import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { Client, ServiceType, Project, MANAGED_ROLES, ManagedRole, OPERATIONAL_STATUSES, OperationalStatus, PAID_BY_OPTIONS, PaidBy, supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { DynamicServiceFields } from './DynamicServiceFields';
import { getFieldsForType, COLUMN_FIELD_KEYS, EXCLUDED_SERVICE_TYPE_NAMES } from '../lib/serviceFields';

type Props = {
  onClose: () => void;
  onSuccess: () => void;
  clients: Client[];
  projects: Project[];
};

export function AddServiceModal({ onClose, onSuccess, clients, projects }: Props) {
  const { user } = useAuth();
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [formData, setFormData] = useState({
    client_id: '',
    project_id: '',
    service_type_id: '',
    name: '',
    description: '',
    status: 'Active' as 'Active' | 'Suspended' | 'Cancelled' | 'Pending',
    price: '',
    currency: 'USD',
    billing_cycle: 'Monthly' as 'Monthly' | 'Quarterly' | 'Semi-Annually' | 'Annually' | 'Biennially' | 'One-Time',
    next_renewal_date: '',
    confirmed_hours_monthly: '',
    business_name: '',
    business_description: '',
    sla_level: '',
    operational_status: 'Operational' as OperationalStatus,
    includes: '',
    excludes: '',
    client_responsibilities: '',
    uptime_badge_url: '',
    uptime_status_url: '',
    rto: '',
    rpo: '',
    maintenance_window: '',
    paid_by: '' as '' | PaidBy,
    payment_card_last4: '',
  });
  const [typeValues, setTypeValues] = useState<Record<string, any>>({});
  const [selectedRoles, setSelectedRoles] = useState<ManagedRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchServiceTypes = async () => {
      const { data } = await supabase.from('service_types').select('*').order('name');
      setServiceTypes((data || []).filter(t => !EXCLUDED_SERVICE_TYPE_NAMES.has(t.name)));
    };
    fetchServiceTypes();
  }, []);

  const currentTypeName = useMemo(
    () => serviceTypes.find(t => t.id === formData.service_type_id)?.name,
    [serviceTypes, formData.service_type_id]
  );

  const toggleRole = (role: ManagedRole) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const fields = getFieldsForType(currentTypeName);
    const columnUpdates: Record<string, any> = {};
    const specifications: Record<string, any> = {};
    for (const field of fields) {
      const raw = typeValues[field.key];
      if (raw === undefined || raw === '' || raw === null) continue;
      const value = field.kind === 'number' ? Number(raw) : raw;
      if (field.storage === 'column' && COLUMN_FIELD_KEYS.has(field.key)) {
        columnUpdates[field.key] = value;
      } else {
        specifications[field.key] = value;
      }
    }

    const { error: insertError } = await supabase.from('services').insert({
      user_id: user!.id,
      client_id: formData.client_id,
      project_id: formData.project_id || null,
      service_type_id: formData.service_type_id,
      name: formData.name,
      description: formData.description || null,
      status: formData.status,
      price: parseFloat(formData.price) || 0,
      currency: formData.currency,
      billing_cycle: formData.billing_cycle,
      next_renewal_date: formData.next_renewal_date || null,
      confirmed_hours_monthly: formData.confirmed_hours_monthly ? parseFloat(formData.confirmed_hours_monthly) : null,
      provider: columnUpdates.provider ?? null,
      server_ip: columnUpdates.server_ip ?? null,
      login_url: columnUpdates.login_url ?? null,
      reverse_proxy_domain: columnUpdates.reverse_proxy_domain ?? null,
      location: columnUpdates.location ?? null,
      cloud_provider: columnUpdates.cloud_provider ?? null,
      cloud_account_payer: columnUpdates.cloud_account_payer ?? null,
      managed_roles: currentTypeName === 'Managed Service' && selectedRoles.length > 0 ? selectedRoles : null,
      specifications: Object.keys(specifications).length > 0 ? specifications : null,
      business_name: formData.business_name || null,
      business_description: formData.business_description || null,
      sla_level: formData.sla_level || null,
      operational_status: formData.operational_status,
      includes: splitLines(formData.includes),
      excludes: splitLines(formData.excludes),
      client_responsibilities: splitLines(formData.client_responsibilities),
      uptime_badge_url: formData.uptime_badge_url || null,
      uptime_status_url: formData.uptime_status_url || null,
      rto: formData.rto || null,
      rpo: formData.rpo || null,
      maintenance_window: formData.maintenance_window || null,
      paid_by: formData.paid_by || null,
      payment_card_last4: formData.payment_card_last4 ? formData.payment_card_last4.slice(-4) : null,
    });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setLoading(false);
    onSuccess();
  };

  const set = (key: string, value: any) => setFormData(prev => ({ ...prev, [key]: value }));
  const setType = (key: string, value: any) => setTypeValues(prev => ({ ...prev, [key]: value }));

  const splitLines = (text: string): string[] =>
    text.split('\n').map(s => s.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">Add New Service</h2>
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
              <select value={formData.client_id} onChange={e => { set('client_id', e.target.value); set('project_id', ''); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required>
                <option value="">Select a client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Project</label>
              <select value={formData.project_id} onChange={e => set('project_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                <option value="">No project</option>
                {projects.filter(p => p.client_id === formData.client_id).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Service Type *</label>
              <select value={formData.service_type_id} onChange={e => { set('service_type_id', e.target.value); setTypeValues({}); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" required>
                <option value="">Select a type</option>
                {serviceTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Service Name *</label>
              <input type="text" value={formData.name} onChange={e => set('name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                placeholder="e.g., Production Web Server" required />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-100">Client-Facing Service Sheet (ISO 20000)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Name</label>
                <input type="text" value={formData.business_name} onChange={e => set('business_name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="e.g., Data Continuity" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">SLA Level</label>
                <input type="text" value={formData.sla_level} onChange={e => set('sla_level', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="e.g., 99.9% Recoverability" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Description</label>
                <textarea value={formData.business_description} onChange={e => set('business_description', e.target.value)} rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                  placeholder="Plain-language description shown to the client (the value / risk mitigated)." />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Operational Status</label>
                <select value={formData.operational_status} onChange={e => set('operational_status', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                  {OPERATIONAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">RTO (Recovery Time)</label>
                <input type="text" value={formData.rto} onChange={e => set('rto', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="e.g., 4 hours" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">RPO (Data Recovery)</label>
                <input type="text" value={formData.rpo} onChange={e => set('rpo', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="e.g., 24 hours" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Maintenance Window</label>
                <input type="text" value={formData.maintenance_window} onChange={e => set('maintenance_window', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="e.g., Sundays 02:00-04:00 UTC" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">What's Included (one per line)</label>
                <textarea value={formData.includes} onChange={e => set('includes', e.target.value)} rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm"
                  placeholder={'Monthly preventive maintenance\n24/7 monitoring'} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">What's NOT Included</label>
                <textarea value={formData.excludes} onChange={e => set('excludes', e.target.value)} rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm"
                  placeholder={'Purchase of new licenses\nHardware replacement'} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Client Responsibilities</label>
                <textarea value={formData.client_responsibilities} onChange={e => set('client_responsibilities', e.target.value)} rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm"
                  placeholder={'Notify staff changes for VPN offboarding'} />
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="e.g., 40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Paid By</label>
                <select value={formData.paid_by} onChange={e => set('paid_by', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                  <option value="">Not set</option>
                  {PAID_BY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Card Last 4 Digits</label>
                <input type="text" inputMode="numeric" maxLength={4} pattern="[0-9]{4}"
                  value={formData.payment_card_last4}
                  onChange={e => set('payment_card_last4', e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono"
                  placeholder="1234" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-100">
              {currentTypeName ? `${currentTypeName} Details` : 'Type-Specific Details'}
            </h3>
            <DynamicServiceFields typeName={currentTypeName} values={typeValues} onChange={setType} />
          </div>

          {currentTypeName === 'Managed Service' && (
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
            <h3 className="text-sm font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-100">
              Live Uptime (Uptime Kuma)
            </h3>
            <p className="text-xs text-gray-500 mb-3">
              Paste the badge image URL from Uptime Kuma. The client portal will render the live badge and, optionally, link to the public status page.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Badge Image URL</label>
                <input type="url" value={formData.uptime_badge_url} onChange={e => set('uptime_badge_url', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="https://status.example.com/api/badge/1/uptime/24" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Public Status Page URL</label>
                <input type="url" value={formData.uptime_status_url} onChange={e => set('uptime_status_url', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  placeholder="https://status.example.com/status/main" />
              </div>
            </div>
            {formData.uptime_badge_url && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs text-gray-500">Preview:</span>
                <img src={formData.uptime_badge_url} alt="Uptime badge preview" className="h-5" />
              </div>
            )}
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
              {loading ? 'Adding...' : 'Add Service'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
