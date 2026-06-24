import { useState, useEffect, useMemo } from 'react';
import {
  Server, Globe, Calendar, Clock, MapPin, Shield, CheckCircle2,
  FolderOpen, History, FileText, Send,
  Cpu, HardDrive, Wifi, ChevronDown, ChevronRight, Mail, X, Check, LayoutGrid,
  Sparkles, Rocket, Search, Cloud, Wrench, DollarSign,
} from 'lucide-react';
import { supabase, Client, Service, ServiceType, Project, ServiceChange, ManagedRole, RoadmapItem, RoadmapStatus, RoadmapCategory, ClientLicense, UserSettings, SupportHour, ServiceHeartbeat } from '../lib/supabase';

type Props = { token: string };

type Section = 'overview' | 'services' | 'licenses' | 'changes' | 'hours' | 'support';

function billingCycleMonths(cycle: string): number {
  return cycle === 'Monthly' ? 1
    : cycle === 'Quarterly' ? 3
    : cycle === 'Semi-Annually' ? 6
    : cycle === 'Annually' ? 12
    : cycle === 'Biennially' ? 24
    : 0;
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

const ROADMAP_META: Record<RoadmapStatus, { color: string; bg: string; border: string; label: string; icon: any }> = {
  'Next Release':  { color: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200',    label: 'Next Release',  icon: Rocket },
  'In Progress':   { color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   label: 'In Progress',   icon: Sparkles },
  'Planned':       { color: 'text-slate-700',   bg: 'bg-slate-100',  border: 'border-slate-200',   label: 'Planned',       icon: Calendar },
  'Released':      { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Released',      icon: CheckCircle2 },
};

export function SharePage({ token }: Props) {
  const [client, setClient] = useState<Client | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [changes, setChanges] = useState<ServiceChange[]>([]);
  const [roadmap, setRoadmap] = useState<RoadmapItem[]>([]);
  const [licenses, setLicenses] = useState<ClientLicense[]>([]);
  const [supportHours, setSupportHours] = useState<SupportHour[]>([]);
  const [heartbeats, setHeartbeats] = useState<ServiceHeartbeat[]>([]);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [section, setSection] = useState<Section>('overview');
  const [expandedService, setExpandedService] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: tokenRow } = await supabase
        .from('client_share_tokens')
        .select('*')
        .eq('token', token)
        .maybeSingle();

      if (!tokenRow) { setNotFound(true); setLoading(false); return; }

      const [{ data: clientData }, { data: servicesData }, { data: projectsData }, { data: typesData }, { data: roadmapData }, { data: settingsData }] = await Promise.all([
        supabase.from('clients').select('*').eq('id', tokenRow.client_id).maybeSingle(),
        supabase.from('services').select('*').eq('client_id', tokenRow.client_id).order('created_at'),
        supabase.from('projects').select('*').eq('client_id', tokenRow.client_id).order('created_at'),
        supabase.from('service_types').select('*'),
        supabase.from('roadmap_items').select('*').eq('user_id', tokenRow.user_id).eq('is_public', true).order('sort_order').order('created_at'),
        supabase.from('user_settings').select('*').eq('user_id', tokenRow.user_id).maybeSingle(),
      ]);

      if (!clientData) { setNotFound(true); setLoading(false); return; }

      setClient(clientData);
      setServices(servicesData || []);
      setProjects(projectsData || []);
      setServiceTypes(typesData || []);
      setRoadmap(roadmapData || []);
      if (settingsData) setUserSettings(settingsData);

      const ids = (servicesData || []).map(s => s.id);
      if (ids.length > 0) {
        const { data: changesData } = await supabase
          .from('service_changes')
          .select('*')
          .in('service_id', ids)
          .order('change_date', { ascending: false });
        setChanges(changesData || []);
      }

      const { data: licensesData } = await supabase
        .from('client_licenses')
        .select('*')
        .eq('client_id', tokenRow.client_id)
        .order('expiration_date', { ascending: true, nullsFirst: false });
      setLicenses(licensesData || []);

      const { data: hoursData } = await supabase
        .from('support_hours')
        .select('*')
        .eq('client_id', tokenRow.client_id)
        .order('work_date', { ascending: false });
      setSupportHours(hoursData || []);

      const serviceIds = (servicesData || []).map(s => s.id);
      if (serviceIds.length > 0) {
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: hbData } = await supabase
          .from('service_heartbeats')
          .select('*')
          .in('service_id', serviceIds)
          .eq('source', 'speedtest')
          .gte('received_at', since)
          .order('received_at', { ascending: true });
        setHeartbeats(hbData || []);
      }

      setLoading(false);
    };
    load();
  }, [token]);

  const getTypeName = (id: string) => serviceTypes.find(t => t.id === id)?.name || 'Service';
  const getProjectName = (id?: string): string | null => id ? projects.find(p => p.id === id)?.name || null : null;
  const activeServices = useMemo(() => services.filter(s => s.status === 'Active'), [services]);

  const allOperational = useMemo(
    () => activeServices.every(s => s.operational_status === 'Operational' || !s.operational_status),
    [activeServices]
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-blue-600 border-t-transparent"></div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center">
          <Globe className="w-14 h-14 text-gray-300 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Portal Not Found</h1>
          <p className="text-gray-500 text-sm">This link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header - compact and clean */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {userSettings?.logo_url ? (
                <img src={userSettings.logo_url} alt="Logo" className="h-8 max-w-[120px] object-contain" />
              ) : (
                <div className="bg-slate-900 p-2 rounded-lg">
                  <Shield className="w-4 h-4 text-white" />
                </div>
              )}
              <div className="h-6 w-px bg-gray-200" />
              <div>
                <h1 className="text-lg font-bold text-gray-900">{client!.company_name}</h1>
                <p className="text-xs text-gray-500">{userSettings?.company_name || 'Managed Services Portal'}</p>
              </div>
            </div>
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
              allOperational
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}>
              <span className={`w-2 h-2 rounded-full ${allOperational ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
              {allOperational ? 'All Operational' : 'Issues Detected'}
            </div>
          </div>
        </div>
      </header>

      {/* Status badges - persistent, only if services have uptime monitoring */}
      <StatusBar services={services} />

      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 flex gap-1 overflow-x-auto">
          <NavBtn active={section === 'overview'} onClick={() => setSection('overview')}>Overview</NavBtn>
          <NavBtn active={section === 'services'} onClick={() => setSection('services')}>Services</NavBtn>
          {licenses.length > 0 && <NavBtn active={section === 'licenses'} onClick={() => setSection('licenses')}>Licenses</NavBtn>}
          {changes.length > 0 && <NavBtn active={section === 'changes'} onClick={() => setSection('changes')}>Changes</NavBtn>}
          {supportHours.length > 0 && <NavBtn active={section === 'hours'} onClick={() => setSection('hours')}>Hours</NavBtn>}
          <NavBtn active={section === 'support'} onClick={() => setSection('support')}>Support</NavBtn>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {section === 'overview' && (
          <OverviewSection
            services={activeServices}
            roadmap={roadmap}
            changes={changes}
            supportHours={supportHours}
            getTypeName={getTypeName}
          />
        )}

        {section === 'services' && (
          <ServiceCatalog
            services={services}
            projects={projects}
            getTypeName={getTypeName}
            getProjectName={getProjectName}
            expandedService={expandedService}
            setExpandedService={setExpandedService}
            heartbeats={heartbeats}
          />
        )}

        {section === 'licenses' && <LicensesSection licenses={licenses} services={services} />}
        {section === 'changes' && <ChangesSection changes={changes} services={services} />}
        {section === 'hours' && <SupportHoursSection hours={supportHours} services={services} />}
        {section === 'support' && <SupportSection clientName={client!.company_name} services={services} />}
      </main>

      <footer className="border-t border-gray-100 py-6">
        <div className="max-w-5xl mx-auto px-4 text-center">
          <p className="text-xs text-gray-400">Managed service portal</p>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Status bar (persistent uptime badges) ---------- */

function StatusBar({ services }: { services: Service[] }) {
  const monitored = services.filter(s => s.status === 'Active' && s.uptime_badge_url);
  if (monitored.length === 0) return null;

  return (
    <div className="bg-slate-50 border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-4 overflow-x-auto">
        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium shrink-0">Status</span>
        {monitored.map(s => (
          <div key={s.id} className="flex items-center gap-2 shrink-0">
            <img src={s.uptime_badge_url} alt={s.business_name || s.name} className="h-4" loading="lazy" />
            {s.uptime_status_url && (
              <a href={s.uptime_status_url} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-blue-600 hover:text-blue-700 font-medium">
                details
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Nav ---------- */

function NavBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? 'border-slate-900 text-slate-900' : 'border-transparent text-gray-500 hover:text-gray-800'
      }`}>
      {children}
    </button>
  );
}

/* ---------- Overview (summary landing) ---------- */

function OverviewSection({ services, roadmap, changes, supportHours, getTypeName }: {
  services: Service[];
  roadmap: RoadmapItem[];
  changes: ServiceChange[];
  supportHours: SupportHour[];
  getTypeName: (id: string) => string;
}) {
  const upcoming = roadmap.filter(r => r.status !== 'Released');
  const recentChanges = changes.slice(0, 3);
  const totalAllocated = services.reduce((sum, s) => sum + (s.confirmed_hours_monthly || 0), 0);

  return (
    <div className="space-y-6">
      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active Services" value={services.length.toString()} />
        <StatCard label="Upcoming Updates" value={upcoming.length.toString()} accent={upcoming.length > 0} />
        <StatCard label="Recent Changes" value={recentChanges.length.toString()} />
        {totalAllocated > 0 && <StatCard label="Hours/month" value={`${totalAllocated}h`} />}
      </div>

      {/* Backup status */}
      <BackupStatus services={services} />

      {/* Roadmap items */}
      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Upcoming</h2>
          <div className="space-y-2">
            {upcoming.slice(0, 5).map(item => {
              const meta = ROADMAP_META[item.status];
              const Icon = meta.icon;
              return (
                <div key={item.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3 flex items-start gap-3">
                  <div className={`p-1.5 rounded-md ${meta.bg} mt-0.5`}>
                    <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">{item.title}</span>
                      <span className={`text-[10px] font-semibold uppercase ${meta.color}`}>{meta.label}</span>
                    </div>
                    {item.description && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{item.description}</p>}
                  </div>
                  {item.scheduled_date && (
                    <span className="text-xs text-gray-400 shrink-0">
                      {new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent changes */}
      {recentChanges.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Recent Changes</h2>
          <div className="space-y-2">
            {recentChanges.map(c => (
              <div key={c.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-gray-400 mb-0.5">
                  <span>{new Date(c.change_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                </div>
                <p className="text-sm text-gray-900">{c.summary}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Service summary */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Your Services</h2>
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {services.map(s => (
            <div key={s.id} className="px-4 py-3 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                s.operational_status === 'Operational' || !s.operational_status ? 'bg-emerald-500' :
                s.operational_status === 'Degraded' ? 'bg-amber-500' :
                s.operational_status === 'Down' ? 'bg-red-500' : 'bg-blue-500'
              }`} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-900">{s.business_name || s.name}</span>
                <span className="text-xs text-gray-400 ml-2">{getTypeName(s.service_type_id)}</span>
              </div>
              {s.uptime_badge_url && (
                <img src={s.uptime_badge_url} alt="status" className="h-4" loading="lazy" />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">{label}</div>
      <div className={`text-xl font-bold ${accent ? 'text-blue-600' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function BackupStatus({ services }: { services: Service[] }) {
  const withBackup = services.filter(s => s.last_backup_at);
  if (withBackup.length === 0) return null;

  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <HardDrive className="w-4 h-4 text-gray-500" />
        <h2 className="text-sm font-semibold text-gray-900">Backup Status</h2>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
        {withBackup.map(s => {
          const age = Date.now() - new Date(s.last_backup_at!).getTime();
          const hoursOld = age / (1000 * 60 * 60);
          const isStale = hoursOld > 48;
          const isWarning = hoursOld > 24 && hoursOld <= 48;

          return (
            <div key={s.id} className="px-4 py-3 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${
                isStale ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'
              }`} />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-gray-900">{s.business_name || s.name}</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {s.last_backup_size_bytes != null && (
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full font-medium">
                    {formatBytes(s.last_backup_size_bytes)}
                  </span>
                )}
                <span className={`text-xs font-medium ${
                  isStale ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-600'
                }`}>
                  {formatTimeAgo(s.last_backup_at!)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- Service Catalog ---------- */

function ServiceCatalog({
  services, projects, getTypeName, getProjectName, expandedService, setExpandedService, heartbeats,
}: {
  services: Service[];
  projects: Project[];
  getTypeName: (id: string) => string;
  getProjectName: (id?: string) => string | null;
  expandedService: string | null;
  setExpandedService: (id: string | null) => void;
  heartbeats: ServiceHeartbeat[];
}) {
  const [showCosts, setShowCosts] = useState(false);

  if (services.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
        <Server className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">No services in your catalog yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{services.length} Services</h2>
        <button
          onClick={() => setShowCosts(!showCosts)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            showCosts
              ? 'bg-slate-800 text-white'
              : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" />
          {showCosts ? 'Hide Costs' : 'Show Costs'}
        </button>
      </div>

      <div className="space-y-3">
        {services.map(s => (
          <ServiceCard
            key={s.id}
            service={s}
            typeName={getTypeName(s.service_type_id)}
            projectName={getProjectName(s.project_id)}
            expanded={expandedService === s.id}
            onToggle={() => setExpandedService(expandedService === s.id ? null : s.id)}
            heartbeats={heartbeats.filter(h => h.service_id === s.id)}
            showCosts={showCosts}
          />
        ))}
      </div>
    </div>
  );
}

function ServiceCard({
  service, typeName, projectName, expanded, onToggle, heartbeats, showCosts,
}: {
  service: Service;
  typeName: string;
  projectName: string | null;
  expanded: boolean;
  onToggle: () => void;
  heartbeats: ServiceHeartbeat[];
  showCosts: boolean;
}) {
  const title = service.business_name || service.name;
  const desc = service.business_description || service.description;
  const isActive = service.status === 'Active';
  const monthly = serviceMonthlyTotal(service);

  return (
    <div className={`bg-white rounded-xl border border-gray-200 overflow-hidden transition-shadow hover:shadow-sm ${!isActive ? 'opacity-70' : ''}`}>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${
              service.operational_status === 'Operational' || !service.operational_status ? 'bg-emerald-500' :
              service.operational_status === 'Degraded' ? 'bg-amber-500' :
              service.operational_status === 'Down' ? 'bg-red-500' : 'bg-blue-500'
            }`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-semibold text-gray-900">{title}</h3>
                <span className="text-xs text-gray-400">{typeName}</span>
                {projectName && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{projectName}</span>
                )}
                {!isActive && (
                  <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">{service.status}</span>
                )}
              </div>
              {desc && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{desc}</p>}
            </div>
          </div>
          {showCosts && monthly > 0 && (
            <div className="text-right shrink-0">
              <div className="text-sm font-bold text-gray-900">{service.currency} {monthly.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="text-[10px] text-gray-400">per month</div>
            </div>
          )}
        </div>

        {/* Includes/Excludes - compact */}
        {(service.includes?.length || service.client_responsibilities?.length) && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {(service.includes || []).slice(0, 4).map((item, i) => (
              <span key={i} className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{item}</span>
            ))}
            {(service.includes || []).length > 4 && (
              <span className="text-[11px] text-gray-400">+{(service.includes || []).length - 4} more</span>
            )}
          </div>
        )}

        {/* Backup indicator */}
        {service.last_backup_at && (
          <div className="flex items-center gap-2 mt-3">
            <HardDrive className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs text-gray-600">
              Last backup: <span className="font-medium">{formatTimeAgo(service.last_backup_at)}</span>
            </span>
            {service.last_backup_size_bytes != null && (
              <span className="text-xs text-gray-400">({formatBytes(service.last_backup_size_bytes)})</span>
            )}
          </div>
        )}

        {/* Expand toggle */}
        <button onClick={onToggle}
          className="mt-3 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 font-medium transition-colors">
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Details
        </button>
      </div>

      {expanded && <TechnicalDetails service={service} heartbeats={heartbeats} showCosts={showCosts} />}
    </div>
  );
}

function TechnicalDetails({ service, heartbeats, showCosts }: { service: Service; heartbeats: ServiceHeartbeat[]; showCosts: boolean }) {
  const specs = service.specifications || {};
  const hasSpecs = !!(specs.cpu || specs.ram || specs.storage || specs.bandwidth);

  return (
    <div className="bg-gray-50 border-t border-gray-100 px-5 py-4 space-y-4">
      {/* Key fields */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-sm">
        {service.sla_level && <Field label="SLA" value={service.sla_level} />}
        {service.provider && <Field label="Provider" value={service.provider} />}
        {service.location && <Field label="Location" value={service.location} />}
        {service.infrastructure_type && <Field label="Infrastructure" value={service.infrastructure_type} />}
        {service.rto && <Field label="RTO" value={service.rto} />}
        {service.rpo && <Field label="RPO" value={service.rpo} />}
        {service.maintenance_window && <Field label="Maintenance" value={service.maintenance_window} />}
        {service.next_renewal_date && <Field label="Next Renewal" value={new Date(service.next_renewal_date).toLocaleDateString()} />}
        {service.last_backup_at && <Field label="Last Backup" value={formatTimeAgo(service.last_backup_at)} />}
      </div>

      {/* Resource bars */}
      {(service.storage_used_pct != null || service.ram_used_pct != null) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {service.storage_used_pct != null && <ResourceBar label="Storage" pct={service.storage_used_pct} />}
          {service.ram_used_pct != null && <ResourceBar label="RAM" pct={service.ram_used_pct} />}
        </div>
      )}

      {/* Specs */}
      {hasSpecs && (
        <div className="flex flex-wrap gap-2">
          {specs.cpu && <Tag label={specs.cpu} />}
          {specs.ram && <Tag label={`${specs.ram} RAM`} />}
          {specs.storage && <Tag label={specs.storage} />}
          {specs.bandwidth && <Tag label={specs.bandwidth} />}
        </div>
      )}

      {/* Managed roles */}
      {service.managed_roles && service.managed_roles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {(service.managed_roles as ManagedRole[]).map(r => (
            <span key={r} className="text-[11px] bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full border border-teal-100">{r}</span>
          ))}
        </div>
      )}

      {/* Includes / Excludes / Responsibilities full list */}
      {(service.includes?.length || service.excludes?.length || service.client_responsibilities?.length) ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-gray-200">
          <BulletList title="Included" items={service.includes || []} color="emerald" />
          <BulletList title="Not Included" items={service.excludes || []} color="gray" />
          <BulletList title="Your Role" items={service.client_responsibilities || []} color="blue" />
        </div>
      ) : null}

      {/* Cost breakdown */}
      {showCosts && (service.infrastructure_cost || service.allocated_hours || service.extra_hour_rate) && (
        <div className="pt-2 border-t border-gray-200">
          <div className="flex flex-wrap gap-4 text-xs text-gray-600">
            {service.infrastructure_cost ? <span>Infra: {service.currency} {service.infrastructure_cost.toFixed(2)}</span> : null}
            {service.allocated_hours ? <span>Allocated: {service.allocated_hours}h/mo</span> : null}
            {service.extra_hour_rate ? <span>Extra hour: {service.currency} {service.extra_hour_rate.toFixed(2)}</span> : null}
          </div>
        </div>
      )}

      {heartbeats.length > 0 && <SpeedChart heartbeats={heartbeats} />}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-900">{value}</div>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return <span className="text-xs bg-white border border-gray-200 px-2.5 py-1 rounded-md text-gray-700">{label}</span>;
}

function BulletList({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (items.length === 0) return null;
  const textColor = color === 'emerald' ? 'text-emerald-700' : color === 'blue' ? 'text-blue-700' : 'text-gray-600';
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wider font-semibold ${textColor} mb-1.5`}>{title}</div>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />
            {item}
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
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-gray-600">{label}</span>
        <span className="text-xs font-semibold text-gray-900">{Math.round(clamped)}%</span>
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function SpeedChart({ heartbeats }: { heartbeats: ServiceHeartbeat[] }) {
  const points = heartbeats.map(h => ({
    time: new Date(h.received_at),
    download: Number((h.payload as any).download_mbps) || 0,
    upload: Number((h.payload as any).upload_mbps) || 0,
    ping: Number((h.payload as any).ping_ms) || 0,
  }));

  if (points.length === 0) return null;

  const maxSpeed = Math.max(...points.map(p => Math.max(p.download, p.upload)), 1);
  const chartH = 80;
  const toY = (val: number) => chartH - (val / maxSpeed) * (chartH - 8);

  const makePath = (values: number[]) =>
    values.map((v, i) => {
      const x = points.length === 1 ? 50 : (i / (points.length - 1)) * 100;
      return `${i === 0 ? 'M' : 'L'} ${x} ${toY(v)}`;
    }).join(' ');

  const latest = points[points.length - 1];

  return (
    <div className="pt-3 border-t border-gray-200">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Network (48h)</span>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-blue-600 font-medium">{latest.download.toFixed(0)} Mbps down</span>
          <span className="text-emerald-600 font-medium">{latest.upload.toFixed(0)} Mbps up</span>
          <span className="text-gray-500">{latest.ping.toFixed(0)}ms</span>
        </div>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-3">
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

  const daysUntilExpiry = (date?: string) => {
    if (!date) return null;
    return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Licenses & Subscriptions</h2>
      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
        {licenses.map(lic => {
          const days = daysUntilExpiry(lic.expiration_date);
          const isExpiring = days !== null && days >= 0 && days <= 30;
          const isExpired = days !== null && days < 0;

          return (
            <div key={lic.id} className="px-5 py-3.5 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{lic.software_name}</span>
                  <span className="text-xs text-gray-400">{lic.quantity} {lic.quantity_label}</span>
                </div>
                {getServiceName(lic.service_id) && (
                  <span className="text-xs text-gray-400">{getServiceName(lic.service_id)}</span>
                )}
              </div>
              <div className="shrink-0">
                {isExpired ? (
                  <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Expired</span>
                ) : isExpiring ? (
                  <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Renews in {days}d</span>
                ) : days !== null ? (
                  <span className="text-xs text-gray-500">{new Date(lic.expiration_date!).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
                ) : (
                  <span className="text-xs text-gray-400">Perpetual</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Change Log ---------- */

function ChangesSection({ changes, services }: { changes: ServiceChange[]; services: Service[] }) {
  const getServiceName = (id: string) => {
    const s = services.find(s => s.id === id);
    return s ? (s.business_name || s.name) : 'Service';
  };

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Change History</h2>
      <div className="space-y-2">
        {changes.map(c => (
          <div key={c.id} className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <span>{new Date(c.change_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span className="text-gray-300">-</span>
              <span className="text-blue-600 font-medium">{getServiceName(c.service_id)}</span>
            </div>
            <p className="text-sm font-medium text-gray-900">{c.summary}</p>
            {c.details && <p className="text-xs text-gray-500 mt-1">{c.details}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Support Hours ---------- */

function SupportHoursSection({ hours, services }: { hours: SupportHour[]; services: Service[] }) {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const filteredHours = useMemo(() => {
    const [year, month] = selectedMonth.split('-');
    const start = `${year}-${month}-01`;
    const endDate = new Date(parseInt(year), parseInt(month), 0);
    const end = `${year}-${month}-${String(endDate.getDate()).padStart(2, '0')}`;
    return hours.filter(h => h.work_date >= start && h.work_date <= end);
  }, [hours, selectedMonth]);

  const totalHoursUsed = filteredHours.reduce((sum, h) => sum + Number(h.hours), 0);
  const totalAllocated = services
    .filter(s => s.status === 'Active')
    .reduce((sum, s) => sum + (s.confirmed_hours_monthly || 0), 0);
  const pctUsed = totalAllocated > 0 ? (totalHoursUsed / totalAllocated) * 100 : 0;

  const getServiceName = (id?: string) => {
    if (!id) return null;
    const svc = services.find(s => s.id === id);
    return svc?.business_name || svc?.name || null;
  };

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    hours.forEach(h => {
      const [y, m] = h.work_date.split('-');
      months.add(`${y}-${m}`);
    });
    const now = new Date();
    months.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    return Array.from(months).sort().reverse();
  }, [hours]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Support Hours</h2>
        <select
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
        >
          {availableMonths.map(m => {
            const [y, mo] = m.split('-');
            const label = new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
            return <option key={m} value={m}>{label}</option>;
          })}
        </select>
      </div>

      {/* Usage summary */}
      {totalAllocated > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-600">{totalHoursUsed.toFixed(1)}h of {totalAllocated}h used</span>
            <span className={`text-xs font-semibold ${pctUsed > 90 ? 'text-red-600' : pctUsed > 70 ? 'text-amber-600' : 'text-gray-900'}`}>
              {pctUsed.toFixed(0)}%
            </span>
          </div>
          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${pctUsed > 90 ? 'bg-red-500' : pctUsed > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
              style={{ width: `${Math.min(pctUsed, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Activity */}
      {filteredHours.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">
          No hours logged this period.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {filteredHours.map(entry => (
            <div key={entry.id} className="px-4 py-3 flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {new Date(entry.work_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </span>
                  {getServiceName(entry.service_id) && (
                    <span className="text-xs text-blue-600 font-medium">{getServiceName(entry.service_id)}</span>
                  )}
                </div>
                {entry.description && <p className="text-sm text-gray-700 mt-0.5">{entry.description}</p>}
              </div>
              <span className="text-xs font-semibold text-gray-900 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
                {Number(entry.hours).toFixed(1)}h
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Support Form ---------- */

function SupportSection({ clientName, services }: { clientName: string; services: Service[] }) {
  const [serviceId, setServiceId] = useState('');
  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const svc = services.find(s => s.id === serviceId);
    const body = `Client: ${clientName}%0D%0AService: ${svc?.business_name || svc?.name || '(general)'}%0D%0APriority: ${priority}%0D%0A%0D%0A${encodeURIComponent(message)}`;
    window.location.href = `mailto:?subject=${encodeURIComponent('[Support] ' + subject)}&body=${body}`;
    setSent(true);
  };

  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">Request Support</h2>
        <p className="text-xs text-gray-500 mt-0.5">Opens your email client with a pre-filled support request.</p>
      </div>

      {sent && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-4 py-3 flex items-center gap-3 text-sm">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Email draft opened. Send it to reach the support team.</span>
          <button onClick={() => setSent(false)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Service</label>
            <select value={serviceId} onChange={e => setServiceId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">General inquiry</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.business_name || s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500">
              <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)} required
            placeholder="Brief summary"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} required
            placeholder="What's happening, when it started..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
        <button type="submit"
          className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Send className="w-3.5 h-3.5" /> Send Request
        </button>
      </form>
    </div>
  );
}
