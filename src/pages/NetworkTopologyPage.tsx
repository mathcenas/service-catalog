import { useState, useEffect } from 'react';
import { Node, Edge } from '@xyflow/react';
import { TopologyCanvas, edgeStyleFor, type StoredEdgeStyle } from '../components/TopologyCanvas';
import { supabase, Client } from '../lib/supabase';
import type { DeviceNodeData, DeviceStatus } from '../components/nodes/DeviceNode';
import { guessDeviceKind, type DeviceKind } from '../components/nodes/deviceIcons';

type Site = { id: string; name: string; city?: string };

type ServiceRow = {
  id: string;
  name: string;
  business_name?: string;
  server_ip?: string;
  status: string;
  operational_status?: string | null;
  telemetry_enabled?: boolean | null;
  uptime_status_url?: string | null;
  mac_address?: string | null;
  ip_internal?: string | null;
  ip_public?: string | null;
  site_id?: string;
  service_types: { name: string } | null;
};

/** Equipo que descubre el router (net-topology-report.rsc) */
export type DiscoveredDevice = {
  id: string;
  site_id: string;
  name: string;
  device_type: string;
  ip_address: string | null;
  mac_address: string | null;
  model: string | null;
  last_seen: string | null;
  service_id: string | null;
  map_visibility: 'auto' | 'show' | 'hide';
};
type NetLink = { source_device_id: string; target_device_id: string; source_port: string | null; target_port: string | null; link_type: string | null };

/** Infraestructura de red: es lo único que el mapa muestra solo, sin que lo pidas */
const INFRA_TYPES = new Set(['router', 'mikrotik', 'switch_managed', 'switch_unmanaged', 'ap', 'google_wifi', 'firewall']);

const KIND_BY_TYPE: Record<string, DeviceKind> = {
  router: 'router', mikrotik: 'router', switch_managed: 'switch', switch_unmanaged: 'switch',
  ap: 'ap', google_wifi: 'ap', firewall: 'firewall', phone: 'phone', endpoint: 'pc',
  workstation: 'pc', server: 'server', nvr: 'nas',
};

export const DEVICE_TYPE_LABEL: Record<string, string> = {
  router: 'Router', mikrotik: 'Router', switch_managed: 'Switch', switch_unmanaged: 'Switch',
  ap: 'Access Point', google_wifi: 'Access Point', firewall: 'Firewall', phone: 'Teléfono IP',
  endpoint: 'Equipo final', workstation: 'PC', server: 'Servidor', nvr: 'NVR',
};

export const isOnMap = (d: DiscoveredDevice) =>
  d.map_visibility === 'show' || (d.map_visibility === 'auto' && INFRA_TYPES.has(d.device_type));

/** Puerto legible: "ether2,bridge" → "ether2" */
const cleanPort = (p?: string | null) => (p || '').split(',').map(x => x.trim()).find(x => x && !/^bridge/i.test(x)) || undefined;

function discoveredStatus(d: DiscoveredDevice): { status: DeviceStatus; text?: string } {
  if (!d.last_seen) return { status: 'unknown' };
  const ageH = (Date.now() - new Date(d.last_seen).getTime()) / 3_600_000;
  if (ageH <= 2) return { status: 'up', text: `Visto ${relativeEs(d.last_seen)}` };
  if (ageH <= 24) return { status: 'warn', text: `No se ve · ${relativeEs(d.last_seen)}` };
  return { status: 'down', text: `No se ve · ${relativeEs(d.last_seen)}` };
}

/** Estado de Uptime Kuma (página de estado del servicio): caído si algún monitor está caído */
async function kumaStatus(url: string): Promise<'up' | 'down' | null> {
  try {
    const base = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '');
    const r = await fetch(`${base}/functions/v1/kuma-proxy?url=${encodeURIComponent(url)}`);
    if (!r.ok) return null;
    const data = await r.json();
    const lists = Object.values(data?.heartbeatList ?? {}) as { status: number }[][];
    const last = lists.map(l => l[l.length - 1]).filter(Boolean);
    if (!last.length) return null;
    return last.some(h => h.status === 0) ? 'down' : 'up';
  } catch {
    return null;
  }
}

type LayoutOverride = { device_id: string; x: number; y: number; kind?: string | null; critical?: boolean | null };
type CustomNodeRow = { id: string; kind: string; label: string; ip: string | null; note: string | null; x: number; y: number };
type NetEdge = {
  id: string;
  source_id: string;
  target_id: string;
  label?: string | null;
  edge_style?: (StoredEdgeStyle & { style?: unknown }) | null;
};
type Heartbeat = { service_id: string; status: string; received_at: string };

function relativeEs(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `hace ${Math.max(mins, 1)} min`;
  const h = Math.round(mins / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
}

/** Estado del equipo: operativo del catálogo + último heartbeat de cualquier script */
function deviceStatus(svc: ServiceRow, hb?: Heartbeat): { status: DeviceStatus; text?: string } {
  if (svc.operational_status === 'Down') return { status: 'down', text: 'Caído' };
  if (svc.operational_status === 'Degraded') return { status: 'warn', text: 'Degradado' };
  if (hb) {
    const ageH = (Date.now() - new Date(hb.received_at).getTime()) / 3_600_000;
    if (ageH > 2) return { status: 'down', text: `Sin señal · ${relativeEs(hb.received_at)}` };
    if (hb.status === 'error') return { status: 'down', text: `Error · ${relativeEs(hb.received_at)}` };
    if (hb.status === 'warning') return { status: 'warn', text: `Advertencia · ${relativeEs(hb.received_at)}` };
    return { status: 'up', text: relativeEs(hb.received_at) };
  }
  if (svc.telemetry_enabled) return { status: 'down', text: 'Nunca reportó' };
  return { status: 'unknown' };
}

/**
 * Ubicación inicial de los equipos que todavía no moviste: en niveles siguiendo los enlaces
 * (routers arriba, lo que cuelga de ellos debajo) y los sueltos en una fila al final.
 * No toca los que ya tienen posición guardada.
 */
function autoLayout(nodes: Node[], fixed: Set<string>, links: [string, string][]) {
  const ids = new Set(nodes.map(n => n.id));
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of links) {
    if (!ids.has(a) || !ids.has(b) || a === b) continue;
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  }
  const kindOf = (id: string) => (nodes.find(n => n.id === id)?.data as DeviceNodeData | undefined)?.kind;
  const rank: Record<string, number> = { internet: 0, firewall: 1, router: 1, sdwan: 1, switch: 2, ap: 3 };
  const roots = [...adj.keys()].sort((a, b) => (rank[kindOf(a) ?? ''] ?? 9) - (rank[kindOf(b) ?? ''] ?? 9) || (adj.get(b)!.size - adj.get(a)!.size));
  const level = new Map<string, number>();
  for (const r of roots) {
    if (level.has(r)) continue;
    level.set(r, 0);
    const queue = [r];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) if (!level.has(nb)) { level.set(nb, level.get(cur)! + 1); queue.push(nb); }
    }
  }
  const rows = new Map<number, Node[]>();
  const loose: Node[] = [];
  for (const n of nodes) {
    if (fixed.has(n.id)) continue;
    const l = level.get(n.id);
    if (l === undefined) loose.push(n); else (rows.get(l) ?? rows.set(l, []).get(l)!).push(n);
  }
  const maxLevel = rows.size ? Math.max(...rows.keys()) : -1;
  const place = (list: Node[], y: number) => {
    const width = (list.length - 1) * 260;
    list.forEach((n, i) => { n.position = { x: 400 - width / 2 + i * 260, y }; });
  };
  for (const [l, list] of rows) place(list, 60 + l * 210);
  place(loose, 60 + (maxLevel + 1) * 210 + 40);
}

function defaultGrid(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: 60 + col * 240, y: 80 + row * 200 };
}

export default function NetworkTopologyPage() {
  const [clients, setClients]     = useState<Client[]>([]);
  const [clientId, setClientId]   = useState<string>('');
  const [sites, setSites]         = useState<Site[]>([]);
  const [siteId, setSiteId]       = useState<string>('');
  const [nodes, setNodes]         = useState<Node[]>([]);
  const [edges, setEdges]         = useState<Edge[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading]     = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredDevice[]>([]);
  const [showDiscovered, setShowDiscovered] = useState(false);
  const [svcOptions, setSvcOptions] = useState<{ id: string; name: string }[]>([]);

  // Load clients once
  useEffect(() => {
    supabase.from('clients').select('id, company_name').order('company_name')
      .then(({ data }) => {
        if (data?.length) {
          setClients(data as Client[]);
          setClientId(data[0].id);
        }
      });
  }, []);

  // Load sites when client changes
  useEffect(() => {
    if (!clientId) return;
    supabase.from('sites').select('id, name, city').eq('client_id', clientId).order('name')
      .then(({ data }) => {
        const list = (data ?? []) as Site[];
        setSites(list);
        setSiteId(list[0]?.id ?? '');
      });
  }, [clientId]);

  // Load services + layout + edges when site or client changes
  useEffect(() => {
    if (!clientId) return;
    loadTopology();
  }, [clientId, siteId, refreshKey]);

  async function loadTopology() {
    setLoading(true);

    let svcQuery = supabase
      .from('services')
      .select('id, name, business_name, server_ip, ip_internal, ip_public, mac_address, status, operational_status, telemetry_enabled, uptime_status_url, site_id, service_types(name)')
      .eq('client_id', clientId)
      .neq('status', 'Cancelled');
    if (siteId) svcQuery = svcQuery.eq('site_id', siteId);

    const byScope = (table: string, cols: string) => siteId
      ? supabase.from(table).select(cols).eq('site_id', siteId)
      : supabase.from(table).select(cols).eq('client_id', clientId).is('site_id', null);

    // Equipos y enlaces que descubre el router (por sitio; en "Todos", los de todos los sitios del cliente)
    let devQuery = supabase.from('net_devices')
      .select('id, site_id, name, device_type, ip_address, mac_address, model, last_seen, service_id, map_visibility, sites!inner(client_id)')
      .eq('sites.client_id', clientId);
    let linkQuery = supabase.from('net_links')
      .select('source_device_id, target_device_id, source_port, target_port, link_type, sites!inner(client_id)')
      .eq('sites.client_id', clientId);
    if (siteId) { devQuery = devQuery.eq('site_id', siteId); linkQuery = linkQuery.eq('site_id', siteId); }

    const [{ data: svcs }, { data: layoutRows }, { data: edgeRows }, { data: customRows }, { data: devRows }, { data: linkRows }] = await Promise.all([
      svcQuery,
      byScope('net_layout_overrides', 'device_id, x, y, kind, critical'),
      byScope('net_edges', 'id, source_id, target_id, label, edge_style'),
      byScope('net_custom_nodes', 'id, kind, label, ip, note, x, y'),
      devQuery,
      linkQuery,
    ]);
    const discovered = ((devRows ?? []) as unknown as DiscoveredDevice[]).map(d => ({ ...d, map_visibility: d.map_visibility ?? 'auto' }));
    setDiscovered(discovered);

    const services = (svcs ?? []) as unknown as ServiceRow[];
    setSvcOptions(services.map(s => ({ id: s.id, name: s.business_name || s.name })));

    // Último heartbeat por servicio (cualquier script), últimas 48 h
    const latestHb: Record<string, Heartbeat> = {};
    if (services.length) {
      const { data: hbs } = await supabase
        .from('service_heartbeats')
        .select('service_id, status, received_at')
        .in('service_id', services.map(s => s.id))
        .gte('received_at', new Date(Date.now() - 48 * 3_600_000).toISOString())
        .order('received_at', { ascending: false })
        .limit(1000);
      for (const h of (hbs ?? []) as Heartbeat[]) if (!latestHb[h.service_id]) latestHb[h.service_id] = h;
    }

    const overrides: Record<string, LayoutOverride> = {};
    for (const r of (layoutRows ?? []) as unknown as LayoutOverride[]) overrides[r.device_id] = r;

    // Uptime Kuma (si el servicio tiene página de estado): un monitor caído manda
    const kumaUrls = [...new Set(services.map(s => s.uptime_status_url).filter(Boolean) as string[])];
    const kuma: Record<string, 'up' | 'down' | null> = {};
    await Promise.all(kumaUrls.map(async u => { kuma[u] = await kumaStatus(u); }));

    // Equipo descubierto → servicio que lo "absorbe" (vínculo guardado, o misma MAC)
    const norm = (v?: string | null) => (v || '').trim().toUpperCase();
    const svcByMac = new Map(services.filter(s => s.mac_address).map(s => [norm(s.mac_address), s.id]));
    const ownerOf = (d: DiscoveredDevice) =>
      (d.service_id && services.some(s => s.id === d.service_id) ? d.service_id : null) ?? svcByMac.get(norm(d.mac_address)) ?? null;
    const absorbedBy = new Map<string, DiscoveredDevice>();
    for (const d of discovered) { const sid = ownerOf(d); if (sid) absorbedBy.set(sid, d); }

    const serviceNodes: Node[] = services.map((svc, i) => {
      const o = overrides[svc.id];
      let st = deviceStatus(svc, latestHb[svc.id]);
      const k = svc.uptime_status_url ? kuma[svc.uptime_status_url] : null;
      if (k === 'down') st = { status: 'down', text: 'Kuma: caído' };
      else if (k === 'up' && st.status === 'unknown') st = { status: 'up', text: 'Kuma: OK' };
      const disc = absorbedBy.get(svc.id);
      if (st.status === 'unknown' && disc) st = discoveredStatus(disc);
      const data: DeviceNodeData = {
        label: svc.business_name || svc.name,
        ip: svc.server_ip || svc.ip_internal || disc?.ip_address || '',
        kind: (o?.kind as DeviceKind) || guessDeviceKind(svc.service_types?.name, `${svc.name} ${svc.business_name ?? ''}`),
        status: st.status,
        statusText: st.text,
        critical: !!o?.critical,
      };
      if (o?.kind) data._kindOverride = o.kind;
      return { id: svc.id, type: 'device', position: o ? { x: o.x, y: o.y } : defaultGrid(i), data };
    });

    const customNodes: Node[] = ((customRows ?? []) as unknown as CustomNodeRow[]).map(c => ({
      id: c.id,
      type: 'device',
      position: { x: c.x, y: c.y },
      data: {
        label: c.label, ip: c.ip ?? '', note: c.note ?? '', kind: (c.kind as DeviceKind) || 'internet',
        status: 'unknown', custom: true,
      } satisfies DeviceNodeData,
    }));

    // Equipos descubiertos sin servicio que los absorba: solo infraestructura (o los que marcaste "mostrar")
    const discNodeId = new Map<string, string>();   // id net_device → id del nodo en el mapa
    for (const d of discovered) { const sid = ownerOf(d); if (sid) discNodeId.set(d.id, sid); }
    const discoveredNodes: Node[] = discovered
      .filter(d => !ownerOf(d) && isOnMap(d))
      .map((d, i) => {
        discNodeId.set(d.id, d.id);
        const o = overrides[d.id];
        const st = discoveredStatus(d);
        const unnamed = !d.name || norm(d.name) === norm(d.mac_address);
        const data: DeviceNodeData = {
          label: unnamed ? (d.model || DEVICE_TYPE_LABEL[d.device_type] || 'Equipo') : d.name,
          ip: d.ip_address ?? '',
          kind: (o?.kind as DeviceKind) || KIND_BY_TYPE[d.device_type] || 'switch',
          note: unnamed ? '' : (d.model ?? ''),
          status: st.status,
          statusText: st.text,
          critical: !!o?.critical,
          discovered: true,
        };
        if (o?.kind) data._kindOverride = o.kind;
        return { id: d.id, type: 'device', position: o ? { x: o.x, y: o.y } : defaultGrid(services.length + i), data };
      });

    const nodeIds = new Set([...serviceNodes, ...customNodes, ...discoveredNodes].map(n => n.id));
    const builtEdges: Edge[] = ((edgeRows ?? []) as unknown as NetEdge[])
      .filter(e => nodeIds.has(e.source_id) && nodeIds.has(e.target_id))
      .map(e => {
        const st = e.edge_style ?? {};
        const data: StoredEdgeStyle = {
          type: st.type,
          sourcePort: st.sourcePort,
          targetPort: st.targetPort,
          // Enlaces viejos tenían una sola etiqueta en la columna label
          midLabel: st.midLabel ?? e.label ?? undefined,
          sourceHandle: st.sourceHandle,
          targetHandle: st.targetHandle,
        };
        return {
          id: e.id, source: e.source_id, target: e.target_id, type: 'port',
          sourceHandle: st.sourceHandle ?? undefined, targetHandle: st.targetHandle ?? undefined,
          style: edgeStyleFor(st.type), data,
        };
      });

    // Enlaces que detecta el router (LLDP), con el puerto en cada punta. Un enlace dibujado
    // a mano entre los mismos equipos tiene prioridad.
    const allNodes = [...serviceNodes, ...customNodes, ...discoveredNodes];
    autoLayout(allNodes, new Set(Object.keys(overrides).concat(customNodes.map(n => n.id))),
      [...builtEdges.map(e => [e.source, e.target] as [string, string]),
       ...((linkRows ?? []) as unknown as NetLink[]).map(l => [discNodeId.get(l.source_device_id) ?? '', discNodeId.get(l.target_device_id) ?? ''] as [string, string])]);
    const pos = new Map(allNodes.map(n => [n.id, n.position]));
    const manualPairs = new Set(builtEdges.flatMap(e => [`${e.source}|${e.target}`, `${e.target}|${e.source}`]));
    const autoEdges: Edge[] = [];
    for (const l of (linkRows ?? []) as unknown as NetLink[]) {
      const a = discNodeId.get(l.source_device_id);
      const b = discNodeId.get(l.target_device_id);
      if (!a || !b || a === b || !nodeIds.has(a) || !nodeIds.has(b) || manualPairs.has(`${a}|${b}`)) continue;
      manualPairs.add(`${a}|${b}`); manualPairs.add(`${b}|${a}`);
      const pa = pos.get(a)!, pb = pos.get(b)!;
      const vertical = Math.abs(pb.y - pa.y) >= Math.abs(pb.x - pa.x);
      const [sh, th] = vertical ? (pb.y > pa.y ? ['bottom', 'top'] : ['top', 'bottom']) : (pb.x > pa.x ? ['right', 'left'] : ['left', 'right']);
      const type = l.link_type === 'fiber' ? 'fibra' : l.link_type === 'mesh_wifi' ? 'wifi' : 'utp';
      autoEdges.push({
        id: `auto-${l.source_device_id}-${l.target_device_id}`, source: a, target: b, type: 'port',
        sourceHandle: sh, targetHandle: th, style: edgeStyleFor(type),
        data: { type, sourcePort: cleanPort(l.source_port), targetPort: cleanPort(l.target_port), auto: true } as StoredEdgeStyle,
      });
    }

    setNodes(allNodes);
    setEdges([...builtEdges, ...autoEdges]);
    setLoading(false);
  }

  const selectedSite = sites.find(s => s.id === siteId);

  const pill = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
      active ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
    }`;

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Topología de red</h1>
          <p className="text-xs text-gray-500">Diagrama por site, con el estado de cada equipo según la telemetría</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            className="bg-white border border-slate-200 text-slate-700 text-xs rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-sky-500"
          >
            {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          {discovered.length > 0 && (
            <button onClick={() => setShowDiscovered(v => !v)} className={pill(showDiscovered)}>
              Descubiertos · {discovered.length}
            </button>
          )}
          {sites.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {sites.map(s => (
                <button key={s.id} onClick={() => setSiteId(s.id)} className={pill(siteId === s.id)}>{s.name}</button>
              ))}
              <button onClick={() => setSiteId('')} className={pill(!siteId)}>Todos</button>
            </div>
          ) : (
            <span className="text-xs text-slate-500 italic">Sin sites: asigná servicios a un site</span>
          )}
        </div>
      </div>

      {showDiscovered && (
        <DiscoveredPanel
          devices={discovered}
          services={svcOptions}
          onChanged={() => setRefreshKey(k => k + 1)}
        />
      )}

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-64 text-slate-500 text-sm">Cargando…</div>
        ) : nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500 text-sm gap-2 bg-white border border-slate-200 rounded-xl">
            <p>No hay servicios en este site.</p>
            <p className="text-xs text-slate-400">Asigná un site a los servicios desde el panel de servicios del cliente.</p>
          </div>
        ) : (
          <TopologyCanvas
            key={`${clientId}-${siteId}-${refreshKey}`}
            initialNodes={nodes}
            initialEdges={edges}
            clientId={clientId}
            siteId={siteId}
            siteName={selectedSite?.name ?? clients.find(c => c.id === clientId)?.company_name ?? 'Todos'}
            onRefresh={() => setRefreshKey(k => k + 1)}
          />
        )}
      </div>
    </div>
  );
}

/** Lista de todo lo que vio el router: qué se muestra en el mapa y a qué servicio corresponde */
function DiscoveredPanel({ devices, services, onChanged }: {
  devices: DiscoveredDevice[];
  services: { id: string; name: string }[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = [...devices].sort((a, b) =>
    Number(isOnMap(b)) - Number(isOnMap(a)) || (a.device_type || '').localeCompare(b.device_type || '') || a.name.localeCompare(b.name));

  const setVisibility = async (d: DiscoveredDevice, v: DiscoveredDevice['map_visibility']) => {
    setBusy(d.id);
    await supabase.from('net_devices').update({ map_visibility: v }).eq('id', d.id);
    setBusy(null);
    onChanged();
  };
  const linkService = async (d: DiscoveredDevice, serviceId: string) => {
    setBusy(d.id);
    await supabase.from('net_devices').update({ service_id: serviceId || null }).eq('id', d.id);
    if (serviceId && d.mac_address) {
      // El servicio "absorbe" la MAC si no tenía una cargada
      await supabase.from('services').update({ mac_address: d.mac_address }).eq('id', serviceId).is('mac_address', null);
    }
    setBusy(null);
    onChanged();
  };

  return (
    <div className="mb-3 bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 text-xs text-slate-500">
        Lo que ve el router (LLDP/CDP). En el mapa aparece solo la infraestructura (routers, switches, APs) y lo que marques
        para mostrar. Si un equipo es un servicio del catálogo, vinculalo: el nodo pasa a ser el del servicio y toma su MAC.
      </div>
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Equipo</th>
              <th className="px-3 py-2 font-semibold">Tipo</th>
              <th className="px-3 py-2 font-semibold">IP / MAC</th>
              <th className="px-3 py-2 font-semibold">En el mapa</th>
              <th className="px-3 py-2 font-semibold">Servicio</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map(d => {
              const unnamed = !d.name || d.name.toUpperCase() === (d.mac_address || '').toUpperCase();
              return (
                <tr key={d.id} className={busy === d.id ? 'opacity-50' : ''}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{unnamed ? <span className="italic text-slate-400">Sin nombre</span> : d.name}</div>
                    {d.model && <div className="text-slate-400">{d.model}</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{DEVICE_TYPE_LABEL[d.device_type] ?? d.device_type}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{d.ip_address || '—'}<br />{d.mac_address}</td>
                  <td className="px-3 py-2">
                    <select value={d.map_visibility} onChange={e => setVisibility(d, e.target.value as DiscoveredDevice['map_visibility'])}
                      className="border border-slate-200 rounded px-1.5 py-1 bg-white">
                      <option value="auto">{INFRA_TYPES.has(d.device_type) ? 'Auto (se muestra)' : 'Auto (oculto)'}</option>
                      <option value="show">Mostrar</option>
                      <option value="hide">Ocultar</option>
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select value={d.service_id ?? ''} onChange={e => linkService(d, e.target.value)}
                      className="border border-slate-200 rounded px-1.5 py-1 bg-white max-w-[12rem]">
                      <option value="">— ninguno —</option>
                      {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
