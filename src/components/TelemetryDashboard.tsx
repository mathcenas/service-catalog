import { useEffect, useState, useMemo, Fragment } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw, Search, Trash2, HardDrive, Wifi, Monitor, Server, LayoutGrid, List, Users, Download, ChevronRight, ChevronDown } from 'lucide-react';
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
// Latest known script versions — bump here when a script is updated
const LATEST_SCRIPT_VERSIONS: Record<string, string> = {
  'system-health':   '1.1.0',
  'mikrotik':        '1.0.0',
  'backup-folder':   '1.0.0',
  'server-snapshot': '1.0.0',
  'speedtest':       '1.0.0',
  'network':         '1.0.0',
  'rdp':             '1.0.0',
};

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
    if (p.smb_session_count != null) chips.push({ label: 'SMB', value: `${p.smb_session_count} session${Number(p.smb_session_count) !== 1 ? 's' : ''}` });
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
  } else if (hb.source === 'backup-folder') {
    if (p.latest_folder != null) chips.push({ label: 'Carpeta', value: String(p.latest_folder) });
    if (p.age_hours != null) chips.push({ label: 'Edad', value: `${p.age_hours}h`, warn: Number(p.age_hours) > 25, error: Number(p.age_hours) > 48 });
    if (p.size_mb != null) chips.push({ label: 'Tamaño', value: `${p.size_mb} MB`, warn: Number(p.size_mb) < 10 });
    if (p.total_folders != null) chips.push({ label: 'Total', value: `${p.total_folders}` });
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

  // Script version chip
  const scriptVer = p.script_version != null ? String(p.script_version) : null;
  const latestVer = LATEST_SCRIPT_VERSIONS[hb.source];
  const versionOutdated = !!latestVer && scriptVer !== null && scriptVer !== latestVer;
  const versionUnknown  = !!latestVer && scriptVer === null;
  if (scriptVer) {
    chips.push({ label: 'v', value: scriptVer, warn: versionOutdated });
  } else if (latestVer) {
    chips.push({ label: 'v', value: '?', warn: true });
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {chips.map(c => {
        const isVersionChip = c.label === 'v';
        const needsUpdate = isVersionChip && (versionOutdated || versionUnknown);
        return (
          <span key={c.label} title={needsUpdate ? `Script desactualizado — última versión: ${latestVer}` : undefined}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border ${
              c.error                  ? 'bg-red-50 border-red-200 text-red-700' :
              needsUpdate              ? 'bg-amber-100 border-amber-400 text-amber-800 ring-1 ring-amber-300' :
              c.warn                   ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                         'bg-gray-50 border-gray-200 text-gray-600'
            }`}>
            {needsUpdate && <span>⚠</span>}
            <span className={needsUpdate ? 'text-amber-600' : 'text-gray-400'}>{c.label}</span>
            <span>{c.value}</span>
          </span>
        );
      })}
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [backupSearch, setBackupSearch] = useState('');
  const [backupClientFilter, setBackupClientFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'warning' | 'error' | 'stale' | 'no-data'>('all');
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

      // Remove any previous unused token for this snapshot
      await supabase
        .from('acl_review_tokens')
        .delete()
        .eq('snapshot_id', snap.id)
        .is('submitted_at', null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('acl_review_tokens')
        .insert({
          snapshot_id: snap.id,
          service_id: snap.service_id,
          client_id: client?.id || null,
          user_id: user.id,
        })
        .select('token')
        .single();
      if (error || !data) throw error ?? new Error('No token returned');
      const link = `${window.location.origin}/acl-review/${data.token}`;
      setReviewLinks(p => ({ ...p, [snap.id]: link }));

      // Auto-send email to client with review link (disabled until endpoint is stable)
      if (client?.email) {
        const svcName = svc?.business_name || svc?.name || 'NAS';
        // Find client's share token for portal link
        const { data: shareToken } = await supabase
          .from('share_tokens')
          .select('token')
          .eq('client_id', client.id)
          .maybeSingle();
        const portalUrl = shareToken?.token
          ? `${window.location.origin}/share/${shareToken.token}`
          : undefined;

        const { error: notifyError } = await supabase.functions.invoke('notify-client', {
          body: {
            client_email: client.email,
            alt_email: client.alt_email,
            cc_emails: client.cc_emails,
            client_name: client.contact_name || client.company_name,
            subject: `Revisión de usuarios — ${svcName}`,
            title: `Auditoría de accesos SMB — ${svcName}`,
            description: `Le enviamos el siguiente enlace para que revise los usuarios con acceso a los archivos compartidos del servidor.\n\nPor favor indique para cada usuario si desea mantenerlo, eliminarlo o realizar algún cambio. El enlace tiene una validez de 15 días.\n\nEsta revisión se realiza cada 6 meses para garantizar que solo los usuarios correctos tengan acceso a sus archivos.`,
            share_url: link,
            share_url_label: 'Iniciar revisión →',
            portal_url: portalUrl,
            logo_url: logoUrl,
            sender_name: companyName,
            category: 'audit',
          },
        });
        if (notifyError) console.error('notify-client error:', notifyError);
      }
    } catch {
      alert('Error al generar el enlace de revisión.');
    } finally {
      setSendingReview(null);
    }
  };

  // Normalize status values: backup scripts send "success"/"failed",
  // heartbeat scripts send "ok"/"warning"/"error"
  const normalizeStatus = (status: string): string => {
    if (status === 'success') return 'ok';
    if (status === 'failed') return 'error';
    return status;
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

    const withHeartbeat = Array.from(serviceIds).map(serviceId => {
      const svc = services.find(s => s.id === serviceId && s.telemetry_enabled !== false);
      const client = svc ? clients.find(c => c.id === svc.client_id) : null;

      // All sources for this service
      const sources: ServiceHeartbeat[] = [];
      for (const [key, hb] of latestPerServiceSource.entries()) {
        if (key.startsWith(serviceId + '|')) sources.push(hb);
      }
      sources.sort((a, b) => a.source.localeCompare(b.source));

      const worstStatus = sources.reduce((worst, hb) => {
        if (isHbStale(hb)) return worst === 'error' ? 'error' : 'stale';
        const s = normalizeStatus(hb.status);
        if (s === 'error') return 'error';
        if (s === 'warning' && worst !== 'error') return 'warning';
        return worst;
      }, 'ok' as string);

      const latest = latestPerService.get(serviceId);

      return { serviceId, svc, client, sources, worstStatus, latest };
    });

    // Services that have never reported — shown as 'no-data'
    const silent = services
      .filter(s => !serviceIds.has(s.id) && s.status === 'Active' && s.telemetry_enabled !== false)
      .map(svc => {
        const client = clients.find(c => c.id === svc.client_id) ?? null;
        return { serviceId: svc.id, svc, client, sources: [], worstStatus: 'no-data', latest: undefined };
      });

    const order = { error: 0, stale: 1, warning: 2, ok: 3, 'no-data': 4 };
    return [...withHeartbeat, ...silent].sort((a, b) =>
      (order[a.worstStatus as keyof typeof order] ?? 5) - (order[b.worstStatus as keyof typeof order] ?? 5)
    );
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

  const outdatedScripts = useMemo(() => {
    const results: { serviceId: string; serviceName: string; source: string; current: string; latest: string }[] = [];
    for (const [key, hb] of latestPerServiceSource.entries()) {
      const latest = LATEST_SCRIPT_VERSIONS[hb.source];
      if (!latest) continue;
      const current = hb.payload && (hb.payload as Record<string, unknown>).script_version != null
        ? String((hb.payload as Record<string, unknown>).script_version)
        : null;
      if (current === null || current !== latest) {
        const svc = services.find(s => s.id === hb.service_id);
        results.push({
          serviceId: hb.service_id,
          serviceName: svc?.business_name || svc?.name || hb.service_id.slice(0, 8),
          source: hb.source,
          current: current ?? 'unknown',
          latest,
        });
      }
    }
    return results;
  }, [latestPerServiceSource, services]);

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
    const s = normalizeStatus(status);
    if (s === 'ok') return 'bg-emerald-500';
    if (s === 'warning') return 'bg-amber-500';
    return 'bg-red-500';
  };

  const statusIcon = (status: string, isStale: boolean) => {
    if (isStale) return <Clock className="w-4 h-4 text-gray-400" />;
    const s = normalizeStatus(status);
    if (s === 'ok') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    if (s === 'warning') return <AlertTriangle className="w-4 h-4 text-amber-500" />;
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
        <StatBadge label="No Data" value={stats.noData} color="slate" onClick={() => setStatusFilter(statusFilter === 'no-data' ? 'all' : 'no-data')} active={statusFilter === 'no-data'} />
      </div>

      {/* Outdated scripts banner */}
      {outdatedScripts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="text-sm font-semibold text-amber-800">{outdatedScripts.length} script{outdatedScripts.length !== 1 ? 's' : ''} outdated</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {outdatedScripts.map(({ serviceId, serviceName, source, current, latest }) => (
              <div key={`${serviceId}-${source}`} className="flex items-center gap-1.5 bg-white border border-amber-200 rounded-lg px-2.5 py-1.5 text-xs">
                <span className="font-medium text-gray-800 truncate max-w-[120px]">{serviceName}</span>
                <span className="text-gray-400">·</span>
                <span className="font-mono text-amber-700">{source}</span>
                <span className="text-gray-400">·</span>
                <span className="text-gray-400 line-through">{current}</span>
                <span className="text-gray-400">→</span>
                <span className="text-emerald-700 font-semibold">{latest}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
              <div key={serviceId} className={`rounded-xl border overflow-hidden ${
                worstStatus === 'error' ? 'bg-white border-red-200' :
                worstStatus === 'warning' ? 'bg-white border-amber-200' :
                worstStatus === 'stale' ? 'bg-white border-gray-200' :
                worstStatus === 'no-data' ? 'bg-slate-50 border-slate-200 border-dashed' : 'bg-white border-gray-200'
              }`}>
                {/* Card header */}
                <div className={`px-4 py-3 border-b flex items-start justify-between gap-2 ${
                  worstStatus === 'error' ? 'bg-red-50 border-red-100' :
                  worstStatus === 'warning' ? 'bg-amber-50 border-amber-100' :
                  worstStatus === 'stale' ? 'bg-gray-50 border-gray-100' :
                  worstStatus === 'no-data' ? 'bg-slate-100 border-slate-200' : 'bg-gray-50 border-gray-100'
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
                  {worstStatus === 'no-data' && (
                    <div className="px-4 py-3 text-xs text-slate-400 italic">No heartbeat received yet</div>
                  )}
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
                              normalizeStatus(hb.status) === 'ok' ? 'text-emerald-700' :
                              normalizeStatus(hb.status) === 'warning' ? 'text-amber-700' : 'text-red-700'
                            }`}>{stale ? 'stale' : hb.status}</span>
                          </div>
                        </div>
                        <MetricChips hb={hb} />
                        {hb.source === 'system-health' && Array.isArray((hb.payload as Record<string,unknown>)?.smb_sessions) && ((hb.payload as Record<string,unknown>).smb_sessions as {user:string;machine:string}[]).length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {((hb.payload as Record<string,unknown>).smb_sessions as {user:string;machine:string}[]).map((s, i) => (
                              <span key={i} className="text-[10px] bg-blue-50 border border-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">
                                {s.user}@{s.machine}
                              </span>
                            ))}
                          </div>
                        )}
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

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Servidor</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Generado</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Shares / Usuarios</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {aclSnapshots
                  .filter(snap => aclClientFilter === 'all' || snap.service_id === aclClientFilter)
                  .map(snap => {
                    const svc = services.find(s => s.id === snap.service_id);
                    const client = clients.find(c => c.id === svc?.client_id);
                    const { shares, users, hostname } = snap.snapshot;
                    return (
                      <tr key={snap.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-900">{svc?.business_name || svc?.name || snap.service_id.slice(0, 8)}</span>
                          {hostname && <span className="text-xs text-gray-400 ml-1.5">({hostname})</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                          {new Date(snap.generated_at).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium mr-1.5">{shares.length} shares</span>
                          <span className="text-xs bg-gray-50 text-gray-600 border border-gray-200 px-2 py-0.5 rounded-full">{users.length} usuarios</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => exportAclHtml(snap, svc?.business_name || svc?.name || 'NAS', client?.company_name || '', logoUrl, companyName)}
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-2 py-1 rounded-lg transition-colors"
                            >
                              <Download className="w-3 h-3" /> PDF
                            </button>
                            {reviewLinks[snap.id] ? (
                              <button
                                onClick={() => navigator.clipboard.writeText(reviewLinks[snap.id])}
                                className="flex items-center gap-1 text-xs text-emerald-600 hover:text-emerald-800 border border-emerald-200 hover:border-emerald-400 px-2 py-1 rounded-lg transition-colors"
                              >
                                📋 Copiar enlace
                              </button>
                            ) : (
                              <button
                                onClick={() => sendReviewLink(snap)}
                                disabled={sendingReview === snap.id}
                                className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 border border-violet-200 hover:border-violet-400 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                              >
                                {sendingReview === snap.id ? '...' : '📨 Revisión'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
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

  const diskBar = (share: Record<string, any>) => {
    if (share.disk_total_gb == null) return '';
    const pct = share.disk_used_pct ?? 0;
    const barColor = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#22c55e';
    return `
      <div style="padding:6px 14px 8px;border-top:1px solid #f3f4f6;display:flex;align-items:center;gap:10px;">
        <span style="font-size:10px;color:#6b7280;white-space:nowrap;">💾 Disco</span>
        <div style="flex:1;background:#f1f5f9;border-radius:4px;height:6px;overflow:hidden;">
          <div style="width:${pct}%;background:${barColor};height:6px;border-radius:4px;"></div>
        </div>
        <span style="font-size:11px;color:#374151;white-space:nowrap;font-weight:600;">${share.disk_used_pct}%</span>
        <span style="font-size:10px;color:#94a3b8;white-space:nowrap;">${share.disk_free_gb} GB libres / ${share.disk_total_gb} GB</span>
      </div>`;
  };

  const sharesHtml = shares.filter(s => s.enabled).map((share: Record<string, any>) => {
    const allPrivs = [
      ...share.users.map((u: any) => ({ name: u.name, access: u.access })),
      ...share.groups.map((g: any) => ({ name: `[${g.name}]`, access: g.access })),
    ];
    const rows = allPrivs.length
      ? allPrivs.map((p: any) => `<tr style="border-top:1px solid #f3f4f6;"><td style="padding:7px 14px;color:#374151;font-size:13px;">${p.name}</td><td style="padding:7px 14px;">${accessBadge(p.access)}</td></tr>`).join('')
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
        ${diskBar(share)}
      </div>`;
  }).join('');

  const usersHtml = (users as (AclUser & { last_login?: string | null; active_sessions?: { machine: string; ip: string }[]; login_history?: { machine: string; timestamp: string; ip: string }[] })[]).map(u => {
    const sessions = u.active_sessions && u.active_sessions.length > 0
      ? u.active_sessions.map(s => `<span style="background:#dcfce7;color:#166534;padding:2px 6px;border-radius:4px;font-size:10px;font-family:monospace;margin-right:4px;">● ${s.machine}</span>`).join('')
      : '';
    const history = u.login_history && u.login_history.length > 0
      ? u.login_history.map(h => `<div style="font-size:10px;color:#6b7280;margin-top:2px;"><span style="font-family:monospace;color:#374151;font-weight:600;">${h.machine}</span> · ${h.timestamp.slice(0, 16)} <span style="color:#d1d5db;">(${h.ip})</span></div>`).join('')
      : `<span style="color:#9ca3af;font-style:italic;font-size:11px;">—</span>`;
    const activePart = sessions ? `<div style="margin-bottom:4px;">${sessions}</div>` : '';
    return `<tr style="border-top:1px solid #f3f4f6;">
      <td style="padding:7px 14px;color:#374151;font-size:13px;font-weight:500;">${u.name}</td>
      <td style="padding:7px 14px;font-size:12px;">${activePart}${history}</td>
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
          <th style="padding:7px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Accesos</th>
          <th style="padding:7px 14px;text-align:left;font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase;letter-spacing:.5px;">Descripción</th>
        </tr></thead>
        <tbody>${usersHtml}</tbody>
      </table>
    </div>

    <p style="color:#94a3b8;font-size:11px;text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9;">${companyName} &nbsp;·&nbsp; Reporte generado automáticamente &nbsp;·&nbsp; ${dateStr}</p>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
