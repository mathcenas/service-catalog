import { useState, useEffect } from 'react';
import { Server, Globe, Calendar, DollarSign, Cpu, HardDrive, Wifi, Clock, MapPin, Shield } from 'lucide-react';
import { supabase, Client, Service, ServiceType, ManagedRole } from '../lib/supabase';

type Props = {
  token: string;
};

const INFRA_COLORS: Record<string, string> = {
  Cloud: 'bg-sky-100 text-sky-800',
  Physical: 'bg-stone-100 text-stone-800',
  'Managed Service': 'bg-teal-100 text-teal-800',
};

export function SharePage({ token }: Props) {
  const [client, setClient] = useState<Client | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: tokenRow } = await supabase
        .from('client_share_tokens')
        .select('*')
        .eq('token', token)
        .maybeSingle();

      if (!tokenRow) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const [{ data: clientData }, { data: servicesData }, { data: typesData }] = await Promise.all([
        supabase.from('clients').select('*').eq('id', tokenRow.client_id).maybeSingle(),
        supabase.from('services').select('*').eq('client_id', tokenRow.client_id).order('created_at'),
        supabase.from('service_types').select('*'),
      ]);

      if (!clientData) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setClient(clientData);
      setServices(servicesData || []);
      setServiceTypes(typesData || []);
      setLoading(false);
    };

    load();
  }, [token]);

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
          <h1 className="text-2xl font-bold text-white mb-2">Dashboard Not Found</h1>
          <p className="text-slate-400">This link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  const getTypeName = (id: string) => serviceTypes.find(t => t.id === id)?.name || 'Service';

  const activeServices = services.filter(s => s.status === 'Active');
  const today = new Date();
  const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const expiringSoon = activeServices.filter(s => {
    if (!s.next_renewal_date) return false;
    const d = new Date(s.next_renewal_date);
    return d >= today && d <= thirtyDays;
  });

  const monthlyRevenue = activeServices.reduce((sum, s) => {
    const m = s.billing_cycle === 'Monthly' ? 1 :
               s.billing_cycle === 'Quarterly' ? 1/3 :
               s.billing_cycle === 'Semi-Annually' ? 1/6 :
               s.billing_cycle === 'Annually' ? 1/12 :
               s.billing_cycle === 'Biennially' ? 1/24 : 0;
    return sum + (s.price * m);
  }, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="bg-blue-500 p-2 rounded-lg">
                  <Server className="w-5 h-5 text-white" />
                </div>
                <span className="text-slate-400 text-sm font-medium uppercase tracking-wider">Service Dashboard</span>
              </div>
              <h1 className="text-3xl font-bold">{client!.company_name}</h1>
              {client!.contact_name && (
                <p className="text-slate-400 mt-1">{client!.contact_name}</p>
              )}
            </div>
            <div className="text-right">
              <div className="text-slate-400 text-xs">Last updated</div>
              <div className="text-white text-sm">{new Date().toLocaleDateString()}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-8">
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Active Services</div>
              <div className="text-2xl font-bold">{activeServices.length}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4">
              <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Monthly Cost</div>
              <div className="text-2xl font-bold">${monthlyRevenue.toFixed(2)}</div>
            </div>
            <div className="bg-slate-800 rounded-lg p-4">
              <div className={`text-xs uppercase tracking-wider mb-1 ${expiringSoon.length > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                Expiring (30d)
              </div>
              <div className={`text-2xl font-bold ${expiringSoon.length > 0 ? 'text-amber-400' : ''}`}>
                {expiringSoon.length}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {services.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center text-gray-500">
            No services configured yet.
          </div>
        ) : (
          services.map(service => (
            <ServiceCard key={service.id} service={service} typeName={getTypeName(service.service_type_id)} />
          ))
        )}
      </main>

      <footer className="border-t border-gray-200 py-6 mt-8">
        <p className="text-center text-xs text-gray-400">
          This is a read-only client dashboard. Content is managed by your service provider.
        </p>
      </footer>
    </div>
  );
}

function ServiceCard({ service, typeName }: { service: Service; typeName: string }) {
  const isExpiring = (() => {
    if (!service.next_renewal_date || service.status !== 'Active') return false;
    const d = new Date(service.next_renewal_date);
    const today = new Date();
    const thirtyDays = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    return d >= today && d <= thirtyDays;
  })();

  const infraType = service.infrastructure_type || 'Cloud';

  return (
    <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${isExpiring ? 'border-amber-300' : 'border-gray-200'}`}>
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <Server className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">{service.name}</h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-gray-500">{typeName}</span>
                <span className="text-gray-300">·</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${INFRA_COLORS[infraType] || 'bg-gray-100 text-gray-700'}`}>
                  {infraType}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isExpiring && (
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded-full font-medium">
                Renews soon
              </span>
            )}
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${
              service.status === 'Active' ? 'bg-green-100 text-green-800' :
              service.status === 'Suspended' ? 'bg-red-100 text-red-800' :
              service.status === 'Cancelled' ? 'bg-gray-100 text-gray-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {service.status}
            </span>
          </div>
        </div>
      </div>

      <div className="px-6 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
              <DollarSign className="w-3 h-3" /> Billing
            </div>
            <div className="text-sm font-medium text-gray-900">
              {service.price} {service.currency} / {service.billing_cycle}
            </div>
          </div>

          {service.next_renewal_date && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                <Calendar className="w-3 h-3" /> Next Renewal
              </div>
              <div className={`text-sm font-medium ${isExpiring ? 'text-amber-600' : 'text-gray-900'}`}>
                {new Date(service.next_renewal_date).toLocaleDateString()}
              </div>
            </div>
          )}

          {service.provider && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                <Globe className="w-3 h-3" /> Provider
              </div>
              <div className="text-sm font-medium text-gray-900">{service.provider}</div>
            </div>
          )}

          {service.location && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                <MapPin className="w-3 h-3" /> Location
              </div>
              <div className="text-sm font-medium text-gray-900">{service.location}</div>
            </div>
          )}

          {service.confirmed_hours_monthly != null && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                <Clock className="w-3 h-3" /> Monthly Hours
              </div>
              <div className="text-sm font-medium text-gray-900">{service.confirmed_hours_monthly}h</div>
            </div>
          )}

          {service.cloud_account_payer && (
            <div>
              <div className="flex items-center gap-1.5 text-gray-500 text-xs mb-1">
                <Shield className="w-3 h-3" /> Cloud Payer
              </div>
              <div className="text-sm font-medium text-gray-900">{service.cloud_account_payer}</div>
            </div>
          )}
        </div>

        {service.specifications && Object.keys(service.specifications).length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-3">
            {service.specifications.cpu && (
              <div className="flex items-center gap-1.5 text-sm bg-gray-50 px-3 py-1.5 rounded-lg">
                <Cpu className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-gray-700">{service.specifications.cpu}</span>
              </div>
            )}
            {service.specifications.ram && (
              <div className="flex items-center gap-1.5 text-sm bg-gray-50 px-3 py-1.5 rounded-lg">
                <Server className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-gray-700">{service.specifications.ram} RAM</span>
              </div>
            )}
            {service.specifications.storage && (
              <div className="flex items-center gap-1.5 text-sm bg-gray-50 px-3 py-1.5 rounded-lg">
                <HardDrive className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-gray-700">{service.specifications.storage}</span>
              </div>
            )}
            {service.specifications.bandwidth && (
              <div className="flex items-center gap-1.5 text-sm bg-gray-50 px-3 py-1.5 rounded-lg">
                <Wifi className="w-3.5 h-3.5 text-gray-500" />
                <span className="text-gray-700">{service.specifications.bandwidth}</span>
              </div>
            )}
          </div>
        )}

        {service.managed_roles && service.managed_roles.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="text-xs text-gray-500 mb-2">Managed Roles</div>
            <div className="flex flex-wrap gap-2">
              {(service.managed_roles as ManagedRole[]).map(role => (
                <span key={role} className="text-xs bg-teal-50 text-teal-700 px-2.5 py-1 rounded-full font-medium border border-teal-100">
                  {role}
                </span>
              ))}
            </div>
          </div>
        )}

        {service.description && (
          <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600">
            {service.description}
          </div>
        )}
      </div>
    </div>
  );
}
