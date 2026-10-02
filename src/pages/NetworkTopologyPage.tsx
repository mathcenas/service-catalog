import { useState, useEffect } from 'react';
import { Node, Edge } from '@xyflow/react';
import { TopologyCanvas } from '../components/TopologyCanvas';
import { supabase, Client } from '../lib/supabase';

// ── Mock data — reemplazar con fetch a net_devices / net_edges ──────────────
const MOCK_SITES: Record<string, { nodes: Node[]; edges: Edge[] }> = {
  'rbuy-central': {
    nodes: [
      {
        id: 'router-1',
        type: 'mikrotik',
        position: { x: 280, y: 40 },
        data: {
          hostname: 'RB-RBUY-CORE',
          ip: '10.0.0.1',
          model: 'MikroTik CCR2004',
          status: 'online',
          uptime_seconds: 432000,
          throughput_in_bps: 48_500_000,
          throughput_out_bps: 12_200_000,
        },
      },
      {
        id: 'sw-access-1',
        type: 'unmanaged',
        position: { x: 100, y: 220 },
        data: { hostname: 'SW-PLANTA-1', ip: '10.0.0.10', model: 'TP-Link TL-SG1024', status: 'online' },
      },
      {
        id: 'sw-access-2',
        type: 'unmanaged',
        position: { x: 460, y: 220 },
        data: { hostname: 'SW-ADMIN', ip: '10.0.0.11', model: 'TP-Link TL-SG1016', status: 'online' },
      },
      {
        id: 'srv-1',
        type: 'endpoint',
        position: { x: 40, y: 400 },
        data: { hostname: 'SRV-BACKUP', ip: '10.0.1.5', type: 'server', status: 'online' },
      },
      {
        id: 'srv-2',
        type: 'endpoint',
        position: { x: 180, y: 400 },
        data: { hostname: 'SRV-ERP', ip: '10.0.1.6', type: 'server', status: 'online' },
      },
      {
        id: 'ws-1',
        type: 'endpoint',
        position: { x: 400, y: 400 },
        data: { hostname: 'PC-ADMIN-01', ip: '10.0.2.10', status: 'online' },
      },
      {
        id: 'ws-2',
        type: 'endpoint',
        position: { x: 540, y: 400 },
        data: { hostname: 'PC-CONTA-01', ip: '10.0.2.11', status: 'offline' },
      },
    ],
    edges: [
      { id: 'e1', source: 'router-1',    target: 'sw-access-1', type: 'smoothstep', label: 'Fibra · Te1', labelStyle: { fill: '#06B6D4', fontSize: 10 }, labelBgStyle: { fill: '#0B192C' }, style: { stroke: '#06B6D4', strokeWidth: 2 } },
      { id: 'e2', source: 'router-1',    target: 'sw-access-2', type: 'smoothstep', label: 'Fibra · Te2', labelStyle: { fill: '#06B6D4', fontSize: 10 }, labelBgStyle: { fill: '#0B192C' }, style: { stroke: '#06B6D4', strokeWidth: 2 } },
      { id: 'e3', source: 'sw-access-1', target: 'srv-1',       type: 'smoothstep', label: 'UTP · Gi1',  labelStyle: { fill: '#64748B', fontSize: 10 }, labelBgStyle: { fill: '#0B192C' }, style: { stroke: '#334155', strokeWidth: 1.5, strokeDasharray: '5 3' } },
      { id: 'e4', source: 'sw-access-1', target: 'srv-2',       type: 'smoothstep', label: 'UTP · Gi2',  labelStyle: { fill: '#64748B', fontSize: 10 }, labelBgStyle: { fill: '#0B192C' }, style: { stroke: '#334155', strokeWidth: 1.5, strokeDasharray: '5 3' } },
      { id: 'e5', source: 'sw-access-2', target: 'ws-1',        type: 'smoothstep', style: { stroke: '#1e3a5f', strokeWidth: 1.5, strokeDasharray: '5 3' } },
      { id: 'e6', source: 'sw-access-2', target: 'ws-2',        type: 'smoothstep', style: { stroke: '#1e3a5f', strokeWidth: 1.5, strokeDasharray: '5 3' } },
    ],
  },
  'rbuy-sucursal': {
    nodes: [
      {
        id: 'router-suc',
        type: 'mikrotik',
        position: { x: 220, y: 40 },
        data: {
          hostname: 'RB-RBUY-SUC',
          ip: '10.1.0.1',
          model: 'MikroTik hEX S',
          status: 'online',
          uptime_seconds: 86400,
          throughput_in_bps: 5_200_000,
          throughput_out_bps: 1_800_000,
        },
      },
      {
        id: 'sw-suc-1',
        type: 'unmanaged',
        position: { x: 220, y: 220 },
        data: { hostname: 'SW-SUC-MAIN', ip: '10.1.0.10', model: 'TP-Link TL-SG1008', status: 'online' },
      },
      {
        id: 'ws-suc-1',
        type: 'endpoint',
        position: { x: 100, y: 380 },
        data: { hostname: 'PC-SUC-01', ip: '10.1.2.10', status: 'online' },
      },
      {
        id: 'ws-suc-2',
        type: 'endpoint',
        position: { x: 340, y: 380 },
        data: { hostname: 'PC-SUC-02', ip: '10.1.2.11', status: 'unknown' },
      },
    ],
    edges: [
      { id: 'e1', source: 'router-suc', target: 'sw-suc-1',  style: { stroke: '#334155', strokeWidth: 2 } },
      { id: 'e2', source: 'sw-suc-1',   target: 'ws-suc-1',  style: { stroke: '#1e3a5f', strokeWidth: 1.5 } },
      { id: 'e3', source: 'sw-suc-1',   target: 'ws-suc-2',  style: { stroke: '#1e3a5f', strokeWidth: 1.5 } },
    ],
  },
};
// ── Fin mock data ────────────────────────────────────────────────────────────

export default function NetworkTopologyPage() {
  const [clients, setClients]     = useState<Client[]>([]);
  const [clientId, setClientId]   = useState<string>('');
  const [siteId, setSiteId]       = useState<string>('rbuy-central');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    supabase.from('clients').select('id, company_name').order('company_name')
      .then(({ data }) => {
        if (data?.length) {
          setClients(data as Client[]);
          setClientId(data[0].id);
        }
      });
  }, []);

  const siteData = MOCK_SITES[siteId] ?? { nodes: [], edges: [] };
  const sites    = Object.keys(MOCK_SITES);

  return (
    <div className="flex flex-col h-full bg-[#0B192C] text-white">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-700/50 flex-shrink-0">
        <div>
          <h1 className="text-sm font-bold text-white">Topología de Red</h1>
          <p className="text-[11px] text-slate-500">Vista por site</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Cliente selector */}
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="bg-[#1E293B] border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 outline-none focus:border-cyan-500"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
          {/* Site selector */}
          <div className="flex gap-1">
            {sites.map((s) => (
              <button
                key={s}
                onClick={() => setSiteId(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  siteId === s
                    ? 'bg-cyan-600 text-white'
                    : 'bg-[#1E293B] border border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 p-4 min-h-0">
        <TopologyCanvas
          key={`${clientId}-${siteId}-${refreshKey}`}
          initialNodes={siteData.nodes}
          initialEdges={siteData.edges}
          clientId={clientId}
          siteId={siteId}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    </div>
  );
}
