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
  site_id?: string;
  service_types: { name: string } | null;
};

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
      .select('id, name, business_name, server_ip, status, operational_status, telemetry_enabled, site_id, service_types(name)')
      .eq('client_id', clientId)
      .neq('status', 'Cancelled');
    if (siteId) svcQuery = svcQuery.eq('site_id', siteId);

    const byScope = (table: string, cols: string) => siteId
      ? supabase.from(table).select(cols).eq('site_id', siteId)
      : supabase.from(table).select(cols).eq('client_id', clientId).is('site_id', null);

    const [{ data: svcs }, { data: layoutRows }, { data: edgeRows }, { data: customRows }] = await Promise.all([
      svcQuery,
      byScope('net_layout_overrides', 'device_id, x, y, kind, critical'),
      byScope('net_edges', 'id, source_id, target_id, label, edge_style'),
      byScope('net_custom_nodes', 'id, kind, label, ip, note, x, y'),
    ]);

    const services = (svcs ?? []) as unknown as ServiceRow[];

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

    const serviceNodes: Node[] = services.map((svc, i) => {
      const o = overrides[svc.id];
      const st = deviceStatus(svc, latestHb[svc.id]);
      const data: DeviceNodeData = {
        label: svc.business_name || svc.name,
        ip: svc.server_ip ?? '',
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

    const nodeIds = new Set([...serviceNodes, ...customNodes].map(n => n.id));
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

    setNodes([...serviceNodes, ...customNodes]);
    setEdges(builtEdges);
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
