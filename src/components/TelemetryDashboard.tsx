import { useEffect, useState, useMemo, Fragment } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Search, ChevronDown, ChevronRight, Trash2, HardDrive, Wifi, Monitor, Server, LayoutGrid, List } from 'lucide-react';
import { supabase, Service, Client, ServiceHeartbeat } from '../lib/supabase';

interface ServiceBackup {
  id: string;
  service_id: string;
  job_name: string | null;
  status: string;
  size_bytes: number | null;
  duration_seconds: number | null;
  backed_up_at: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Stale threshold per source — rdp/network scripts run every 5min, system-health every hour
function staleThresholdForSource(source: string): number {
  if (source === 'rdp' || source === 'network') return 30 * 60 * 1000;
  if (source === 'speedtest') return 2 * 60 * 60 * 1000;
  return 2 * 60 * 60 * 1000; // system-health
}

function isHbStale(hb: ServiceHeartbeat): boolean {
  return (Date.now() - new Date(hb.received_at).getTime()) > staleThresholdForSource(hb.source);
}

type Props = {
  services: Service[];
  clients: Client[];
};

// Extract readable metrics from payload based on source
function MetricChips({ hb }: { hb: ServiceHeartbeat }) {
  const p = hb.payload as Record<string, unknown>;
  if (!p) return null;

  const chips: { label: string; value: string; warn?: boolean; error?: boolean }[] = [];

  if (hb.source === 'system-health') {
    if (p.cpu_pct != null) chips.push({ label: 'CPU', value: `${p.cpu_pct}%`, warn: Number(p.cpu_pct) > 80, error: Number(p.cpu_pct) > 95 });
    if (p.ram_pct != null) chips.push({ label: 'RAM', value: `${p.ram_pct}%`, warn: Number(p.ram_pct) > 80, error: Number(p.ram_pct) > 92 });
    if (p.disk_pct != null) chips.push({ label: 'Disk', value: `${p.disk_pct}%`, warn: Number(p.disk_pct) > 75, error: Number(p.disk_pct) > 90 });
    if (p.disk_free_gb != null) chips.push({ label: 'Free', value: `${p.disk_free_gb} GB` });
  } else if (hb.source === 'network') {
    if (p.gateway_ok != null) chips.push({ label: 'GW', value: p.gateway_ok ? 'ok' : '✗', error: !p.gateway_ok });
    if (p.internet_ok != null) chips.push({ label: 'Internet', value: p.internet_ok ? 'ok' : '✗', error: !p.internet_ok });
    if (p.ping_ms != null) chips.push({ label: 'Ping', value: `${p.ping_ms}ms`, warn: Number(p.ping_ms) > 100, error: Number(p.ping_ms) > 200 });
    if (p.packet_loss_pct != null) chips.push({ label: 'Loss', value: `${p.packet_loss_pct}%`, warn: Number(p.packet_loss_pct) > 2, error: Number(p.packet_loss_pct) > 10 });
  } else if (hb.source === 'rdp') {
    if (p.rdp_sessions != null) chips.push({ label: 'Sessions', value: p.rdp_max_allowed ? `${p.rdp_sessions}/${p.rdp_max_allowed}` : `${p.rdp_sessions}`, warn: Number(p.rdp_sessions) > 0 && p.rdp_max_allowed && Number(p.rdp_sessions) >= Math.floor(Number(p.rdp_max_allowed) * 0.85) });
    if (p.rdp_disconnects != null) chips.push({ label: 'Disconnects', value: `${p.rdp_disconnects}`, warn: Number(p.rdp_disconnects) > 0, error: Number(p.rdp_disconnects) > 3 });
    if (p.rdp_tcp_connections != null) chips.push({ label: 'TCP 3389', value: `${p.rdp_tcp_connections}` });
    if (p.disk_latency_sec != null && Number(p.disk_latency_sec) > 0) chips.push({ label: 'DiskIO', value: `${p.disk_latency_sec}s`, warn: Number(p.disk_latency_sec) > 0.03, error: Number(p.disk_latency_sec) > 0.05 });
  } else if (hb.source === 'speedtest') {
    if (p.ping_ms != null) chips.push({ label: 'Ping', value: `${p.ping_ms}ms` });
    if (p.packet_loss_pct != null) chips.push({ label: 'Loss', value: `${p.packet_loss_pct}%`, warn: Number(p.packet_loss_pct) > 2 });
    if (p.download_mbps != null) chips.push({ label: '↓', value: `${p.download_mbps} Mbps` });
    if (p.upload_mbps != null) chips.push({ label: '↑', value: `${p.upload_mbps} Mbps` });
  } else {
    // Generic: show all numeric/boolean values
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === 'number' || typeof v === 'boolean') {
        chips.push({ label: k.replace(/_/g, ' '), value: String(v) });
      }
    }
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {chips.map(c => (
        <span key={c.label} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border ${
          c.error ? 'bg-red-50 border-red-200 text-red-700' :
          c.warn  ? 'bg-amber-50 border-amber-200 text-amber-700' :
                    'bg-gray-50 border-gray-200 text-gray-600'
        }`}>
          <span className="text-gray-400">{c.label}</span>
          <span>{c.value}</span>
        </span>
      ))}
    </div>
  );
}

const SOURCE_ICONS: Record<string, typeof Monitor> = {
  'system-health': Server,
  'network': Wifi,
  'rdp': Monitor,
  'speedtest': Wifi,
};

function SourceIcon({ source }: { source: string }) {
  const Icon = SOURCE_ICONS[source] || Activity;
  return <Icon className="w-3.5 h-3.5" />;
}

export function TelemetryDashboard({ services, clients }: Props) {
  const [heartbeats, setHeartbeats] = useState<ServiceHeartbeat[]>([]);
  const [backups, setBackups] = useState<ServiceBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [backupSearch, setBackupSearch] = useState('');
  const [backupClientFilter, setBackupClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'warning' | 'error' | 'stale'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAllBackups, setShowAllBackups] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'log'>('cards');

  const load = async () => {
    setLoading(true);
    const [{ data: hbData }, { data: backupData }] = await Promise.all([
      supabase.from('service_heartbeats').select('*').order('received_at', { ascending: false }).limit(500),
      supabase.from('service_backups').select('*').order('backed_up_at', { ascending: false }).limit(200),
    ]);
    setHeartbeats(hbData || []);
    setBackups(backupData || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const getServiceName = (id: string) => {
    const s = services.find(sv => sv.id === id);
    return s?.business_name || s?.name || 'Unknown';
  };

  const getClientForService = (serviceId: string) => {
    const s = services.find(sv => sv.id === serviceId);
    if (!s) return null;
    return clients.find(c => c.id === s.client_id);
  };

  // Latest heartbeat per service per source
  const latestPerServiceSource = useMemo(() => {
    const map = new Map<string, ServiceHeartbeat>(); // key: serviceId|source
    for (const hb of heartbeats) {
      const key = `${hb.service_id}|${hb.source}`;
      if (!map.has(key)) map.set(key, hb);
    }
    return map;
  }, [heartbeats]);

  // Latest heartbeat per service (any source, most recent)
  const latestPerService = useMemo(() => {
    const map = new Map<string, ServiceHeartbeat>();
    for (const hb of heartbeats) {
      if (!map.has(hb.service_id)) map.set(hb.service_id, hb);
    }
    return map;
  }, [heartbeats]);

  // Services that have sent at least one heartbeat, grouped
  const serviceCards = useMemo(() => {
    const serviceIds = new Set<string>();
    for (const hb of heartbeats) serviceIds.add(hb.service_id);

    return Array.from(serviceIds).map(serviceId => {
      const svc = services.find(s => s.id === serviceId);
      const client = svc ? clients.find(c => c.id === svc.client_id) : null;

      // All sources for this service
      const sources: ServiceHeartbeat[] = [];
      for (const [key, hb] of latestPerServiceSource.entries()) {
        if (key.startsWith(serviceId + '|')) sources.push(hb);
      }
      sources.sort((a, b) => a.source.localeCompare(b.source));

      const worstStatus = sources.reduce((worst, hb) => {
        if (isHbStale(hb)) return worst === 'error' ? 'error' : 'stale';
        if (hb.status === 'error') return 'error';
        if (hb.status === 'warning' && worst !== 'error') return 'warning';
        return worst;
      }, 'ok' as string);

      const latest = latestPerService.get(serviceId);

      return { serviceId, svc, client, sources, worstStatus, latest };
    }).sort((a, b) => {
      const order = { error: 0, stale: 1, warning: 2, ok: 3 };
      return (order[a.worstStatus as keyof typeof order] ?? 4) - (order[b.worstStatus as keyof typeof order] ?? 4);
    });
  }, [heartbeats, latestPerServiceSource, latestPerService, services, clients]);

  const stats = useMemo(() => {
    const withHeartbeat = Array.from(latestPerService.values());
    const ok = withHeartbeat.filter(h => h.status === 'ok' && !isHbStale(h)).length;
    const warnings = withHeartbeat.filter(h => h.status === 'warning' && !isHbStale(h)).length;
    const errors = withHeartbeat.filter(h => h.status === 'error').length;
    const stale = withHeartbeat.filter(h => isHbStale(h)).length;
    const noData = services.length - withHeartbeat.length;
    return { ok, warnings, errors, stale, noData };
  }, [latestPerService, services]);

  const filteredCards = useMemo(() => {
    let list = serviceCards;
    if (clientFilter !== 'all') list = list.filter(c => c.client?.id === clientFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        (c.svc?.name || '').toLowerCase().includes(q) ||
        (c.svc?.business_name || '').toLowerCase().includes(q) ||
        (c.client?.company_name || '').toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') {
      list = list.filter(c => {
        if (statusFilter === 'stale') return c.worstStatus === 'stale';
        return c.worstStatus === statusFilter;
      });
    }
    return list;
  }, [serviceCards, clientFilter, search, statusFilter]);

  const filteredLog = useMemo(() => {
    let list = heartbeats;
    if (clientFilter !== 'all') {
      const svcIds = new Set(services.filter(s => s.client_id === clientFilter).map(s => s.id));
      list = list.filter(h => svcIds.has(h.service_id));
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(h => {
        const name = getServiceName(h.service_id).toLowerCase();
        return name.includes(q) || h.source.toLowerCase().includes(q) || (h.message || '').toLowerCase().includes(q);
      });
    }
    if (statusFilter === 'stale') {
      list = list.filter(h => isHbStale(h));
    } else if (statusFilter !== 'all') {
      list = list.filter(h => h.status === statusFilter);
    }
    return list;
  }, [heartbeats, clientFilter, search, statusFilter]);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const deleteOld = async () => {
    if (!confirm('Delete heartbeats older than 7 days?')) return;
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('service_heartbeats').delete().lt('received_at', cutoff);
    load();
  };

  const statusDot = (status: string, stale: boolean) => {
    if (stale) return 'bg-gray-300';
    if (status === 'ok') return 'bg-emerald-500';
    if (status === 'warning') return 'bg-amber-500';
    return 'bg-red-500';
  };

  const statusIcon = (status: string, isStale: boolean) => {
    if (isStale) return <Clock className="w-4 h-4 text-gray-400" />;
    if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (status === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    return <AlertTriangle className="w-4 h-4 text-red-500" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Telemetry & Heartbeats</h2>
          <p className="text-sm text-gray-600 mt-1">Monitor incoming data from your automation scripts.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={deleteOld}
            className="flex items-center gap-2 text-gray-600 hover:text-red-600 border border-gray-300 hover:border-red-300 px-3 py-2 rounded-lg text-sm transition-colors">
            <Trash2 className="w-4 h-4" /> Purge 7d+
          </button>
          <button onClick={load}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBadge label="Healthy" value={stats.ok} color="emerald" onClick={() => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok')} active={statusFilter === 'ok'} />
        <StatBadge label="Warnings" value={stats.warnings} color="amber" onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')} active={statusFilter === 'warning'} />
        <StatBadge label="Errors" value={stats.errors} color="red" onClick={() => setStatusFilter(statusFilter === 'error' ? 'all' : 'error')} active={statusFilter === 'error'} />
        <StatBadge label="Stale" value={stats.stale} color="gray" onClick={() => setStatusFilter(statusFilter === 'stale' ? 'all' : 'stale')} active={statusFilter === 'stale'} />
        <StatBadge label="No Data" value={stats.noData} color="slate" onClick={() => setStatusFilter('all')} active={false} />
      </div>

      {/* Filters + view toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search service, client..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <select value={clientFilter} onChange={e => setClientFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
          <option value="all">All clients</option>
          {clients.filter(c => c.status === 'Active').map(c => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
        </select>
        <div className="ml-auto inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          <button onClick={() => setViewMode('cards')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'cards' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <LayoutGrid className="w-3.5 h-3.5" /> Cards
          </button>
          <button onClick={() => setViewMode('log')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'log' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <List className="w-3.5 h-3.5" /> Log
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading heartbeats...</div>
      ) : viewMode === 'cards' ? (
        /* ── CARDS VIEW ── */
        filteredCards.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No heartbeats received yet</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredCards.map(({ serviceId, svc, client, sources, worstStatus, latest }) => (
              <div key={serviceId} className={`bg-white rounded-xl border overflow-hidden ${
                worstStatus === 'error' ? 'border-red-200' :
                worstStatus === 'warning' ? 'border-amber-200' :
                worstStatus === 'stale' ? 'border-gray-200' : 'border-gray-200'
              }`}>
                {/* Card header */}
                <div className={`px-4 py-3 border-b flex items-start justify-between gap-2 ${
                  worstStatus === 'error' ? 'bg-red-50 border-red-100' :
                  worstStatus === 'warning' ? 'bg-amber-50 border-amber-100' :
                  worstStatus === 'stale' ? 'bg-gray-50 border-gray-100' : 'bg-gray-50 border-gray-100'
                }`}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDot(worstStatus, worstStatus === 'stale')}`} />
                      <span className="font-semibold text-gray-900 text-sm truncate">
                        {svc?.business_name || svc?.name || serviceId.slice(0, 8)}
                      </span>
                    </div>
                    {client && <div className="text-xs text-gray-500 mt-0.5 ml-4">{client.company_name}</div>}
                  </div>
                  {latest && (
                    <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">{timeAgo(latest.received_at)}</span>
                  )}
                </div>

                {/* Sources */}
                <div className="divide-y divide-gray-100">
                  {sources.map(hb => {
                    const stale = isHbStale(hb);
                    return (
                      <div key={hb.id} className={`px-4 py-2.5 ${stale ? 'opacity-50' : ''}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <SourceIcon source={hb.source} />
                            <span className="font-mono font-medium">{hb.source}</span>
                            {stale && <span className="text-gray-400 text-[10px]">(stale)</span>}
                          </div>
                          <div className="flex items-center gap-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(hb.status, stale)}`} />
                            <span className={`text-[11px] font-semibold ${
                              stale ? 'text-gray-400' :
                              hb.status === 'ok' ? 'text-emerald-700' :
                              hb.status === 'warning' ? 'text-amber-700' : 'text-red-700'
                            }`}>{stale ? 'stale' : hb.status}</span>
                          </div>
                        </div>
                        <MetricChips hb={hb} />
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* ── LOG VIEW ── */
        filteredLog.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No entries match your filters</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600 w-8"></th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Service</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Source</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Message</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredLog.slice(0, 100).map(hb => {
                    const stale = isHbStale(hb);
                    const client = getClientForService(hb.service_id);
                    const expanded = expandedId === hb.id;
                    return (
                      <Fragment key={hb.id}>
                        <tr className={`hover:bg-gray-50 cursor-pointer ${stale ? 'opacity-60' : ''}`}
                          onClick={() => setExpandedId(expanded ? null : hb.id)}>
                          <td className="px-4 py-3">
                            {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-gray-900">{getServiceName(hb.service_id)}</div>
                            {client && <div className="text-xs text-gray-500">{client.company_name}</div>}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">
                              <SourceIcon source={hb.source} />
                              {hb.source}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              {statusIcon(hb.status, stale)}
                              <span className={`text-xs font-medium ${
                                stale ? 'text-gray-400' :
                                hb.status === 'ok' ? 'text-emerald-700' :
                                hb.status === 'warning' ? 'text-amber-700' : 'text-red-700'
                              }`}>{stale ? 'Stale' : hb.status.toUpperCase()}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{hb.message || '--'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{timeAgo(hb.received_at)}</td>
                        </tr>
                        {expanded && (
                          <tr className="bg-slate-50">
                            <td colSpan={6} className="px-6 py-4">
                              <div className="mb-3">
                                <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Metrics</div>
                                <MetricChips hb={hb} />
                              </div>
                              <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Raw Payload</div>
                              <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto max-h-48 font-mono">
                                {JSON.stringify(hb.payload, null, 2)}
                              </pre>
                              <div className="mt-2 text-xs text-gray-400">
                                {new Date(hb.received_at).toLocaleString()}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredLog.length > 100 && (
              <div className="border-t border-gray-200 px-4 py-3 text-sm text-gray-500 text-center">
                Showing 100 of {filteredLog.length} entries
              </div>
            )}
          </div>
        )
      )}

      {/* Backup History */}
      <div className="space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">Backup History</h2>
              <p className="text-sm text-gray-600 mt-0.5">All backup reports received from your scripts.</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <select value={backupClientFilter} onChange={e => setBackupClientFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
              <option value="all">All clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" value={backupSearch} onChange={e => setBackupSearch(e.target.value)}
                placeholder="Search service, job..."
                className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none w-56" />
            </div>
          </div>
        </div>

        {backups.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <HardDrive className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No backup records yet</p>
          </div>
        ) : (() => {
          const filtered = backups.filter(b => {
            const svc = services.find(s => s.id === b.service_id);
            if (backupClientFilter !== 'all' && svc?.client_id !== backupClientFilter) return false;
            if (!backupSearch) return true;
            const q = backupSearch.toLowerCase();
            const name = (svc?.business_name || svc?.name || '').toLowerCase();
            return name.includes(q) || (b.job_name || '').toLowerCase().includes(q) || b.status.includes(q);
          });
          const visible = showAllBackups ? filtered : filtered.slice(0, 25);
          return (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Service</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Client</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Job</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Size</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Duration</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visible.map(b => {
                      const svc = services.find(s => s.id === b.service_id);
                      const client = svc ? clients.find(c => c.id === svc.client_id) : null;
                      return (
                        <tr key={b.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">{svc?.business_name || svc?.name || b.service_id.slice(0, 8)}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{client?.company_name || '—'}</td>
                          <td className="px-4 py-3 text-gray-600 font-mono text-xs">{b.job_name || '—'}</td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                              b.status === 'failed' ? 'text-red-600' :
                              b.status === 'warning' ? 'text-amber-600' : 'text-emerald-600'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${b.status === 'failed' ? 'bg-red-500' : b.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                              {b.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{b.size_bytes != null ? formatBytes(b.size_bytes) : '—'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{b.duration_seconds != null ? `${b.duration_seconds}s` : '—'}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                            {new Date(b.backed_up_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                            <span className="text-gray-400">{new Date(b.backed_up_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filtered.length > 25 && (
                <div className="border-t border-gray-200 px-4 py-3 text-center">
                  <button onClick={() => setShowAllBackups(!showAllBackups)} className="text-sm text-blue-600 hover:underline">
                    {showAllBackups ? 'Show less' : `Show all ${filtered.length} records`}
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function StatBadge({ label, value, color, onClick, active }: { label: string; value: number; color: string; onClick: () => void; active: boolean }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
  };
  return (
    <button onClick={onClick}
      className={`rounded-lg border p-3 text-left transition-all ${colors[color]} ${active ? 'ring-2 ring-offset-1 ring-blue-400' : 'hover:shadow-sm'}`}>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-xs font-medium opacity-80">{label}</div>
    </button>
  );
}
