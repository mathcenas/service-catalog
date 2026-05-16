import { useState, useEffect } from 'react';
import { Users, Server, DollarSign, AlertCircle, Plus, LogOut, Upload, FolderOpen, CreditCard, Rocket, FileText } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState<'dashboard' | 'clients' | 'projects' | 'services' | 'payments' | 'licenses' | 'roadmap'>('dashboard');
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
  const [loading, setLoading] = useState(true);
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
        <div className="flex gap-4 mb-8 border-b border-gray-200">
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
            <ClientList clients={clients} onUpdate={fetchData} />
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
          <RoadmapManager />
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
