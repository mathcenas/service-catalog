import { useEffect, useState, useMemo } from 'react';
import { Plus, Trash2, CreditCard as Edit3, X, Save, Shield, AlertTriangle, Calendar, Bell } from 'lucide-react';
import { supabase, Client, Service, ClientLicense, PAID_BY_OPTIONS } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const BILLING_CYCLES = ['Monthly', 'Quarterly', 'Annually', 'Biennially', 'Perpetual'];
const QUANTITY_LABELS = ['Licenses', 'Users', 'Devices', 'Cores', 'Seats', 'Endpoints'];

type Props = {
  clients: Client[];
  services: Service[];
};

export function LicenseManager({ clients, services }: Props) {
  const { user } = useAuth();
  const [licenses, setLicenses] = useState<ClientLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ClientLicense | null>(null);
  const [filterClient, setFilterClient] = useState<string>('all');
  const [sendingReminders, setSendingReminders] = useState(false);

  const [form, setForm] = useState({
    client_id: '', service_id: '', software_name: '', license_key: '',
    quantity: '1', quantity_label: 'Licenses', expiration_date: '',
    billing_cycle: 'Annually', cost: '', currency: 'USD',
    paid_by: '' as string, payment_card_last4: '', notes: '',
  });

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('client_licenses')
      .select('*')
      .order('expiration_date', { ascending: true, nullsFirst: false });
    setLicenses(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filterClient === 'all') return licenses;
    return licenses.filter(l => l.client_id === filterClient);
  }, [licenses, filterClient]);

  const resetForm = () => {
    setForm({ client_id: '', service_id: '', software_name: '', license_key: '', quantity: '1', quantity_label: 'Licenses', expiration_date: '', billing_cycle: 'Annually', cost: '', currency: 'USD', paid_by: '', payment_card_last4: '', notes: '' });
    setEditing(null);
    setShowForm(false);
  };

  const openEdit = (lic: ClientLicense) => {
    setForm({
      client_id: lic.client_id,
      service_id: lic.service_id || '',
      software_name: lic.software_name,
      license_key: lic.license_key || '',
      quantity: String(lic.quantity),
      quantity_label: lic.quantity_label,
      expiration_date: lic.expiration_date || '',
      billing_cycle: lic.billing_cycle,
      cost: lic.cost != null ? String(lic.cost) : '',
      currency: lic.currency || 'USD',
      paid_by: lic.paid_by || '',
      payment_card_last4: lic.payment_card_last4 || '',
      notes: lic.notes || '',
    });
    setEditing(lic);
    setShowForm(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.client_id || !form.software_name.trim()) return;

    const payload = {
      user_id: user!.id,
      client_id: form.client_id,
      service_id: form.service_id || null,
      software_name: form.software_name.trim(),
      license_key: form.license_key.trim() || null,
      quantity: parseInt(form.quantity) || 1,
      quantity_label: form.quantity_label,
      expiration_date: form.expiration_date || null,
      billing_cycle: form.billing_cycle,
      cost: form.cost ? parseFloat(form.cost) : null,
      currency: form.currency || 'USD',
      paid_by: form.paid_by || null,
      payment_card_last4: form.payment_card_last4.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (editing) {
      await supabase.from('client_licenses').update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editing.id);
    } else {
      await supabase.from('client_licenses').insert(payload);
    }
    resetForm();
    load();
  };

  const deleteLicense = async (id: string) => {
    if (!confirm('Delete this license record?')) return;
    await supabase.from('client_licenses').delete().eq('id', id);
    setLicenses(prev => prev.filter(l => l.id !== id));
  };

  const sendReminders = async () => {
    setSendingReminders(true);
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/license-reminder`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Sent ${data.sent} reminder(s) for licenses expiring within 30 days.`);
      } else {
        alert(`Error: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    }
    setSendingReminders(false);
  };

  const getClientName = (id: string) => clients.find(c => c.id === id)?.company_name || '--';
  const getServiceName = (id?: string) => id ? services.find(s => s.id === id)?.business_name || services.find(s => s.id === id)?.name || '--' : null;

  const clientServices = useMemo(
    () => form.client_id ? services.filter(s => s.client_id === form.client_id) : [],
    [form.client_id, services]
  );

  const daysUntilExpiry = (date?: string) => {
    if (!date) return null;
    return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const expiryBadge = (date?: string) => {
    const days = daysUntilExpiry(date);
    if (days === null) return <span className="text-xs text-gray-500">Perpetual</span>;
    if (days < 0) return <span className="text-xs font-medium text-red-700 bg-red-50 px-2 py-0.5 rounded-full">Expired</span>;
    if (days <= 30) return <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">Expires in {days}d</span>;
    return <span className="text-xs text-gray-600">{new Date(date!).toLocaleDateString()}</span>;
  };

  const stats = useMemo(() => {
    const total = licenses.length;
    const expiringSoon = licenses.filter(l => { const d = daysUntilExpiry(l.expiration_date); return d !== null && d >= 0 && d <= 30; }).length;
    const expired = licenses.filter(l => { const d = daysUntilExpiry(l.expiration_date); return d !== null && d < 0; }).length;
    const totalCost = licenses.reduce((sum, l) => sum + (l.cost || 0), 0);
    return { total, expiringSoon, expired, totalCost };
  }, [licenses]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Licenses & Subscriptions</h2>
          <p className="text-sm text-gray-600 mt-1">Track software licenses, subscriptions, and renewal dates across your clients.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={sendReminders} disabled={sendingReminders}
            className="flex items-center gap-2 border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            <Bell className="w-4 h-4" /> {sendingReminders ? 'Sending...' : 'Send Reminders'}
          </button>
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Add License
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={Shield} label="Total Licenses" value={stats.total} color="blue" />
        <StatCard icon={AlertTriangle} label="Expiring (30d)" value={stats.expiringSoon} color="amber" />
        <StatCard icon={X} label="Expired" value={stats.expired} color="red" />
        <StatCard icon={Calendar} label="Annual Cost" value={`$${stats.totalCost.toLocaleString()}`} color="emerald" />
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Filter by client:</label>
        <select value={filterClient} onChange={e => setFilterClient(e.target.value)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="all">All Clients</option>
          {clients.filter(c => c.status === 'Active').map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
        </select>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">{editing ? 'Edit License' : 'Add License'}</h3>
              <button onClick={resetForm} className="p-1 hover:bg-gray-100 rounded-md"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
                  <select value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value, service_id: '' })} required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Select client...</option>
                    {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Linked Service</label>
                  <select value={form.service_id} onChange={e => setForm({ ...form, service_id: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">None</option>
                    {clientServices.map(s => <option key={s.id} value={s.id}>{s.business_name || s.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Software Name *</label>
                <input type="text" value={form.software_name} onChange={e => setForm({ ...form, software_name: e.target.value })} required
                  placeholder="e.g., Bitdefender Endpoint Security"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">License Key</label>
                <input type="text" value={form.license_key} onChange={e => setForm({ ...form, license_key: e.target.value })}
                  placeholder="Optional - admin only, never shown to clients"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Quantity</label>
                  <input type="number" min="1" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                  <select value={form.quantity_label} onChange={e => setForm({ ...form, quantity_label: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    {QUANTITY_LABELS.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cost</label>
                  <input type="number" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })}
                    placeholder="0.00"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
                  <input type="text" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                    placeholder="USD" maxLength={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Paid By</label>
                  <select value={form.paid_by} onChange={e => setForm({ ...form, paid_by: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    <option value="">Not set</option>
                    {PAID_BY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Card Last 4</label>
                  <input type="text" value={form.payment_card_last4} onChange={e => setForm({ ...form, payment_card_last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                    placeholder="1234" maxLength={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expiration Date</label>
                  <input type="date" value={form.expiration_date} onChange={e => setForm({ ...form, expiration_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Billing Cycle</label>
                  <select value={form.billing_cycle} onChange={e => setForm({ ...form, billing_cycle: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none">
                    {BILLING_CYCLES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
                  placeholder="Internal notes..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit"
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  <Save className="w-4 h-4" /> {editing ? 'Update' : 'Add License'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <Shield className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No licenses found. Add your first software license or subscription above.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Software</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Client</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Service</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Qty</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Cycle</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Expires</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Paid By</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">Cost</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(lic => (
                  <tr key={lic.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{lic.software_name}</div>
                      {lic.notes && <div className="text-xs text-gray-500 mt-0.5 truncate max-w-[200px]">{lic.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{getClientName(lic.client_id)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{getServiceName(lic.service_id) || '--'}</td>
                    <td className="px-4 py-3 text-gray-700">{lic.quantity} {lic.quantity_label}</td>
                    <td className="px-4 py-3 text-gray-600">{lic.billing_cycle}</td>
                    <td className="px-4 py-3">{expiryBadge(lic.expiration_date)}</td>
                    <td className="px-4 py-3">
                      {lic.paid_by ? (
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          lic.paid_by === 'Me' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700'
                        }`}>{lic.paid_by}</span>
                      ) : <span className="text-xs text-gray-400">--</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-700">{lic.cost != null ? `${lic.currency || '$'}${lic.cost.toLocaleString()}` : '--'}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button onClick={() => openEdit(lic)} className="p-1.5 hover:bg-blue-50 text-gray-500 hover:text-blue-600 rounded-md">
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteLicense(lic.id)} className="p-1.5 hover:bg-red-50 text-gray-500 hover:text-red-600 rounded-md">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: typeof Shield; label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}><Icon className="w-4 h-4" /></div>
        <div>
          <div className="text-xs text-gray-500 font-medium">{label}</div>
          <div className="text-lg font-bold text-gray-900">{value}</div>
        </div>
      </div>
    </div>
  );
}
