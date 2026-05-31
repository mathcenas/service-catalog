import { useState, useEffect } from 'react';
import { Clock, Plus, Trash2, Filter, Calendar, X } from 'lucide-react';
import { supabase, Client, Service, SupportHour } from '../lib/supabase';

type Props = {
  clients: Client[];
  services: Service[];
};

export function SupportHoursManager({ clients, services }: Props) {
  const [entries, setEntries] = useState<SupportHour[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterClientId, setFilterClientId] = useState('');
  const [filterMonth, setFilterMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [formData, setFormData] = useState({
    client_id: '',
    service_id: '',
    work_date: new Date().toISOString().split('T')[0],
    hours: '',
    description: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchEntries = async () => {
    setLoading(true);
    let query = supabase
      .from('support_hours')
      .select('*')
      .order('work_date', { ascending: false });

    if (filterClientId) {
      query = query.eq('client_id', filterClientId);
    }

    if (filterMonth) {
      const [year, month] = filterMonth.split('-');
      const start = `${year}-${month}-01`;
      const endDate = new Date(parseInt(year), parseInt(month), 0);
      const end = `${year}-${month}-${String(endDate.getDate()).padStart(2, '0')}`;
      query = query.gte('work_date', start).lte('work_date', end);
    }

    const { data } = await query;
    setEntries(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchEntries();
  }, [filterClientId, filterMonth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not authenticated'); setSaving(false); return; }

    const { error: insertErr } = await supabase.from('support_hours').insert({
      user_id: user.id,
      client_id: formData.client_id,
      service_id: formData.service_id || null,
      work_date: formData.work_date,
      hours: parseFloat(formData.hours),
      description: formData.description,
    });

    if (insertErr) {
      setError(insertErr.message);
    } else {
      setShowForm(false);
      setFormData({ client_id: '', service_id: '', work_date: new Date().toISOString().split('T')[0], hours: '', description: '' });
      fetchEntries();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this entry?')) return;
    await supabase.from('support_hours').delete().eq('id', id);
    fetchEntries();
  };

  const clientServices = formData.client_id
    ? services.filter(s => s.client_id === formData.client_id)
    : [];

  const totalHours = entries.reduce((sum, e) => sum + Number(e.hours), 0);

  const clientTotals = entries.reduce((acc, e) => {
    acc[e.client_id] = (acc[e.client_id] || 0) + Number(e.hours);
    return acc;
  }, {} as Record<string, number>);

  const getClientName = (id: string) => clients.find(c => c.id === id)?.company_name || '--';
  const getServiceName = (id?: string) => {
    if (!id) return null;
    const svc = services.find(s => s.id === id);
    return svc?.business_name || svc?.name || null;
  };

  const getAllocatedHours = (clientId: string) => {
    const clientSvcs = services.filter(s => s.client_id === clientId && s.status === 'Active');
    return clientSvcs.reduce((sum, s) => sum + (s.confirmed_hours_monthly || 0), 0);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Support Hours</h2>
          <p className="text-sm text-gray-500 mt-0.5">Track time spent on client VPS and services</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          Log Hours
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-4 items-center">
        <Filter className="w-4 h-4 text-gray-400" />
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Client:</label>
          <select
            value={filterClientId}
            onChange={e => setFilterClientId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Clients</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 font-medium">Month:</label>
          <input
            type="month"
            value={filterMonth}
            onChange={e => setFilterMonth(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 p-2.5 rounded-lg">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{totalHours.toFixed(1)}h</div>
              <div className="text-xs text-gray-500">Total this period</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-50 p-2.5 rounded-lg">
              <Calendar className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">{entries.length}</div>
              <div className="text-xs text-gray-500">Entries logged</div>
            </div>
          </div>
        </div>
        {Object.keys(clientTotals).length > 0 && Object.keys(clientTotals).length <= 2 && (
          Object.entries(clientTotals).map(([cid, hrs]) => {
            const allocated = getAllocatedHours(cid);
            const pct = allocated > 0 ? ((hrs / allocated) * 100).toFixed(0) : null;
            return (
              <div key={cid} className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="text-sm font-medium text-gray-700 truncate">{getClientName(cid)}</div>
                <div className="text-xl font-bold text-gray-900 mt-1">{hrs.toFixed(1)}h
                  {allocated > 0 && <span className="text-sm font-normal text-gray-500"> / {allocated}h</span>}
                </div>
                {pct && (
                  <div className="mt-2">
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${Number(pct) > 90 ? 'bg-red-500' : Number(pct) > 70 ? 'bg-amber-500' : 'bg-blue-500'}`}
                        style={{ width: `${Math.min(Number(pct), 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{pct}% used</div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Per-service confirmed hours breakdown */}
      {filterClientId && (() => {
        const svcsWithHours = services.filter(s => s.client_id === filterClientId && s.status === 'Active' && s.confirmed_hours_monthly && s.confirmed_hours_monthly > 0);
        if (svcsWithHours.length === 0) return null;
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h4 className="text-sm font-semibold text-gray-700 mb-3">Confirmed Hours by Service</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {svcsWithHours.map(s => (
                <div key={s.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                  <span className="text-sm text-gray-700 truncate">{s.business_name || s.name}</span>
                  <span className="text-sm font-semibold text-gray-900 ml-2 whitespace-nowrap">{s.confirmed_hours_monthly}h/mo</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Entries table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Client</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Service</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Hours</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400">No hours logged for this period</td></tr>
              ) : (
                entries.map(entry => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                      {new Date(entry.work_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{getClientName(entry.client_id)}</td>
                    <td className="px-4 py-3 text-gray-600">{getServiceName(entry.service_id) || '--'}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">
                        <Clock className="w-3 h-3" />{Number(entry.hours).toFixed(1)}h
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{entry.description || '--'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add entry modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-gray-900">Log Support Hours</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && <div className="mb-4 bg-red-50 text-red-700 text-sm p-3 rounded-lg">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Client *</label>
                <select
                  required
                  value={formData.client_id}
                  onChange={e => setFormData(prev => ({ ...prev, client_id: e.target.value, service_id: '' }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select client...</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
              </div>

              {clientServices.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Service (optional)</label>
                  <select
                    value={formData.service_id}
                    onChange={e => setFormData(prev => ({ ...prev, service_id: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">General support</option>
                    {clientServices.map(s => (
                      <option key={s.id} value={s.id}>{s.business_name || s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={formData.work_date}
                    onChange={e => setFormData(prev => ({ ...prev, work_date: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hours *</label>
                  <input
                    type="number"
                    required
                    step="0.25"
                    min="0.25"
                    placeholder="1.5"
                    value={formData.hours}
                    onChange={e => setFormData(prev => ({ ...prev, hours: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  rows={3}
                  placeholder="What was done..."
                  value={formData.description}
                  onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Log Hours'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
