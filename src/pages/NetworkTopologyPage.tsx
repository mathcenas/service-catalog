import React, { useState, useEffect } from 'react';
import { Node, Edge } from '@xyflow/react';
import { TopologyCanvas } from '../components/TopologyCanvas';
import { supabase, Client } from '../lib/supabase';

type Site = { id: string; name: string; city?: string };

type ServiceRow = {
  id: string;
  name: string;
  business_name?: string;
  server_ip?: string;
  provider?: string;
  status: string;
  site_id?: string;
  service_types: { name: string } | null;
};

type LayoutOverride = { service_id: string; x: number; y: number };
type NetEdge = {
  id: string;
  source_id: string;
  target_id: string;
  label?: string;
  edge_style?: Record<string, unknown>;
};

function serviceTypeToNodeType(typeName: string | undefined): string {
  if (!typeName) return 'endpoint';
  const n = typeName.toLowerCase();
  if (n.includes('router') || n.includes('switch') || n.includes('firewall')) return 'mikrotik';
  return 'endpoint';
}

function serviceToNode(svc: ServiceRow, pos: { x: number; y: number }): Node {
  const typeName = svc.service_types?.name;
  const nodeType = serviceTypeToNodeType(typeName);
  const isMikrotik = nodeType === 'mikrotik';

  return {
    id: svc.id,
    type: nodeType,
    position: pos,
    data: {
      hostname: svc.business_name || svc.name,
      ip:       svc.server_ip ?? '',
      model:    isMikrotik ? (svc.provider ?? typeName ?? '') : undefined,
      type:     isMikrotik ? undefined : 'server',
      status:   svc.status === 'Active' ? 'online' : 'offline',
    },
  };
}

function defaultGrid(index: number): { x: number; y: number } {
  const col = index % 3;
  const row = Math.floor(index / 3);
  return { x: 80 + col * 260, y: 60 + row * 220 };
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

    // Services: filter by site if one is selected, otherwise all client services
    let svcQuery = supabase
      .from('services')
      .select('id, name, business_name, server_ip, provider, status, site_id, service_types(name)')
      .eq('client_id', clientId)
      .neq('status', 'Cancelled');

    if (siteId) svcQuery = svcQuery.eq('site_id', siteId);

    const [{ data: svcs }, { data: layoutRows }, { data: edgeRows }] = await Promise.all([
      svcQuery,
      siteId
        ? supabase.from('net_layout_overrides').select('service_id, x, y').eq('site_id', siteId)
        : Promise.resolve({ data: [] }),
      siteId
        ? supabase.from('net_edges').select('id, source_id, target_id, label, edge_style').eq('site_id', siteId)
        : Promise.resolve({ data: [] }),
    ]);

    const overrides: Record<string, { x: number; y: number }> = {};
    for (const r of (layoutRows ?? []) as LayoutOverride[]) {
      overrides[r.service_id] = { x: r.x, y: r.y };
    }

    const builtNodes: Node[] = ((svcs ?? []) as ServiceRow[]).map((svc, i) =>
      serviceToNode(svc, overrides[svc.id] ?? defaultGrid(i))
    );

    const builtEdges: Edge[] = ((edgeRows ?? []) as NetEdge[]).map(e => ({
      id:     e.id,
      source: e.source_id,
      target: e.target_id,
      type:   'smoothstep',
      label:  e.label ?? undefined,
      style:  (e.edge_style as React.CSSProperties) ?? { stroke: '#334155', strokeWidth: 2 },
    }));

    setNodes(builtNodes);
    setEdges(builtEdges);
    setLoading(false);
  }

  const selectedSite = sites.find(s => s.id === siteId);

  return (
    <div className="flex flex-col h-full bg-[#0B192C] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-700/50 flex-shrink-0">
        <div>
          <h1 className="text-sm font-bold text-white">Topología de Red</h1>
          <p className="text-[11px] text-slate-500">Vista por site</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={clientId}
            onChange={e => setClientId(e.target.value)}
            className="bg-[#1E293B] border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 outline-none focus:border-cyan-500"
          >
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>

          {sites.length > 0 ? (
            <div className="flex gap-1">
              {sites.map(s => (
                <button
                  key={s.id}
                  onClick={() => setSiteId(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    siteId === s.id
                      ? 'bg-cyan-600 text-white'
                      : 'bg-[#1E293B] border border-slate-700 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s.name}
                </button>
              ))}
              <button
                onClick={() => setSiteId('')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  !siteId
                    ? 'bg-cyan-600 text-white'
                    : 'bg-[#1E293B] border border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                Todos
              </button>
            </div>
          ) : (
            <span className="text-xs text-slate-500 italic">Sin sites — asigná servicios a un site</span>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">Cargando…</div>
        ) : nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 text-sm gap-2">
            <p>No hay servicios en este site.</p>
            <p className="text-xs text-slate-600">Asigná un site a los servicios desde el panel de servicios del cliente.</p>
          </div>
        ) : (
          <TopologyCanvas
            key={`${clientId}-${siteId}-${refreshKey}`}
            initialNodes={nodes}
            initialEdges={edges}
            clientId={clientId}
            siteId={siteId}
            siteName={selectedSite?.name ?? 'Todos'}
            onRefresh={() => setRefreshKey(k => k + 1)}
          />
        )}
      </div>
    </div>
  );
}
