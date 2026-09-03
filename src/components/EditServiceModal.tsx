import { useState, useEffect, useMemo } from 'react';
import { X, Copy, Check, RefreshCw } from 'lucide-react';
import { Service, Client, ServiceType, Project, MANAGED_ROLES, ManagedRole, OPERATIONAL_STATUSES, OperationalStatus, PAID_BY_OPTIONS, PaidBy, supabase } from '../lib/supabase';
import { DynamicServiceFields } from './DynamicServiceFields';
import { getFieldsForType, COLUMN_FIELD_KEYS, EXCLUDED_SERVICE_TYPE_NAMES } from '../lib/serviceFields';

type Props = {
  service: Service;
  clients: Client[];
  projects: Project[];
  onClose: () => void;
  onSuccess: () => void;
};

export function EditServiceModal({ service, clients, projects, onClose, onSuccess }: Props) {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([]);
  const [formData, setFormData] = useState({
    client_id: service.client_id,
    project_id: service.project_id || '',
    service_type_id: service.service_type_id,
    name: service.name,
    description: service.description || '',
    status: service.status,
    price: service.price.toString(),
    currency: service.currency,
    billing_cycle: service.billing_cycle,
    next_renewal_date: service.next_renewal_date || '',
    confirmed_hours_monthly: service.confirmed_hours_monthly?.toString() || '',
    infrastructure_cost: service.infrastructure_cost?.toString() || '',
    cloud_backup_enabled: service.cloud_backup_enabled ?? false,
    cloud_backup_retention_days: service.cloud_backup_retention_days?.toString() || '',
    telemetry_enabled: service.telemetry_enabled ?? true,
    business_name: service.business_name || '',
    business_description: service.business_description || '',
    sla_level: service.sla_level || '',
    operational_status: (service.operational_status || 'Operational') as OperationalStatus,
    includes: (service.includes || []).join('\n'),
    excludes: (service.excludes || []).join('\n'),
    client_responsibilities: (service.client_responsibilities || []).join('\n'),
    uptime_badge_url: service.uptime_badge_url || '',
    uptime_status_url: service.uptime_status_url || '',
    rto: service.rto || '',
    rpo: service.rpo || '',
    maintenance_window: service.maintenance_window || '',
    ip_internal: service.ip_internal || '',
    ip_public: service.ip_public || '',
    dns_record: service.dns_record || '',
    paid_by: (service.paid_by || '') as '' | PaidBy,
    payment_card_last4: service.payment_card_last4 || '',
  });

  const buildInitialTypeValues = (): Record<string, any> => {
    const values: Record<string, any> = {};
    const spec = service.specifications || {};
    const colVals: Record<string, any> = {
      provider: service.provider,
      server_ip: service.server_ip,
      login_url: service.login_url,
      reverse_proxy_domain: service.reverse_proxy_domain,
      location: service.location,
      cloud_provider: service.cloud_provider,
      cloud_account_payer: service.cloud_account_payer,
    };
    for (const [k, v] of Object.entries(spec)) {
      if (v !== null && v !== undefined) values[k] = v;
    }
    for (const [k, v] of Object.entries(colVals)) {
      if (v !== null && v !== undefined && v !== '') values[k] = v;
    }
    return values;
  };

  const [typeValues, setTypeValues] = useState<Record<string, any>>(buildInitialTypeValues());
  const [selectedRoles, setSelectedRoles] = useState<ManagedRole[]>(
    (service.managed_roles as ManagedRole[]) || []
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchServiceTypes = async () => {
      const { data } = await supabase.from('service_types').select('*').order('name');
      const filtered = (data || []).filter(t =>
        !EXCLUDED_SERVICE_TYPE_NAMES.has(t.name) || t.id === service.service_type_id
      );
      setServiceTypes(filtered);
    };
    fetchServiceTypes();
  }, [service.service_type_id]);

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
    const columnUpdates: Record<string, any> = {
      provider: null,
      server_ip: null,
      login_url: null,
      reverse_proxy_domain: null,
      location: null,
      cloud_provider: null,
      cloud_account_payer: null,
    };
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

    const { error: updateError } = await supabase
      .from('services')
      .update({
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
        infrastructure_cost: formData.infrastructure_cost ? parseFloat(formData.infrastructure_cost) : null,
        cloud_backup_enabled: formData.cloud_backup_enabled,
        cloud_backup_retention_days: formData.cloud_backup_retention_days ? parseInt(formData.cloud_backup_retention_days) : null,
        telemetry_enabled: formData.telemetry_enabled,
        provider: columnUpdates.provider,
        server_ip: columnUpdates.server_ip,
        login_url: columnUpdates.login_url,
        reverse_proxy_domain: columnUpdates.reverse_proxy_domain,
        location: columnUpdates.location,
        cloud_provider: columnUpdates.cloud_provider,
        cloud_account_payer: columnUpdates.cloud_account_payer,
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
        ip_internal: formData.ip_internal || null,
        ip_public: formData.ip_public || null,
        dns_record: formData.dns_record || null,
        paid_by: formData.paid_by || null,
        payment_card_last4: formData.payment_card_last4 ? formData.payment_card_last4.slice(-4) : null,
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
  const setType = (key: string, value: any) => setTypeValues(prev => ({ ...prev, [key]: value }));

  const splitLines = (text: string): string[] =>
    text.split('\n').map(s => s.trim()).filter(Boolean);

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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none" />
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">What's NOT Included</label>
                <textarea value={formData.excludes} onChange={e => set('excludes', e.target.value)} rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Client Responsibilities</label>
                <textarea value={formData.client_responsibilities} onChange={e => set('client_responsibilities', e.target.value)} rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-sm" />
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
              {['Annually', 'Biennially', 'Semi-Annually', 'One-Time'].includes(formData.billing_cycle) ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">Next Renewal Date</label>
                  <input type="date" value={formData.next_renewal_date} onChange={e => set('next_renewal_date', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
                </div>
              ) : (
                <div className="flex items-end pb-2">
                  <p className="text-xs text-gray-400">Monthly / Quarterly services renew automatically — no expiry date needed.</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirmed Hours / Month</label>
                <input type="number" step="0.5" value={formData.confirmed_hours_monthly} onChange={e => set('confirmed_hours_monthly', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Infrastructure Cost / Month</label>
                <div className="flex gap-2 items-center">
                  <input type="number" step="0.01" value={formData.infrastructure_cost} onChange={e => set('infrastructure_cost', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    placeholder="e.g., 25.00" />
                  <span className="text-xs text-gray-400 whitespace-nowrap">{formData.currency || 'USD'}/mo</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">VPS, DB, hosting — fixed cost not tied to hours</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Cloud Backup</label>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={formData.cloud_backup_enabled} onChange={e => set('cloud_backup_enabled', e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                    <span className="text-sm text-gray-700">Enabled</span>
                  </label>
                  {formData.cloud_backup_enabled && (
                    <div className="flex items-center gap-2 flex-1">
                      <input type="number" min="1" max="365" value={formData.cloud_backup_retention_days}
                        onChange={e => set('cloud_backup_retention_days', e.target.value)}
                        className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                        placeholder="7" />
                      <span className="text-sm text-gray-500">days retention</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-400 mt-1">Cloud provider backup (no agent required)</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Telemetry</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={formData.telemetry_enabled} onChange={e => set('telemetry_enabled', e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span className="text-sm text-gray-700">Monitor in Telemetry</span>
                </label>
                <p className="text-xs text-gray-400 mt-1">Uncheck for domains, one-time payments, or services with no agent</p>
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
              Paste a badge image URL from your Uptime Kuma instance. It will render live on the client portal.
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
            <h3 className="text-sm font-semibold text-gray-800 mb-3 pb-1 border-b border-gray-100">
              Network / IPAM
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Internal IP</label>
                <input type="text" value={formData.ip_internal} onChange={e => set('ip_internal', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm"
                  placeholder="192.168.1.10" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Public IP</label>
                <input type="text" value={formData.ip_public} onChange={e => set('ip_public', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm"
                  placeholder="203.0.113.50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">DNS Record</label>
                <input type="text" value={formData.dns_record} onChange={e => set('dns_record', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono text-sm"
                  placeholder="app.example.com A 203.0.113.50" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description / Notes</label>
            <textarea value={formData.description} onChange={e => set('description', e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none" />
          </div>

          {currentTypeName === 'Database' && (
            <DbMonitoringPanel service={service} typeValues={typeValues} />
          )}

          <IngestSecretPanel serviceId={service.id} currentSecret={service.ingest_secret} />

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

function DbMonitoringPanel({ service, typeValues }: { service: Service; typeValues: Record<string, any> }) {
  const [copied, setCopied] = useState(false);

  const host   = service.ip_internal || typeValues.ip_internal || '';
  const port   = service.specifications?.db_port ?? typeValues.db_port ?? '';
  const engine = (service.specifications?.db_engine ?? typeValues.db_engine ?? '') as string;
  const secret = service.ingest_secret || '';

  // Determine which tool the script will use
  const toolHint = engine.toLowerCase().includes('postgres') ? 'pg_isready'
                 : engine.toLowerCase().includes('mysql') || engine.toLowerCase().includes('mariadb') ? 'mysqladmin ping'
                 : engine.toLowerCase().includes('redis') ? 'redis-cli ping'
                 : 'nc -z';

  if (!secret) {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 text-sm text-amber-700">
        Generá un Ingest Secret primero para poder activar el monitoreo de esta DB.
      </div>
    );
  }

  // Suggest next index: find next DB_N not yet in use (simple: just say DB_1)
  const snippet = [
    `# ${service.name} — agregar en /etc/backup-ingest.env`,
    `DB_1_SERVICE_ID="${service.id}"`,
    `DB_1_INGEST_SECRET="${secret}"`,
    `DB_1_NAME="${service.name}"`,
    host ? `DB_1_HOST="${host}"` : `DB_1_HOST="localhost"`,
    port ? `DB_1_PORT="${port}"` : `# DB_1_PORT="5432"`,
    engine ? `DB_1_TYPE="${engine}"` : `# DB_1_TYPE="PostgreSQL"`,
  ].join('\n');

  const copy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <label className="text-sm font-medium text-gray-700">DB Monitoring</label>
          <p className="text-xs text-gray-400 mt-0.5">
            Agregá estas variables al <code className="bg-gray-100 px-1 rounded">.env</code> del servidor donde corre <code className="bg-gray-100 px-1 rounded">system-health.sh</code>.
            El script usará <strong>{toolHint}</strong> para chequear conectividad.
          </p>
        </div>
        <button type="button" onClick={copy}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 shrink-0">
          {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="bg-gray-50 rounded-md px-3 py-2 text-xs font-mono text-gray-600 whitespace-pre overflow-x-auto">{snippet}</pre>
      <p className="text-xs text-gray-400 mt-2">
        Si tenés más de una DB, usá <code className="bg-gray-100 px-1 rounded">DB_2_*</code>, <code className="bg-gray-100 px-1 rounded">DB_3_*</code>, etc.
        El heartbeat aparecerá en el portal del cliente bajo este servicio.
      </p>
    </div>
  );
}

function IngestSecretPanel({ serviceId, currentSecret }: { serviceId: string; currentSecret?: string }) {
  const [secret, setSecret] = useState(currentSecret || '');
  const [copied, setCopied] = useState(false);
  const [rotating, setRotating] = useState(false);

  const rotate = async () => {
    setRotating(true);
    const newSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    const { error } = await supabase.from('services').update({ ingest_secret: newSecret }).eq('id', serviceId);
    if (!error) setSecret(newSecret);
    setRotating(false);
  };

  const copy = () => {
    navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!secret) return null;

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-gray-700">Ingest Secret</label>
        <button type="button" onClick={rotate} disabled={rotating}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${rotating ? 'animate-spin' : ''}`} />
          Rotate
        </button>
      </div>
      <div className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-2">
        <code className="flex-1 text-xs font-mono text-gray-600 truncate">{secret}</code>
        <button type="button" onClick={copy} className="shrink-0 text-gray-400 hover:text-gray-600">
          {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <p className="text-xs text-gray-400 mt-2">Used to authenticate ingest scripts. Store in the server's <code className="bg-gray-100 px-1 rounded">.env</code> file as <code className="bg-gray-100 px-1 rounded">SERVICE_CATALOG_SECRET</code>.</p>
    </div>
  );
}
