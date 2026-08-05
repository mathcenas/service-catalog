import { useEffect, useState, useMemo, Fragment } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Search, ChevronDown, ChevronRight, Trash2, HardDrive, Wifi, Monitor, Server, LayoutGrid, List, Users, Download, FolderOpen } from 'lucide-react';
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

interface AclUser { name: string; uid?: string; comment?: string; groups?: string[] }
interface AclPrivilege { type: 'user' | 'group'; name: string; access: 'read/write' | 'read only' | 'no access'; perms: number }
interface AclShare {
  smb_name: string; folder_name: string; rel_path?: string; comment?: string;
  readonly: boolean; guest_access: boolean; enabled: boolean;
  users: AclPrivilege[]; groups: AclPrivilege[];
}
interface AclSnapshot {
  id: string;
  service_id: string;
  generated_at: string;
  snapshot: { shares: AclShare[]; users: AclUser[]; hostname?: string; generated_at: string };
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
  if (source === 'server-snapshot') return 25 * 60 * 60 * 1000; // runs once daily
  if (source === 'mikrotik') return 5 * 60 * 1000; // every minute
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
    if (p.load_avg != null) chips.push({ label: 'Load', value: String(p.load_avg) });
    if (p.ram_pct != null) chips.push({ label: 'RAM', value: `${p.ram_pct}%`, warn: Number(p.ram_pct) > 80, error: Number(p.ram_pct) > 92 });
    if (p.disk_pct != null) chips.push({ label: 'Disk', value: `${p.disk_pct}%`, warn: Number(p.disk_pct) > 75, error: Number(p.disk_pct) > 90 });
    if (p.disk_free_gb != null) chips.push({ label: 'Free', value: `${p.disk_free_gb} GB` });
    if (p.uptime_str != null) chips.push({ label: 'Up', value: String(p.uptime_str) });
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
  } else if (hb.source === 'mikrotik') {
    if (p.cpu_pct != null) chips.push({ label: 'CPU', value: `${p.cpu_pct}%`, warn: Number(p.cpu_pct) > 80, error: Number(p.cpu_pct) > 95 });
    if (p.ram_pct != null) chips.push({ label: 'RAM', value: `${p.ram_pct}%`, warn: Number(p.ram_pct) > 85, error: Number(p.ram_pct) > 92 });
    if (p.wan_in_mbps != null) chips.push({ label: 'WAN', value: `${p.wan_in_mbps} Mbps` });
    if (p.ipsec_status != null) chips.push({ label: 'IPsec', value: String(p.ipsec_status), warn: p.ipsec_status === 'OFFLINE', error: false });
    if (p.client) chips.push({ label: 'Router', value: String(p.client) });
  } else if (hb.source === 'server-snapshot') {
    if (p.cpu_percent != null) chips.push({ label: 'CPU', value: `${p.cpu_percent}%`, warn: Number(p.cpu_percent) > 80, error: Number(p.cpu_percent) > 95 });
    if (p.disk_latency_ms != null) chips.push({ label: 'DiskIO', value: `${p.disk_latency_ms}ms`, warn: Number(p.disk_latency_ms) > 50, error: Number(p.disk_latency_ms) > 150 });
    if (p.disk_queue != null) chips.push({ label: 'Queue', value: `${p.disk_queue}`, warn: Number(p.disk_queue) > 10, error: Number(p.disk_queue) > 30 });
    if (p.rdp_sessions != null) chips.push({ label: 'RDP', value: `${p.rdp_sessions}`, warn: Number(p.rdp_sessions) > 15 });
    if (p.smb_sessions != null && Number(p.smb_sessions) > 0) chips.push({ label: 'SMB', value: `${p.smb_sessions} / ${p.smb_open_files ?? 0}f` });
    if (p.gateway_ping != null) chips.push({ label: 'GW', value: p.gateway_ping ? 'ok' : '✗', error: !p.gateway_ping });
    if (p.internet_ping != null) chips.push({ label: 'Net', value: p.internet_ping ? 'ok' : '✗', error: !p.internet_ping });
    if (p.rdp_disconnect_events != null && Number(p.rdp_disconnect_events) > 0) chips.push({ label: 'Disc', value: `${p.rdp_disconnect_events}`, warn: true });
    if (p.probable_cause && p.probable_cause !== 'Normal') chips.push({ label: 'Cause', value: String(p.probable_cause), warn: true });
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
  'server-snapshot': Server,
  'mikrotik': Wifi,
};

function SourceIcon({ source }: { source: string }) {
  const Icon = SOURCE_ICONS[source] || Activity;
  return <Icon className="w-3.5 h-3.5" />;
}

export function TelemetryDashboard({ services, clients }: Props) {
  const [heartbeats, setHeartbeats] = useState<ServiceHeartbeat[]>([]);
  const [backups, setBackups] = useState<ServiceBackup[]>([]);
  const [aclSnapshots, setAclSnapshots] = useState<AclSnapshot[]>([]);
  const [aclClientFilter, setAclClientFilter] = useState<string>('all');
  const [expandedAcl, setExpandedAcl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [backupSearch, setBackupSearch] = useState('');
  const [backupClientFilter, setBackupClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'warning' | 'error' | 'stale'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAllBackups, setShowAllBackups] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'log'>('cards');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>('Cenas-Support');
  const [sendingReview, setSendingReview] = useState<string | null>(null);
  const [reviewLinks, setReviewLinks] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const [{ data: hbData }, { data: backupData }, { data: aclData }, { data: settingsData }] = await Promise.all([
      supabase.from('service_heartbeats').select('*').order('received_at', { ascending: false }).limit(500),
      supabase.from('service_backups').select('*').order('backed_up_at', { ascending: false }).limit(200),
      supabase.from('service_acl_snapshots').select('id,service_id,generated_at,snapshot').order('generated_at', { ascending: false }).limit(50),
      supabase.from('user_settings').select('logo_url,company_name').maybeSingle(),
    ]);
    setHeartbeats(hbData || []);
    setBackups(backupData || []);
    setAclSnapshots((aclData as AclSnapshot[]) || []);
    if (settingsData) {
      if (settingsData.logo_url) setLogoUrl(settingsData.logo_url);
      if (settingsData.company_name) setCompanyName(settingsData.company_name);
    }
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

  const sendReviewLink = async (snap: AclSnapshot) => {
    setSendingReview(snap.id);
    try {
      const svc = services.find(s => s.id === snap.service_id);
      const client = svc ? clients.find(c => c.id === svc.client_id) : null;
      const { data, error } = await supabase
        .from('acl_review_tokens')
        .insert({
          snapshot_id: snap.id,
          service_id: snap.service_id,
          client_id: client?.id || null,
        })
        .select('token')
        .single();
      if (error || !data) throw error;
      const link = `${window.location.origin}/acl-review/${data.token}`;
      setReviewLinks(p => ({ ...p, [snap.id]: link }));
    } catch (e) {
      alert('Error al generar el enlace de revisión.');
    } finally {
      setSendingReview(null);
    }
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

      {/* NAS SMB Access Control */}
      {aclSnapshots.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-gray-500" />
              <div>
                <h2 className="text-xl font-bold text-gray-900">NAS — Accesos SMB</h2>
                <p className="text-sm text-gray-600 mt-0.5">Usuarios y permisos por carpeta compartida.</p>
              </div>
            </div>
            <select value={aclClientFilter} onChange={e => setAclClientFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
              <option value="all">All services</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.business_name || s.name}</option>)}
            </select>
          </div>

          <div className="space-y-3">
            {aclSnapshots
              .filter(snap => aclClientFilter === 'all' || snap.service_id === aclClientFilter)
              .map(snap => {
                const svc = services.find(s => s.id === snap.service_id);
                const isExpanded = expandedAcl === snap.id;
                const { shares, users, hostname } = snap.snapshot;
                return (
                  <div key={snap.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => setExpandedAcl(isExpanded ? null : snap.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        <div>
                          <span className="font-semibold text-gray-900 text-sm">{svc?.business_name || svc?.name || snap.service_id.slice(0, 8)}</span>
                          {hostname && <span className="text-xs text-gray-400 ml-2">({hostname})</span>}
                        </div>
                        <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium">{shares.length} shares</span>
                        <span className="text-xs bg-gray-50 text-gray-600 border border-gray-200 px-2 py-0.5 rounded-full">{users.length} usuarios</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-gray-400">{new Date(snap.generated_at).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })}</span>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            const client = clients.find(c => c.id === svc?.client_id);
                            exportAclHtml(snap, svc?.business_name || svc?.name || 'NAS', client?.company_name || '', logoUrl, companyName);
                          }}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-2 py-1 rounded-lg transition-colors"
                        >
                          <Download className="w-3 h-3" /> Exportar
                        </button>
                        {reviewLinks[snap.id] ? (
                          <button
                            onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(reviewLinks[snap.id]); }}
                            className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 border border-emerald-200 hover:border-emerald-400 px-2 py-1 rounded-lg transition-colors"
                          >
                            📋 Copiar enlace
                          </button>
                        ) : (
                          <button
                            onClick={e => { e.stopPropagation(); sendReviewLink(snap); }}
                            disabled={sendingReview === snap.id}
                            className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 border border-violet-200 hover:border-violet-400 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {sendingReview === snap.id ? '...' : '📨 Enviar revisión'}
                          </button>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-gray-100 divide-y divide-gray-100">
                        {shares.filter(s => s.enabled).map(share => (
                          <div key={share.smb_name} className="px-4 py-3">
                            <div className="flex items-center gap-2 mb-2">
                              <FolderOpen className="w-4 h-4 text-amber-500" />
                              <span className="font-medium text-gray-900 text-sm">{share.smb_name}</span>
                              {share.comment && <span className="text-xs text-gray-400">{share.comment}</span>}
                              {share.readonly && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium uppercase">solo lectura</span>}
                              {share.guest_access && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium uppercase">guest</span>}
                            </div>
                            {share.users.length === 0 && share.groups.length === 0 ? (
                              <p className="text-xs text-gray-400 ml-6">Sin permisos explícitos configurados</p>
                            ) : (
                              <div className="ml-6 flex flex-wrap gap-2">
                                {share.users.map(u => (
                                  <span key={u.name} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${
                                    u.access === 'read/write' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                    u.access === 'read only' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                    'bg-gray-100 text-gray-500 border-gray-200 line-through'
                                  }`}>
                                    {u.name}
                                    <span className="opacity-60 font-normal">{u.access === 'read/write' ? 'R/W' : u.access === 'read only' ? 'R' : '✗'}</span>
                                  </span>
                                ))}
                                {share.groups.map(g => (
                                  <span key={g.name} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${
                                    g.access === 'read/write' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                    g.access === 'read only' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                    'bg-gray-100 text-gray-500 border-gray-200'
                                  }`}>
                                    <Users className="w-2.5 h-2.5" />
                                    {g.name}
                                    <span className="opacity-60 font-normal">{g.access === 'read/write' ? 'R/W' : g.access === 'read only' ? 'R' : '✗'}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        {/* Users summary */}
                        <div className="px-4 py-3 bg-gray-50">
                          <p className="text-xs font-medium text-gray-500 mb-2">Usuarios del sistema</p>
                          <div className="flex flex-wrap gap-2">
                            {users.map(u => (
                              <span key={u.name} className="inline-flex items-center gap-1 text-xs bg-white border border-gray-200 text-gray-700 px-2 py-0.5 rounded-full">
                                {u.name}
                                {u.groups && u.groups.length > 0 && <span className="opacity-50">· {u.groups.join(', ')}</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

function exportAclHtml(snap: AclSnapshot, serviceName: string, clientName: string, logoUrl: string | null, companyName: string) {
  const { shares, users, hostname, generated_at } = snap.snapshot;
  const dateStr = new Date(generated_at).toLocaleString('es-UY', { dateStyle: 'long', timeStyle: 'short' });

  const accessBadge = (access: string) => {
    if (access === 'read/write') return `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">R/W</span>`;
    if (access === 'read only') return `<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">Solo lectura</span>`;
    return `<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:4px;font-size:11px;">Sin acceso</span>`;
  };

  const sharesHtml = shares.filter(s => s.enabled).map(share => {
    const allPrivs = [
      ...share.users.map(u => ({ name: u.name, access: u.access })),
      ...share.groups.map(g => ({ name: `[${g.name}]`, access: g.access })),
    ];
    const rows = allPrivs.length
      ? allPrivs.map(p => `<tr style="border-top:1px solid #f3f4f6;"><td style="padding:7px 14px;color:#374151;font-size:13px;">${p.name}</td><td style="padding:7px 14px;">${accessBadge(p.access)}</td></tr>`).join('')
      : `<tr><td colspan="2" style="padding:7px 14px;color:#9ca3af;font-style:italic;font-size:12px;">Sin permisos explícitos configurados</td></tr>`;

    const badges = [
      share.readonly ? `<span style="background:#f3f4f6;color:#6b7280;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;margin-left:8px;vertical-align:middle;">SOLO LECTURA</span>` : '',
      share.guest_access ? `<span style="background:#fef3c7;color:#92400e;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:700;margin-left:8px;vertical-align:middle;">GUEST</span>` : '',
    ].join('');

    return `
      <div style="margin-bottom:18px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:#f8fafc;padding:9px 14px;border-bottom:1px solid #e5e7eb;">
          <span style="font-weight:700;color:#111827;font-size:13px;">📁 ${share.smb_name}</span>${badges}
          ${share.comment ? `<span style="color:#94a3b8;font-size:11px;margin-left:10px;">${share.comment}</span>` : ''}
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:6px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Usuario</th>
            <th style="padding:6px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Acceso</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const usersHtml = (users as (AclUser & { last_login?: string | null })[]).map(u => {
    const login = u.last_login
      ? `<span style="color:#374151;">${u.last_login}</span>`
      : `<span style="background:#f1f5f9;color:#94a3b8;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;letter-spacing:.4px;">EN DESARROLLO</span>`;
    return `<tr style="border-top:1px solid #f3f4f6;">
      <td style="padding:7px 14px;color:#374151;font-size:13px;font-weight:500;">${u.name}</td>
      <td style="padding:7px 14px;color:#6b7280;font-size:12px;">${(u.groups || []).join(', ') || '—'}</td>
      <td style="padding:7px 14px;font-size:12px;">${login}</td>
      <td style="padding:7px 14px;color:#94a3b8;font-size:12px;">${u.comment || ''}</td>
    </tr>`;
  }).join('');

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="${companyName}" style="height:36px;object-fit:contain;margin-bottom:4px;" />`
    : `<span style="font-weight:700;font-size:16px;color:#1e293b;">${companyName}</span>`;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte de Accesos SMB — ${clientName || serviceName}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px 24px; background: #fff; color: #111827; }
    #print-btn { position:fixed;top:16px;right:16px;background:#3b82f6;color:#fff;border:none;border-radius:8px;padding:9px 18px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(59,130,246,.35);z-index:999; }
    #print-btn:hover { background:#2563eb; }
    @media print { #print-btn { display:none; } body { padding: 20px; } }
  </style>
</head>
<body>
  <button id="print-btn" onclick="window.print()">⬇ Guardar PDF</button>
  <div style="max-width:720px;margin:0 auto;">

    <!-- Header al estilo emails -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:20px;border-bottom:2px solid #3b82f6;margin-bottom:28px;">
      <div>
        ${logoHtml}
        <h1 style="margin:8px 0 2px;font-size:20px;color:#1e293b;">Reporte de Accesos SMB</h1>
        ${clientName ? `<p style="margin:0;font-size:13px;color:#64748b;">Cliente: <strong>${clientName}</strong>${hostname ? ` &nbsp;·&nbsp; Servidor: ${hostname}` : ''}</p>` : `<p style="margin:0;font-size:13px;color:#64748b;">${serviceName}${hostname ? ` &nbsp;·&nbsp; ${hostname}` : ''}</p>`}
      </div>
      <div style="text-align:right;font-size:12px;color:#64748b;white-space:nowrap;padding-top:4px;">
        <div style="font-weight:600;color:#374151;">Generado</div>
        <div>${dateStr}</div>
      </div>
    </div>

    <!-- Carpetas -->
    <h2 style="font-size:14px;font-weight:700;color:#1e293b;margin:0 0 14px;text-transform:uppercase;letter-spacing:.5px;">Carpetas Compartidas</h2>
    ${sharesHtml}

    <!-- Usuarios -->
    <h2 style="font-size:14px;font-weight:700;color:#1e293b;margin:28px 0 14px;text-transform:uppercase;letter-spacing:.5px;">Usuarios del Sistema</h2>
    <div style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f9fafb;">
          <th style="padding:7px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Usuario</th>
          <th style="padding:7px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Grupos</th>
          <th style="padding:7px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Último acceso</th>
          <th style="padding:7px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Descripción</th>
        </tr></thead>
        <tbody>${usersHtml}</tbody>
      </table>
    </div>

    <p style="color:#cbd5e1;font-size:10px;margin-top:12px;margin-bottom:0;">* Último acceso vía SMB/Windows en desarrollo — requiere auditoría de Samba habilitada en el servidor.</p>
    <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;">${companyName} &nbsp;·&nbsp; Reporte generado automáticamente &nbsp;·&nbsp; ${dateStr}</p>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  // Liberar la URL del blob cuando la ventana cargue
  if (win) win.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
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
