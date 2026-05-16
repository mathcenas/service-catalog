import { useEffect, useState, useMemo } from 'react';
import { Plus, Trash2, Eye, EyeOff, Save, Rocket, Sparkles, Database, CreditCard, Lightbulb, MapPin, User } from 'lucide-react';
import { supabase, RoadmapItem, ROADMAP_STATUSES, RoadmapStatus, ROADMAP_CATEGORIES, RoadmapCategory } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const CATEGORY_META: Record<RoadmapCategory, { icon: typeof Rocket; color: string }> = {
  idea: { icon: Lightbulb, color: 'text-amber-600 bg-amber-50' },
  payment: { icon: CreditCard, color: 'text-blue-600 bg-blue-50' },
  backup: { icon: Database, color: 'text-teal-600 bg-teal-50' },
  visit: { icon: MapPin, color: 'text-rose-600 bg-rose-50' },
};

export function RoadmapManager() {
  const { user } = useAuth();
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    title: '', description: '', eta: '', status: 'Planned' as RoadmapStatus,
    category: 'idea' as RoadmapCategory, requested_by: '', amount: '',
  });
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<RoadmapCategory | 'all'>('all');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('roadmap_items')
      .select('*')
      .order('sort_order')
      .order('created_at');
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (filterCategory === 'all') return items;
    return items.filter(i => i.category === filterCategory);
  }, [items, filterCategory]);

  const addItem = async () => {
    if (!draft.title.trim()) return;
    setSaving(true);
    await supabase.from('roadmap_items').insert({
      user_id: user!.id,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      eta: draft.eta.trim() || null,
      status: draft.status,
      category: draft.category,
      requested_by: draft.requested_by.trim() || null,
      amount: draft.amount ? parseFloat(draft.amount) : null,
      sort_order: items.length,
      is_public: draft.category === 'idea',
    });
    setDraft({ title: '', description: '', eta: '', status: 'Planned', category: 'idea', requested_by: '', amount: '' });
    setSaving(false);
    load();
  };

  const updateItem = async (id: string, patch: Partial<RoadmapItem>) => {
    await supabase.from('roadmap_items').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, ...patch } as RoadmapItem : i));
  };

  const deleteItem = async (id: string) => {
    if (!confirm('Delete this roadmap item?')) return;
    await supabase.from('roadmap_items').delete().eq('id', id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Roadmap & Pipeline</h2>
        <p className="text-sm text-gray-600 mt-1">
          Track upcoming work: new services, pending payments, backup integrations, and scheduled visits. Public items appear on the client portal.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-blue-600" /> Add Item
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
            <input
              type="text"
              value={draft.title}
              onChange={e => setDraft({ ...draft, title: e.target.value })}
              placeholder="e.g., Veeam backup for file server"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
            <select
              value={draft.category}
              onChange={e => setDraft({ ...draft, category: e.target.value as RoadmapCategory })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              {ROADMAP_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Requested By</label>
            <input
              type="text"
              value={draft.requested_by}
              onChange={e => setDraft({ ...draft, requested_by: e.target.value })}
              placeholder="Client or person name"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              placeholder="Details, notes, coordination info..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              value={draft.status}
              onChange={e => setDraft({ ...draft, status: e.target.value as RoadmapStatus })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              {ROADMAP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ETA</label>
              <input
                type="text"
                value={draft.eta}
                onChange={e => setDraft({ ...draft, eta: e.target.value })}
                placeholder="Q2 2026"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Amount</label>
              <input
                type="number"
                value={draft.amount}
                onChange={e => setDraft({ ...draft, amount: e.target.value })}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <button
            onClick={addItem}
            disabled={saving || !draft.title.trim()}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Add Item'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2 flex-wrap">
          <Rocket className="w-4 h-4 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800">Pipeline</h3>
          <div className="ml-auto inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-xs font-medium">
            <button onClick={() => setFilterCategory('all')}
              className={`px-2.5 py-1 rounded-md transition-colors ${filterCategory === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
              All ({items.length})
            </button>
            {ROADMAP_CATEGORIES.map(c => {
              const count = items.filter(i => i.category === c.value).length;
              if (count === 0) return null;
              return (
                <button key={c.value} onClick={() => setFilterCategory(c.value)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${filterCategory === c.value ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                  {c.label.split(' ')[0]} ({count})
                </button>
              );
            })}
          </div>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-10 text-center">
            <Sparkles className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No items yet. Add the first one above.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map(item => {
              const meta = CATEGORY_META[item.category] || CATEGORY_META.idea;
              const CatIcon = meta.icon;
              return (
                <div key={item.id} className="p-5 hover:bg-gray-50">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
                    <div className="md:col-span-5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`p-1 rounded ${meta.color}`}><CatIcon className="w-3.5 h-3.5" /></span>
                        <input
                          type="text"
                          value={item.title}
                          onChange={e => updateItem(item.id, { title: e.target.value })}
                          className="flex-1 px-2 py-1 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded-md text-sm font-medium text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        />
                      </div>
                      <textarea
                        value={item.description || ''}
                        onChange={e => updateItem(item.id, { description: e.target.value })}
                        placeholder="Description..."
                        rows={2}
                        className="w-full px-2 py-1 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded-md text-xs text-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                      />
                      {item.requested_by && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                          <User className="w-3 h-3" /> {item.requested_by}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <select
                        value={item.category}
                        onChange={e => updateItem(item.id, { category: e.target.value as RoadmapCategory })}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      >
                        {ROADMAP_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                      <input
                        type="text"
                        value={item.requested_by || ''}
                        onChange={e => updateItem(item.id, { requested_by: e.target.value })}
                        placeholder="Requested by"
                        className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <select
                        value={item.status}
                        onChange={e => updateItem(item.id, { status: e.target.value as RoadmapStatus })}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      >
                        {ROADMAP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <input
                        type="text"
                        value={item.eta || ''}
                        onChange={e => updateItem(item.id, { eta: e.target.value })}
                        placeholder="ETA"
                        className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      />
                    </div>
                    <div className="md:col-span-1">
                      <input
                        type="number"
                        value={item.sort_order}
                        onChange={e => updateItem(item.id, { sort_order: parseInt(e.target.value) || 0 })}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                        title="Sort order (lower = higher)"
                      />
                      {item.amount != null && item.amount > 0 && (
                        <div className="text-xs text-emerald-700 font-medium mt-1 px-1">
                          ${item.amount.toLocaleString()}
                        </div>
                      )}
                    </div>
                    <div className="md:col-span-2 flex items-center justify-end gap-2">
                      <button
                        onClick={() => updateItem(item.id, { is_public: !item.is_public })}
                        className={`p-2 rounded-md transition-colors ${
                          item.is_public ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:bg-gray-100'
                        }`}
                        title={item.is_public ? 'Visible on client portal' : 'Hidden from clients'}
                      >
                        {item.is_public ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
