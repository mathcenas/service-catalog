import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { Plus, Trash2, Eye, EyeOff, Save, Rocket, Sparkles, Database, CreditCard, Lightbulb, MapPin, User, Send, CalendarClock, BookOpen, Check, CheckCheck } from 'lucide-react';
import { supabase, Client, Service, RoadmapItem, ROADMAP_STATUSES, RoadmapStatus, ROADMAP_CATEGORIES, RoadmapCategory } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

const CATEGORY_META: Record<RoadmapCategory, { icon: typeof Rocket; color: string }> = {
  idea: { icon: Lightbulb, color: 'text-amber-600 bg-amber-50' },
  payment: { icon: CreditCard, color: 'text-blue-600 bg-blue-50' },
  backup: { icon: Database, color: 'text-teal-600 bg-teal-50' },
  visit: { icon: MapPin, color: 'text-rose-600 bg-rose-50' },
};

type Props = {
  clients: Client[];
  services: Service[];
};

export function RoadmapManager({ clients, services }: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<RoadmapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState({
    title: '', description: '', eta: '', status: 'Planned' as RoadmapStatus,
    category: 'idea' as RoadmapCategory, requested_by: '', amount: '', amount_type: 'money' as 'money' | 'hours',
    scheduled_date: '', client_id: '', service_id: '', publish_to_changelog: false,
  });
  const [saving, setSaving] = useState(false);
  const [filterCategory, setFilterCategory] = useState<RoadmapCategory | 'all'>('all');
  const [filterClientId, setFilterClientId] = useState<string>('all');
  const [notifying, setNotifying] = useState<string | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [emailOpens, setEmailOpens] = useState<Record<string, { opened_at: string | null; open_count: number }>>({});

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

  useEffect(() => {
    load();
    supabase.from('user_settings').select('logo_url').eq('user_id', user!.id).maybeSingle()
      .then(({ data }) => { if (data?.logo_url) setLogoUrl(data.logo_url); });
    supabase.from('email_opens').select('roadmap_item_id, opened_at, open_count')
      .not('roadmap_item_id', 'is', null)
      .then(({ data }) => {
        if (data) {
          const map: Record<string, { opened_at: string | null; open_count: number }> = {};
          for (const row of data) {
            const existing = map[row.roadmap_item_id!];
            if (!existing || (row.opened_at && (!existing.opened_at || row.opened_at > existing.opened_at))) {
              map[row.roadmap_item_id!] = { opened_at: row.opened_at, open_count: row.open_count };
            }
          }
          setEmailOpens(map);
        }
      });
  }, []);

  const filtered = useMemo(() => {
    let list = items;
    if (filterClientId !== 'all') {
      list = list.filter(i => i.client_id === filterClientId || !i.client_id);
    }
    if (filterCategory !== 'all') {
      list = list.filter(i => i.category === filterCategory);
    }
    return list;
  }, [items, filterCategory, filterClientId]);

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
      amount_type: draft.amount ? draft.amount_type : null,
      scheduled_date: draft.scheduled_date || null,
      client_id: draft.client_id || null,
      service_id: draft.service_id || null,
      publish_to_changelog: draft.publish_to_changelog,
      sort_order: items.length,
      is_public: draft.category === 'idea',
    });
    setDraft({ title: '', description: '', eta: '', status: 'Planned', category: 'idea', requested_by: '', amount: '', amount_type: 'money', scheduled_date: '', client_id: '', service_id: '', publish_to_changelog: false });
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

  const markReleased = async (item: RoadmapItem) => {
    await updateItem(item.id, { status: 'Released' });

    if (item.publish_to_changelog && item.service_id) {
      await supabase.from('service_changes').insert({
        user_id: user!.id,
        service_id: item.service_id,
        change_date: new Date().toISOString().split('T')[0],
        summary: item.title,
        details: item.description || null,
      });
    }

    if (item.client_id) {
      const client = clients.find(c => c.id === item.client_id);
      if (client?.email && window.confirm(`Notify ${client.company_name} about "${item.title}"?`)) {
        const { data: tokens } = await supabase.from('client_share_tokens').select('token').eq('client_id', client.id).limit(1);
        const shareUrl = tokens?.[0]?.token ? `${window.location.origin}/share/${tokens[0].token}` : undefined;
        const { data: session } = await supabase.auth.getSession();
        if (session?.session?.access_token) {
          await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-client`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.session.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              client_email: client.email,
              alt_email: client.alt_email || undefined,
              cc_emails: client.cc_emails || undefined,
              client_name: client.contact_name || client.company_name,
              subject: `Released: ${item.title}`,
              title: `✅ Released: ${item.title}`,
              description: item.description || undefined,
              scheduled_date: item.scheduled_date || undefined,
              share_url: shareUrl,
              sender_name: user?.email,
              logo_url: logoUrl,
              roadmap_item_id: item.id,
            }),
          }).catch(() => {});
          await updateItem(item.id, { notified_at: new Date().toISOString() });
        }
      }
    }
  };

  const notifyClient = async (item: RoadmapItem) => {
    if (!item.client_id) return;
    const client = clients.find(c => c.id === item.client_id);
    if (!client?.email) return;

    setNotifying(item.id);

    try {
      const { data: tokens } = await supabase
        .from('client_share_tokens')
        .select('token')
        .eq('client_id', client.id)
        .limit(1);

      const shareUrl = tokens && tokens.length > 0
        ? `${window.location.origin}/share/${tokens[0].token}`
        : undefined;

      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        alert('Session expired. Please sign in again.');
        setNotifying(null);
        return;
      }

      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/notify-client`;

      console.log('[notify-client] Sending to:', client.email, client.alt_email || '(no alt)');
      console.log('[notify-client] URL:', apiUrl);

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_email: client.email,
          alt_email: client.alt_email || undefined,
          cc_emails: client.cc_emails || undefined,
          client_name: client.contact_name || client.company_name,
          subject: `Planned: ${item.title}`,
          title: item.title,
          description: item.description,
          scheduled_date: item.scheduled_date,
          share_url: shareUrl,
          sender_name: user?.email,
          logo_url: logoUrl,
          roadmap_item_id: item.id,
        }),
      });

      console.log('[notify-client] Response status:', res.status);

      if (res.ok) {
        const data = await res.json();
        console.log('[notify-client] Success:', data);
        await updateItem(item.id, { notified_at: new Date().toISOString() });
      } else {
        const errText = await res.text();
        console.error('[notify-client] Error response:', res.status, errText);
        let errMsg = `HTTP ${res.status}`;
        try {
          const errJson = JSON.parse(errText);
          errMsg = errJson.error || errJson.details || errMsg;
        } catch { /* use status */ }
        alert(`Failed to send notification:\n${errMsg}`);
      }
    } catch (err) {
      console.error('[notify-client] Network error:', err);
      alert(`Network error sending notification: ${err instanceof Error ? err.message : String(err)}`);
    }

    setNotifying(null);
  };

  const getClientName = (id?: string) => id ? clients.find(c => c.id === id)?.company_name || '--' : null;
  const getServiceName = (id?: string) => id ? services.find(s => s.id === id)?.name || '--' : null;

  const clientServices = (clientId?: string) =>
    clientId ? services.filter(s => s.client_id === clientId) : services;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Roadmap & Pipeline</h2>
        <p className="text-sm text-gray-600 mt-1">
          Track upcoming work, schedule service actions, and notify clients. Public items appear on the client portal.
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
              placeholder="e.g., Upgrade firewall firmware"
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
            <select
              value={draft.client_id}
              onChange={e => setDraft({ ...draft, client_id: e.target.value, service_id: '' })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">None</option>
              {clients.filter(c => c.status === 'Active').map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={e => setDraft({ ...draft, description: e.target.value })}
              rows={2}
              placeholder="Details about the planned action..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Service</label>
            <select
              value={draft.service_id}
              onChange={e => setDraft({ ...draft, service_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">None</option>
              {clientServices(draft.client_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
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
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Scheduled Date</label>
            <input
              type="date"
              value={draft.scheduled_date}
              onChange={e => setDraft({ ...draft, scheduled_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
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
              <div className="flex rounded-lg border border-gray-300 overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
                <select
                  value={draft.amount_type}
                  onChange={e => setDraft({ ...draft, amount_type: e.target.value as 'money' | 'hours' })}
                  className="px-2 py-2 text-xs bg-gray-50 border-r border-gray-300 text-gray-600 outline-none"
                >
                  <option value="money">$</option>
                  <option value="hours">hs</option>
                </select>
                <input
                  type="number"
                  value={draft.amount}
                  onChange={e => setDraft({ ...draft, amount: e.target.value })}
                  placeholder="0"
                  className="flex-1 px-3 py-2 text-sm outline-none"
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={draft.publish_to_changelog}
              onChange={e => setDraft({ ...draft, publish_to_changelog: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <BookOpen className="w-3.5 h-3.5 text-gray-500" />
            Publish to changelog when released
          </label>
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
          <select
            value={filterClientId}
            onChange={e => setFilterClientId(e.target.value)}
            className="ml-3 px-2.5 py-1 border border-gray-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-gray-50"
          >
            <option value="all">All Clients</option>
            {clients.filter(c => c.status === 'Active').map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
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
            {filtered.map(item => <RoadmapRow
              key={item.id}
              item={item}
              clients={clients}
              services={services}
              notifying={notifying === item.id}
              emailOpen={emailOpens[item.id]}
              getClientName={getClientName}
              getServiceName={getServiceName}
              clientServices={clientServices}
              onUpdate={updateItem}
              onDelete={deleteItem}
              onNotify={notifyClient}
              onMarkReleased={markReleased}
            />)}
          </div>
        )}
      </div>
    </div>
  );
}

function RoadmapRow({ item, clients, notifying, emailOpen, clientServices, onUpdate, onDelete, onNotify, onMarkReleased }: {
  item: RoadmapItem;
  clients: Client[];
  services: Service[];
  notifying: boolean;
  emailOpen?: { opened_at: string | null; open_count: number };
  getClientName: (id?: string) => string | null;
  getServiceName: (id?: string) => string | null;
  clientServices: (clientId?: string) => Service[];
  onUpdate: (id: string, patch: Partial<RoadmapItem>) => void;
  onDelete: (id: string) => void;
  onNotify: (item: RoadmapItem) => void;
  onMarkReleased: (item: RoadmapItem) => void;
}) {
  const meta = CATEGORY_META[item.category] || CATEGORY_META.idea;
  const CatIcon = meta.icon;
  const canNotify = !!item.client_id && !notifying;
  const client = clients.find(c => c.id === item.client_id);

  const [localTitle, setLocalTitle] = useState(item.title);
  const [localDesc, setLocalDesc] = useState(item.description || '');
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const descTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setLocalTitle(item.title); }, [item.title]);
  useEffect(() => { setLocalDesc(item.description || ''); }, [item.description]);

  const handleTitleChange = useCallback((val: string) => {
    setLocalTitle(val);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => onUpdate(item.id, { title: val }), 600);
  }, [item.id, onUpdate]);

  const handleDescChange = useCallback((val: string) => {
    setLocalDesc(val);
    if (descTimer.current) clearTimeout(descTimer.current);
    descTimer.current = setTimeout(() => onUpdate(item.id, { description: val }), 600);
  }, [item.id, onUpdate]);

  return (
    <div className="p-5 hover:bg-gray-50">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
        <div className="md:col-span-4">
          <div className="flex items-center gap-2 mb-1">
            <span className={`p-1 rounded ${meta.color}`}><CatIcon className="w-3.5 h-3.5" /></span>
            <input
              type="text"
              value={localTitle}
              onChange={e => handleTitleChange(e.target.value)}
              className="flex-1 px-2 py-1 border border-transparent hover:border-gray-200 focus:border-blue-300 rounded-md text-sm font-medium text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <textarea
            value={localDesc}
            onChange={e => handleDescChange(e.target.value)}
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
            value={item.client_id || ''}
            onChange={e => onUpdate(item.id, { client_id: e.target.value || undefined, service_id: undefined })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">No client</option>
            {clients.filter(c => c.status === 'Active').map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <select
            value={item.service_id || ''}
            onChange={e => onUpdate(item.id, { service_id: e.target.value || undefined })}
            className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">No service</option>
            {clientServices(item.client_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <select
            value={item.status}
            onChange={e => {
              const newStatus = e.target.value as RoadmapStatus;
              if (newStatus === 'Released' && item.status !== 'Released') {
                onMarkReleased(item);
              } else {
                onUpdate(item.id, { status: newStatus });
              }
            }}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            {ROADMAP_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            type="date"
            value={item.scheduled_date || ''}
            onChange={e => onUpdate(item.id, { scheduled_date: e.target.value || undefined })}
            className="w-full mt-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            title="Scheduled date"
          />
        </div>
        <div className="md:col-span-1">
          <input
            type="number"
            value={item.sort_order}
            onChange={e => onUpdate(item.id, { sort_order: parseInt(e.target.value) || 0 })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            title="Sort order (lower = higher)"
          />
          {item.amount != null && item.amount > 0 && (
            <div className="text-xs text-emerald-700 font-medium mt-1 px-1">
              {item.amount_type === 'hours' ? `${item.amount} hs` : `$${item.amount.toLocaleString()}`}
            </div>
          )}
          {item.scheduled_date && (
            <div className="flex items-center gap-1 mt-1 text-xs text-blue-600">
              <CalendarClock className="w-3 h-3" />
              {new Date(item.scheduled_date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
        <div className="md:col-span-3 flex items-center justify-end gap-1.5 flex-wrap">
          <label className="inline-flex items-center gap-1 text-[10px] text-gray-500 cursor-pointer select-none" title="Publish to changelog when released">
            <input
              type="checkbox"
              checked={item.publish_to_changelog}
              onChange={e => onUpdate(item.id, { publish_to_changelog: e.target.checked })}
              className="w-3 h-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <BookOpen className="w-3 h-3" />
          </label>
          {canNotify && (
            <button
              onClick={() => onNotify(item)}
              disabled={notifying}
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                item.notified_at
                  ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                  : 'text-blue-700 bg-blue-50 hover:bg-blue-100'
              }`}
              title={item.notified_at ? `Last notified: ${new Date(item.notified_at).toLocaleString()}` : `Send notification to ${client?.email}`}
            >
              {notifying ? (
                <span className="animate-pulse">Sending...</span>
              ) : item.notified_at ? (
                <><Check className="w-3 h-3" /> Sent</>
              ) : (
                <><Send className="w-3 h-3" /> Notify</>
              )}
            </button>
          )}
          {emailOpen?.opened_at && (
            <span
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200"
              title={`Read at: ${new Date(emailOpen.opened_at).toLocaleString()} (${emailOpen.open_count} open${emailOpen.open_count > 1 ? 's' : ''})`}
            >
              <CheckCheck className="w-3.5 h-3.5" /> Read
            </span>
          )}
          <button
            onClick={() => onUpdate(item.id, { is_public: !item.is_public })}
            className={`p-1.5 rounded-md transition-colors ${
              item.is_public ? 'text-emerald-600 hover:bg-emerald-50' : 'text-gray-400 hover:bg-gray-100'
            }`}
            title={item.is_public ? 'Visible on client portal' : 'Hidden from clients'}
          >
            {item.is_public ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
