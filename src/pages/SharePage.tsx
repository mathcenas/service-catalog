import { useState, useEffect, useMemo } from 'react';
import {
  Server, Globe, Calendar, Clock, MapPin, Shield, CheckCircle2, AlertTriangle,
  AlertCircle, XCircle, Activity, FolderOpen, History, FileText, Send, Info,
  Cpu, HardDrive, Wifi, ChevronDown, ChevronRight, Mail, X, Check, MinusCircle, LayoutGrid,
} from 'lucide-react';
import { supabase, Client, Service, ServiceType, Project, ServiceChange, OperationalStatus, ManagedRole } from '../lib/supabase';

type Props = { token: string };

type Section = 'overview' | 'catalog' | 'changes' | 'support';

const STATUS_META: Record<OperationalStatus, { color: string; bg: string; border: string; icon: any; label: string; dot: string }> = {
  Operational:  { color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: CheckCircle2, label: 'Operational', dot: 'bg-emerald-500' },
  Maintenance:  { color: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   icon: AlertTriangle, label: 'Scheduled Maintenance', dot: 'bg-amber-500' },
  Degraded:     { color: 'text-orange-700',  bg: 'bg-orange-50',  border: 'border-orange-200',  icon: AlertCircle,   label: 'Degraded Performance', dot: 'bg-orange-500' },
  Down:         { color: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200',     icon: XCircle,       label: 'Service Down', dot: 'bg-red-500' },
};

export function SharePage({ token }: Props) {
  const [client, setClient] = useState<Client | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [changes, setChanges] = useState<ServiceChange[]>([]);
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

      const [{ data: clientData }, { data: servicesData }, { data: projectsData }, { data: typesData }] = await Promise.all([
        supabase.from('clients').select('*').eq('id', tokenRow.client_id).maybeSingle(),
        supabase.from('services').select('*').eq('client_id', tokenRow.client_id).order('created_at'),
        supabase.from('projects').select('*').eq('client_id', tokenRow.client_id).order('created_at'),
        supabase.from('service_types').select('*'),
      ]);

      if (!clientData) { setNotFound(true); setLoading(false); return; }

      setClient(clientData);
      setServices(servicesData || []);
      setProjects(projectsData || []);
      setServiceTypes(typesData || []);

      const ids = (servicesData || []).map(s => s.id);
      if (ids.length > 0) {
        const { data: changesData } = await supabase
          .from('service_changes')
          .select('*')
          .in('service_id', ids)
          .order('change_date', { ascending: false });
        setChanges(changesData || []);
      }

      setLoading(false);
    };
    load();
  }, [token]);

  const getTypeName = (id: string) => serviceTypes.find(t => t.id === id)?.name || 'Service';
  const getProjectName = (id?: string) => id ? projects.find(p => p.id === id)?.name : null;

  const activeServices = useMemo(() => services.filter(s => s.status === 'Active'), [services]);
  const statusCounts = useMemo(() => {
    const counts: Record<OperationalStatus, number> = { Operational: 0, Maintenance: 0, Degraded: 0, Down: 0 };
    activeServices.forEach(s => {
      const st = (s.operational_status || 'Operational') as OperationalStatus;
      counts[st]++;
    });
    return counts;
  }, [activeServices]);

  const overallStatus: OperationalStatus = statusCounts.Down > 0 ? 'Down'
    : statusCounts.Degraded > 0 ? 'Degraded'
    : statusCounts.Maintenance > 0 ? 'Maintenance'
    : 'Operational';

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
            <OverallStatusBadge status={overallStatus} />
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-8">
            <KpiCard label="Active Services" value={activeServices.length} />
            <KpiCard label="Operational" value={statusCounts.Operational} accent="emerald" />
            <KpiCard label="Maintenance" value={statusCounts.Maintenance} accent="amber" />
            <KpiCard label="Incidents" value={statusCounts.Degraded + statusCounts.Down} accent={statusCounts.Degraded + statusCounts.Down > 0 ? 'red' : 'slate'} />
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          <NavBtn icon={Activity} active={section === 'overview'} onClick={() => setSection('overview')}>Availability</NavBtn>
          <NavBtn icon={LayoutGrid} active={section === 'catalog'} onClick={() => setSection('catalog')}>Service Catalog</NavBtn>
          <NavBtn icon={History} active={section === 'changes'} onClick={() => setSection('changes')}>Change Log</NavBtn>
          <NavBtn icon={Mail} active={section === 'support'} onClick={() => setSection('support')}>Request Support</NavBtn>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {section === 'overview' && <OverviewSection services={activeServices} getTypeName={getTypeName} />}

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

function OverallStatusBadge({ status }: { status: OperationalStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <div className={`inline-flex items-center gap-3 bg-white/10 backdrop-blur rounded-xl px-5 py-3 border border-white/10`}>
      <div className="relative">
        <span className={`block w-3 h-3 rounded-full ${meta.dot}`}></span>
        <span className={`absolute inset-0 rounded-full ${meta.dot} opacity-50 animate-ping`}></span>
      </div>
      <div>
        <div className="text-xs text-slate-300 uppercase tracking-wider">Overall Status</div>
        <div className="text-lg font-semibold flex items-center gap-2">
          <Icon className="w-4 h-4" />
          {meta.label}
        </div>
      </div>
    </div>
  );
}

function KpiCard({ label, value, accent = 'slate' }: { label: string; value: number; accent?: string }) {
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

/* ---------- Overview (Availability) ---------- */

function OverviewSection({ services, getTypeName }: { services: Service[]; getTypeName: (id: string) => string }) {
  if (services.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
        No active services configured.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-600" /> Service Availability
        </h2>
        <p className="text-xs text-gray-500">Real-time operational status of your services</p>
      </div>
      {services.map(s => {
        const st = (s.operational_status || 'Operational') as OperationalStatus;
        const meta = STATUS_META[st];
        const Icon = meta.icon;
        return (
          <div key={s.id} className={`bg-white rounded-xl border ${meta.border} shadow-sm px-5 py-4 flex items-center gap-4`}>
            <span className={`w-3 h-3 rounded-full ${meta.dot} flex-shrink-0`}></span>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-gray-900">{s.business_name || s.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">{getTypeName(s.service_type_id)}{s.sla_level ? ` · SLA: ${s.sla_level}` : ''}</div>
            </div>
            <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${meta.bg} ${meta.color}`}>
              <Icon className="w-3.5 h-3.5" />
              {meta.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Catalog (ISO 20000 service sheets) ---------- */

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
  const grouped = useMemo(() => {
    const byProject = new Map<string, { project: Project | null; items: Service[] }>();
    byProject.set('__none__', { project: null, items: [] });
    projects.forEach(p => byProject.set(p.id, { project: p, items: [] }));
    services.forEach(s => {
      const key = s.project_id && byProject.has(s.project_id) ? s.project_id : '__none__';
      byProject.get(key)!.items.push(s);
    });
    return Array.from(byProject.values()).filter(g => g.items.length > 0);
  }, [services, projects]);

  if (services.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
        No services in your catalog.
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {grouped.map(({ project, items }) => (
        <section key={project?.id || 'none'}>
          <div className="flex items-center gap-2 mb-4">
            <FolderOpen className="w-4 h-4 text-blue-600" />
            <h2 className="text-base font-semibold text-gray-900">{project?.name || 'Standalone Services'}</h2>
            {project?.status && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-medium">{project.status}</span>
            )}
          </div>
          {project?.description && <p className="text-sm text-gray-600 mb-4 -mt-2">{project.description}</p>}
          <div className="space-y-4">
            {items.map(s => (
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
      ))}
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
  const st = (service.operational_status || 'Operational') as OperationalStatus;
  const meta = STATUS_META[st];
  const title = service.business_name || service.name;
  const desc = service.business_description || service.description;

  return (
    <article className={`bg-white rounded-xl border shadow-sm overflow-hidden ${meta.border}`}>
      <div className="px-6 py-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`p-2 rounded-lg ${meta.bg}`}>
              <Server className={`w-5 h-5 ${meta.color}`} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-gray-900 text-lg">{title}</h3>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <span className="text-xs text-gray-500">{typeName}</span>
                {service.sla_level && (
                  <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full font-medium">SLA: {service.sla_level}</span>
                )}
              </div>
              {desc && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{desc}</p>}
            </div>
          </div>
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${meta.bg} ${meta.color} whitespace-nowrap`}>
            <span className={`w-2 h-2 rounded-full ${meta.dot}`}></span>
            {meta.label}
          </div>
        </div>

        {/* Includes / Excludes / Responsibilities */}
        {(service.includes?.length || service.excludes?.length || service.client_responsibilities?.length) ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
            <ListCard title="Includes" icon={Check} color="emerald" items={service.includes || []} />
            <ListCard title="Not Included" icon={MinusCircle} color="slate" items={service.excludes || []} />
            <ListCard title="Client Responsibilities" icon={Info} color="blue" items={service.client_responsibilities || []} />
          </div>
        ) : null}

        <button onClick={onToggle}
          className="mt-5 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Technical details
        </button>
      </div>

      {expanded && <TechnicalDetails service={service} />}
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
  return (
    <div className="bg-slate-50 border-t border-gray-100 px-6 py-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <Field icon={Activity} label="Billing" value={`${service.price} ${service.currency} / ${service.billing_cycle}`} />
        {service.next_renewal_date && (
          <Field icon={Calendar} label="Next Renewal" value={new Date(service.next_renewal_date).toLocaleDateString()} />
        )}
        {service.provider && <Field icon={Globe} label="Provider" value={service.provider} />}
        {service.location && <Field icon={MapPin} label="Location" value={service.location} />}
        {service.confirmed_hours_monthly != null && (
          <Field icon={Clock} label="Monthly Hours" value={`${service.confirmed_hours_monthly}h`} />
        )}
        {service.infrastructure_type && (
          <Field icon={Shield} label="Infrastructure" value={service.infrastructure_type} />
        )}
        {service.cloud_provider && <Field icon={Globe} label="Cloud" value={service.cloud_provider} />}
        {service.cloud_account_payer && <Field icon={FileText} label="Cloud Payer" value={service.cloud_account_payer} />}
      </div>

      {(specs.cpu || specs.ram || specs.storage || specs.bandwidth) && (
        <div className="mt-4 pt-4 border-t border-gray-200 flex flex-wrap gap-2">
          {specs.cpu && <Spec icon={Cpu} label={specs.cpu} />}
          {specs.ram && <Spec icon={Server} label={`${specs.ram} RAM`} />}
          {specs.storage && <Spec icon={HardDrive} label={specs.storage} />}
          {specs.bandwidth && <Spec icon={Wifi} label={specs.bandwidth} />}
        </div>
      )}

      {service.managed_roles && service.managed_roles.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Managed Roles</div>
          <div className="flex flex-wrap gap-2">
            {(service.managed_roles as ManagedRole[]).map(r => (
              <span key={r} className="text-xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full font-medium border border-teal-100">{r}</span>
            ))}
          </div>
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

function Spec({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-sm bg-white border border-gray-200 px-3 py-1.5 rounded-lg">
      <Icon className="w-3.5 h-3.5 text-gray-500" />
      <span className="text-gray-700">{label}</span>
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
