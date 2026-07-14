import { useEffect, useState, useMemo, Fragment } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Search, ChevronDown, ChevronRight, Trash2, HardDrive } from 'lucide-react';
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

type Props = {
  services: Service[];
  clients: Client[];
};

export function TelemetryDashboard({ services, clients }: Props) {
  const [heartbeats, setHeartbeats] = useState<ServiceHeartbeat[]>([]);
  const [backups, setBackups] = useState<ServiceBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [backupSearch, setBackupSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'warning' | 'error' | 'stale'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAllBackups, setShowAllBackups] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: hbData }, { data: backupData }] = await Promise.all([
      supabase.from('service_heartbeats').select('*').order('received_at', { ascending: false }).limit(200),
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

  const latestPerService = useMemo(() => {
    const map = new Map<string, ServiceHeartbeat>();
    for (const hb of heartbeats) {
      if (!map.has(hb.service_id)) {
        map.set(hb.service_id, hb);
      }
    }
    return map;
  }, [heartbeats]);

  const staleThresholdMs = 24 * 60 * 60 * 1000;

  // @ts-expect-error -- prepared for upcoming health view
  const _serviceHealth = useMemo(() => {
    const result: { service: Service; latest: ServiceHeartbeat | null; isStale: boolean }[] = [];
    for (const svc of services) {
      const latest = latestPerService.get(svc.id) || null;
      const isStale = latest ? (Date.now() - new Date(latest.received_at).getTime()) > staleThresholdMs : false;
      result.push({ service: svc, latest, isStale });
    }
    return result.sort((a, b) => {
      if (!a.latest && b.latest) return -1;
      if (a.latest && !b.latest) return 1;
      if (a.isStale && !b.isStale) return -1;
      if (!a.isStale && b.isStale) return 1;
      if (a.latest?.status === 'error' && b.latest?.status !== 'error') return -1;
      if (a.latest?.status !== 'error' && b.latest?.status === 'error') return 1;
      return 0;
    });
  }, [services, latestPerService]);

  const stats = useMemo(() => {
    const withHeartbeat = Array.from(latestPerService.values());
    const ok = withHeartbeat.filter(h => h.status === 'ok' && (Date.now() - new Date(h.received_at).getTime()) <= staleThresholdMs).length;
    const warnings = withHeartbeat.filter(h => h.status === 'warning').length;
    const errors = withHeartbeat.filter(h => h.status === 'error').length;
    const stale = withHeartbeat.filter(h => (Date.now() - new Date(h.received_at).getTime()) > staleThresholdMs).length;
    const noData = services.length - withHeartbeat.length;
    return { ok, warnings, errors, stale, noData };
  }, [latestPerService, services]);

  const filtered = useMemo(() => {
    let list = heartbeats;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(h => {
        const name = getServiceName(h.service_id).toLowerCase();
        return name.includes(q) || h.source.toLowerCase().includes(q) || (h.message || '').toLowerCase().includes(q);
      });
    }
    if (statusFilter === 'stale') {
      const staleIds = new Set(
        Array.from(latestPerService.entries())
          .filter(([, hb]) => (Date.now() - new Date(hb.received_at).getTime()) > staleThresholdMs)
          .map(([id]) => id)
      );
      list = list.filter(h => staleIds.has(h.service_id));
    } else if (statusFilter !== 'all') {
      list = list.filter(h => h.status === statusFilter);
    }
    return list;
  }, [heartbeats, search, statusFilter, latestPerService]);

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const deleteOld = async () => {
    if (!confirm('Delete heartbeats older than 7 days?')) return;
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('service_heartbeats').delete().lt('received_at', cutoff);
    load();
  };

  const statusIcon = (status: string, isStale: boolean) => {
    if (isStale) return <Clock className="w-4 h-4 text-gray-400" />;
    if (status === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (status === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    return <AlertTriangle className="w-4 h-4 text-red-500" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Telemetry & Heartbeats</h2>
          <p className="text-sm text-gray-600 mt-1">Monitor incoming data from your automation scripts. Detect stale or failed pushes before they affect clients.</p>
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

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBadge label="Healthy" value={stats.ok} color="emerald" onClick={() => setStatusFilter('ok')} active={statusFilter === 'ok'} />
        <StatBadge label="Warnings" value={stats.warnings} color="amber" onClick={() => setStatusFilter('warning')} active={statusFilter === 'warning'} />
        <StatBadge label="Errors" value={stats.errors} color="red" onClick={() => setStatusFilter('error')} active={statusFilter === 'error'} />
        <StatBadge label="Stale (24h+)" value={stats.stale} color="gray" onClick={() => setStatusFilter('stale')} active={statusFilter === 'stale'} />
        <StatBadge label="No Data" value={stats.noData} color="slate" onClick={() => setStatusFilter('all')} active={statusFilter === 'all'} />
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search service, source..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading heartbeats...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Activity className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No heartbeats received yet</p>
          <p className="text-sm text-gray-400 mt-1">Your PowerShell scripts will POST data here via the Supabase API.</p>
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
                {filtered.slice(0, 50).map(hb => {
                  const isStale = (Date.now() - new Date(hb.received_at).getTime()) > staleThresholdMs;
                  const client = getClientForService(hb.service_id);
                  const expanded = expandedId === hb.id;
                  return (
                    <Fragment key={hb.id}>
                      <tr className={`hover:bg-gray-50 cursor-pointer ${isStale ? 'opacity-60' : ''}`}
                        onClick={() => setExpandedId(expanded ? null : hb.id)}>
                        <td className="px-4 py-3">
                          {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{getServiceName(hb.service_id)}</div>
                          {client && <div className="text-xs text-gray-500">{client.company_name}</div>}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <span className="inline-flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-xs font-mono">{hb.source}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {statusIcon(hb.status, isStale)}
                            <span className={`text-xs font-medium ${
                              isStale ? 'text-gray-400' :
                              hb.status === 'ok' ? 'text-emerald-700' :
                              hb.status === 'warning' ? 'text-amber-700' : 'text-red-700'
                            }`}>{isStale ? 'Stale' : hb.status.toUpperCase()}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{hb.message || '--'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{timeAgo(hb.received_at)}</td>
                      </tr>
                      {expanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Payload</div>
                            <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 text-xs overflow-x-auto max-h-48 font-mono">
                              {JSON.stringify(hb.payload, null, 2)}
                            </pre>
                            <div className="mt-2 text-xs text-gray-400">
                              Full timestamp: {new Date(hb.received_at).toLocaleString()}
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
          {filtered.length > 50 && (
            <div className="border-t border-gray-200 px-4 py-3 text-sm text-gray-500 text-center">
              Showing 50 of {filtered.length} entries
            </div>
          )}
        </div>
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
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={backupSearch} onChange={e => setBackupSearch(e.target.value)}
              placeholder="Search service, job..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
          </div>
        </div>

        {backups.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <HardDrive className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No backup records yet</p>
            <p className="text-sm text-gray-400 mt-1">Your scripts will POST data here via the ingest-backup function.</p>
          </div>
        ) : (() => {
          const filtered = backups.filter(b => {
            if (!backupSearch) return true;
            const q = backupSearch.toLowerCase();
            const svc = services.find(s => s.id === b.service_id);
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

