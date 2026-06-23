import { useState, useEffect } from 'react';
import { Users, Server, DollarSign, AlertCircle, Plus, LogOut, Upload, FolderOpen, CreditCard, Rocket, FileText, Activity, Database, Settings, Clock, CheckCircle2, AlertTriangle, Wrench, XCircle } from 'lucide-react';
import { supabase, Client, Service, Project, ServiceType } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ClientList } from './ClientList';
import { ServiceList } from './ServiceList';
import { ProjectList } from './ProjectList';
import { AddClientModal } from './AddClientModal';
import { AddServiceModal } from './AddServiceModal';
import { AddProjectModal } from './AddProjectModal';
import { ImportModal } from './ImportModal';
import { PaymentsView } from './PaymentsView';
import { RoadmapManager } from './RoadmapManager';
import { LicenseManager } from './LicenseManager';
import { TelemetryDashboard } from './TelemetryDashboard';
import { DataExportImport } from './DataExportImport';
import { SettingsPanel } from './SettingsPanel';
import { SupportHoursManager } from './SupportHoursManager';

type Stats = {
  totalClients: number;
  activeClients: number;
  totalServices: number;
  activeServices: number;
  monthlyRevenue: number;
  expiringServices: number;
};

export function Dashboard() {
  const { signOut } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'clients' | 'projects' | 'services' | 'payments' | 'licenses' | 'roadmap' | 'hours' | 'telemetry' | 'data' | 'settings'>('dashboard');
  const [stats, setStats] = useState<Stats>({
    totalClients: 0,
    activeClients: 0,
    totalServices: 0,
    activeServices: 0,
    monthlyRevenue: 0,
    expiringServices: 0,
  });
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [, setLoading] = useState(true);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const { data: clientsData } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });

    const { data: servicesData } = await supabase
      .from('services')
      .select('*')
      .order('created_at', { ascending: false });

    const { data: projectsData } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false });

    const { data: typesData } = await supabase
      .from('service_types')
      .select('*')
      .order('name');

    const clients = clientsData || [];
    const services = servicesData || [];

    setClients(clients);
    setServices(services);
    setProjects(projectsData || []);
    setServiceTypes(typesData || []);

    const activeClients = clients.filter(c => c.status === 'Active').length;
    const activeServices = services.filter(s => s.status === 'Active').length;

    const revenueTypeIds = new Set((typesData || []).filter(t => t.is_revenue).map(t => t.id));
    const monthlyRevenue = services
      .filter(s => s.status === 'Active' && revenueTypeIds.has(s.service_type_id))
      .reduce((sum, s) => {
        const months = s.billing_cycle === 'Monthly' ? 1 :
                       s.billing_cycle === 'Quarterly' ? 3 :
                       s.billing_cycle === 'Semi-Annually' ? 6 :
                       s.billing_cycle === 'Annually' ? 12 :
                       s.billing_cycle === 'Biennially' ? 24 : 0;
        if (months === 0) return sum;
        const hours = s.confirmed_hours_monthly;
        const perMonth = (hours && hours > 0) ? s.price * hours : s.price / months;
        return sum + perMonth;
      }, 0);

    const today = new Date();
    const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringServices = services.filter(s => {
      if (!s.next_renewal_date || s.status !== 'Active') return false;
      const renewalDate = new Date(s.next_renewal_date);
      return renewalDate >= today && renewalDate <= thirtyDaysFromNow;
    }).length;

    setStats({
      totalClients: clients.length,
      activeClients,
      totalServices: services.length,
      activeServices,
      monthlyRevenue,
      expiringServices,
    });

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleClientAdded = () => {
    fetchData();
    setShowAddClient(false);
  };

  const handleServiceAdded = () => {
    fetchData();
    setShowAddService(false);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="bg-blue-600 p-2 rounded-lg">
                <Server className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gray-900">Client Manager</h1>
            </div>
            <button
              onClick={() => signOut()}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <LogOut className="w-5 h-5" />
              Sign Out
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-4 mb-8 border-b border-gray-200 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'dashboard'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('clients')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'clients'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Clients
          </button>
          <button
            onClick={() => setActiveTab('projects')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'projects'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Projects
          </button>
          <button
            onClick={() => setActiveTab('services')}
            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'services'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            Services
          </button>
          <button
            onClick={() => setActiveTab('payments')}
            className={`flex items-center gap-1.5 px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'payments'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <CreditCard className="w-4 h-4" />
            Payments
          </button>
          <button
            onClick={() => setActiveTab('licenses')}
            className={`flex items-center gap-1.5 px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'licenses'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <FileText className="w-4 h-4" />
            Licenses
          </button>
          <button
            onClick={() => setActiveTab('roadmap')}
            className={`flex items-center gap-1.5 px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'roadmap'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Rocket className="w-4 h-4" />
            Roadmap
          </button>
          <button
            onClick={() => setActiveTab('hours')}
            className={`flex items-center gap-1.5 px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'hours'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Clock className="w-4 h-4" />
            Hours
          </button>
          <button
            onClick={() => setActiveTab('telemetry')}
            className={`flex items-center gap-1.5 px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'telemetry'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Activity className="w-4 h-4" />
            Telemetry
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-1.5 px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'data'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Database className="w-4 h-4" />
            Data
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-1.5 px-4 py-2 font-medium border-b-2 transition-colors ${
              activeTab === 'settings'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>

        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-blue-100 p-3 rounded-lg">
                    <Users className="w-6 h-6 text-blue-600" />
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{stats.activeClients}</div>
                    <div className="text-sm text-gray-600">of {stats.totalClients}</div>
                  </div>
                </div>
                <h3 className="text-sm font-medium text-gray-700">Active Clients</h3>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-green-100 p-3 rounded-lg">
                    <Server className="w-6 h-6 text-green-600" />
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">{stats.activeServices}</div>
                    <div className="text-sm text-gray-600">of {stats.totalServices}</div>
                  </div>
                </div>
                <h3 className="text-sm font-medium text-gray-700">Active Services</h3>
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="bg-emerald-100 p-3 rounded-lg">
                    <DollarSign className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-gray-900">
                      ${stats.monthlyRevenue.toFixed(2)}
                    </div>
                    <div className="text-sm text-gray-600">per month</div>
                  </div>
                </div>
                <h3 className="text-sm font-medium text-gray-700">Monthly Revenue</h3>
              </div>
            </div>

            {stats.expiringServices > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
                <div className="flex items-start gap-4">
                  <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-amber-900 mb-1">
                      {stats.expiringServices} Service{stats.expiringServices !== 1 ? 's' : ''} Expiring Soon
                    </h3>
                    <p className="text-sm text-amber-800">
                      You have services that will expire within the next 30 days. Review them in the Services tab.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Operational Status Overview */}
            {services.filter(s => s.status === 'Active').length > 0 && (
              <OperationalStatusPanel services={services} clients={clients} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Recent Clients</h3>
                  <button
                    onClick={() => setShowAddClient(true)}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    View All
                  </button>
                </div>
                {clients.slice(0, 5).map(client => (
                  <div key={client.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                    <div>
                      <div className="font-medium text-gray-900">{client.company_name}</div>
                      <div className="text-sm text-gray-600">{client.contact_name}</div>
                    </div>
                    <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                      client.status === 'Active' ? 'bg-green-100 text-green-800' :
                      client.status === 'Inactive' ? 'bg-gray-100 text-gray-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {client.status}
                    </span>
                  </div>
                ))}
                {clients.length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-4">No clients yet</p>
                )}
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Recent Services</h3>
                  <button
                    onClick={() => setShowAddService(true)}
                    className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                  >
                    View All
                  </button>
                </div>
                {services.slice(0, 5).map(service => (
                  <div key={service.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                    <div>
                      <div className="font-medium text-gray-900">{service.name}</div>
                      <div className="text-sm text-gray-600">
                        ${service.price} / {service.billing_cycle}
                      </div>
                    </div>
                    <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                      service.status === 'Active' ? 'bg-green-100 text-green-800' :
                      service.status === 'Suspended' ? 'bg-red-100 text-red-800' :
                      service.status === 'Cancelled' ? 'bg-gray-100 text-gray-800' :
                      'bg-yellow-100 text-yellow-800'
                    }`}>
                      {service.status}
                    </span>
                  </div>
                ))}
                {services.length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-4">No services yet</p>
                )}
              </div>
            </div>

            {services.filter(s => s.status === 'Active').length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h3 className="text-lg font-semibold text-gray-900">Infrastructure Overview</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Quick reference for IPs, providers, and domains across active services.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Service</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Client</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">IP</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Provider</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Domain / Proxy</th>
                        <th className="text-left px-4 py-2.5 font-medium text-gray-600">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {services.filter(s => s.status === 'Active').map(svc => {
                        const client = clients.find(c => c.id === svc.client_id);
                        return (
                          <tr key={svc.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-gray-900">{svc.business_name || svc.name}</div>
                            </td>
                            <td className="px-4 py-2.5 text-gray-600">{client?.company_name || '--'}</td>
                            <td className="px-4 py-2.5">
                              {svc.server_ip ? (
                                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded font-mono text-gray-800">{svc.server_ip}</code>
                              ) : <span className="text-gray-400">--</span>}
                            </td>
                            <td className="px-4 py-2.5 text-gray-600">{svc.provider || svc.cloud_provider || '--'}</td>
                            <td className="px-4 py-2.5">
                              {svc.reverse_proxy_domain ? (
                                <code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-mono">{svc.reverse_proxy_domain}</code>
                              ) : <span className="text-gray-400">--</span>}
                            </td>
                            <td className="px-4 py-2.5">
                              {svc.infrastructure_type ? (
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  svc.infrastructure_type === 'Cloud' ? 'bg-sky-50 text-sky-700' :
                                  svc.infrastructure_type === 'Physical' ? 'bg-orange-50 text-orange-700' :
                                  'bg-teal-50 text-teal-700'
                                }`}>{svc.infrastructure_type}</span>
                              ) : <span className="text-gray-400">--</span>}
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
        )}

        {activeTab === 'clients' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Clients</h2>
              <button
                onClick={() => setShowAddClient(true)}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
              >
                <Plus className="w-5 h-5" />
                Add Client
              </button>
            </div>
            <ClientList clients={clients} services={services} onUpdate={fetchData} />
          </div>
        )}

        {activeTab === 'projects' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Projects</h2>
              {clients.length > 0 && (
                <button
                  onClick={() => setShowAddProject(true)}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  <FolderOpen className="w-5 h-5" />
                  New Project
                </button>
              )}
            </div>
            <ProjectList projects={projects} clients={clients} services={services} serviceTypes={serviceTypes} onUpdate={fetchData} />
          </div>
        )}

        {activeTab === 'services' && (
          <div>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Services</h2>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowImport(true)}
                  className="flex items-center gap-2 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 px-4 py-2 rounded-lg transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  Import CSV
                </button>
                <button
                  onClick={() => setShowAddService(true)}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  Add Service
                </button>
              </div>
            </div>
            <ServiceList services={services} clients={clients} projects={projects} onUpdate={fetchData} />
          </div>
        )}

        {activeTab === 'payments' && (
          <PaymentsView services={services} clients={clients} />
        )}

        {activeTab === 'licenses' && (
          <LicenseManager clients={clients} services={services} />
        )}

        {activeTab === 'roadmap' && (
          <RoadmapManager clients={clients} services={services} />
        )}

        {activeTab === 'hours' && (
          <SupportHoursManager clients={clients} services={services} />
        )}

        {activeTab === 'telemetry' && (
          <TelemetryDashboard services={services} clients={clients} />
        )}

        {activeTab === 'data' && (
          <DataExportImport clients={clients} services={services} onRefresh={fetchData} />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel />
        )}
      </div>

      {showAddClient && (
        <AddClientModal onClose={() => setShowAddClient(false)} onSuccess={handleClientAdded} />
      )}

      {showAddService && (
        <AddServiceModal onClose={() => setShowAddService(false)} onSuccess={handleServiceAdded} clients={clients} projects={projects} />
      )}

      {showAddProject && (
        <AddProjectModal
          clients={clients}
          onClose={() => setShowAddProject(false)}
          onSuccess={() => { setShowAddProject(false); fetchData(); }}
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onSuccess={() => { setShowImport(false); fetchData(); }}
          clients={clients}
        />
      )}
    </div>
  );
}

function OperationalStatusPanel({ services, clients }: { services: Service[]; clients: Client[] }) {
  const [filter, setFilter] = useState<'all' | 'issues' | 'monitored'>('all');

  const active = services.filter(s => s.status === 'Active');

  const categorized = {
    operational: active.filter(s => s.operational_status === 'Operational'),
    maintenance: active.filter(s => s.operational_status === 'Maintenance'),
    degraded: active.filter(s => s.operational_status === 'Degraded'),
    down: active.filter(s => s.operational_status === 'Down'),
    unset: active.filter(s => !s.operational_status),
  };

  const issueCount = categorized.maintenance.length + categorized.degraded.length + categorized.down.length;
  const monitoredCount = active.filter(s => s.uptime_badge_url).length;

  const displayed = filter === 'issues'
    ? [...categorized.down, ...categorized.degraded, ...categorized.maintenance]
    : filter === 'monitored'
    ? active.filter(s => s.uptime_badge_url)
    : active;

  const getClientName = (clientId: string) => clients.find(c => c.id === clientId)?.company_name || '';

  const statusMeta = (s: Service) => {
    switch (s.operational_status) {
      case 'Operational': return { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Operational' };
      case 'Maintenance': return { icon: Wrench, color: 'text-blue-600', bg: 'bg-blue-50', label: 'Maintenance' };
      case 'Degraded': return { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', label: 'Degraded' };
      case 'Down': return { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50', label: 'Down' };
      default: return { icon: Server, color: 'text-gray-400', bg: 'bg-gray-50', label: 'Not Set' };
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Operational Status</h3>
          <p className="text-xs text-gray-500 mt-0.5">Service health overview across all clients</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> {categorized.operational.length}</span>
            <span className="flex items-center gap-1"><Wrench className="w-3.5 h-3.5 text-blue-600" /> {categorized.maintenance.length}</span>
            <span className="flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> {categorized.degraded.length}</span>
            <span className="flex items-center gap-1"><XCircle className="w-3.5 h-3.5 text-red-600" /> {categorized.down.length}</span>
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-xs font-medium">
            <button onClick={() => setFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-colors ${filter === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
              All ({active.length})
            </button>
            {issueCount > 0 && (
              <button onClick={() => setFilter('issues')}
                className={`px-2.5 py-1 rounded-md transition-colors ${filter === 'issues' ? 'bg-white text-red-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                Issues ({issueCount})
              </button>
            )}
            {monitoredCount > 0 && (
              <button onClick={() => setFilter('monitored')}
                className={`px-2.5 py-1 rounded-md transition-colors ${filter === 'monitored' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                Monitored ({monitoredCount})
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
        {displayed.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500">No services match this filter.</div>
        ) : displayed.map(svc => {
          const meta = statusMeta(svc);
          const Icon = meta.icon;
          return (
            <div key={svc.id} className="px-6 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors">
              <div className={`p-1.5 rounded-md ${meta.bg}`}>
                <Icon className={`w-4 h-4 ${meta.color}`} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate">{svc.business_name || svc.name}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                </div>
                <span className="text-xs text-gray-500">{getClientName(svc.client_id)}</span>
              </div>
              {svc.uptime_badge_url && (
                <img src={svc.uptime_badge_url} alt="uptime" className="h-5" loading="lazy" />
              )}
              {svc.uptime_status_url && (
                <a href={svc.uptime_status_url} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap">
                  Live
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
