import { useState, useEffect } from 'react';
import { Plus, Trash2, Mail } from 'lucide-react';
import { ClientContact, supabase } from '../lib/supabase';

const FREQ_LABELS: Record<string, string> = {
  none: 'Sin digest',
  daily: 'Diario',
  weekly: 'Semanal',
};

const FREQ_COLORS: Record<string, string> = {
  none: 'bg-gray-100 text-gray-500',
  daily: 'bg-blue-100 text-blue-700',
  weekly: 'bg-violet-100 text-violet-700',
};

type Props = { clientId: string; userId: string };

export function ClientContactsPanel({ clientId, userId }: Props) {
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: '', digest_frequency: 'none' as ClientContact['digest_frequency'] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('client_contacts')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at');
    setContacts(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId]);

  const handleAdd = async () => {
    if (!form.name.trim() || !form.email.trim()) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('client_contacts').insert({
      user_id: userId,
      client_id: clientId,
      name: form.name.trim(),
      email: form.email.trim(),
      role: form.role.trim() || null,
      digest_frequency: form.digest_frequency,
    });
    if (err) { setError(err.message); setSaving(false); return; }
    setForm({ name: '', email: '', role: '', digest_frequency: 'none' });
    setAdding(false);
    setSaving(false);
    load();
  };

  const handleFreqChange = async (id: string, freq: ClientContact['digest_frequency']) => {
    await supabase.from('client_contacts').update({ digest_frequency: freq }).eq('id', id);
    setContacts(cs => cs.map(c => c.id === id ? { ...c, digest_frequency: freq } : c));
  };

  const handleDelete = async (id: string) => {
    await supabase.from('client_contacts').delete().eq('id', id);
    setContacts(cs => cs.filter(c => c.id !== id));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">Contactos</p>
          <p className="text-xs text-gray-400 mt-0.5">Configurá el digest por contacto</p>
        </div>
        <button
          type="button"
          onClick={() => setAdding(a => !a)}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Agregar
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-gray-400">Cargando...</p>
      ) : contacts.length === 0 ? (
        <p className="text-xs text-gray-400 italic">Sin contactos cargados</p>
      ) : (
        <div className="space-y-2">
          {contacts.map(c => (
            <div key={c.id} className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-200">
              <Mail className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-gray-800 truncate">{c.name}</span>
                  {c.role && <span className="text-xs text-gray-400">· {c.role}</span>}
                </div>
                <span className="text-xs text-gray-500 truncate block">{c.email}</span>
              </div>
              <select
                value={c.digest_frequency}
                onChange={e => handleFreqChange(c.id, e.target.value as ClientContact['digest_frequency'])}
                className={`text-xs px-2 py-1 rounded border-0 font-medium cursor-pointer outline-none ${FREQ_COLORS[c.digest_frequency]}`}
              >
                {Object.entries(FREQ_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleDelete(c.id)}
                className="p-1 hover:bg-red-50 rounded text-gray-300 hover:text-red-500 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Nombre *"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-400"
            />
            <input
              type="text"
              placeholder="Rol (ej: Gerente)"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <input
            type="email"
            placeholder="Email *"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-400"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-600">Digest:</label>
            {Object.entries(FREQ_LABELS).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => setForm(f => ({ ...f, digest_frequency: v as ClientContact['digest_frequency'] }))}
                className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                  form.digest_frequency === v ? FREQ_COLORS[v] + ' ring-1 ring-offset-1 ring-current' : 'bg-white text-gray-400 border border-gray-200'
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => setAdding(false)}
              className="flex-1 text-xs py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-white transition-colors">
              Cancelar
            </button>
            <button type="button" onClick={handleAdd} disabled={saving}
              className="flex-1 text-xs py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
