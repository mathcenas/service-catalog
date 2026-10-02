# Red — Topología de Red

Vista interactiva de la infraestructura de red por cliente y site, construida sobre ReactFlow.

---

## Estructura de archivos

```
src/
  components/
    TopologyCanvas.tsx          # Canvas principal (ReactFlow)
    nodes/
      MikroTikNode.tsx          # Router MikroTik — uptime, throughput
      UnmanagedNode.tsx         # Switch no administrado
      EndpointNode.tsx          # Server / workstation
  pages/
    NetworkTopologyPage.tsx     # Página con selector cliente + site
```

---

## Agregar la ruta

En `App.tsx` (o donde estén las rutas):

```tsx
import NetworkTopologyPage from './pages/NetworkTopologyPage';

// dentro del router:
<Route path="/network" element={<NetworkTopologyPage />} />
```

---

## Agregar un nuevo tipo de nodo

1. Crear `src/components/nodes/MiNuevoNode.tsx` con la interfaz `MiNuevoNodeData` y los `Handle` de ReactFlow.
2. Registrarlo en `TopologyCanvas.tsx`:
   ```ts
   const nodeTypes = {
     mikrotik:  MikroTikNode,
     unmanaged: UnmanagedNode,
     endpoint:  EndpointNode,
     minuevo:   MiNuevoNode,   // ← agregar acá
   };
   ```
3. Usarlo en los datos enviando `type: 'minuevo'` en el nodo.

---

## Agregar un nuevo site / cliente

Mientras se usa mock data (antes de que el colector esté activo), editar `MOCK_SITES` en `NetworkTopologyPage.tsx`:

```ts
const MOCK_SITES = {
  'rbuy-central':   { nodes: [...], edges: [...] },
  'rbuy-sucursal':  { nodes: [...], edges: [...] },
  'nuevo-cliente-sede': { nodes: [...], edges: [...] },  // ← agregar
};
```

---

## Conexión con datos reales (cuando rbuy-netinv esté activo)

Reemplazar el bloque de mock data en `NetworkTopologyPage.tsx` por un `useEffect` que consulte Supabase:

```ts
useEffect(() => {
  if (!clientId || !siteId) return;

  Promise.all([
    supabase.from('net_devices').select('*').eq('client_id', clientId).eq('site_id', siteId),
    supabase.from('net_edges').select('*').eq('client_id', clientId).eq('site_id', siteId),
    supabase.from('net_layout_overrides').select('*').eq('client_id', clientId).eq('site_id', siteId),
  ]).then(([{ data: devices }, { data: edges }, { data: layouts }]) => {
    const posMap = Object.fromEntries((layouts ?? []).map(l => [l.device_id, { x: l.x, y: l.y }]));

    const nodes: Node[] = (devices ?? []).map((d, i) => ({
      id:       d.device_id,
      type:     d.type,
      position: posMap[d.device_id] ?? { x: (i % 4) * 220, y: Math.floor(i / 4) * 180 },
      data:     { hostname: d.hostname, ip: d.ip, model: d.model, status: d.status,
                  uptime_seconds: d.uptime_seconds, throughput_in_bps: d.throughput_in_bps,
                  throughput_out_bps: d.throughput_out_bps },
    }));

    const flowEdges: Edge[] = (edges ?? []).map(e => ({
      id:     e.id,
      source: e.source_device_id,
      target: e.target_device_id,
      style:  { stroke: '#334155', strokeWidth: 2 },
    }));

    setNodes(nodes);
    setEdges(flowEdges);
  });
}, [clientId, siteId, refreshKey]);
```

---

## Tablas Supabase requeridas

```sql
-- Dispositivos de red
create table net_devices (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id) on delete cascade,
  site_id          text not null,
  device_id        text not null,
  type             text not null,  -- 'mikrotik' | 'unmanaged' | 'endpoint'
  hostname         text,
  ip               text,
  model            text,
  status           text default 'unknown',
  uptime_seconds   int,
  throughput_in_bps  bigint,
  throughput_out_bps bigint,
  raw_data         jsonb,
  source           text,
  last_seen_at     timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (client_id, site_id, device_id)
);

-- Conexiones entre dispositivos
create table net_edges (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id) on delete cascade,
  site_id          text not null,
  source_device_id text not null,
  target_device_id text not null,
  link_type        text default 'ethernet',
  raw_data         jsonb,
  updated_at       timestamptz default now()
);

-- Posiciones guardadas por el usuario en el canvas
create table net_layout_overrides (
  id        uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  site_id   text not null,
  device_id text not null,
  x         float not null,
  y         float not null,
  updated_at timestamptz default now(),
  unique (client_id, site_id, device_id)
);
```

---

## Edge function `ingest-net-topology`

Endpoint para recibir datos de los colectores (UniFi y MikroTik). Payload esperado:

```json
{
  "client_id": "uuid",
  "site_id":   "rbuy-central",
  "source":    "rbuy-netinv",
  "devices": [
    {
      "device_id": "mac-o-id-unico",
      "type":      "mikrotik",
      "hostname":  "RB-RBUY-CORE",
      "ip":        "10.0.0.1",
      "model":     "CCR2004",
      "status":    "online",
      "uptime_seconds": 432000,
      "throughput_in_bps": 48500000,
      "throughput_out_bps": 12200000
    }
  ],
  "edges": [
    { "source_device_id": "mac1", "target_device_id": "mac2", "link_type": "ethernet" }
  ]
}
```

La función hace upsert en `net_devices` y `net_edges` por `(client_id, site_id, device_id)`.
