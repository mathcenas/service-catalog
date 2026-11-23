import { useState, useEffect, useMemo } from 'react';
import {
  Server, Globe, Calendar, Clock, Shield, CheckCircle2,
  HardDrive, Wifi, ChevronDown, ChevronRight, Mail, X,
  Sparkles, Rocket, DollarSign, Send, Loader2, HelpCircle, ShieldCheck, Lock,
  AlertTriangle, AlertCircle, Eye, CheckCheck,
} from 'lucide-react';
import { createShareClient, Client, Service, ServiceType, Project, ServiceChange, ManagedRole, RoadmapItem, RoadmapStatus, RoadmapItemUpdate, ClientLicense, UserSettings, SupportHour, ServiceHeartbeat, ClientApp, ServiceIncident } from '../lib/supabase';
import { BackupMetricsModal } from '../components/BackupMetricsModal';
import { backupMaxAgeHours, jobMaxAgeHours, isRetiredJob } from '../lib/backupSchedule';
import { ReferencesSection } from '../components/share/ReferencesSection';
import { appKind } from '../lib/appKinds';
import { hardwareAlerts, type HardwareAlert } from '../lib/hardwareAlerts';

type Props = { token: string };
type Section = 'overview' | 'services' | 'licenses' | 'changes' | 'hours' | 'support' | 'tickets' | 'referencias';

interface ServiceBackup {
  id: string;
  service_id: string;
  job_name: string | null;
  status: string;
  size_bytes: number | null;
  duration_seconds: number | null;
  backed_up_at: string;
}

interface UptimeEvent {
  id: string;
  service_id: string;
  monitor_name: string | null;
  event_type: string;
  message: string | null;
  duration_seconds: number | null;
  occurred_at: string;
}

function billingCycleMonths(cycle: string): number {
  return cycle === 'Monthly' ? 1 : cycle === 'Quarterly' ? 3 : cycle === 'Semi-Annually' ? 6 : cycle === 'Annually' ? 12 : cycle === 'Biennially' ? 24 : 0;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days === 2) return '2 days ago';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes < 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
}

function serviceMonthlyTotal(service: Service): number {
  const months = billingCycleMonths(service.billing_cycle);
  if (months === 0) return 0;
  const hours = service.confirmed_hours_monthly;
  if (hours && hours > 0) return service.price * hours;
  return service.price / months;
}

const ROADMAP_META: Record<RoadmapStatus, { color: string; bg: string; label: string; icon: any }> = {
  'Next Release':  { color: 'text-brand-accent dark:text-brand-accent',      bg: 'bg-brand-accent/10 dark:bg-brand-accent/10',    label: 'Next Release',  icon: Rocket },
  'In Progress':   { color: 'text-amber-600 dark:text-amber-400',    bg: 'bg-amber-50 dark:bg-amber-950',  label: 'In Progress',   icon: Sparkles },
  'Planned':       { color: 'text-slate-600 dark:text-slate-400',    bg: 'bg-slate-100 dark:bg-slate-800', label: 'Planned',       icon: Calendar },
  'Released':      { color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950', label: 'Released', icon: CheckCircle2 },
};

export function SharePage({ token }: Props) {
  const [client, setClient] = useState<Client | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [changes, setChanges] = useState<ServiceChange[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [roadmapUpdates, setRoadmapUpdates] = useState<RoadmapItemUpdate[]>([]);
  const [licenses, setLicenses] = useState<ClientLicense[]>([]);
  const [supportHours, setSupportHours] = useState<SupportHour[]>([]);
  const [heartbeats, setHeartbeats] = useState<ServiceHeartbeat[]>([]);
  const [systemHeartbeats, setSystemHeartbeats] = useState<ServiceHeartbeat[]>([]);
  // Heartbeats "tailscale" de kopia-report: a qué IP de la VPN manda el backup y si responde
  const [vpnHeartbeats, setVpnHeartbeats] = useState<ServiceHeartbeat[]>([]);
  // Reporte de red de los routers MikroTik (mk-network-report.rsc): estado de los túneles VPN
  const [netHeartbeats, setNetHeartbeats] = useState<ServiceHeartbeat[]>([]);
  // cpu-watch.ps1: resumen diario de los picos de CPU en horario laboral (evidencia antes/después de un cambio)
  const [cpuWatch, setCpuWatch] = useState<ServiceHeartbeat[]>([]);
  const [clientApps, setClientApps] = useState<ClientApp[]>([]);
  const [incidents, setIncidents] = useState<ServiceIncident[]>([]);
  const [backups, setBackups] = useState<ServiceBackup[]>([]);
  const [uptimeEvents, setUptimeEvents] = useState<UptimeEvent[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // #referencias abre directo la página de referencias (link desde los mails)
  const [section, setSection] = useState<Section>(() => (typeof window !== 'undefined' && window.location.hash === '#referencias' ? 'referencias' : 'overview'));
  const [expandedService, setExpandedService] = useState<string | null>(null);

  const [dark, setDark] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    // Cliente propio del portal: manda el token en `x-share-token`, que las políticas
    // RLS anon exigen (sin él, o con el token de otro cliente, las tablas vienen vacías).
    const supabase = createShareClient(token);

    const load = async () => {
      const { data: tokenRows, error: tokenError } = await supabase
        .rpc('resolve_share_token', { p_token: token });
      const tokenRow = tokenRows?.[0];

      if (tokenError || !tokenRow) { setNotFound(true); setLoading(false); return; }

      const servicesQuery = supabase.from('services').select('*').eq('client_id', tokenRow.client_id).order('created_at');
      if (tokenRow.service_ids && tokenRow.service_ids.length > 0) {
        servicesQuery.in('id', tokenRow.service_ids);
      }

      const [{ data: clientData }, { data: servicesData }, { data: projectsData }, { data: typesData }, { data: roadmapData }, { data: settingsData }] = await Promise.all([
        supabase.from('clients').select('*').eq('id', tokenRow.client_id).maybeSingle(),
        servicesQuery,
        supabase.from('projects').select('*').eq('client_id', tokenRow.client_id).order('created_at'),
        supabase.from('service_types').select('*'),
        supabase.from('roadmap_items').select('*').eq('user_id', tokenRow.user_id).eq('is_public', true).or(`client_id.eq.${tokenRow.client_id},client_id.is.null`).order('sort_order').order('created_at'),
        supabase.from('user_settings').select('company_name, logo_url').eq('user_id', tokenRow.user_id).maybeSingle(),
      ]);

      if (roadmapData && roadmapData.length > 0) {
        const ids = roadmapData.map((r: RoadmapItem) => r.id);
        const { data: updatesData } = await supabase
          .from('roadmap_item_updates')
          .select('*')
          .in('roadmap_item_id', ids)
          .order('created_at', { ascending: true });
        setRoadmapUpdates(updatesData || []);
      }

      if (!clientData) { setNotFound(true); setLoading(false); return; }

      setClient(clientData);
      setServices(servicesData || []);
      setProjects(projectsData || []);
      setServiceTypes(typesData || []);
      setRoadmap(roadmapData || []);
      if (settingsData) setUserSettings(settingsData);

      const currentYearStart = `${new Date().getFullYear()}-01-01`;

      const ids = (servicesData || []).map(s => s.id);
      if (ids.length > 0) {
        const { data: changesData } = await supabase
          .from('service_changes').select('*').in('service_id', ids)
          .gte('change_date', currentYearStart)
          .order('change_date', { ascending: false });
        setChanges(changesData || []);
      }

      const { data: licensesData } = await supabase
        .from('client_licenses').select('*').eq('client_id', tokenRow.client_id).order('expiration_date', { ascending: true, nullsFirst: false });
      setLicenses(licensesData || []);

      const { data: hoursData } = await supabase
        .from('support_hours').select('*').eq('client_id', tokenRow.client_id)
        .gte('work_date', currentYearStart)
        .order('work_date', { ascending: false });
      setSupportHours(hoursData || []);

      const serviceIds = (servicesData || []).map(s => s.id);
      if (serviceIds.length > 0) {
        const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        const [{ data: hbData }, { data: sysHbData }, { data: backupsData }, { data: uptimeData }] = await Promise.all([
          supabase.from('service_heartbeats').select('*').in('service_id', serviceIds).eq('source', 'speedtest').gte('received_at', since48h).order('received_at', { ascending: true }),
          supabase.from('service_heartbeats').select('*').in('service_id', serviceIds).in('source', ['system-health', 'backup-folder', 'db-check', 'smb-check', 'tailscale']).gte('received_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).order('received_at', { ascending: false }),
          supabase.from('service_backups').select('id,service_id,job_name,status,size_bytes,duration_seconds,backed_up_at').in('service_id', serviceIds).order('backed_up_at', { ascending: false }).limit(100),
          supabase.from('uptime_events').select('id,service_id,monitor_name,event_type,message,duration_seconds,occurred_at').in('service_id', serviceIds).gte('occurred_at', since30d).order('occurred_at', { ascending: false }),
        ]);
        setHeartbeats(hbData || []);
        setSystemHeartbeats((sysHbData || []).filter(h => h.source !== 'tailscale'));
        setVpnHeartbeats((sysHbData || []).filter(h => h.source === 'tailscale'));
        setBackups(backupsData || []);
        setUptimeEvents(uptimeData || []);
        const { data: cpuData } = await supabase.from('service_heartbeats').select('id,service_id,status,payload,received_at')
          .in('service_id', serviceIds).eq('source', 'cpu-watch')
          .gte('received_at', new Date(Date.now() - 21 * 86_400_000).toISOString()).order('received_at', { ascending: true });
        setCpuWatch((cpuData || []) as ServiceHeartbeat[]);
        const { data: netData } = await supabase.from('service_heartbeats').select('id,service_id,status,payload,received_at')
          .in('service_id', serviceIds).eq('source', 'mk-network')
          .gte('received_at', new Date(Date.now() - 6 * 3_600_000).toISOString()).order('received_at', { ascending: false }).limit(50);
        setNetHeartbeats((netData || []) as ServiceHeartbeat[]);
      }

      const { data: appsData } = await supabase
        .from('client_apps').select('*').eq('client_id', tokenRow.client_id).order('sort_order');
      setClientApps(appsData || []);

      const since90d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data: incidentsData } = await supabase
        .from('service_incidents')
        .select('*')
        .eq('client_id', tokenRow.client_id)
        .gte('started_at', since90d)
        .order('started_at', { ascending: false });
      setIncidents(incidentsData || []);

      setLoading(false);
    };
    load();

    // Refresh live data (backups, heartbeats) every 5 minutes without re-loading the full page
    const refreshLive = async () => {
      const { data: tokenRows } = await supabase.rpc('resolve_share_token', { p_token: token });
      const tokenRow = tokenRows?.[0];
      if (!tokenRow) return;
      const svcQuery = supabase.from('services').select('id').eq('client_id', tokenRow.client_id);
      if (tokenRow.service_ids && tokenRow.service_ids.length > 0) svcQuery.in('id', tokenRow.service_ids);
      const { data: svcs } = await svcQuery;
      const serviceIds = (svcs || []).map((s: { id: string }) => s.id);
      if (serviceIds.length === 0) return;
      const [{ data: sysHbData }, { data: backupsData }] = await Promise.all([
        supabase.from('service_heartbeats').select('*').in('service_id', serviceIds).in('source', ['system-health', 'backup-folder', 'db-check', 'smb-check', 'tailscale']).gte('received_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()).order('received_at', { ascending: false }),
        supabase.from('service_backups').select('id,service_id,job_name,status,size_bytes,duration_seconds,backed_up_at').in('service_id', serviceIds).order('backed_up_at', { ascending: false }).limit(100),
      ]);
      if (sysHbData) {
        setSystemHeartbeats(sysHbData.filter(h => h.source !== 'tailscale'));
        setVpnHeartbeats(sysHbData.filter(h => h.source === 'tailscale'));
      }
      if (backupsData) setBackups(backupsData);
      const { data: netData } = await supabase.from('service_heartbeats').select('id,service_id,status,payload,received_at')
        .in('service_id', serviceIds).eq('source', 'mk-network')
        .gte('received_at', new Date(Date.now() - 6 * 3_600_000).toISOString()).order('received_at', { ascending: false }).limit(50);
      if (netData) setNetHeartbeats(netData as ServiceHeartbeat[]);
    };
    const interval = setInterval(refreshLive, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [token]);

  const getTypeName = (id: string) => serviceTypes.find(t => t.id === id)?.name || 'Service';
  const getProjectName = (id?: string): string | null => id ? projects.find(p => p.id === id)?.name || null : null;
  const activeServices = useMemo(() => services.filter(s => s.status === 'Active'), [services]);
  const allOperational = useMemo(() => activeServices.every(s => s.operational_status === 'Operational' || !s.operational_status), [activeServices]);
  const statusPageUrl = client?.uptime_status_url || null;

  if (loading) {
    return (
      <div className={`${dark ? 'dark' : ''}`}>
        <div className="min-h-screen bg-slate-50 dark:bg-gray-950 flex items-center justify-center">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-brand-accent border-t-transparent"></div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className={`${dark ? 'dark' : ''}`}>
        <div className="min-h-screen bg-slate-50 dark:bg-gray-950 flex items-center justify-center p-4">
          <div className="text-center">
            <Globe className="w-14 h-14 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Portal Not Found</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">This link is invalid or has expired.</p>
          </div>
        </div>
      </div>
    );
  }

  const badge = (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
      allOperational
        ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
        : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
    } ${statusPageUrl ? 'hover:opacity-80 transition-opacity' : ''}`}>
      <span className={`w-2 h-2 rounded-full animate-pulse ${allOperational ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {allOperational ? 'All Operational' : 'Issues Detected'}
    </div>
  );

  return (
    <div className={`${dark ? 'dark' : ''}`}>
      <div className="min-h-screen bg-slate-50 dark:bg-gray-950">
        {/* Watermark logo */}
        {userSettings?.logo_url && (
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-30 flex items-end justify-center px-4 pb-5">
            <img
              src={userSettings.logo_url}
              alt=""
              draggable={false}
              className="h-auto w-full max-w-[8rem] select-none object-contain opacity-[0.10] dark:opacity-[0.07] drop-shadow-[0_1px_6px_rgba(255,255,255,0.6)]"
            />
          </div>
        )}
        {/* Header */}
        <header className="share-header">
          <div className="max-w-5xl mx-auto px-4 py-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {userSettings?.logo_url ? (
                  <img src={userSettings.logo_url} alt="Logo" className="h-8 max-w-[120px] object-contain brightness-0 invert" />
                ) : (
                  <div className="bg-brand-accent/20 p-2 rounded-lg">
                    <Shield className="w-4 h-4 text-brand-accent" />
                  </div>
                )}
                <div className="h-6 w-px bg-white/15" />
                <div>
                  <h1 className="text-lg font-bold text-white font-brand">{client!.company_name}</h1>
                  <p className="text-xs text-white/50">{userSettings?.company_name || 'Managed Services Portal'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-wrap justify-end">
                <div className="flex items-center gap-2 bg-[#1E293B] border border-slate-700/80 px-3 py-1 rounded-full text-xs">
                  <span className="h-2 w-2 rounded-full bg-[#06B6D4] animate-pulse" />
                  <span className="text-slate-300">Gestión bajo norma <strong className="text-white">ISO/IEC 20000</strong></span>
                </div>
                {client!.spof_free != null && (
                  <div className={`group relative flex items-center gap-2 border px-3 py-1 rounded-full text-xs ${client!.spof_free ? 'bg-emerald-950/60 border-emerald-700/60' : 'bg-amber-950/60 border-amber-700/60'}`}>
                    <span className={`h-2 w-2 rounded-full ${client!.spof_free ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className={client!.spof_free ? 'text-emerald-300' : 'text-amber-300'}>
                      {client!.spof_free ? 'Sin SPOF crítico' : 'SPOF identificado'}
                    </span>
                    <span className="text-white/30 cursor-help">?</span>
                    <div className="absolute right-0 top-full mt-2 w-64 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2.5 text-xs text-slate-300 leading-relaxed opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-xl">
                      <strong className="text-white block mb-1">Single Point of Failure (SPOF)</strong>
                      Un SPOF es cualquier componente cuya falla detiene toda la operación. Evaluamos redundancia en servidores, conectividad, energía y backups para minimizar este riesgo.
                    </div>
                  </div>
                )}
                {statusPageUrl ? (
                  <>
                    <a href={statusPageUrl} target="_blank" rel="noopener noreferrer">{badge}</a>
                    <a
                      href={statusPageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors"
                    >
                      <Wifi className="w-3 h-3" />
                      Status Page
                    </a>
                  </>
                ) : badge}
              </div>
            </div>
          </div>
        </header>

        {/* Status badges */}
        <StatusBar services={services} />

        {/* Nav */}
        <nav className="share-nav sticky top-0 z-10">
          <div className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
            <NavBtn active={section === 'overview'} onClick={() => setSection('overview')}>Overview</NavBtn>
            <NavBtn active={section === 'services'} onClick={() => setSection('services')}>Services</NavBtn>
            {licenses.length > 0 && <NavBtn active={section === 'licenses'} onClick={() => setSection('licenses')}>Licenses</NavBtn>}
            {roadmap.some(r => r.category === 'problem' || r.category === 'change_request') && (
              <NavBtn active={section === 'tickets' as Section} onClick={() => setSection('tickets' as Section)}>Tickets</NavBtn>
            )}
            {(supportHours.length > 0 || roadmap.some(r => r.amount_type === 'hours' && r.amount && r.amount > 0)) && <NavBtn active={section === 'hours'} onClick={() => setSection('hours')}>Hours</NavBtn>}
            <NavBtn active={section === 'support'} onClick={() => setSection('support')}>Support</NavBtn>
            <NavBtn active={section === 'referencias'} onClick={() => setSection('referencias')}>Referencias</NavBtn>
          </div>
        </nav>

        <main className="max-w-5xl mx-auto px-4 py-6">
          {section === 'overview' && <OverviewSection services={activeServices} roadmap={roadmap} changes={changes} getTypeName={getTypeName} backups={backups} uptimeEvents={uptimeEvents} supportHours={supportHours} systemHeartbeats={systemHeartbeats} vpnHeartbeats={vpnHeartbeats} cpuWatch={cpuWatch} clientApps={clientApps} licenses={licenses} riskFlags={client?.risk_flags ?? []} incidents={incidents} />}
          {section === 'services' && <ServiceCatalog services={services} projects={projects} getTypeName={getTypeName} getProjectName={getProjectName} expandedService={expandedService} setExpandedService={setExpandedService} heartbeats={heartbeats} backups={backups} systemHeartbeats={systemHeartbeats} netHeartbeats={netHeartbeats} />}
          {section === 'licenses' && <LicensesSection licenses={licenses} services={services} />}
          {section === ('tickets' as Section) && <TicketsSection items={roadmap.filter(r => r.category === 'problem' || r.category === 'change_request')} updates={roadmapUpdates} />}
          {section === 'hours' && <SupportHoursSection hours={supportHours} roadmapItems={roadmap} services={services} />}
          {section === 'support' && <SupportSection token={token} clientName={client!.company_name} services={services} />}
          {section === 'referencias' && <ReferencesSection companyName={userSettings?.company_name ?? undefined} />}
        </main>

        <footer className="border-t border-gray-100 dark:border-gray-800 py-6">
          <div className="max-w-5xl mx-auto px-4 text-center space-y-1">
            <p className="text-xs text-gray-400 dark:text-gray-600">
              Gobernanza TI y Monitoreo Proactivo operados por {userSettings?.company_name || 'Cenas IT Solutions'}.
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-600">
              Procesos alineados a estándar <strong className="text-gray-500 dark:text-gray-500">ISO/IEC 20000</strong> para continuidad operativa y seguridad.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-700 pt-1">
              ¿Perdiste tu link?{' '}
              <a href="/acceso" className="text-brand-accent hover:underline font-medium">Solicitá uno nuevo →</a>
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ---------- Status Bar ---------- */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

function useKumaUptime(statusUrl: string | null | undefined): number | null {
  const [uptime, setUptime] = useState<number | null>(null);
  useEffect(() => {
    if (!statusUrl) return;
    const proxyUrl = `${SUPABASE_URL}/functions/v1/kuma-proxy?url=${encodeURIComponent(statusUrl)}`;
    fetch(proxyUrl)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.uptimeList) return;
        const vals = Object.entries(data.uptimeList)
          .filter(([k]) => k.endsWith('_24'))
          .map(([, v]) => v as number);
        if (vals.length > 0) setUptime(vals.reduce((a, b) => a + b, 0) / vals.length);
      })
      .catch(() => {});
  }, [statusUrl]);
  return uptime;
}

function ServiceBadge({ service }: { service: Service }) {
  const uptime = useKumaUptime(service.uptime_status_url);
  const pct = uptime !== null ? (uptime * 100).toFixed(uptime >= 0.9995 ? 2 : 1) : null;
  const color = uptime === null ? '' : uptime >= 0.999 ? 'text-emerald-600 dark:text-emerald-400' : uptime >= 0.99 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500';
  return (
    <div className="flex items-center gap-2 shrink-0">
      <img src={service.uptime_badge_url!} alt={service.business_name || service.name} className="h-4" loading="lazy" />
      {pct && <span className={`text-[10px] font-semibold tabular-nums ${color}`}>{pct}%</span>}
      {service.uptime_status_url && (
        <a href={service.uptime_status_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-brand-accent dark:text-brand-accent hover:text-brand-accent/80 font-medium">details</a>
      )}
    </div>
  );
}

function StatusBar({ services }: { services: Service[] }) {
  const monitored = services.filter(s => s.status === 'Active' && s.uptime_badge_url);
  if (monitored.length === 0) return null;
  return (
    <div className="bg-slate-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-4 overflow-x-auto">
        <span className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-medium shrink-0">Status</span>
        {monitored.map(s => <ServiceBadge key={s.id} service={s} />)}
      </div>
    </div>
  );
}

/* ---------- Nav ---------- */

function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap font-brand ${
      active
        ? 'border-brand-accent text-brand-accent'
        : 'border-transparent text-white/55 hover:text-white/90'
    }`}>{children}</button>
  );
}

/* ---------- Overview ---------- */

const RISK_FLAG_LABELS: Record<string, string> = {
  no_isp_redundancy:   'Sin redundancia de internet (ISP único)',
  no_endpoint_backup:  'Sin backup de endpoints',
  no_offsite_backup:   'Sin backup offsite',
  no_321_rule:         'No cumple regla 3-2-1',
  no_ups:              'Sin UPS',
  no_mfa:              'Sin doble factor de autenticación',
  no_password_manager: 'Sin gestión centralizada de contraseñas',
  free_antivirus:      'Antivirus gratuito (sin gestión centralizada)',
  no_bco_plan:         'Sin plan de BCO documentado',
};

function OverviewSection({ services, roadmap, changes, getTypeName, backups, uptimeEvents, supportHours, systemHeartbeats, vpnHeartbeats, cpuWatch, clientApps, licenses, riskFlags, incidents }: {
  services: Service[]; roadmap: RoadmapItem[]; changes: ServiceChange[]; getTypeName: (id: string) => string;
  backups: ServiceBackup[]; uptimeEvents: UptimeEvent[]; supportHours: SupportHour[];
  systemHeartbeats: ServiceHeartbeat[]; vpnHeartbeats: ServiceHeartbeat[]; cpuWatch: ServiceHeartbeat[]; clientApps: ClientApp[]; licenses: ClientLicense[];
  riskFlags: string[]; incidents: ServiceIncident[];
}) {
  const upcoming = roadmap.filter(r => r.status !== 'Released');
  const recentChanges = changes.slice(0, 3);

  const renewalCycles = new Set(['Annually', 'Biennially', 'Semi-Annually', 'One-Time']);
  const in60days = new Date(); in60days.setDate(in60days.getDate() + 60);
  const upcomingRenewals = services
    .filter(s => s.next_renewal_date && renewalCycles.has(s.billing_cycle ?? '') && new Date(s.next_renewal_date) <= in60days)
    .sort((a, b) => new Date(a.next_renewal_date!).getTime() - new Date(b.next_renewal_date!).getTime());

  // Latest heartbeat per service+source combo
  const latestHealth: Record<string, ServiceHeartbeat> = {};
  for (const h of systemHeartbeats) {
    const key = `${h.service_id}|${h.source}`;
    if (!latestHealth[key] || h.received_at > latestHealth[key].received_at) {
      latestHealth[key] = h;
    }
  }
  const healthEntries = Object.values(latestHealth);
  // Avisos de hardware para el cliente (disco que falla, espejo degradado, disco lleno), de reportes de los últimos 3 días
  const attention = healthEntries
    .filter(h => h.source === 'system-health' && Date.now() - new Date(h.received_at).getTime() < 72 * 3_600_000)
    .flatMap(h => {
      const svc = services.find(s => s.id === h.service_id);
      return hardwareAlerts(h.payload as Record<string, unknown>, svc?.business_name || svc?.name || 'un equipo')
        .map(a => ({ ...a, key: `${h.service_id}-${a.key}`, reportedAt: h.received_at }));
    })
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));

  const totalAllocated = services.reduce((sum, s) => sum + (s.confirmed_hours_monthly || 0), 0);
  const completedHours = roadmap
    .filter(r => r.status === 'Released' && r.amount_type === 'hours' && r.amount && r.amount > 0)
    .reduce((sum, r) => sum + (r.amount ?? 0), 0);
  // Horas trabajadas este mes (tareas terminadas del Task Tracker o cargadas a mano)
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const hasLoggedHours = supportHours.length > 0;
  const monthHours = supportHours.filter(h => h.work_date.startsWith(monthPrefix)).reduce((sum, h) => sum + Number(h.hours), 0);
  const fmtH = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}h`;

  return (
    <div className="space-y-6">
      {attention.length > 0 && <AttentionPanel alerts={attention} />}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active Services" value={services.length.toString()} tooltip="Cantidad de servicios activos que Cenas IT gestiona para tu empresa (internet, servidores, backups, licencias, etc.)." />
        <StatCard label="Upcoming Updates" value={upcoming.length.toString()} accent={upcoming.length > 0} tooltip="Mejoras, cambios o tareas planificadas que están en progreso o pendientes de implementar." />
        <StatCard label="Completed Updates" value={roadmap.filter(r => r.status === 'Released').length.toString()} tooltip="Cantidad de actualizaciones y mejoras ya implementadas en tu infraestructura." />
        {hasLoggedHours
          ? <StatCard label="Hours this month" value={totalAllocated > 0 ? `${fmtH(monthHours)} / ${fmtH(totalAllocated)}` : fmtH(monthHours)} accent={totalAllocated > 0 && monthHours > totalAllocated} tooltip={totalAllocated > 0 ? `Horas de trabajo técnico de este mes (tareas terminadas) sobre las ${fmtH(totalAllocated)} confirmadas por mes en tus servicios. El detalle está en la pestaña Hours.` : 'Horas de trabajo técnico de este mes (tareas terminadas). El detalle está en la pestaña Hours.'} />
          : completedHours > 0
          ? <StatCard label="Hours worked" value={`${completedHours}h`} tooltip="Horas de trabajo técnico registradas en tareas y proyectos completados." />
          : totalAllocated > 0 && <StatCard label="Hours/month" value={`${totalAllocated}h`} tooltip="Horas de soporte técnico incluidas en tu plan mensual." />
        }
      </div>

      <BackupStatus services={services} backups={backups} kopiaDest={kopiaDestinations(services, systemHeartbeats, vpnHeartbeats)} />
      <UptimeStatus services={services} uptimeEvents={uptimeEvents} />

      <IncidentPanel incidents={incidents} />

      {upcoming.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Upcoming</h2>
            <InfoTooltip text="Tareas, mejoras y cambios planificados en tu infraestructura. Incluye actualizaciones de software, migraciones, nuevas configuraciones y proyectos en curso." />
          </div>
          <div className="space-y-2">
            {upcoming.slice(0, 5).map(item => {
              const meta = ROADMAP_META[item.status];
              const Icon = meta.icon;
              return (
                <div key={item.id} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-start gap-3">
                  <div className={`p-1.5 rounded-md ${meta.bg} mt-0.5`}><Icon className={`w-3.5 h-3.5 ${meta.color}`} /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">{item.title}</span>
                      <span className={`text-[10px] font-semibold uppercase ${meta.color}`}>{meta.label}</span>
                    </div>
                    {item.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>}
                  </div>
                  {item.scheduled_date && (
                    <span className="text-xs text-gray-400 shrink-0">{new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}


      {upcomingRenewals.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Upcoming Renewals</h2>
          <div className="space-y-2">
            {upcomingRenewals.map(s => {
              const date = new Date(s.next_renewal_date!);
              const daysLeft = Math.ceil((date.getTime() - Date.now()) / 86400000);
              const urgent = daysLeft <= 14;
              return (
                <div key={s.id} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{s.business_name || s.name}</p>
                    <p className="text-xs text-gray-400">{getTypeName(s.service_type_id)} · {s.billing_cycle}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                    <p className={`text-xs font-medium ${urgent ? 'text-amber-500' : 'text-gray-400'}`}>{daysLeft <= 0 ? 'Due today' : `in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {(() => { const expiring = licenses.filter(l => { const d = l.expiration_date ? Math.ceil((new Date(l.expiration_date).getTime() - Date.now()) / 86400000) : null; return d !== null && d >= 0 && d <= 30; }); return expiring.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Licencias próximas a vencer</h2>
          <div className="space-y-2">
            {expiring.map(lic => {
              const days = Math.ceil((new Date(lic.expiration_date!).getTime() - Date.now()) / 86400000);
              return (
                <div key={lic.id} className="bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-800 px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{lic.software_name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{lic.quantity} {lic.quantity_label}</p>
                  </div>
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 shrink-0">
                    {days === 0 ? 'Vence hoy' : `Vence en ${days}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      ); })()}

      {healthEntries.length > 0 && <SystemHealth entries={healthEntries} services={services} cpuWatch={cpuWatch} />}

      {/* Resolved incidents history from support_hours (legacy — shown only when no new incident system entries) */}
      {incidents.filter(i => i.status === 'resolved').length === 0 && supportHours.filter(h => h.type === 'incident').length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Resolved Incidents</h2>
            <InfoTooltip text="Incidentes técnicos recientes que ya fueron atendidos y resueltos por el equipo de Cenas IT." />
          </div>
          <div className="space-y-2">
            {supportHours.filter(h => h.type === 'incident').slice(0, 5).map(h => (
              <div key={h.id} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{h.title || h.description}</p>
                  {h.title && <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{h.description}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-400">{new Date(h.work_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                  {h.hours > 0 && <p className="text-xs text-gray-500">{h.hours}h</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {clientApps.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Applications & Software</h2>
            <InfoTooltip text="Qué corre en cada equipo de tu empresa: aplicaciones de proveedores (con su contacto de soporte), impresoras y carpetas compartidas. Tocá un equipo para ver el detalle." />
          </div>
          <div className="space-y-2">
            {(() => {
              // Agrupado por equipo; cada grupo es desplegable y arranca cerrado
              const groups = new Map<string, ClientApp[]>();
              for (const app of clientApps) {
                const key = app.service_id ?? '';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(app);
              }
              const svcName = (id: string) => { const sv = services.find(x => x.id === id); return sv ? (sv.business_name || sv.name) : 'Otro equipo'; };
              return [...groups.entries()]
                .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : svcName(a).localeCompare(svcName(b))))
                .map(([key, apps]) => (
                  <details key={key || 'general'} className="group bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
                    <summary className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-gray-900 dark:text-white">{key ? svcName(key) : 'Generales'}</span>
                        <span className="ml-2 text-xs text-gray-400">
                          {apps.length} {apps.length === 1 ? 'ítem' : 'ítems'} · {[...new Set(apps.map(a => appKind(a.kind).icon))].join(' ')}
                        </span>
                      </span>
                      <ChevronDown className="w-4 h-4 text-gray-400 shrink-0 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
                      {apps.map(app => (
                        <div key={app.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 dark:text-white"><span aria-hidden="true">{appKind(app.kind).icon}</span> {app.name}</p>
                            <p className="text-xs text-gray-400">{[appKind(app.kind).label, app.vendor].filter(Boolean).join(' · ')}</p>
                            {app.notes && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{app.notes}</p>}
                          </div>
                          <div className="flex gap-2 shrink-0">
                            {app.whatsapp_url && (
                              <a href={app.whatsapp_url} target="_blank" rel="noopener noreferrer"
                                className="text-xs text-emerald-600 hover:text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-md font-medium">
                                WhatsApp
                              </a>
                            )}
                            {app.support_phone && (
                              <a href={`tel:${app.support_phone}`}
                                className="text-xs text-brand-accent hover:text-brand-accent/80 bg-brand-accent/10 px-2 py-1 rounded-md font-medium">
                                {app.support_phone}
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ));
            })()}
          </div>
        </section>
      )}

      {roadmap.filter(r => r.status === 'Released').length > 0 && (
        <CompletedUpdates items={roadmap.filter(r => r.status === 'Released')} />
      )}

      {riskFlags.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Fuera de alcance</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">Los siguientes puntos no están incluidos en el servicio administrado actual.</p>
          <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
            {riskFlags.map(flag => (
              <div key={flag} className="px-4 py-2.5 flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />
                <span className="text-sm text-gray-600 dark:text-gray-300">{RISK_FLAG_LABELS[flag] ?? flag}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Your Services</h2>
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {services.map(s => (
            <div key={s.id} className="px-4 py-3 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                s.operational_status === 'Operational' || !s.operational_status ? 'bg-emerald-500' :
                s.operational_status === 'Degraded' ? 'bg-amber-500' :
                s.operational_status === 'Down' ? 'bg-red-500' : 'bg-brand-accent/100'
              }`} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-900 dark:text-white">{s.business_name || s.name}</span>
                <span className="text-xs text-gray-400 ml-2">{getTypeName(s.service_type_id)}</span>
              </div>
              {s.uptime_badge_url && <img src={s.uptime_badge_url} alt="status" className="h-4" loading="lazy" />}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CompletedUpdates({ items }: { items: RoadmapItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 3);
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" /> Completed Updates
        </h2>
        {items.length > 3 && (
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-brand-accent dark:text-brand-accent hover:underline">
            {expanded ? 'Show less' : `Show all ${items.length}`}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map(item => (
          <div key={item.id} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-start gap-3 opacity-75">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-gray-900 dark:text-white">{item.title}</span>
              {item.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{item.description}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {item.amount_type === 'hours' && item.amount && item.amount > 0 && (
                <span className="text-xs font-semibold text-brand-accent dark:text-brand-accent bg-brand-accent/10 dark:bg-brand-accent/10 px-2 py-0.5 rounded-full">{item.amount}h</span>
              )}
              {item.scheduled_date && (
                <span className="text-xs text-gray-400">{new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex items-center">
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-500 hover:text-slate-300 transition-colors focus:outline-none"
        aria-label="Más información"
        type="button"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-56 bg-[#0B192C] border border-white/10 text-slate-300 text-xs rounded-lg px-3 py-2 shadow-xl leading-relaxed pointer-events-none">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#0B192C]" />
        </span>
      )}
    </span>
  );
}

function StatCard({ label, value, accent = false, tooltip }: { label: string; value: string; accent?: boolean; tooltip?: string }) {
  return (
    <div className="bg-[#1E293B] rounded-xl border border-white/5 px-4 py-3">
      <div className="flex items-center gap-1 mb-1">
        <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <div className={`text-2xl font-bold ${accent ? 'text-[#06B6D4]' : 'text-white'}`}>{value}</div>
    </div>
  );
}

function backupIcon(jobName: string): string {
  if (jobName.toLowerCase().includes('kopia')) return '☁️';
  return '💾';
}

function isOfflineBackup(jobName: string | null): boolean {
  return !!(jobName && jobName.startsWith('Copia física'));
}

type KopiaDest = { name: string; ok: boolean; at: string };

// Kopia manda el backup a una IP de Tailscale (TAILSCALE_IP en config.ps1). Esa IP es la de otro
// equipo del cliente (la que reporta su system-health en tailscale.self.ip): así sabemos a qué
// servidor en la nube va cada backup y si la VPN respondía en el último control.
function kopiaDestinations(services: Service[], health: ServiceHeartbeat[], vpn: ServiceHeartbeat[]): Record<string, KopiaDest> {
  const ipToName: Record<string, string> = {};
  for (const h of health) {
    const ip = (h.payload as any)?.tailscale?.self?.ip;
    if (h.source !== 'system-health' || !ip) continue;
    const svc = services.find(s => s.id === h.service_id);
    if (!svc) continue;
    // Varios servicios en el mismo VPS comparten la IP: preferir el que es el respaldo
    const name = svc.business_name || svc.name;
    if (!ipToName[ip] || (/backup|respaldo|nube|cloud/i.test(name) && !/backup|respaldo|nube|cloud/i.test(ipToName[ip]))) ipToName[ip] = name;
  }
  const out: Record<string, KopiaDest> = {};
  for (const h of vpn) {   // vienen del más nuevo al más viejo
    if (out[h.service_id]) continue;
    const ip = (h.payload as any)?.target_ip as string | undefined;
    if (!ip) continue;
    out[h.service_id] = { name: ipToName[ip] ?? 'servidor en la nube', ok: ['success', 'ok'].includes(String(h.status)), at: h.received_at };
  }
  return out;
}

function BackupStatus({ services, backups, kopiaDest = {} }: { services: Service[]; backups: ServiceBackup[]; kopiaDest?: Record<string, KopiaDest> }) {
  const withBackup = services.filter(s => s.last_backup_at || backups.some(b => b.service_id === s.id));
  if (withBackup.length === 0) return null;

  const [historyModal, setHistoryModal] = useState<{ serviceId: string; name: string } | null>(null);

  // All offline copies across all services, most recent first
  const offlineCopies = backups.filter(b => isOfflineBackup(b.job_name)).slice(0, 3);

  // maxAge: expected backup frequency of the service in hours (null = not monitored)
  function ageLevel(hoursOld: number, maxAge: number | null) {
    if (maxAge === null) return 'ok';
    return hoursOld > maxAge * 2 ? 'late' : hoursOld > maxAge ? 'due' : 'ok';
  }
  function jobDotColor(status: string, hoursOld: number, maxAge: number | null) {
    if (status === 'failed') return 'bg-red-500';
    if (status === 'warning') return 'bg-amber-500';
    const age = ageLevel(hoursOld, maxAge);
    return age === 'late' ? 'bg-red-500' : age === 'due' ? 'bg-amber-500' : 'bg-emerald-500';
  }
  function jobTextColor(status: string, hoursOld: number, maxAge: number | null) {
    const age = ageLevel(hoursOld, maxAge);
    if (status === 'failed' || age === 'late') return 'text-red-400';
    if (status === 'warning' || age === 'due') return 'text-amber-400';
    return 'text-slate-400';
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <HardDrive className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-white">Backup Status</h2>
        <InfoTooltip text="Estado de los últimos backups de cada servicio. Verde = backup reciente y exitoso. Rojo = fallo o sin datos recientes." />
      </div>
      <div className="bg-[#1E293B] rounded-xl border border-white/5 divide-y divide-white/5">
        {withBackup.map(s => {
          const svcBackups = backups.filter(b => b.service_id === s.id);

          // Group by job_name, preserving order (most recent first per group)
          // Offline copies are shown separately in the custody panel below
          const byJob = new Map<string, ServiceBackup[]>();
          for (const b of svcBackups) {
            if (isOfflineBackup(b.job_name)) continue;
            // El resumen diario de Veeam repite los trabajos que ya se listan (y su nombre cambia con la cantidad)
            if (/^(veeam\s*-\s*)?resumen diario\b/i.test(b.job_name || '')) continue;
            const key = b.job_name || '';
            if (!byJob.has(key)) byJob.set(key, []);
            byJob.get(key)!.push(b);
          }

          // Fallback: no non-offline history entries, use service.last_backup_at
          if (byJob.size === 0) {
            if (!s.last_backup_at) return null;
            const hoursOld = (Date.now() - new Date(s.last_backup_at!).getTime()) / 3600000;
            return (
              <div key={s.id} className="px-4 py-3 flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${jobDotColor('success', hoursOld, backupMaxAgeHours(s))}`} />
                <span className="text-sm font-medium text-white flex-1">{s.business_name || s.name}</span>
                {s.last_backup_size_bytes != null && (
                  <span className="text-xs text-slate-400 bg-[#0B192C] px-2 py-0.5 rounded-full font-medium">
                    {formatBytes(s.last_backup_size_bytes)}
                  </span>
                )}
                <span className={`text-xs font-medium ${jobTextColor('success', hoursOld, backupMaxAgeHours(s))}`}>
                  {formatTimeAgo(s.last_backup_at!)}
                </span>
              </div>
            );
          }

          const svcName = s.business_name || s.name;

          // Jobs viejos (renombrados o dados de baja) no se muestran como vencidos
          const newestRun = svcBackups.find(b => !isOfflineBackup(b.job_name))?.backed_up_at ?? '';
          const jobs = [...byJob.entries()]
            .filter(([, entries]) => !isRetiredJob(entries[0].backed_up_at, newestRun))
            .sort((a, b) => b[1][0].backed_up_at.localeCompare(a[1][0].backed_up_at));
          const multiJob = jobs.length > 1;
          if (jobs.length === 0) return null;
          // Se ven los 2 más recientes y cualquiera con problema; el resto queda en un desplegable
          const jobHasProblem = ([jobName, entries]: [string, ServiceBackup[]]) => {
            const hoursOld = (Date.now() - new Date(entries[0].backed_up_at).getTime()) / 3600000;
            const maxAge = jobMaxAgeHours(backupMaxAgeHours(s), jobName, entries.map(e => e.backed_up_at));
            return entries[0].status === 'failed' || ageLevel(hoursOld, maxAge) === 'late';
          };
          const shownJobs = jobs.filter((j, i) => i < 2 || jobHasProblem(j));
          const moreJobs = jobs.filter(j => !shownJobs.includes(j));

          return (
            <div key={s.id} className="px-4 py-3 space-y-2.5">
              {multiJob && (
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">{svcName}</p>
                  <button
                    onClick={() => setHistoryModal({ serviceId: s.id, name: svcName })}
                    className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors"
                  >
                    ver historial
                  </button>
                </div>
              )}
              {(() => {
              const renderJob = ([jobName, entries]: [string, ServiceBackup[]]) => {
                const last = entries[0];
                const hoursOld = (Date.now() - new Date(last.backed_up_at).getTime()) / 3600000;
                const history = entries.slice(0, 7);
                // Cada job con su propia frecuencia (un servicio diario puede tener jobs semanales)
                const maxAge = jobMaxAgeHours(backupMaxAgeHours(s), jobName, entries.map(e => e.backed_up_at));

                return (
                  <div key={jobName} className={multiJob ? 'ml-3' : ''}>
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${jobDotColor(last.status, hoursOld, maxAge)}`} />
                      <div className="flex-1 min-w-0">
                        {!multiJob && (
                          <span className="text-sm font-medium text-white mr-2">{s.business_name || s.name}</span>
                        )}
                        {jobName && (
                          <span className="text-xs text-slate-400">
                            <span className="mr-1">{backupIcon(jobName)}</span>{jobName}
                          </span>
                        )}
                        {/^kopia/i.test(jobName) && kopiaDest[s.id] && (
                          <span className={`flex items-center gap-1 text-[11px] mt-0.5 ${kopiaDest[s.id].ok ? 'text-slate-500' : 'text-amber-400'}`}
                            title={`Último control de la VPN ${formatTimeAgo(kopiaDest[s.id].at)}`}>
                            <Lock className="w-3 h-3 shrink-0" aria-hidden="true" />
                            {kopiaDest[s.id].ok
                              ? `Copia en ${kopiaDest[s.id].name}, por VPN cifrada`
                              : `Copia en ${kopiaDest[s.id].name}: la VPN no respondió en el último control`}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {last.size_bytes != null && last.size_bytes > 0 && (
                          <span className="text-xs text-slate-400 bg-[#0B192C] px-2 py-0.5 rounded-full font-medium">
                            {formatBytes(last.size_bytes)}
                          </span>
                        )}
                        <span className={`text-xs font-medium ${jobTextColor(last.status, hoursOld, maxAge)}`}>
                          {formatTimeAgo(last.backed_up_at)}
                        </span>
                        {!multiJob && (
                          <button
                            onClick={() => setHistoryModal({ serviceId: s.id, name: svcName })}
                            className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors"
                          >
                            ver historial
                          </button>
                        )}
                      </div>
                    </div>
                    {history.length > 1 && (
                      <div className="flex items-center gap-1 mt-1.5 ml-5">
                        <span className="text-[10px] text-slate-500 mr-1">Last {history.length}</span>
                        {history.map(b => (
                          <span key={b.id} title={`${b.status} — ${formatTimeAgo(b.backed_up_at)}`}
                            className={`w-3 h-3 rounded-sm ${b.status === 'failed' ? 'bg-red-500' : b.status === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              };
              return (
                <>
                  {shownJobs.map(renderJob)}
                  {moreJobs.length > 0 && (
                    <details className="ml-3 group">
                      <summary className="cursor-pointer list-none text-[11px] text-slate-500 hover:text-emerald-400 inline-flex items-center gap-1">
                        <ChevronRight className="w-3 h-3 transition-transform group-open:rotate-90" aria-hidden="true" />
                        Ver {moreJobs.length} {moreJobs.length === 1 ? 'backup más' : 'backups más'}
                      </summary>
                      <div className="mt-2.5 space-y-2.5">{moreJobs.map(renderJob)}</div>
                    </details>
                  )}
                </>
              );
              })()}
            </div>
          );
        })}
      </div>
      {offlineCopies.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-600/40 bg-slate-800/60 px-4 py-3.5 flex gap-3">
          <div className="shrink-0 mt-0.5">
            <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center">
              <Lock className="w-3.5 h-3.5 text-slate-300" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-200 mb-0.5">
              Copia física bajo custodia del cliente
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Esta copia permite reactivar toda la operativa de la empresa ante una pérdida total de hardware. Almacenada bajo llave en la caja fuerte del cliente.
            </p>
            <div className="mt-2 space-y-1">
              {offlineCopies.map(b => (
                <div key={b.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <span>
                    {new Date(b.backed_up_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                    {' — '}{services.find(s => s.id === b.service_id)?.business_name || services.find(s => s.id === b.service_id)?.name || ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {historyModal && (
        <BackupMetricsModal
          serviceId={historyModal.serviceId}
          serviceName={historyModal.name}
          onClose={() => setHistoryModal(null)}
        />
      )}
    </section>
  );
}

function UptimeStatus({ services, uptimeEvents }: { services: Service[]; uptimeEvents: UptimeEvent[] }) {
  const servicesWithEvents = services.filter(s => uptimeEvents.some(e => e.service_id === s.id));
  if (servicesWithEvents.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <Wifi className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-white">Uptime — Last 30 Days</h2>
        <InfoTooltip text="Disponibilidad de cada servicio en los últimos 30 días. Muestra cuántas horas estuvo caído y el porcentaje de tiempo operativo." />
      </div>
      <div className="bg-[#1E293B] rounded-xl border border-white/5 divide-y divide-white/5">
        {servicesWithEvents.map(s => {
          const events = uptimeEvents.filter(e => e.service_id === s.id);
          const downEvents = events.filter(e => e.event_type === 'down');
          const lastDown = downEvents[0];

          // Calculate approximate uptime %: sum of duration_seconds for 'up' events that recovered
          const windowMs = 30 * 24 * 60 * 60 * 1000;
          const totalDownMs = downEvents.reduce((sum, e) => {
            // duration_seconds on 'down' event is how long it was down before recovery (set by Kuma)
            return sum + (e.duration_seconds ? e.duration_seconds * 1000 : 0);
          }, 0);
          const uptimePct = Math.max(0, Math.min(100, ((windowMs - totalDownMs) / windowMs) * 100));
          const hasDowntime = totalDownMs > 0;

          return (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full shrink-0 ${!hasDowntime ? 'bg-emerald-500' : uptimePct > 99 ? 'bg-amber-400' : 'bg-red-500'}`} />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-white">{s.business_name || s.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-semibold ${!hasDowntime ? 'text-emerald-400' : uptimePct > 99 ? 'text-amber-400' : 'text-red-400'}`}>
                    {hasDowntime ? `${uptimePct.toFixed(2)}%` : '100%'}
                  </span>
                  {downEvents.length > 0 && (
                    <span className="text-xs text-slate-400">{downEvents.length} incident{downEvents.length !== 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
              {lastDown && (
                <p className="text-xs text-slate-500 mt-1 ml-5">
                  Last incident: {formatTimeAgo(lastDown.occurred_at)}
                  {lastDown.duration_seconds ? ` · ${Math.round(lastDown.duration_seconds / 60)} min down` : ''}
                  {lastDown.message ? ` · ${lastDown.message}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Service Catalog ---------- */

const SERVICE_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Infrastructure', types: ['VPS', 'Dedicated Server'] },
  { label: 'Network & Connectivity', types: ['Firewall', 'Router / Switch', 'VPN'] },
  { label: 'Database', types: ['Database'] },
  { label: 'Web & Applications', types: ['Web Hosting', 'Email Hosting', 'CDN'] },
  { label: 'Domain & DNS', types: ['Domain'] },
  { label: 'Backup', types: ['Backup'] },
  { label: 'Managed Services', types: ['Managed Service', 'Monitoring'] },
];

function monthlyEquivalent(service: Service): number {
  const months = billingCycleMonths(service.billing_cycle);
  const safeMonths = months > 0 ? months : 1;
  const hours = service.confirmed_hours_monthly ?? 0;
  const infra = service.infrastructure_cost ?? 0;
  if (service.price > 0 && hours > 0) return service.price * hours + infra / safeMonths;
  if (service.price > 0) return service.price / safeMonths + infra / safeMonths;
  return infra / safeMonths;
}

function CostSummary({ services }: { services: Service[] }) {
  const billable = services.filter(s => s.price > 0 || (s.infrastructure_cost ?? 0) > 0);
  if (billable.length === 0) return null;

  const total = billable.reduce((sum, s) => sum + monthlyEquivalent(s), 0);

  const cycleShort = (s: Service) => {
    switch (s.billing_cycle) {
      case 'Monthly': return 'mensual';
      case 'Quarterly': return 'trimestral ÷ 3';
      case 'Semi-Annually': return 'semestral ÷ 6';
      case 'Annually': return 'anual ÷ 12';
      case 'Biennially': return 'bienal ÷ 24';
      case 'One-Time': return 'pago único';
      default: return s.billing_cycle ?? '';
    }
  };

  return (
    <div className="bg-[#0B192C] rounded-xl border border-white/5 overflow-hidden">
      {/* header */}
      <div className="px-5 py-4 flex items-end justify-between gap-4 border-b border-white/5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Resumen mensual estimado</p>
          <p className="text-[28px] font-extrabold text-white leading-none tracking-tight" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {billable[0]?.currency ?? 'USD'} {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            <span className="text-sm font-medium text-slate-400 ml-1">/mes</span>
          </p>
        </div>
        <p className="text-[11px] text-slate-500 text-right leading-relaxed shrink-0">
          Calculado sobre horas confirmadas<br />y costos de infraestructura
        </p>
      </div>

      {/* breakdown */}
      <div>
        {billable.map((s, i) => {
          const hasHours = (s.confirmed_hours_monthly ?? 0) > 0;
          const monthly = monthlyEquivalent(s);
          const meta = hasHours
            ? `${s.confirmed_hours_monthly}h × ${s.currency} ${s.price.toFixed(2)}/h`
            : cycleShort(s);
          return (
            <div
              key={s.id}
              className="grid items-center px-5 py-2.5 gap-x-5"
              style={{ gridTemplateColumns: '1fr auto auto', borderTop: i === 0 ? undefined : '1px solid rgba(255,255,255,0.04)' }}
            >
              <div>
                <p className="text-[13px] font-medium text-white/85">{s.business_name || s.name}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">{meta}</p>
              </div>
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${
                hasHours
                  ? 'text-emerald-300 bg-emerald-400/10'
                  : 'text-sky-300 bg-sky-400/10'
              }`}>
                {hasHours ? 'horas' : 'infra'}
              </span>
              <p className="text-[14px] font-bold text-white text-right" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {s.currency} {monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-[10px] font-medium text-slate-400 ml-1">/mes</span>
              </p>
            </div>
          );
        })}
      </div>

      {/* footer note */}
      <div className="px-5 py-2.5 border-t border-white/5">
        <p className="text-[11px] text-slate-500 leading-relaxed">
          * No incluye costos de licencias de software. Consultá la tab <strong className="text-slate-400">Licenses</strong> para el detalle.
        </p>
      </div>
    </div>
  );
}

function ServiceCatalog({ services, projects, getTypeName, getProjectName, expandedService, setExpandedService, heartbeats, backups, systemHeartbeats, netHeartbeats }: {
  services: Service[]; projects: Project[]; getTypeName: (id: string) => string; getProjectName: (id?: string) => string | null;
  expandedService: string | null; setExpandedService: (id: string | null) => void; heartbeats: ServiceHeartbeat[]; backups: ServiceBackup[]; systemHeartbeats: ServiceHeartbeat[]; netHeartbeats: ServiceHeartbeat[];
}) {
  // latest db-check heartbeat per service
  const latestDbCheck: Record<string, ServiceHeartbeat> = {};
  for (const h of systemHeartbeats) {
    if (h.source !== 'db-check') continue;
    if (!latestDbCheck[h.service_id] || h.received_at > latestDbCheck[h.service_id].received_at) {
      latestDbCheck[h.service_id] = h;
    }
  }
  const [showCosts, setShowCosts] = useState(false);

  if (services.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-12 text-center">
        <Server className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-gray-500 dark:text-gray-400 text-sm">No services in your catalog yet.</p>
      </div>
    );
  }

  const knownTypes = new Set(SERVICE_GROUPS.flatMap(g => g.types));
  const grouped = SERVICE_GROUPS.map(g => ({
    ...g,
    items: services.filter(s => g.types.includes(getTypeName(s.service_type_id))),
  })).filter(g => g.items.length > 0);
  const ungrouped = services.filter(s => !knownTypes.has(getTypeName(s.service_type_id)));

  const renderCards = (items: Service[]) => items.map(s => (
    <ServiceCard key={s.id} service={s} typeName={getTypeName(s.service_type_id)} projectName={getProjectName(s.project_id)}
      expanded={expandedService === s.id} onToggle={() => setExpandedService(expandedService === s.id ? null : s.id)}
      heartbeats={heartbeats.filter(h => h.service_id === s.id)}
      backups={backups.filter(b => b.service_id === s.id)}
      latestHealth={systemHeartbeats.find(h => h.service_id === s.id && h.source !== 'db-check' && h.source !== 'backup-folder') ?? null}
      latestDbCheck={latestDbCheck[s.id] ?? null}
      netHeartbeats={netHeartbeats}
      showCosts={showCosts} />
  ));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{services.length} Services</h2>
        <button onClick={() => setShowCosts(!showCosts)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            showCosts ? 'bg-slate-800 dark:bg-white text-white dark:text-gray-900' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300'
          }`}>
          <DollarSign className="w-3.5 h-3.5" />
          {showCosts ? 'Hide Costs' : 'Show Costs'}
        </button>
      </div>

      {showCosts && <CostSummary services={services} />}

      {grouped.map(g => (
        <div key={g.label}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">{g.label}</h3>
          <div className="space-y-3">{renderCards(g.items)}</div>
        </div>
      ))}

      {ungrouped.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">Other</h3>
          <div className="space-y-3">{renderCards(ungrouped)}</div>
        </div>
      )}
    </div>
  );
}

// Linux scripts report success/warning/failed, Windows scripts ok/warning/error.
type HealthLevel = 'ok' | 'warning' | 'error';
function healthLevel(status: string | null | undefined): HealthLevel {
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'warning') return 'warning';
  return 'ok';
}

const HEALTH_META = {
  ok:       { label: 'Operativo',       pill: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-400/20', dot: 'bg-emerald-500' },
  warning:  { label: 'Atención',        pill: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-400/20',           dot: 'bg-amber-500' },
  error:    { label: 'Crítico',         pill: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20',                     dot: 'bg-red-500' },
  stale:    { label: 'Desactualizado',  pill: 'bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-gray-500/10 dark:text-gray-400 dark:ring-gray-400/20',              dot: 'bg-gray-400' },
  offline:  { label: 'Sin contacto',    pill: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-400/20',                     dot: 'bg-red-500' },
} as const;

function HealthMeter({ label, pct, warnAt, critAt, detail }: { label: string; pct: number; warnAt: number; critAt: number; detail?: string }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const tone = clamped >= critAt ? 'crit' : clamped >= warnAt ? 'warn' : 'ok';
  const bar = tone === 'crit' ? 'bg-red-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-brand-accent';
  const value = tone === 'crit' ? 'text-red-600 dark:text-red-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-900 dark:text-white';
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</span>
        <span className={`text-sm font-semibold tabular-nums ${value}`}>{Math.round(clamped)}%</span>
      </div>
      <div className="mt-1.5 h-1 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${clamped}%` }} />
      </div>
      {detail && <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 tabular-nums truncate">{detail}</p>}
    </div>
  );
}

function timeAgoEs(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

// "Requiere tu atención": lo que el cliente tiene que decidir o comprar, explicado sin tecnicismos.
// Se puede enlazar directo con /share/<token>#atencion.
function AttentionPanel({ alerts }: { alerts: (HardwareAlert & { reportedAt: string })[] }) {
  useEffect(() => {
    if (window.location.hash === '#atencion') document.getElementById('atencion')?.scrollIntoView({ block: 'start' });
  }, []);
  return (
    <section id="atencion" aria-labelledby="atencion-title" className="scroll-mt-20">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-red-500" aria-hidden="true" />
        <h2 id="atencion-title" className="text-sm font-semibold text-gray-900 dark:text-white">Requiere tu atención</h2>
      </div>
      <div className="space-y-3">
        {alerts.map(a => {
          const crit = a.severity === 'critical';
          return (
            <article key={a.key} className={`rounded-xl border p-4 sm:p-5 ${crit ? 'border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10' : 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10'}`}>
              <h3 className="text-base font-semibold text-gray-900 dark:text-white text-balance">{a.title}</h3>
              <dl className="mt-3 grid gap-3 text-sm">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Qué pasa</dt>
                  <dd className="mt-0.5 text-gray-700 dark:text-gray-200">{a.what}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Qué puede pasar</dt>
                  <dd className="mt-0.5 text-gray-700 dark:text-gray-200">{a.risk}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Qué recomendamos</dt>
                  <dd className="mt-0.5 font-medium text-gray-900 dark:text-white">{a.action}</dd>
                </div>
                {a.part && (
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Pieza a reemplazar</dt>
                    <dd className="mt-0.5 font-mono text-xs text-gray-700 dark:text-gray-200 break-words">{a.part}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
                {a.since ? `Detectado el ${new Date(a.since).toLocaleString('es-UY', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ` : ''}
                Último control {timeAgoEs(a.reportedAt)}. Cualquier duda, respondé este mensaje o escribinos por soporte.
              </p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

type CpuWatchPayload = {
  window?: string; threshold?: number; interval_s?: number; samples?: number; peak_samples?: number; max_cpu?: number; avg_cpu?: number;
  top_processes?: { name: string; avg_pct: number; seen_in: number; users_count: number }[];
};

// Picos de CPU por día en la franja vigilada (cpu-watch.ps1): una barra por día con los minutos por
// encima del umbral. Sirve de evidencia para el cliente: cuándo pasa, qué lo causa y si un cambio
// (por ejemplo ajustar los procesadores de la VM) lo mejoró.
function CpuWatchPanel({ entries }: { entries: ServiceHeartbeat[] }) {
  const days = entries.map(e => {
    const p = (e.payload ?? {}) as CpuWatchPayload;
    const minutes = Math.round(((p.peak_samples ?? 0) * (p.interval_s ?? 60)) / 60);
    return { date: new Date(e.received_at), minutes, max: p.max_cpu ?? 0, avg: p.avg_cpu ?? 0, p };
  }).slice(-21);
  if (!days.length) return null;
  const last = days[days.length - 1];
  const top = (last.p.top_processes ?? []).filter(t => t.avg_pct >= 1).slice(0, 4);
  const fmtDay = (d: Date) => d.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric', month: 'short' });

  // Escala: el tope del eje es el máximo redondeado hacia arriba (mínimo 10 min) para que las barras se comparen
  const peakMax = Math.max(10, ...days.map(d => d.minutes));
  const yMax = Math.ceil(peakMax / 10) * 10;
  const W = 320, H = 96, PAD_L = 26, PAD_B = 16, PAD_T = 8;
  const plotW = W - PAD_L - 4, plotH = H - PAD_B - PAD_T;
  const slot = plotW / days.length;
  const barW = Math.max(3, Math.min(18, slot - 2));
  const y = (v: number) => PAD_T + plotH - (v / yMax) * plotH;

  return (
    <details className="group rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-2 text-xs font-medium text-gray-700 dark:text-gray-200">
        <span className="inline-flex items-center gap-1.5">
          <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
          Picos de CPU en horario de trabajo
        </span>
        <span className="text-gray-500 dark:text-gray-400 font-normal tabular-nums">
          {last.minutes ? `Último día: ${last.minutes} min por encima de ${last.p.threshold ?? 80}%` : 'Último día: sin picos'}
        </span>
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          Minutos por día con el procesador por encima del {last.p.threshold ?? 80}%, medido de {(last.p.window ?? '').replace('-', ' a ')} h.
          Menos es mejor.
        </p>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[280px] h-auto text-slate-500 dark:text-slate-400" role="img"
            aria-label={`Minutos de pico de CPU por día, ${days.length} días. Último: ${last.minutes} minutos.`}>
            {[0, yMax / 2, yMax].map(v => (
              <g key={v}>
                <line x1={PAD_L} x2={W - 4} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.5 : 0.15} strokeWidth={1} />
                <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="currentColor">{v}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const x = PAD_L + i * slot + (slot - barW) / 2;
              const h = Math.max(d.minutes ? 2 : 0, y(0) - y(d.minutes));
              return (
                <g key={i}>
                  <title>{`${fmtDay(d.date)}: ${d.minutes} min de pico · máx ${d.max}% · promedio ${d.avg}%`}</title>
                  {/* zona de hover más grande que la barra */}
                  <rect x={PAD_L + i * slot} y={PAD_T} width={slot} height={plotH} fill="transparent" />
                  {h > 0 && <rect x={x} y={y(0) - h} width={barW} height={h} rx={Math.min(3, barW / 2)} fill="currentColor" fillOpacity={0.85} />}
                </g>
              );
            })}
            <text x={PAD_L} y={H - 3} fontSize={8} fill="currentColor">{fmtDay(days[0].date)}</text>
            <text x={W - 4} y={H - 3} fontSize={8} fill="currentColor" textAnchor="end">{fmtDay(last.date)}</text>
          </svg>
        </div>
        {top.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Qué usaba el procesador en los picos (último día)</p>
            <ul className="mt-1 space-y-0.5 text-xs text-gray-700 dark:text-gray-200">
              {top.map(t => (
                <li key={t.name} className="flex justify-between gap-3">
                  <span className="truncate font-mono">{t.name}</span>
                  <span className="shrink-0 tabular-nums text-gray-500 dark:text-gray-400">
                    {t.avg_pct}% del CPU{t.users_count > 1 ? ` · ${t.users_count} usuarios` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function SystemHealth({ entries, services, cpuWatch = [] }: { entries: ServiceHeartbeat[]; services: Service[]; cpuWatch?: ServiceHeartbeat[] }) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">System Health</h2>
        <InfoTooltip text="Monitoreo de tus servidores y equipos: CPU, RAM, disco y disponibilidad. Los datos se actualizan cada vez que corre el script de monitoreo." />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 items-start gap-3">
        {entries.map(h => {
          const svc = services.find(s => s.id === h.service_id);
          const p = (h.payload ?? {}) as Record<string, any>;
          const ageH = (Date.now() - new Date(h.received_at).getTime()) / 3600000;
          const freshness = ageH > 72 ? 'offline' : ageH > 25 ? 'stale' : 'fresh';
          const level = healthLevel(h.status);
          const meta = HEALTH_META[freshness === 'fresh' ? level : freshness];

          const num = (v: unknown) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);
          const cpu = num(p.cpu_pct);
          const ram = num(p.ram_pct);
          const disk = num(p.disk_pct);
          const diskFree = num(p.disk_free_gb);
          const ramTotal = num(p.ram_total_gb);
          const uptime = p.uptime_str ? String(p.uptime_str) : null;
          const hasMetrics = cpu != null || ram != null || disk != null;
          const osu = p.os_updates && typeof p.os_updates.pending === 'number'
            ? p.os_updates as { pending: number; security: number; reboot_required: boolean; last_installed_at: string | null }
            : null;

          const raidIssue = Array.isArray(p.disk_raid)
            ? p.disk_raid.filter((r: any) => r?.status && r.status !== 'ok').map((r: any) => `Volumen ${r.name}: ${r.health}`).join(' · ')
            : '';
          // Scripts viejos no mandan "issues": armar el motivo con los discos que no están OK
          const smartIssue = Array.isArray(p.disk_smart)
            ? p.disk_smart.filter((d: any) => d?.status && d.status !== 'ok').map((d: any) => {
                const why = [
                  d.smart_health && !/^(healthy|passed|ok)$/i.test(d.smart_health) ? d.smart_health : null,
                  d.temp_c != null ? `${d.temp_c} °C` : null,
                  d.pct_used > 75 ? `desgaste ${d.pct_used}%` : null,
                  d.uncorrectable_errors > 0 ? `${d.uncorrectable_errors} errores de lectura/escritura` : null,
                ].filter(Boolean).join(', ');
                return `Disco ${d.model ?? d.dev}${why ? `: ${why}` : ''}`;
              }).join(' · ')
            : '';
          const issues = typeof p.issues === 'string' && p.issues.trim() && p.issues !== 'Normal'
            ? p.issues.trim()
            : [raidIssue, smartIssue].filter(Boolean).join(' · ') || null;
          const hw = freshness !== 'offline' && h.source === 'system-health' ? hardwareAlerts(p, '') : [];
          const reason =
            hw.length                ? `${hw[0].title} — ver "Requiere tu atención" arriba` :
            freshness === 'offline' ? `No reporta hace ${Math.round(ageH / 24)} días` :
            freshness === 'stale'   ? `Último reporte hace ${Math.round(ageH)} h` :
            level !== 'ok'          ? (issues ?? (hasMetrics ? 'Revisar alertas del equipo' : h.message)) :
            !hasMetrics             ? h.message :
            null;

          return (
            <article key={h.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-col gap-4 min-w-0">
              <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white truncate">{svc?.business_name || svc?.name || 'Equipo'}</h3>
                  {reason && (
                    <p className={`mt-0.5 text-xs ${freshness !== 'fresh' || level !== 'ok' ? 'text-gray-600 dark:text-gray-300' : 'text-gray-500 dark:text-gray-400'}`}>{reason}</p>
                  )}
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${meta.pill}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
              </header>

              {hasMetrics && freshness !== 'offline' && (
                <div className={`grid grid-cols-3 gap-4 ${freshness === 'stale' ? 'opacity-50' : ''}`}>
                  {cpu != null  && <HealthMeter label="CPU"   pct={cpu}  warnAt={80} critAt={95} />}
                  {ram != null  && <HealthMeter label="RAM"   pct={ram}  warnAt={80} critAt={92} detail={ramTotal ? `de ${ramTotal} GB` : undefined} />}
                  {disk != null && <HealthMeter label="Disco" pct={disk} warnAt={75} critAt={90} detail={diskFree != null ? `${diskFree} GB libres` : undefined} />}
                </div>
              )}

              {h.source === 'system-health' && <CpuWatchPanel entries={cpuWatch.filter(c => c.service_id === h.service_id)} />}

              <footer className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-gray-400 dark:text-gray-500 pt-3 border-t border-gray-100 dark:border-gray-800">
                <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />Actualizado {timeAgoEs(h.received_at)}</span>
                {uptime && freshness === 'fresh' && <span>Encendido hace {uptime}</span>}
                {osu && freshness === 'fresh' && (
                  <span className={osu.security > 0 || osu.reboot_required ? 'text-amber-600 dark:text-amber-400' : undefined}>
                    {osu.pending === 0
                      ? 'Sistema al día'
                      : `${osu.pending} actualizaci${osu.pending === 1 ? 'ón' : 'ones'} pendiente${osu.pending === 1 ? '' : 's'}${osu.security > 0 ? ` (${osu.security} de seguridad)` : ''}`}
                    {osu.reboot_required && ' · reinicio pendiente'}
                  </span>
                )}
                {osu?.last_installed_at && freshness === 'fresh' && (
                  <span>Último parche {new Date(osu.last_installed_at + 'T00:00:00').toLocaleDateString('es', { day: 'numeric', month: 'short' })}</span>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function HealthDot({ hb }: { hb: ServiceHeartbeat | null }) {
  if (!hb) return null;
  const p = hb.payload as any;
  const diskPct: number | undefined = p?.disk_pct ?? p?.disk_used_pct;
  const ramPct: number | undefined  = p?.ram_pct  ?? p?.ram_used_pct;

  const level = healthLevel(hb.status);
  const warn = level !== 'ok';
  const color = HEALTH_META[level].dot;

  const label = warn && diskPct != null ? `Disk ${diskPct}%`
              : warn && ramPct  != null ? `RAM ${ramPct}%`
              : null;

  return (
    <span className="inline-flex items-center gap-1" title={hb.message || hb.status}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
      {label && <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">{label}</span>}
    </span>
  );
}

// VPN anotada como servicio (specifications.vpn): el estado sale del reporte de red del router
// que tiene ese peer de WireGuard (mk-network-report.rsc).
type VpnSpec = { protocol?: string; peer?: string; access?: string; sites?: string };
type WgPeerReport = { name?: string; comment?: string; disabled?: boolean; last_handshake_s?: number };

function VpnTunnelStatus({ vpn, net }: { vpn: VpnSpec; net: ServiceHeartbeat[] }) {
  // El reporte más nuevo que trae ese peer
  let found: { peer: WgPeerReport; at: string } | null = null;
  for (const hb of net) {
    const wgs = ((hb.payload as Record<string, unknown> | null)?.wireguard ?? []) as { peers?: WgPeerReport[] }[];
    const peer = wgs.flatMap(w => w.peers ?? []).find(p => !p.disabled && vpn.peer && (p.name === vpn.peer || (p.comment ?? '').toLowerCase().startsWith(vpn.peer.toLowerCase())));
    if (peer) { found = { peer, at: hb.received_at }; break; }
  }
  const hs = found?.peer.last_handshake_s ?? -1;
  const up = found && hs >= 0 && hs <= 300;
  const ago = (sec: number) => sec < 120 ? `${sec} s` : sec < 7200 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} h`;
  const color = !found ? 'bg-gray-300 dark:bg-gray-600' : up ? 'bg-emerald-500' : 'bg-red-500';
  const text = !found ? 'Monitoreo del túnel en preparación'
    : up ? `Túnel conectado · último contacto hace ${ago(hs)}`
    : hs < 0 ? 'Túnel sin conexión' : `Túnel sin conexión hace ${ago(hs)}`;
  return (
    <div className="mt-3 space-y-1">
      <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
        <span>{text}</span>
        {found && <span className="text-gray-400">(revisado {formatTimeAgo(found.at)})</span>}
      </div>
      {(vpn.protocol || vpn.sites) && (
        <div className="text-xs text-gray-500 dark:text-gray-400">{[vpn.protocol, vpn.sites].filter(Boolean).join(' · ')}</div>
      )}
      {vpn.access && <div className="text-xs text-gray-500 dark:text-gray-400">Acceso: <span className="font-mono text-gray-700 dark:text-gray-300">{vpn.access}</span></div>}
    </div>
  );
}

function ServiceCard({ service, typeName, projectName, expanded, onToggle, heartbeats, backups, latestHealth, latestDbCheck, netHeartbeats, showCosts }: {
  service: Service; typeName: string; projectName: string | null; expanded: boolean; onToggle: () => void; heartbeats: ServiceHeartbeat[]; backups: ServiceBackup[]; latestHealth: ServiceHeartbeat | null; latestDbCheck: ServiceHeartbeat | null; netHeartbeats: ServiceHeartbeat[]; showCosts: boolean;
}) {
  const title = service.business_name || service.name;
  const desc = service.business_description || service.description;
  const isActive = service.status === 'Active';
  const monthly = serviceMonthlyTotal(service);

  return (
    <div className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden transition-shadow hover:shadow-sm ${!isActive ? 'opacity-70' : ''}`}>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${
              service.operational_status === 'Operational' || !service.operational_status ? 'bg-emerald-500' :
              service.operational_status === 'Degraded' ? 'bg-amber-500' :
              service.operational_status === 'Down' ? 'bg-red-500' : 'bg-brand-accent/100'
            }`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h3>
                <HealthDot hb={latestHealth} />
                <span className="text-xs text-gray-400">{typeName}</span>
                {projectName && <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-2 py-0.5 rounded-full">{projectName}</span>}
                {!isActive && <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded-full">{service.status}</span>}
              </div>
              {desc && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{desc}</p>}
            </div>
          </div>
          {showCosts && (() => {
            const hasPrice = service.price > 0;
            const hasInfra = (service.infrastructure_cost ?? 0) > 0;
            const hasHours = (service.confirmed_hours_monthly ?? 0) > 0;
            if (!hasPrice && !hasInfra) return null;
            const cycleLabel = service.billing_cycle === 'Monthly' ? 'per month' :
              service.billing_cycle === 'Quarterly' ? 'per quarter' :
              service.billing_cycle === 'Semi-Annually' ? 'per 6 months' :
              service.billing_cycle === 'Annually' ? 'per year' :
              service.billing_cycle === 'Biennially' ? 'per 2 years' :
              service.billing_cycle === 'One-Time' ? 'one-time' : service.billing_cycle;
            return (
              <div className="text-right shrink-0">
                {hasPrice && hasHours ? (
                  <>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      {service.currency} {(service.price * service.confirmed_hours_monthly!).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] text-gray-400">{service.confirmed_hours_monthly}h / month</div>
                    {hasInfra && (
                      <div className="text-[10px] text-gray-400">+ {service.currency} {service.infrastructure_cost!.toFixed(2)} infra</div>
                    )}
                  </>
                ) : hasPrice ? (
                  <>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      {service.currency} {service.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] text-gray-400">{cycleLabel}</div>
                    {hasInfra && (
                      <div className="text-[10px] text-gray-400">+ {service.currency} {service.infrastructure_cost!.toFixed(2)} infra</div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      {service.currency} {service.infrastructure_cost!.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] text-gray-400">{cycleLabel}</div>
                  </>
                )}
              </div>
            );
          })()}
        </div>

        {(service.includes?.length || service.cloud_backup_enabled) ? (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(service.includes || []).slice(0, 4).map((item, i) => (
              <span key={i} className="text-[11px] bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full">{item}</span>
            ))}
            {(service.includes || []).length > 4 && <span className="text-[11px] text-gray-400">+{(service.includes || []).length - 4} more</span>}
            {service.cloud_backup_enabled && (
              <span className="inline-flex items-center gap-1 text-[11px] bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 px-2 py-0.5 rounded-full font-medium">
                ☁ Cloud backup{service.cloud_backup_retention_days ? ` · ${service.cloud_backup_retention_days}d` : ''}
              </span>
            )}
          </div>
        ) : null}

        {service.specifications?.vpn && <VpnTunnelStatus vpn={service.specifications.vpn as VpnSpec} net={netHeartbeats} />}

        {service.last_backup_at && (
          <div className="flex items-center gap-2 mt-3">
            <HardDrive className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">
              Last backup: <span className="font-medium text-gray-900 dark:text-gray-200">{formatTimeAgo(service.last_backup_at)}</span>
            </span>
            {service.last_backup_size_bytes != null && (
              <span className="text-xs text-gray-400">({formatBytes(service.last_backup_size_bytes)})</span>
            )}
            {backups[0] && backups[0].status !== 'success' && (
              <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${backups[0].status === 'failed' ? 'bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400' : 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400'}`}>
                {backups[0].status}
              </span>
            )}
          </div>
        )}

        {service.last_restore_test_at && (
          <div className="flex items-center gap-2 mt-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-600 dark:text-gray-400">
              Restore test: <span className="font-medium text-gray-900 dark:text-gray-200">{formatTimeAgo(service.last_restore_test_at)}</span>
            </span>
            <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
              service.last_restore_test_result === 'success' ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400' :
              service.last_restore_test_result === 'failed'  ? 'bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400' :
                                                               'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400'
            }`}>
              {service.last_restore_test_result ?? 'partial'}
            </span>
          </div>
        )}

        <button onClick={onToggle} className="mt-3 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-medium transition-colors">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Details
        </button>
      </div>

      {expanded && <TechnicalDetails service={service} heartbeats={heartbeats} backups={backups} latestDbCheck={latestDbCheck} showCosts={showCosts} />}
    </div>
  );
}

function TechnicalDetails({ service, heartbeats, backups, latestDbCheck, showCosts }: { service: Service; heartbeats: ServiceHeartbeat[]; backups: ServiceBackup[]; latestDbCheck: ServiceHeartbeat | null; showCosts: boolean }) {
  const specs = service.specifications || {};
  const hasSpecs = !!(specs.cpu || specs.ram || specs.storage || specs.bandwidth);

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 px-5 py-4 space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
        {service.sla_level && <Field label="SLA" value={service.sla_level} />}
        {service.provider && <Field label="Provider" value={service.provider} />}
        {service.location && <Field label="Location" value={service.location} />}
        {service.infrastructure_type && <Field label="Infrastructure" value={service.infrastructure_type} />}
        {service.rto && <Field label="RTO" value={service.rto} />}
        {service.rpo && <Field label="RPO" value={service.rpo} />}
        {service.spof != null && (
          <div className="col-span-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${service.spof ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${service.spof ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              {service.spof ? 'Sin SPOF crítico' : 'SPOF identificado'}
            </span>
          </div>
        )}
        {service.maintenance_window && <Field label="Maintenance" value={service.maintenance_window} />}
        {service.next_renewal_date && <Field label="Next Renewal" value={new Date(service.next_renewal_date).toLocaleDateString()} />}
        {service.last_backup_at && <Field label="Last Backup" value={formatTimeAgo(service.last_backup_at)} />}
      </div>

      {service.spof === false && service.recovery_steps && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg px-4 py-3">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-1.5">Plan de recuperación</p>
          <p className="text-sm text-amber-900 dark:text-amber-200 whitespace-pre-line leading-relaxed">{service.recovery_steps}</p>
        </div>
      )}

      {(service.storage_used_pct != null || service.ram_used_pct != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {service.storage_used_pct != null && <ResourceBar label="Storage" pct={service.storage_used_pct} />}
          {service.ram_used_pct != null && <ResourceBar label="RAM" pct={service.ram_used_pct} />}
        </div>
      )}

      {hasSpecs && (
        <div className="flex flex-wrap gap-2">
          {specs.cpu && <Tag label={specs.cpu} />}
          {specs.ram && <Tag label={`${specs.ram} RAM`} />}
          {specs.storage && <Tag label={specs.storage} />}
          {specs.bandwidth && <Tag label={specs.bandwidth} />}
        </div>
      )}

      {service.managed_roles && service.managed_roles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(service.managed_roles as ManagedRole[]).map(r => (
            <span key={r} className="text-[11px] bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 px-2 py-0.5 rounded-full border border-teal-100 dark:border-teal-800">{r}</span>
          ))}
        </div>
      )}

      {(service.includes?.length || service.excludes?.length || service.client_responsibilities?.length) ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-gray-200 dark:border-gray-700">
          <BulletList title="Included" items={service.includes || []} color="emerald" />
          <BulletList title="Not Included" items={service.excludes || []} color="gray" />
          <BulletList title="Your Role (Client)" items={service.client_responsibilities || []} color="blue" />
        </div>
      ) : null}

      {showCosts && (() => {
        const infraShownInHeader = service.price <= 0 && (service.infrastructure_cost ?? 0) > 0;
        const showInfra = (service.infrastructure_cost ?? 0) > 0 && !infraShownInHeader;
        const showHours = (service.allocated_hours ?? 0) > 0;
        const showRate = (service.extra_hour_rate ?? 0) > 0;
        if (!showInfra && !showHours && !showRate) return null;
        return (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <div className="flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-400">
              {showInfra && <span>Infraestructura: {service.currency} {service.infrastructure_cost!.toFixed(2)}/mes</span>}
              {showHours && <span>Horas incluidas: {service.allocated_hours}h/mes</span>}
              {showRate && <span>Hora adicional: {service.currency} {service.extra_hour_rate!.toFixed(2)}</span>}
            </div>
          </div>
        );
      })()}

      {latestDbCheck && <DbCheckStatus hb={latestDbCheck} />}

      {backups.length > 0 && <BackupHistory backups={backups} />}

      {heartbeats.length > 0 && <SpeedChart heartbeats={heartbeats} />}
    </div>
  );
}

function DbCheckStatus({ hb }: { hb: ServiceHeartbeat }) {
  const p = hb.payload as any;
  const ageMs = Date.now() - new Date(hb.received_at).getTime();
  const stale = ageMs > 2 * 60 * 60 * 1000; // >2h without update

  const color = stale           ? 'text-gray-400'
              : hb.status === 'ok'      ? 'text-emerald-600 dark:text-emerald-400'
              : hb.status === 'warning' ? 'text-amber-600 dark:text-amber-400'
              : 'text-red-600 dark:text-red-400';

  const dot = stale           ? 'bg-gray-300'
            : hb.status === 'ok'      ? 'bg-emerald-500'
            : hb.status === 'warning' ? 'bg-amber-500'
            : 'bg-red-500';

  const latency: number | undefined = p?.latency_ms;

  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span className={`text-xs font-semibold ${color}`}>
          {stale ? 'Sin datos recientes' : hb.status === 'ok' ? 'Conectividad OK' : hb.status === 'warning' ? 'Advertencia' : 'Sin conexión'}
        </span>
        {latency != null && !stale && (
          <span className="text-[11px] text-gray-400">{latency} ms</span>
        )}
        <span className="text-[11px] text-gray-400 ml-auto">
          {new Date(hb.received_at).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {hb.message && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5 ml-4">{hb.message}</p>
      )}
    </div>
  );
}

function BackupHistory({ backups }: { backups: ServiceBackup[] }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? backups : backups.slice(0, 10);

  return (
    <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
      <div className="flex items-center gap-2 mb-2">
        <HardDrive className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Backup History</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100 dark:border-gray-700">
              <th className="pb-1.5 pr-3 font-medium">Date</th>
              <th className="pb-1.5 pr-3 font-medium">Job</th>
              <th className="pb-1.5 pr-3 font-medium">Status</th>
              <th className="pb-1.5 pr-3 font-medium text-right">Size</th>
              <th className="pb-1.5 font-medium text-right">Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
            {visible.map(b => (
              <tr key={b.id}>
                <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {new Date(b.backed_up_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  <span className="text-gray-400 ml-1">{new Date(b.backed_up_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                </td>
                <td className="py-1.5 pr-3 text-gray-600 dark:text-gray-300 max-w-[140px] truncate">{b.job_name || '—'}</td>
                <td className="py-1.5 pr-3">
                  <span className={`inline-flex items-center gap-1 font-semibold ${
                    b.status === 'failed'  ? 'text-red-600 dark:text-red-400' :
                    b.status === 'warning' ? 'text-amber-600 dark:text-amber-400' :
                                            'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${b.status === 'failed' ? 'bg-red-500' : b.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    {b.status}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {b.size_bytes != null ? formatBytes(b.size_bytes) : '—'}
                </td>
                <td className="py-1.5 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {b.duration_seconds != null ? `${Math.round(b.duration_seconds / 60)}m` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {backups.length > 10 && (
        <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-brand-accent dark:text-brand-accent hover:underline">
          {showAll ? 'Show less' : `Show all ${backups.length} records`}
        </button>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return <span className="text-xs bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 px-2.5 py-1 rounded-md text-gray-700 dark:text-gray-300">{label}</span>;
}

function BulletList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  const textColor = color === 'emerald' ? 'text-emerald-700 dark:text-emerald-400' : color === 'blue' ? 'text-brand-accent dark:text-brand-accent' : 'text-gray-600 dark:text-gray-400';
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${textColor} mb-1.5`}>{title}</div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-1.5">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600 shrink-0" />{item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResourceBar({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const barColor = clamped >= 90 ? 'bg-red-500' : clamped >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-xs font-semibold text-gray-900 dark:text-white">{Math.round(clamped)}%</span>
      </div>
      <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function SpeedChart({ heartbeats }: { heartbeats: ServiceHeartbeat[] }) {
  const points = heartbeats.map(h => ({
    download: Number((h.payload as any).download_mbps) || 0,
    upload: Number((h.payload as any).upload_mbps) || 0,
    ping: Number((h.payload as any).ping_ms) || 0,
  }));
  if (points.length === 0) return null;

  const maxSpeed = Math.max(...points.map(p => Math.max(p.download, p.upload)), 1);
  const chartH = 80;
  const toY = (val: number) => chartH - (val / maxSpeed) * (chartH - 8);
  const makePath = (values: number[]) => values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${points.length === 1 ? 50 : (i / (points.length - 1)) * 100} ${toY(v)}`).join(' ');
  const latest = points[points.length - 1];

  return (
    <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Network (48h)</span>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-brand-accent dark:text-brand-accent font-medium">{latest.download.toFixed(0)} Mbps down</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-medium">{latest.upload.toFixed(0)} Mbps up</span>
          <span className="text-gray-500">{latest.ping.toFixed(0)}ms</span>
        </div>
      </div>
      <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
        <svg viewBox={`0 0 100 ${chartH}`} preserveAspectRatio="none" className="w-full h-16">
          <path d={`${makePath(points.map(p => p.download))} L 100 ${chartH} L 0 ${chartH} Z`} fill="rgba(37,99,235,0.06)" />
          <path d={`${makePath(points.map(p => p.upload))} L 100 ${chartH} L 0 ${chartH} Z`} fill="rgba(16,185,129,0.06)" />
          <path d={makePath(points.map(p => p.download))} fill="none" stroke="#2563eb" strokeWidth="0.8" />
          <path d={makePath(points.map(p => p.upload))} fill="none" stroke="#10b981" strokeWidth="0.8" />
        </svg>
      </div>
    </div>
  );
}

/* ---------- Licenses ---------- */

function LicensesSection({ licenses, services }: { licenses: ClientLicense[]; services: Service[] }) {
  const getServiceName = (id?: string) => id ? services.find(s => s.id === id)?.business_name || services.find(s => s.id === id)?.name : null;
  const daysUntilExpiry = (date?: string) => date ? Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Licenses & Subscriptions</h2>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        {licenses.map(lic => {
          const days = daysUntilExpiry(lic.expiration_date);
          const isExpiring = days !== null && days >= 0 && days <= 30;
          const isExpired = days !== null && days < 0;
          return (
            <div key={lic.id} className="px-5 py-3.5 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{lic.software_name}</span>
                  <span className="text-xs text-gray-400">{lic.quantity} {lic.quantity_label}</span>
                </div>
                {getServiceName(lic.service_id) && <span className="text-xs text-gray-400">{getServiceName(lic.service_id)}</span>}
              </div>
              <div className="shrink-0">
                {isExpired ? <span className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 px-2 py-0.5 rounded-full">Expired</span>
                : isExpiring ? <span className="text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-2 py-0.5 rounded-full">Renews in {days}d</span>
                : days !== null ? <span className="text-xs text-gray-500">{new Date(lic.expiration_date!).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                : <span className="text-xs text-gray-400">Perpetual</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Changes ---------- */

function ChangesSection({ changes, services }: { changes: ServiceChange[]; services: Service[] }) {
  const getServiceName = (id: string) => { const s = services.find(s => s.id === id); return s ? (s.business_name || s.name) : 'Service'; };
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Change History</h2>
      <div className="space-y-2">
        {changes.map(c => (
          <div key={c.id} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <span>{new Date(c.change_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span className="text-gray-300 dark:text-gray-600">-</span>
              <span className="text-brand-accent dark:text-brand-accent font-medium">{getServiceName(c.service_id)}</span>
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">{c.summary}</p>
            {c.details && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{c.details}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Support Hours ---------- */

function SupportHoursSection({ hours, roadmapItems, services }: { hours: SupportHour[]; roadmapItems: RoadmapItem[]; services: Service[] }) {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  type UnifiedEntry = { id: string; work_date: string; hours: number; description: string; service_id?: string; source: 'manual' | 'pipeline' | 'task-tracker'; project?: string | null };

  const allEntries = useMemo((): UnifiedEntry[] => {
    const manual: UnifiedEntry[] = hours.map(h => ({
      id: h.id, work_date: h.work_date, hours: Number(h.hours),
      description: h.description || '', service_id: h.service_id,
      source: h.source === 'task-tracker' ? 'task-tracker' : 'manual', project: h.project_name,
    }));
    // Con las horas del Task Tracker, los items del roadmap ya están ahí como tareas: no se suman dos veces
    if (hours.some(h => h.source === 'task-tracker')) return manual.sort((a, b) => b.work_date.localeCompare(a.work_date));
    const pipeline: UnifiedEntry[] = roadmapItems
      .filter(r => r.amount_type === 'hours' && r.amount && r.amount > 0 && (r.scheduled_date || r.eta))
      .map(r => ({
        id: `rm-${r.id}`,
        work_date: (r.scheduled_date || r.eta)!,
        hours: r.amount!,
        description: r.title,
        service_id: r.service_id,
        source: 'pipeline',
      }));
    return [...manual, ...pipeline].sort((a, b) => b.work_date.localeCompare(a.work_date));
  }, [hours, roadmapItems]);

  const filteredHours = useMemo(() => {
    const [year, month] = selectedMonth.split('-');
    const start = `${year}-${month}-01`;
    const endDate = new Date(parseInt(year), parseInt(month), 0);
    const end = `${year}-${month}-${String(endDate.getDate()).padStart(2, '0')}`;
    return allEntries.filter(h => h.work_date >= start && h.work_date <= end);
  }, [allEntries, selectedMonth]);

  const totalHoursUsed = filteredHours.reduce((sum, h) => sum + h.hours, 0);
  const totalAllocated = services.filter(s => s.status === 'Active').reduce((sum, s) => sum + (s.confirmed_hours_monthly || 0), 0);
  const pctUsed = totalAllocated > 0 ? (totalHoursUsed / totalAllocated) * 100 : 0;
  const getServiceName = (id?: string) => { if (!id) return null; const svc = services.find(s => s.id === id); return svc?.business_name || svc?.name || null; };

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    allEntries.forEach(h => { const [y, m] = h.work_date.split('-'); months.add(`${y}-${m}`); });
    const now = new Date();
    months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    return Array.from(months).sort().reverse();
  }, [allEntries]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Support Hours</h2>
        <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-brand-accent outline-none">
          {availableMonths.map(m => {
            const [y, mo] = m.split('-');
            return <option key={m} value={m}>{new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</option>;
          })}
        </select>
      </div>

      {totalAllocated > 0 && (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-600 dark:text-gray-400">{totalHoursUsed.toFixed(1)}h of {totalAllocated}h used</span>
            <span className={`text-xs font-semibold ${pctUsed > 90 ? 'text-red-600' : pctUsed > 70 ? 'text-amber-600' : 'text-gray-900 dark:text-white'}`}>{pctUsed.toFixed(0)}%</span>
          </div>
          <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${pctUsed > 90 ? 'bg-red-500' : pctUsed > 70 ? 'bg-amber-500' : 'bg-brand-accent/100'}`} style={{ width: `${Math.min(pctUsed, 100)}%` }} />
          </div>
        </div>
      )}

      {filteredHours.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-8 text-center text-sm text-gray-400">No hours logged this period.</div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {filteredHours.map(entry => (
            <div key={entry.id} className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400">{new Date(entry.work_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  {getServiceName(entry.service_id) && <span className="text-xs text-brand-accent dark:text-brand-accent font-medium">{getServiceName(entry.service_id)}</span>}
                  {entry.source === 'pipeline' && <span className="text-[10px] bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 rounded-full font-medium">Pipeline</span>}
                  {entry.project && <span className="text-xs text-gray-500 dark:text-gray-400">{entry.project}</span>}
                </div>
                {entry.description && <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">{entry.description}</p>}
              </div>
              <span className="text-xs font-semibold text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full shrink-0">{entry.hours.toFixed(1)}h</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Support Form (Resend) ---------- */

function SupportSection({ token, clientName, services }: { token: string; clientName: string; services: Service[] }) {
  const [serviceId, setServiceId] = useState('');
  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');

    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-support-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ token, service_id: serviceId || undefined, priority, subject, message }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to send request');
      }

      setSent(true);
      setSubject('');
      setMessage('');
      setServiceId('');
      setPriority('Medium');
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Request Support</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Send a support request directly to our team. We'll respond as soon as possible.</p>
      </div>

      {sent && (
        <div className="bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Your request has been sent. We'll get back to you shortly.</span>
          <button onClick={() => setSent(false)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200 rounded-lg px-4 py-3 flex items-center gap-3 text-sm">
          <X className="w-4 h-4 shrink-0" />
          <span>{error}</span>
          <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Service</label>
            <select value={serviceId} onChange={e => setServiceId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-accent">
              <option value="">General inquiry</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.business_name || s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-accent">
              <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Subject</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)} required placeholder="Brief summary"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-accent" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} required placeholder="What's happening, when it started..."
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg text-sm outline-none focus:ring-2 focus:ring-brand-accent resize-none" />
        </div>
        <button type="submit" disabled={sending}
          className="inline-flex items-center gap-2 bg-slate-900 dark:bg-white hover:bg-slate-800 dark:hover:bg-gray-100 text-white dark:text-gray-900 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
          {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          {sending ? 'Sending...' : 'Send Request'}
        </button>
      </form>
    </div>
  );
}


const STATUS_META: Record<string, { label: string; dot: string; text: string }> = {
  'Planned':      { label: 'Abierto',          dot: 'bg-gray-400',    text: 'text-gray-500 dark:text-gray-400' },
  'In Progress':  { label: 'En proceso',        dot: 'bg-amber-400',   text: 'text-amber-600 dark:text-amber-400' },
  'Next Release': { label: 'Pendiente cierre',  dot: 'bg-blue-400',    text: 'text-blue-600 dark:text-blue-400' },
  'Released':     { label: 'Resuelto',          dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
};

function TicketsSection({ items, updates }: { items: RoadmapItem[]; updates: RoadmapItemUpdate[] }) {
  const open = items.filter(i => i.status !== 'Released');
  const closed = items.filter(i => i.status === 'Released');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(open.map(i => i.id)));

  const updatesFor = (id: string) => updates.filter(u => u.roadmap_item_id === id);
  const formatDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const formatTime = (d: string) => new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const catBadge = (category: string, isOpen: boolean) => {
    if (category === 'problem') return isOpen
      ? 'bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
      : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700';
    return isOpen
      ? 'bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800'
      : 'bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700';
  };

  const TicketCard = ({ item }: { item: RoadmapItem }) => {
    const isOpen = item.status !== 'Released';
    const itemUpdates = updatesFor(item.id);
    const isExpanded = expanded.has(item.id);
    const statusMeta = STATUS_META[item.status] || STATUS_META['Planned'];

    // Build timeline: opening event first, then updates, newest last
    const timeline = [
      { type: 'open' as const, date: item.created_at, status: 'Planned', note: item.description },
      ...itemUpdates.map(u => ({ type: 'update' as const, date: u.created_at, status: u.status || '', note: u.note })),
    ];
    const lastUpdate = itemUpdates[itemUpdates.length - 1];

    return (
      <div className={`bg-white dark:bg-gray-900 rounded-xl border ${isOpen ? 'border-gray-200 dark:border-gray-800' : 'border-gray-100 dark:border-gray-800 opacity-75'} overflow-hidden`}>
        {/* Header */}
        <button
          onClick={() => toggle(item.id)}
          className="w-full flex items-start gap-3 px-4 py-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
        >
          <span className={`mt-0.5 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border shrink-0 ${catBadge(item.category, isOpen)}`}>
            {item.category === 'problem' ? 'Incidente' : 'Cambio'}
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${isOpen ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
              {item.title}
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`flex items-center gap-1 text-[11px] font-medium ${statusMeta.text}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
              {itemUpdates.length > 0 && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  · última actualización {formatTime(lastUpdate.created_at)}
                </span>
              )}
              {itemUpdates.length === 0 && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">· abierto {formatDate(item.created_at)}</span>
              )}
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 mt-0.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>

        {/* Timeline */}
        {isExpanded && (
          <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-800">
            <div className="relative pt-4 space-y-0">
              {/* vertical line */}
              <div className="absolute left-[7px] top-4 bottom-4 w-px bg-gray-200 dark:bg-gray-700" />
              {timeline.map((entry, idx) => {
                const isLast = idx === timeline.length - 1;
                const entryMeta = entry.type === 'open'
                  ? { dot: 'bg-gray-400', label: 'Abierto' }
                  : STATUS_META[entry.status] || { dot: 'bg-gray-400', label: entry.status };
                return (
                  <div key={idx} className="relative flex gap-3 pb-4 last:pb-0">
                    <span className={`relative z-10 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-900 shrink-0 mt-0.5 ${isLast ? entryMeta.dot : 'bg-gray-300 dark:bg-gray-600'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                          {entry.type === 'open' ? 'Apertura' : entryMeta.label}
                        </span>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500">{formatTime(entry.date)}</span>
                      </div>
                      {entry.note && (
                        <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5 leading-relaxed">{entry.note}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {open.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wider">Abiertos</h3>
          <div className="space-y-3">
            {open.map(i => <TicketCard key={i.id} item={i} />)}
          </div>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-500 mb-3 uppercase tracking-wider">Resueltos</h3>
          <div className="space-y-3">
            {closed.map(i => <TicketCard key={i.id} item={i} />)}
          </div>
        </section>
      )}
      {items.length === 0 && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-600 text-sm">No hay tickets</div>
      )}
    </div>
  );
}

// ── Incident Panel ────────────────────────────────────────────────────────────

const INCIDENT_STATUS_META = {
  investigating: { label: 'Investigando',  color: 'text-red-600',    bg: 'bg-red-50 dark:bg-red-900/20',    border: 'border-red-200 dark:border-red-800',    icon: AlertCircle  },
  identified:    { label: 'Identificado',  color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', icon: AlertTriangle },
  monitoring:    { label: 'Monitoring',    color: 'text-blue-600',   bg: 'bg-blue-50 dark:bg-blue-900/20',   border: 'border-blue-200 dark:border-blue-800',   icon: Eye          },
  resolved:      { label: 'Resuelto',      color: 'text-emerald-600',bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800', icon: CheckCheck },
} as const;

function IncidentPanel({ incidents }: { incidents: ServiceIncident[] }) {
  const active   = incidents.filter(i => i.status !== 'resolved');
  const resolved = incidents.filter(i => i.status === 'resolved').slice(0, 5);

  if (incidents.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Incidentes</h2>
        <InfoTooltip text="Estado de incidentes técnicos activos y resueltos recientemente." />
      </div>
      <div className="space-y-2">
        {active.map(inc => {
          const meta = INCIDENT_STATUS_META[inc.status] ?? INCIDENT_STATUS_META.investigating;
          const Icon = meta.icon;
          return (
            <div key={inc.id} className={`rounded-lg border px-4 py-3 ${meta.bg} ${meta.border}`}>
              <div className="flex items-start gap-2">
                <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${meta.color}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{inc.title}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wide ${meta.color}`}>{meta.label}</span>
                  </div>
                  {inc.description && inc.description !== inc.title && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{inc.description}</p>
                  )}
                  {inc.notes.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {inc.notes.map((n, i) => (
                        <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex gap-1.5">
                          <span className="shrink-0 text-gray-300">·</span>
                          <span>{n.note}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Iniciado {new Date(inc.started_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {resolved.map(inc => {
          const Icon = INCIDENT_STATUS_META.resolved.icon;
          const duration = inc.resolved_at
            ? Math.round((new Date(inc.resolved_at).getTime() - new Date(inc.started_at).getTime()) / 60000)
            : null;
          return (
            <div key={inc.id} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 px-4 py-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{inc.title}</p>
                  {inc.notes.length > 0 && (
                    <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{inc.notes[inc.notes.length - 1].note}</p>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-400">{new Date(inc.started_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
                {duration !== null && <p className="text-xs text-gray-400">{duration < 60 ? `${duration}m` : `${Math.round(duration / 60)}h`}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
