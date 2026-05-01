import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Service, Client, ServiceType, MANAGED_ROLES, ManagedRole, supabase } from '../lib/supabase';

type Props = {
  service: Service;
  clients: Client[];
  onClose: () => void;
  onSuccess: () => void;
};

const CLOUD_PROVIDERS = ['AWS', 'Azure', 'GCP', 'DigitalOcean', 'Linode', 'Vultr', 'Hetzner', 'OVH', 'Other'];

export function EditServiceModal({ service, clients, onClose, onSuccess }: Props) {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [formData, setFormData] = useState({
    client_id: service.client_id,
    service_type_id: service.service_type_id,
    name: service.name,
    description: service.description || '',
    status: service.status,
    price: service.price.toString(),
    currency: service.currency,
    billing_cycle: service.billing_cycle,
    next_renewal_date: service.next_renewal_date || '',
    provider: service.provider || '',
    server_ip: service.server_ip || '',
    login_url: service.login_url || '',
    infrastructure_type: (service.infrastructure_type || 'Cloud') as 'Cloud' | 'Physical' | 'Managed Service',
    cloud_provider: service.cloud_provider || '',
    cloud_account_payer: service.cloud_account_payer || '',
    confirmed_hours_monthly: service.confirmed_hours_monthly?.toString() || '',
    location: service.location || '',
    cpu: service.specifications?.cpu || '',
    ram: service.specifications?.ram || '',
    storage: service.specifications?.storage || '',
    bandwidth: service.specifications?.bandwidth || '',
  });
  const [selectedRoles, setSelectedRoles] = useState<ManagedRole[]>(
    (service.managed_roles as ManagedRole[]) || []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchServiceTypes = async () => {
      const { data } = await supabase.from('service_types').select('*').order('name');
      setServiceTypes(data || []);
    };
    fetchServiceTypes();
  }, []);

  const toggleRole = (role: ManagedRole) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const specifications: Record<string, any> = {};
    if (formData.cpu) specifications.cpu = formData.cpu;
    if (formData.ram) specifications.ram = formData.ram;
    if (formData.storage) specifications.storage = formData.storage;
    if (formData.bandwidth) specifications.bandwidth = formData.bandwidth;

    const { error: updateError } = await supabase
      .from('services')
      .update({
        client_id: formData.client_id,
        service_type_id: formData.service_type_id,
        name: formData.name,
        description: formData.description || null,
        status: formData.status,
        price: parseFloat(formData.price) || 0,
        currency: formData.currency,
        billing_cycle: formData.billing_cycle,
        next_renewal_date: formData.next_renewal_date || null,
        provider: formData.provider || null,
        server_ip: formData.server_ip || null,
        login_url: formData.login_url || null,
        infrastructure_type: formData.infrastructure_type,
        cloud_provider: formData.cloud_provider || null,
        cloud_account_payer: formData.cloud_account_payer || null,
        confirmed_hours_monthly: formData.confirmed_hours_monthly ? parseFloat(formData.confirmed_hours_monthly) : null,
        location: formData.location || null,
        managed_roles: selectedRoles.length > 0 ? selectedRoles : null,
        specifications: Object.keys(specifications).length > 0 ? specifications : null,
      })
      .eq('id', service.id);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    onSuccess();
  };

  const set = (key: string, value: any) => setFormData(prev => ({ ...prev, [key]: value }));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Edit Service</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">{error}</div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Client *</label>
              <select value={formData.client_id} onChange={e => set('client_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required>
                <option value="">Select a client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Service Type *</label>
              <select value={formData.service_type_id} onChange={e => set('service_type_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required>
                <option value="">Select a type</option>
                {serviceTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Service Name *</label>
              <input type="text" value={formData.name} onChange={e => set('name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Infrastructure Type *</label>
              <div className="grid grid-cols-3 gap-2">
                {(['Cloud', 'Physical', 'Managed Service'] as const).map(type => (
                  <button key={type} type="button"
                    onClick={() => set('infrastructure_type', type)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      formData.infrastructure_type === type
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'border-gray-300 text-gray-700 hover:border-blue-400'
                    }`}>
                    {type}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-100">Billing</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Status *</label>
                <select value={formData.status} onChange={e => set('status', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                  <option value="Active">Active</option>
                  <option value="Suspended">Suspended</option>
                  <option value="Cancelled">Cancelled</option>
                  <option value="Pending">Pending</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Billing Cycle *</label>
                <select value={formData.billing_cycle} onChange={e => set('billing_cycle', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                  <option value="Monthly">Monthly</option>
                  <option value="Quarterly">Quarterly</option>
                  <option value="Semi-Annually">Semi-Annually</option>
                  <option value="Annually">Annually</option>
                  <option value="Biennially">Biennially</option>
                  <option value="One-Time">One-Time</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Price *</label>
                <div className="flex gap-2">
                  <input type="number" step="0.01" value={formData.price} onChange={e => set('price', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required />
                  <select value={formData.currency} onChange={e => set('currency', e.target.value)}
                    className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="CAD">CAD</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Next Renewal Date</label>
                <input type="date" value={formData.next_renewal_date} onChange={e => set('next_renewal_date', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirmed Hours / Month</label>
                <input type="number" step="0.5" value={formData.confirmed_hours_monthly} onChange={e => set('confirmed_hours_monthly', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-100">Infrastructure Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Provider / Vendor</label>
                <input type="text" value={formData.provider} onChange={e => set('provider', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Location / Datacenter</label>
                <input type="text" value={formData.location} onChange={e => set('location', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">IP Address</label>
                <input type="text" value={formData.server_ip} onChange={e => set('server_ip', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Login URL</label>
                <input type="url" value={formData.login_url} onChange={e => set('login_url', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
              {formData.infrastructure_type === 'Cloud' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Cloud Provider</label>
                    <select value={formData.cloud_provider} onChange={e => set('cloud_provider', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                      <option value="">Select provider</option>
                      {CLOUD_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Cloud Account Payer</label>
                    <input type="text" value={formData.cloud_account_payer} onChange={e => set('cloud_account_payer', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
                  </div>
                </>
              )}
            </div>
          </div>

          {formData.infrastructure_type === 'Managed Service' && (
            <div>
              <h3 className="text-sm font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-100">Managed Roles</h3>
              <div className="flex flex-wrap gap-2">
                {MANAGED_ROLES.map(role => (
                  <button key={role} type="button"
                    onClick={() => toggleRole(role)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      selectedRoles.includes(role)
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'border-gray-300 text-gray-700 hover:border-teal-400'
                    }`}>
                    {role}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-100">Specifications</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { key: 'cpu', label: 'CPU' },
                { key: 'ram', label: 'RAM' },
                { key: 'storage', label: 'Storage' },
                { key: 'bandwidth', label: 'Bandwidth' },
              ].map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
                  <input type="text" value={(formData as any)[key]} onChange={e => set(key, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description / Notes</label>
            <textarea value={formData.description} onChange={e => set('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none" />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
