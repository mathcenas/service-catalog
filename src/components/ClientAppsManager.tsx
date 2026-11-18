import { useState, useEffect } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { supabase, ClientApp, AppKind } from '../lib/supabase';
import { APP_KINDS, appKind } from '../lib/appKinds';
import { useAuth } from '../contexts/AuthContext';

type Props = { clientId: string };

const empty = () => ({
  name: '', vendor: '', support_phone: '', whatsapp_url: '', notes: '', kind: 'app' as AppKind, service_id: '',
});

export function ClientAppsManager({ clientId }: Props) {
  const { user } = useAuth();
  const [apps, setApps] = useState<ClientApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(empty());
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [servers, setServers] = useState<{ id: string; name: string }[]>([]);

  const load = async () => {
    const [{ data }, { data: svcs }] = await Promise.all([
      supabase.from('client_apps').select('*').eq('client_id', clientId).order('sort_order'),
      supabase.from('services').select('id, name, business_name').eq('client_id', clientId).eq('status', 'Active').order('name'),
    ]);
    setApps(data || []);
    setServers((svcs ?? []).map((x: { id: string; name: string; business_name?: string | null }) => ({ id: x.id, name: x.business_name || x.name })));
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId]);

  const handleAdd = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    await supabase.from('client_apps').insert({
      user_id: user!.id,
      client_id: clientId,
      name: draft.name.trim(),
      vendor: draft.vendor?.trim() || null,
      support_phone: draft.support_phone?.trim() || null,
      whatsapp_url: draft.whatsapp_url?.trim() || null,
      notes: draft.notes?.trim() || null,
      kind: draft.kind,
      service_id: draft.service_id || null,
      sort_order: apps.length,
    });
    setDraft(empty());
    setAdding(false);
    setSaving(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this app?')) return;
    await supabase.from('client_apps').delete().eq('id', id);
    load();
  };

  if (loading) return <p className="text-xs text-gray-400 py-2">Loading...</p>;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Applications & Software</p>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
            <Plus className="w-3.5 h-3.5" /> Add App
          </button>
        )}
      </div>

      {apps.map(app => (
        <div key={app.id} className="bg-gray-50 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900"><span aria-hidden="true">{appKind(app.kind).icon}</span> {app.name}</p>
            {app.service_id && <p className="text-xs text-gray-400">en {servers.find(x => x.id === app.service_id)?.name ?? 'otro equipo'}</p>}
            {app.vendor && <p className="text-xs text-gray-500">{app.vendor}</p>}
            <div className="flex gap-2 mt-1">
              {app.support_phone && <a href={`tel:${app.support_phone}`} className="text-xs text-blue-600">{app.support_phone}</a>}
              {app.whatsapp_url && <a href={app.whatsapp_url} target="_blank" rel="noopener noreferrer" className="text-xs text-emerald-600">WhatsApp</a>}
            </div>
            {app.notes && <p className="text-xs text-gray-400 mt-0.5">{app.notes}</p>}
          </div>
          <button onClick={() => handleDelete(app.id)} className="text-gray-300 hover:text-red-500 shrink-0 mt-0.5">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {apps.length === 0 && !adding && (
        <p className="text-xs text-gray-400">No apps added yet.</p>
      )}

      {adding && (
        <div className="bg-blue-50 rounded-lg p-3 space-y-2 border border-blue-100">
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.kind} onChange={e => setDraft(d => ({ ...d, kind: e.target.value as AppKind }))} aria-label="Tipo"
              className="px-2 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500">
              {APP_KINDS.map(k => <option key={k.value} value={k.value}>{k.icon} {k.label}</option>)}
            </select>
            <select value={draft.service_id} onChange={e => setDraft(d => ({ ...d, service_id: e.target.value }))} aria-label="Equipo"
              className="px-2 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">Sin equipo (general)</option>
              {servers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              placeholder="App name *" className="col-span-2 px-2 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500" />
            <input value={draft.vendor} onChange={e => setDraft(d => ({ ...d, vendor: e.target.value }))}
              placeholder="Vendor" className="px-2 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500" />
            <input value={draft.support_phone} onChange={e => setDraft(d => ({ ...d, support_phone: e.target.value }))}
              placeholder="Support phone" className="px-2 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500" />
            <input value={draft.whatsapp_url} onChange={e => setDraft(d => ({ ...d, whatsapp_url: e.target.value }))}
              placeholder="WhatsApp URL" className="col-span-2 px-2 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500" />
            <textarea value={draft.notes} onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
              placeholder="Notes" rows={2}
              className="col-span-2 px-2 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving || !draft.name.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => { setAdding(false); setDraft(empty()); }}
              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
