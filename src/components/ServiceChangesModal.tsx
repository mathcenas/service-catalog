import { useState, useEffect } from 'react';
import { X, Plus, Trash2, History } from 'lucide-react';
import { Service, ServiceChange, supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  service: Service;
  onClose: () => void;
};

export function ServiceChangesModal({ service, onClose }: Props) {
  const { user } = useAuth();
  const [changes, setChanges] = useState<ServiceChange[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    change_date: new Date().toISOString().slice(0, 10),
    summary: '',
    details: '',
  });

  const fetchChanges = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('service_changes')
      .select('*')
      .eq('service_id', service.id)
      .order('change_date', { ascending: false });
    setChanges(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchChanges();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.summary.trim()) return;
    setSaving(true);
    await supabase.from('service_changes').insert({
      user_id: user!.id,
      service_id: service.id,
      change_date: form.change_date,
      summary: form.summary,
      details: form.details || null,
    });
    setForm({ change_date: new Date().toISOString().slice(0, 10), summary: '', details: '' });
    setSaving(false);
    fetchChanges();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this change entry?')) return;
    await supabase.from('service_changes').delete().eq('id', id);
    fetchChanges();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <History className="w-5 h-5 text-blue-600" />
              Change History
            </h2>
            <p className="text-sm text-gray-600 mt-0.5">{service.name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <form onSubmit={handleAdd} className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Log a change</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
                <input type="date" value={form.change_date}
                  onChange={e => setForm(f => ({ ...f, change_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 mb-1">Summary *</label>
                <input type="text" value={form.summary}
                  onChange={e => setForm(f => ({ ...f, summary: e.target.value }))}
                  placeholder="e.g., Increased VPS-01 RAM due to reported slowness"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm" required />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Details (optional)</label>
              <textarea value={form.details} rows={2}
                onChange={e => setForm(f => ({ ...f, details: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 resize-none text-sm" />
            </div>
            <button type="submit" disabled={saving}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">
              <Plus className="w-4 h-4" /> {saving ? 'Saving...' : 'Add Entry'}
            </button>
          </form>

          <div>
            <h3 className="text-sm font-semibold text-gray-800 mb-3">History</h3>
            {loading ? (
              <p className="text-sm text-gray-500 text-center py-6">Loading...</p>
            ) : changes.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No changes logged yet.</p>
            ) : (
              <ol className="border-l-2 border-gray-200 space-y-4 ml-2">
                {changes.map(c => (
                  <li key={c.id} className="pl-4 relative">
                    <span className="absolute -left-[7px] top-1.5 w-3 h-3 bg-blue-600 rounded-full border-2 border-white"></span>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-500">{new Date(c.change_date).toLocaleDateString()}</div>
                        <div className="text-sm font-medium text-gray-900 mt-0.5">{c.summary}</div>
                        {c.details && <div className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{c.details}</div>}
                      </div>
                      <button onClick={() => handleDelete(c.id)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors flex-shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
