import { useState, useEffect, useMemo } from 'react';
import {
  Server, Globe, Calendar, Clock, MapPin, Shield, CheckCircle2,
  FolderOpen, History, FileText, Send, Info,
  Cpu, HardDrive, Wifi, ChevronDown, ChevronRight, Mail, X, Check, MinusCircle, LayoutGrid,
  Sparkles, Rocket, DollarSign, Search, Cloud, Wrench,
} from 'lucide-react';
import { supabase, Client, Service, ServiceType, Project, ServiceChange, ManagedRole, RoadmapItem, RoadmapStatus, RoadmapCategory, ClientLicense } from '../lib/supabase';

type Props = { token: string };

type Section = 'overview' | 'catalog' | 'licenses' | 'changes' | 'support';

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
  return `${days}d ago`;
}

function servicePeriodTotal(service: Service): number {
  const hours = service.confirmed_hours_monthly;
  if (hours && hours > 0) {
    const months = billingCycleMonths(service.billing_cycle);
    if (months > 0) return service.price * hours * months;
  }
  return service.price;
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

      const [{ data: clientData }, { data: servicesData }, { data: projectsData }, { data: typesData }, { data: roadmapData }] = await Promise.all([
        supabase.from('clients').select('*').eq('id', tokenRow.client_id).maybeSingle(),
        supabase.from('services').select('*').eq('client_id', tokenRow.client_id).order('created_at'),
        supabase.from('projects').select('*').eq('client_id', tokenRow.client_id).order('created_at'),
        supabase.from('service_types').select('*'),
        supabase.from('roadmap_items').select('*').eq('user_id', tokenRow.user_id).eq('is_public', true).order('sort_order').order('created_at'),
      ]);

      if (!clientData) { setNotFound(true); setLoading(false); return; }

      setClient(clientData);
      setServices(servicesData || []);
      setProjects(projectsData || []);
      setServiceTypes(typesData || []);
      setRoadmap(roadmapData || []);

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
        .select('id, client_id, service_id, software_name, quantity, quantity_label, expiration_date, billing_cycle, created_at, updated_at')
        .eq('client_id', tokenRow.client_id)
        .order('expiration_date', { ascending: true, nullsFirst: false });
      setLicenses(licensesData || []);

      setLoading(false);
    };
    load();
  }, [token]);

  const getTypeName = (id: string) => serviceTypes.find(t => t.id === id)?.name || 'Service';
  const getProjectName = (id?: string) => id ? projects.find(p => p.id === id)?.name : null;

  const activeServices = useMemo(() => services.filter(s => s.status === 'Active'), [services]);

  const monthlyEquivalent = useMemo(
    () => activeServices.reduce((sum, s) => sum + serviceMonthlyTotal(s), 0),
    [activeServices]
  );

  const primaryCurrency = useMemo(() => {
    const counts = new Map<string, number>();
    activeServices.forEach(s => counts.set(s.currency, (counts.get(s.currency) || 0) + 1));
    let best = 'USD';
    let max = 0;
    counts.forEach((v, k) => { if (v > max) { max = v; best = k; } });
    return best;
  }, [activeServices]);

  const nextRelease = useMemo(() => roadmap.find(r => r.status === 'Next Release'), [roadmap]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white"></div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="text-center">
          <Globe className="w-16 h-16 text-slate-600 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white mb-2">Portal Not Found</h1>
          <p className="text-slate-400">This link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="max-w-6xl mx-auto px-4 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="bg-blue-600 p-2 rounded-lg">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <span className="text-slate-300 text-xs font-semibold uppercase tracking-widest">IT Services Portal · ISO/IEC 20000</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold">{client!.company_name}</h1>
              {client!.contact_name && <p className="text-slate-300 mt-1">{client!.contact_name}</p>}
            </div>
            <div className="inline-flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl px-5 py-3 border border-white/10">
              <div className="p-2 rounded-lg bg-emerald-500/20">
                <DollarSign className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <div className="text-xs text-slate-300 uppercase tracking-wider">Monthly Equivalent</div>
                <div className="text-2xl font-bold">
                  {primaryCurrency} {monthlyEquivalent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </div>

          {/* Cost strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <KpiCard label="Active Services" value={activeServices.length.toString()} />
            <KpiCard label={`Monthly (${primaryCurrency})`} value={monthlyEquivalent.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} accent="emerald" />
            <KpiCard label={`Annual (${primaryCurrency})`} value={(monthlyEquivalent * 12).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} accent="emerald" />
            <KpiCard label="Upcoming Updates" value={roadmap.filter(r => r.status !== 'Released').length.toString()} accent="amber" />
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          <NavBtn icon={Sparkles} active={section === 'overview'} onClick={() => setSection('overview')}>What's Coming</NavBtn>
          <NavBtn icon={LayoutGrid} active={section === 'catalog'} onClick={() => setSection('catalog')}>Service Catalog</NavBtn>
          <NavBtn icon={Shield} active={section === 'licenses'} onClick={() => setSection('licenses')}>Licenses</NavBtn>
          <NavBtn icon={History} active={section === 'changes'} onClick={() => setSection('changes')}>Change Log</NavBtn>
          <NavBtn icon={Mail} active={section === 'support'} onClick={() => setSection('support')}>Request Support</NavBtn>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {section === 'overview' && <ComingSoonSection roadmap={roadmap} nextRelease={nextRelease} />}

        {section === 'catalog' && (
          <CatalogSection
            services={services}
            projects={projects}
            getTypeName={getTypeName}
            getProjectName={getProjectName}
            expandedService={expandedService}
            setExpandedService={setExpandedService}
          />
        )}

        {section === 'licenses' && <LicensesSection licenses={licenses} services={services} />}

        {section === 'changes' && <ChangesSection changes={changes} services={services} />}

        {section === 'support' && <SupportSection clientName={client!.company_name} services={services} />}
      </main>

      <footer className="border-t border-gray-200 py-8 mt-8">
        <div className="max-w-6xl mx-auto px-4 text-center">
          <p className="text-xs text-gray-500">
            Managed service portal · Read-only view · Aligned with ISO/IEC 20000 IT Service Management practices
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ---------- Header bits ---------- */

function KpiCard({ label, value, accent = 'slate' }: { label: string; value: string; accent?: string }) {
  const bg = accent === 'emerald' ? 'bg-emerald-500/20 text-emerald-200'
    : accent === 'amber' ? 'bg-amber-500/20 text-amber-200'
    : accent === 'red' ? 'bg-red-500/20 text-red-200'
    : 'bg-slate-700/40 text-slate-200';
  return (
    <div className={`rounded-lg p-4 ${bg}`}>
      <div className="text-xs uppercase tracking-wider opacity-80 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}

function NavBtn({ icon: Icon, active, onClick, children }: any) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'
      }`}>
      <Icon className="w-4 h-4" />
      {children}
    </button>
  );
}

/* ---------- Coming Soon (replaces live availability) ---------- */

function ComingSoonSection({ roadmap, nextRelease }: { roadmap: RoadmapItem[]; nextRelease: RoadmapItem | undefined }) {
  const upcoming = roadmap.filter(r => r.status !== 'Released');
  const released = roadmap.filter(r => r.status === 'Released');

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-sky-50 p-8">
        <div className="absolute -right-10 -top-10 w-48 h-48 bg-blue-100 rounded-full blur-3xl opacity-60"></div>
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5" /> Coming Soon
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">Live availability & operational status</h2>
          <p className="text-gray-700 max-w-2xl">
            Real-time monitoring of your services — uptime, maintenance windows, and incident reporting — is being prepared. It will be activated once the monitoring agents are fully deployed.
          </p>
          {nextRelease && (
            <div className="mt-6 inline-flex items-center gap-3 bg-white border border-blue-200 rounded-xl px-4 py-3 shadow-sm">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Rocket className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-xs text-blue-700 font-semibold uppercase tracking-wider">Next Release</div>
                <div className="font-semibold text-gray-900">{nextRelease.title}</div>
                {nextRelease.eta && <div className="text-xs text-gray-500 mt-0.5">ETA: {nextRelease.eta}</div>}
              </div>
            </div>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Rocket className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">Upcoming Updates</h3>
        </div>
        {upcoming.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
            <Sparkles className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-500 text-sm">The roadmap is being put together. Check back soon.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {upcoming.map(item => <RoadmapCard key={item.id} item={item} />)}
          </div>
        )}
      </section>

      {released.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <h3 className="text-lg font-semibold text-gray-900">Recently Released</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {released.map(item => <RoadmapCard key={item.id} item={item} />)}
          </div>
        </section>
      )}
    </div>
  );
}

const CATEGORY_LABELS: Record<RoadmapCategory, string> = {
  idea: 'New Service',
  payment: 'Pending Payment',
  backup: 'Backup Integration',
  visit: 'Visit / Coordination',
};

function RoadmapCard({ item }: { item: RoadmapItem }) {
  const meta = ROADMAP_META[item.status];
  const Icon = meta.icon;
  return (
    <article className={`bg-white rounded-xl border ${meta.border} shadow-sm p-5 transition-shadow hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-md ${meta.bg}`}>
            <Icon className={`w-4 h-4 ${meta.color}`} />
          </div>
          <span className={`text-xs font-semibold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
          {item.category && item.category !== 'idea' && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
              {CATEGORY_LABELS[item.category]}
            </span>
          )}
        </div>
        {item.eta && (
          <span className="text-xs text-gray-500 inline-flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {item.eta}
          </span>
        )}
      </div>
      <h4 className="font-semibold text-gray-900 mb-1">{item.title}</h4>
      {item.description && <p className="text-sm text-gray-600 leading-relaxed">{item.description}</p>}
      {item.requested_by && (
        <div className="text-xs text-gray-500 mt-2">Requested by {item.requested_by}</div>
      )}
    </article>
  );
}

/* ---------- Catalog (ISO 20000 service sheets) ---------- */

type GroupMode = 'project' | 'type';
type Group = { key: string; title: string; subtitle?: string; status?: string; items: Service[] };

function CatalogSection({
  services, projects, getTypeName, getProjectName, expandedService, setExpandedService,
}: {
  services: Service[];
  projects: Project[];
  getTypeName: (id: string) => string;
  getProjectName: (id?: string) => string | null;
  expandedService: string | null;
  setExpandedService: (id: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Other'>('all');
  const [groupBy, setGroupBy] = useState<GroupMode>('project');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter(s => {
      if (statusFilter === 'Active' && s.status !== 'Active') return false;
      if (statusFilter === 'Other' && s.status === 'Active') return false;
      if (!q) return true;
      const hay = [
        s.business_name, s.name, s.description, s.business_description,
        getTypeName(s.service_type_id), s.provider, s.location, s.sla_level,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [services, query, statusFilter, getTypeName]);

  const groups: Group[] = useMemo(() => {
    if (groupBy === 'project') {
      const map = new Map<string, Group>();
      map.set('__none__', { key: '__none__', title: 'Standalone Services', items: [] });
      projects.forEach(p => map.set(p.id, { key: p.id, title: p.name, subtitle: p.description, status: p.status, items: [] }));
      filtered.forEach(s => {
        const k = s.project_id && map.has(s.project_id) ? s.project_id : '__none__';
        map.get(k)!.items.push(s);
      });
      return Array.from(map.values()).filter(g => g.items.length > 0);
    }
    const map = new Map<string, Group>();
    filtered.forEach(s => {
      const name = getTypeName(s.service_type_id);
      if (!map.has(name)) map.set(name, { key: name, title: name, items: [] });
      map.get(name)!.items.push(s);
    });
    return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title));
  }, [filtered, projects, groupBy, getTypeName]);

  if (services.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
        <LayoutGrid className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-500 text-sm">No services in your catalog yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col md:flex-row gap-3 md:items-center">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search services, providers, locations..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-xs font-medium">
          {(['all', 'Active', 'Other'] as const).map(key => (
            <button key={key} onClick={() => setStatusFilter(key)}
              className={`px-3 py-1.5 rounded-md transition-colors ${statusFilter === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
              {key === 'all' ? 'All' : key === 'Active' ? 'Active' : 'Other'}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-xs font-medium">
          <button onClick={() => setGroupBy('project')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors ${groupBy === 'project' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <FolderOpen className="w-3.5 h-3.5" /> By project
          </button>
          <button onClick={() => setGroupBy('type')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md transition-colors ${groupBy === 'type' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <LayoutGrid className="w-3.5 h-3.5" /> By type
          </button>
        </div>
        <div className="text-xs text-gray-500 whitespace-nowrap">{filtered.length} of {services.length}</div>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <Search className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No services match your filters.</p>
        </div>
      ) : groups.map(g => {
        const subtotal = g.items.reduce((sum, s) => sum + (s.status === 'Active' ? serviceMonthlyTotal(s) : 0), 0);
        const subtotalCurrency = g.items.find(s => s.status === 'Active')?.currency;
        const HeaderIcon = groupBy === 'project' ? FolderOpen : LayoutGrid;
        return (
          <section key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <header className="px-6 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-gray-200 flex items-center gap-3 flex-wrap">
              <HeaderIcon className="w-4 h-4 text-blue-600" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-semibold text-gray-900">{g.title}</h2>
                  {g.status && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{g.status}</span>
                  )}
                </div>
                {g.subtitle && <p className="text-xs text-gray-600 mt-0.5">{g.subtitle}</p>}
              </div>
              {subtotal > 0 && subtotalCurrency && (
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-gray-500">Monthly Subtotal</div>
                  <div className="text-sm font-bold text-emerald-700">
                    {subtotalCurrency} {subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              )}
              <span className="text-xs text-gray-500">{g.items.length} {g.items.length === 1 ? 'service' : 'services'}</span>
            </header>
            <div className="divide-y divide-gray-100">
              {g.items.map(s => (
                <ServiceSheet
                  key={s.id}
                  service={s}
                  typeName={getTypeName(s.service_type_id)}
                  projectName={getProjectName(s.project_id)}
                  expanded={expandedService === s.id}
                  onToggle={() => setExpandedService(expandedService === s.id ? null : s.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ServiceSheet({
  service, typeName, expanded, onToggle,
}: {
  service: Service;
  typeName: string;
  projectName: string | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const title = service.business_name || service.name;
  const desc = service.business_description || service.description;
  const isActive = service.status === 'Active';
  const statusStyle =
    service.status === 'Suspended' ? 'bg-amber-50 text-amber-700 border-amber-200' :
    service.status === 'Cancelled' ? 'bg-red-50 text-red-700 border-red-200' :
    service.status === 'Pending' ? 'bg-slate-50 text-slate-700 border-slate-200' :
    'bg-emerald-50 text-emerald-700 border-emerald-200';

  return (
    <article className={`px-6 py-5 transition-colors ${isActive ? 'hover:bg-slate-50' : 'bg-gray-50/60'}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div className={`p-2 rounded-lg ${isActive ? 'bg-blue-50' : 'bg-gray-100'}`}>
            <Server className={`w-5 h-5 ${isActive ? 'text-blue-600' : 'text-gray-400'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`font-semibold text-lg ${isActive ? 'text-gray-900' : 'text-gray-600'}`}>{title}</h3>
              {!isActive && (
                <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border font-semibold ${statusStyle}`}>
                  {service.status}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              <span className="text-xs text-gray-500">{typeName}</span>
            </div>
            {desc && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{desc}</p>}
          </div>
        </div>
        <PriceTag service={service} />
      </div>

      {(service.includes?.length || service.excludes?.length || service.client_responsibilities?.length) ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
          <ListCard title="Includes" icon={Check} color="emerald" items={service.includes || []} />
          <ListCard title="Not Included" icon={MinusCircle} color="slate" items={service.excludes || []} />
          <ListCard title="What You Manage" icon={Info} color="blue" items={service.client_responsibilities || []} />
        </div>
      ) : null}

      <button onClick={onToggle}
        className="mt-5 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
        {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        Technical details
      </button>

      {expanded && (
        <div className="mt-4 -mx-6 -mb-5">
          <TechnicalDetails service={service} />
        </div>
      )}
    </article>
  );
}

function ListCard({ title, icon: Icon, color, items }: { title: string; icon: any; color: string; items: string[] }) {
  if (items.length === 0) return null;
  const styles: Record<string, string> = {
    emerald: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-600',
    blue: 'bg-blue-50 border-blue-100 text-blue-700',
  };
  return (
    <div className={`rounded-lg border p-4 ${styles[color]}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider mb-2">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="text-sm text-gray-800 flex items-start gap-2">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-400 flex-shrink-0"></span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TechnicalDetails({ service }: { service: Service }) {
  const specs = service.specifications || {};
  const hasSpecs = !!(specs.cpu || specs.ram || specs.storage || specs.bandwidth);
  const renewal = service.next_renewal_date ? new Date(service.next_renewal_date).toLocaleDateString() : '--';
  return (
    <div className="bg-slate-50 border-t border-gray-100 px-6 py-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Field icon={Shield} label="SLA" value={service.sla_level || '--'} />
        <Field icon={Globe} label="Provider" value={service.provider || '--'} />
        <Field icon={MapPin} label="Location" value={service.location || '--'} />
        <Field icon={Shield} label="Infrastructure" value={service.infrastructure_type || '--'} />
        <Field icon={Globe} label="Cloud" value={service.cloud_provider || '--'} />
        <Field icon={Server} label="IP" value={service.server_ip || '--'} />
        <Field icon={Clock} label="Monthly Hours" value={service.confirmed_hours_monthly != null ? `${service.confirmed_hours_monthly}h` : '--'} />
        <Field icon={Calendar} label="Next Renewal" value={renewal} />
        <Field icon={FileText} label="Billing" value={`${service.price} ${service.currency} / ${service.billing_cycle}`} />
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-3">Recovery & Maintenance</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">RTO (Recovery Time)</div>
            <div className="text-sm font-medium text-gray-900">{service.rto || '--'}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">RPO (Data Recovery)</div>
            <div className="text-sm font-medium text-gray-900">{service.rpo || '--'}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Maintenance Window</div>
            <div className="text-sm font-medium text-gray-900">{service.maintenance_window || '--'}</div>
          </div>
          {service.last_backup_at && (
            <div className="bg-white rounded-lg border border-emerald-200 p-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-600 mb-1">Last Backup</div>
              <div className="text-sm font-medium text-gray-900">{formatTimeAgo(service.last_backup_at)}</div>
            </div>
          )}
        </div>
      </div>

      {(service.storage_used_pct != null || service.ram_used_pct != null) && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs uppercase tracking-wider text-gray-500">Resource Usage</div>
            {service.resource_updated_at && (
              <div className="text-[10px] text-gray-400">Updated {formatTimeAgo(service.resource_updated_at)}</div>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {service.storage_used_pct != null && (
              <ResourceBar label="Storage" pct={service.storage_used_pct} icon={HardDrive} />
            )}
            {service.ram_used_pct != null && (
              <ResourceBar label="RAM" pct={service.ram_used_pct} icon={Server} />
            )}
          </div>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Specifications</div>
        {hasSpecs ? (
          <div className="flex flex-wrap gap-2">
            {specs.cpu && <Spec icon={Cpu} label={specs.cpu} />}
            {specs.ram && <Spec icon={Server} label={`${specs.ram} RAM`} />}
            {specs.storage && <Spec icon={HardDrive} label={specs.storage} />}
            {specs.bandwidth && <Spec icon={Wifi} label={specs.bandwidth} />}
          </div>
        ) : (
          <span className="text-sm text-gray-400">--</span>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Managed Roles</div>
        {service.managed_roles && service.managed_roles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {(service.managed_roles as ManagedRole[]).map(r => (
              <span key={r} className="text-xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full font-medium border border-teal-100">{r}</span>
            ))}
          </div>
        ) : (
          <span className="text-sm text-gray-400">--</span>
        )}
      </div>
    </div>
  );
}

function PriceTag({ service }: { service: Service }) {
  const hours = service.confirmed_hours_monthly;
  const isHourly = !!(hours && hours > 0);
  const monthly = serviceMonthlyTotal(service);
  const annual = monthly * 12;
  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const infraCost = service.infrastructure_cost || 0;
  const allocHours = service.allocated_hours || 0;
  const extraRate = service.extra_hour_rate || 0;
  const hasBreakdown = infraCost > 0 || allocHours > 0;
  const maintenanceCost = hasBreakdown ? (monthly - infraCost) : 0;

  return (
    <div className="flex flex-col items-end">
      <div className="inline-flex items-baseline gap-1 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-xl px-4 py-3 shadow-sm">
        <span className="text-sm font-semibold opacity-90">{service.currency}</span>
        <span className="text-2xl md:text-3xl font-bold tracking-tight">{fmt(monthly)}</span>
      </div>
      <div className="text-xs text-gray-500 mt-1 font-medium">per month</div>

      {hasBreakdown && (
        <div className="mt-2 text-right space-y-0.5 border-t border-gray-100 pt-2">
          {infraCost > 0 && (
            <div className="text-xs text-gray-500 flex items-center justify-end gap-1.5">
              <Cloud className="w-3 h-3" />
              <span>Infra: {service.currency} {fmt(infraCost)}</span>
            </div>
          )}
          {allocHours > 0 && (
            <div className="text-xs text-gray-500 flex items-center justify-end gap-1.5">
              <Wrench className="w-3 h-3" />
              <span>Maint. ({allocHours}h): {service.currency} {fmt(maintenanceCost)}</span>
            </div>
          )}
        </div>
      )}

      <div className="text-xs text-gray-400 mt-1.5">{service.currency} {fmt(annual)} / year</div>

      {extraRate > 0 && (
        <div className="text-xs text-gray-500 mt-0.5">
          Extra hr: {service.currency} {fmt(extraRate)}/hr
        </div>
      )}

      {!hasBreakdown && isHourly && (
        <div className="text-xs text-gray-500 mt-0.5">
          {hours}h / month &middot; {service.currency} {fmt(service.price)}/hr
        </div>
      )}

      {service.next_renewal_date && (
        <div className="text-xs text-gray-400 mt-0.5 inline-flex items-center gap-1">
          <Calendar className="w-3 h-3" /> Renews {new Date(service.next_renewal_date).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}

function Field({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="font-medium text-gray-900">{value}</div>
    </div>
  );
}

function ResourceBar({ label, pct, icon: Icon }: { label: string; pct: number; icon: any }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const barColor = clamped >= 90 ? 'bg-red-500' : clamped >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  const textColor = clamped >= 90 ? 'text-red-700' : clamped >= 80 ? 'text-amber-700' : 'text-gray-700';
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs font-medium text-gray-600">{label}</span>
        </div>
        <span className={`text-xs font-semibold ${textColor}`}>{Math.round(clamped)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

function Spec({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm bg-white border border-gray-200 px-3 py-1.5 rounded-lg">
      <Icon className="w-3.5 h-3.5 text-gray-500" />
      <span className="text-gray-700">{label}</span>
    </div>
  );
}

/* ---------- Licenses & Subscriptions ---------- */

function LicensesSection({ licenses, services }: { licenses: ClientLicense[]; services: Service[] }) {
  const getServiceName = (id?: string) => id ? services.find(s => s.id === id)?.business_name || services.find(s => s.id === id)?.name : null;

  const daysUntilExpiry = (date?: string) => {
    if (!date) return null;
    return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  if (licenses.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
        <Shield className="w-10 h-10 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No active licenses or subscriptions.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">Active Licenses & Subscriptions</h2>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        Software and subscriptions managed as part of your service agreement.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {licenses.map(lic => {
          const days = daysUntilExpiry(lic.expiration_date);
          const isExpiring = days !== null && days >= 0 && days <= 30;
          const isExpired = days !== null && days < 0;
          const borderColor = isExpired ? 'border-red-200' : isExpiring ? 'border-amber-200' : 'border-gray-200';
          const linkedService = getServiceName(lic.service_id);

          return (
            <div key={lic.id} className={`bg-white rounded-xl border ${borderColor} p-5 shadow-sm transition-shadow hover:shadow-md`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900">{lic.software_name}</h4>
                  {linkedService && (
                    <div className="text-xs text-gray-500 mt-0.5">
                      Linked to: {linkedService}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium text-gray-900">
                    {lic.quantity} {lic.quantity_label}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                <div className="text-xs text-gray-500">
                  {lic.billing_cycle === 'Perpetual' ? 'Perpetual license' : `Billed ${lic.billing_cycle.toLowerCase()}`}
                </div>
                {days === null ? (
                  <span className="text-xs text-gray-500 font-medium">No expiry</span>
                ) : isExpired ? (
                  <span className="text-xs font-semibold text-red-700 bg-red-50 px-2.5 py-1 rounded-full">Expired</span>
                ) : isExpiring ? (
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Renews in {days}d
                  </span>
                ) : (
                  <span className="text-xs text-gray-600 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {new Date(lic.expiration_date!).toLocaleDateString()}
                  </span>
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
    <section>
      <div className="flex items-center gap-2 mb-5">
        <History className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">Change History</h2>
      </div>
      <p className="text-sm text-gray-600 mb-6">Record of changes and improvements applied to your services. Transparency is part of our ISO 20000 service management practice.</p>
      {changes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-500">
          No changes logged yet.
        </div>
      ) : (
        <ol className="relative border-l-2 border-gray-200 ml-2 space-y-6">
          {changes.map(c => (
            <li key={c.id} className="pl-6 relative">
              <span className="absolute -left-[9px] top-1.5 w-4 h-4 bg-blue-600 rounded-full border-4 border-slate-50"></span>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(c.change_date).toLocaleDateString()}
                  <span className="text-gray-300">·</span>
                  <span className="text-blue-600 font-medium">{getServiceName(c.service_id)}</span>
                </div>
                <div className="text-sm font-semibold text-gray-900">{c.summary}</div>
                {c.details && <p className="text-sm text-gray-600 mt-1.5 whitespace-pre-wrap">{c.details}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ---------- Support / Incident form (UI only, not wired) ---------- */

function StatusOverview({ services }: { services: Service[] }) {
  const monitored = services.filter(s => s.status === 'Active' && s.uptime_badge_url);
  if (monitored.length === 0) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="w-4 h-4 text-emerald-600" />
        <h3 className="text-sm font-semibold text-gray-900">System Status</h3>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {monitored.map(s => (
          <div key={s.id} className="flex items-center gap-3 bg-slate-50 rounded-lg border border-gray-100 px-3 py-2.5">
            <img
              src={s.uptime_badge_url}
              alt={`${s.business_name || s.name} status`}
              className="h-5"
              loading="lazy"
            />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-gray-800 truncate block">{s.business_name || s.name}</span>
            </div>
            {s.uptime_status_url && (
              <a href={s.uptime_status_url} target="_blank" rel="noopener noreferrer"
                className="text-[10px] text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap">
                Live status
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

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
    <section className="max-w-2xl">
      <StatusOverview services={services} />
      <div className="flex items-center gap-2 mb-2">
        <Mail className="w-5 h-5 text-blue-600" />
        <h2 className="text-lg font-semibold text-gray-900">Request Support</h2>
      </div>
      <p className="text-sm text-gray-600 mb-6">
        Report an incident or request a service change. Submissions open your email client so our team receives all context.
      </p>

      {sent && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="text-sm">Your email client should now be open with the request draft. Send it to reach our support team.</div>
          <button onClick={() => setSent(false)} className="ml-auto"><X className="w-4 h-4" /></button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Affected Service</label>
            <select value={serviceId} onChange={e => setServiceId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">General inquiry</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.business_name || s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Priority</label>
            <select value={priority} onChange={e => setPriority(e.target.value as any)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500">
              <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Subject</label>
          <input type="text" value={subject} onChange={e => setSubject(e.target.value)} required
            placeholder="Brief summary of the issue"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={5} required
            placeholder="Describe what is happening, when it started, who is affected..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
        <button type="submit"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-lg font-medium transition-colors">
          <Send className="w-4 h-4" /> Submit Request
        </button>
      </form>
    </section>
  );
}
