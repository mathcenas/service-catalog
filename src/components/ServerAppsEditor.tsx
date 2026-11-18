import { useEffect, useState } from 'react';
import { Plus, Trash2, Save, Sparkles } from 'lucide-react';
import { supabase, ClientApp, AppKind } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { APP_KINDS, appKind, DetectedRoles } from '../lib/appKinds';

// "Qué corre en este equipo": apps de proveedores, impresoras y carpetas compartidas, servicios.
// Se guarda en client_apps con service_id = este servicio. Lo que detecta el script de salud de
// Windows (payload.server_roles) aparece como sugerencia para sumar con un clic.

type Draft = { kind: AppKind; name: string; vendor: string; support_phone: string; whatsapp_url: string; notes: string };
const empty = (kind: AppKind = 'app', name = '', notes = ''): Draft => ({ kind, name, vendor: '', support_phone: '', whatsapp_url: '', notes });

export function ServerAppsEditor({ serviceId, clientId }: { serviceId: string; clientId: string }) {
  const { user } = useAuth();
  const [items, setItems] = useState<ClientApp[]>([]);
  const [detected, setDetected] = useState<{ kind: AppKind; name: string; notes: string }[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    const [{ data: apps }, { data: hb }] = await Promise.all([
      supabase.from('client_apps').select('*').eq('service_id', serviceId).order('kind').order('sort_order'),
      supabase.from('service_heartbeats').select('payload').eq('service_id', serviceId).eq('source', 'system-health')
        .order('received_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    const list = (apps ?? []) as ClientApp[];
    setItems(list);
    const roles = ((hb?.payload as Record<string, unknown> | null)?.server_roles ?? null) as DetectedRoles | null;
    const have = new Set(list.map(a => `${a.kind}:${a.name.toLowerCase()}`));
    const sug = [
      ...(roles?.shares ?? []).map(s => ({ kind: 'share' as AppKind, name: s.name, notes: [s.path, s.description].filter(Boolean).join(' — ') })),
      ...(roles?.printers ?? []).map(p => ({ kind: 'printer' as AppKind, name: p.share_name || p.name, notes: p.driver ?? '' })),
      ...(roles?.services ?? []).map(s => ({ kind: (/sql|postgres|mysql/i.test(s.svc) ? 'database' : 'service') as AppKind, name: s.name, notes: s.status ? `Servicio ${s.svc} (${s.status})` : `Servicio ${s.svc}` })),
    ].filter(x => !have.has(`${x.kind}:${x.name.toLowerCase()}`));
    setDetected(sug);
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [serviceId]);

  const save = async () => {
    if (!draft || !draft.name.trim() || !user) return;
    setSaving(true); setError('');
    const { error: err } = await supabase.from('client_apps').insert({
      user_id: user.id, client_id: clientId, service_id: serviceId, kind: draft.kind,
      name: draft.name.trim(),
      vendor: draft.vendor.trim() || null,
      support_phone: draft.support_phone.trim() || null,
      whatsapp_url: draft.whatsapp_url.trim() || null,
      notes: draft.notes.trim() || null,
      sort_order: items.length,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setDraft(null);
    load();
  };

  const remove = async (id: string) => {
    await supabase.from('client_apps').delete().eq('id', id);
    load();
  };

  const input = 'px-2 py-1.5 text-sm border border-gray-300 rounded-md outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500">Apps de proveedores, impresoras, carpetas compartidas y servicios que corren en este equipo. El cliente las ve en su portal, agrupadas por equipo y desplegables.</p>

      {items.map(a => {
        const k = appKind(a.kind);
        return (
          <div key={a.id} className="bg-gray-50 rounded-lg px-3 py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900"><span aria-hidden="true">{k.icon}</span> {a.name} <span className="text-xs font-normal text-gray-400">· {k.label}</span></p>
              {a.vendor && <p className="text-xs text-gray-500">{a.vendor}{a.support_phone ? ` · ${a.support_phone}` : ''}</p>}
              {a.notes && <p className="text-xs text-gray-400 mt-0.5">{a.notes}</p>}
            </div>
            <button type="button" onClick={() => remove(a.id)} className="text-gray-300 hover:text-red-500 shrink-0 mt-0.5" title="Quitar">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      {items.length === 0 && !draft && <p className="text-xs text-gray-400">Todavía no hay nada cargado en este equipo.</p>}

      {detected.length > 0 && !draft && (
        <div className="rounded-lg border border-dashed border-gray-300 p-2.5 space-y-1.5">
          <p className="text-xs font-medium text-gray-600 inline-flex items-center gap-1"><Sparkles className="w-3.5 h-3.5" /> Detectado en el equipo</p>
          <div className="flex flex-wrap gap-1.5">
            {detected.map(d => (
              <button key={`${d.kind}:${d.name}`} type="button" onClick={() => setDraft(empty(d.kind, d.name, d.notes))}
                className="inline-flex items-center gap-1 text-xs border border-gray-200 bg-white hover:border-blue-400 rounded-full px-2 py-0.5" title="Sumar a la lista">
                <span aria-hidden="true">{appKind(d.kind).icon}</span> {d.name} <Plus className="w-3 h-3 text-blue-600" />
              </button>
            ))}
          </div>
        </div>
      )}

      {draft ? (
        <div className="bg-blue-50 rounded-lg p-3 space-y-2 border border-blue-100">
          <div className="grid grid-cols-2 gap-2">
            <select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as AppKind })} className={input} aria-label="Tipo">
              {APP_KINDS.map(k => <option key={k.value} value={k.value}>{k.icon} {k.label}</option>)}
            </select>
            <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Nombre *" className={input} />
            <input value={draft.vendor} onChange={e => setDraft({ ...draft, vendor: e.target.value })} placeholder="Proveedor" className={input} />
            <input value={draft.support_phone} onChange={e => setDraft({ ...draft, support_phone: e.target.value })} placeholder="Teléfono de soporte" className={input} />
            <input value={draft.whatsapp_url} onChange={e => setDraft({ ...draft, whatsapp_url: e.target.value })} placeholder="Link de WhatsApp" className={`col-span-2 ${input}`} />
            <textarea value={draft.notes} onChange={e => setDraft({ ...draft, notes: e.target.value })} placeholder="Notas (ruta, puerto, quién lo usa…)" rows={2} className={`col-span-2 resize-none ${input}`} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={saving || !draft.name.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-md disabled:opacity-50">
              <Save className="w-3.5 h-3.5" /> {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" onClick={() => setDraft(null)} className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-md">Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setDraft(empty())} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
          <Plus className="w-3.5 h-3.5" /> Agregar
        </button>
      )}
    </div>
  );
}
