import { useState, useEffect } from 'react';
import { MapPin, Copy, Check, Plus, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Site = {
  id: string;
  name: string;
  city?: string;
  address?: string;
  notes?: string;
};

type Props = { clientId: string };

export function ClientSitesPanel({ clientId }: Props) {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCity, setEditCity] = useState('');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('');

  const load = async () => {
    const { data } = await supabase
      .from('sites')
      .select('id, name, city, address, notes')
      .eq('client_id', clientId)
      .order('name');
    setSites((data ?? []) as Site[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [clientId]);

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  const startEdit = (s: Site) => {
    setEditing(s.id);
    setEditName(s.name);
    setEditCity(s.city ?? '');
  };

  const saveEdit = async (id: string) => {
    await supabase.from('sites').update({ name: editName, city: editCity || null }).eq('id', id);
    setEditing(null);
    await load();
  };

  const deleteSite = async (id: string) => {
    if (!confirm('¿Eliminar este site? Se borrarán todos los dispositivos y links asociados.')) return;
    await supabase.from('sites').delete().eq('id', id);
    await load();
  };

  const addSite = async () => {
    if (!newName.trim()) return;
    await supabase.from('sites').insert({ client_id: clientId, name: newName.trim(), city: newCity.trim() || null });
    setAdding(false);
    setNewName('');
    setNewCity('');
    await load();
  };

  if (loading) return <div className="px-5 py-3 text-xs text-gray-400">Cargando sites…</div>;

  return (
    <div className="px-5 py-4 bg-gray-50/50 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" /> Ubicaciones (Sites)
        </h4>
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
          <Plus className="w-3.5 h-3.5" /> Agregar
        </button>
      </div>

      <div className="space-y-2">
        {sites.map(s => (
          <div key={s.id} className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
            {editing === s.id ? (
              <div className="flex items-center gap-2">
                <input value={editName} onChange={e => setEditName(e.target.value)}
                  className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  placeholder="Nombre" />
                <input value={editCity} onChange={e => setEditCity(e.target.value)}
                  className="w-32 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  placeholder="Ciudad" />
                <button onClick={() => saveEdit(s.id)}
                  className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700">Guardar</button>
                <button onClick={() => setEditing(null)}
                  className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900">{s.name}</span>
                    {s.city && <span className="text-xs text-gray-400">{s.city}</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <code className="text-xs text-gray-400 font-mono">{s.id}</code>
                    <button onClick={() => copyId(s.id)}
                      className="text-gray-300 hover:text-blue-500 transition-colors"
                      title="Copiar site_id">
                      {copied === s.id
                        ? <Check className="w-3 h-3 text-emerald-500" />
                        : <Copy className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => startEdit(s)}
                    className="p-1 text-gray-300 hover:text-gray-500 rounded">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteSite(s.id)}
                    className="p-1 text-gray-300 hover:text-red-500 rounded">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {sites.length === 0 && !adding && (
          <p className="text-xs text-gray-400 py-1">Sin ubicaciones registradas.</p>
        )}

        {adding && (
          <div className="bg-white border border-blue-200 rounded-lg px-3 py-2.5 flex items-center gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              autoFocus
              className="flex-1 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
              placeholder="Nombre (ej: Oficina Principal)" />
            <input value={newCity} onChange={e => setNewCity(e.target.value)}
              className="w-32 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
              placeholder="Ciudad" />
            <button onClick={addSite}
              className="text-xs bg-blue-600 text-white px-2.5 py-1 rounded hover:bg-blue-700">Guardar</button>
            <button onClick={() => setAdding(false)}
              className="text-xs text-gray-400 hover:text-gray-600">Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}
