import { useState, useEffect } from 'react';
import { X, Link, Trash2, Copy, Check, Plus, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import { supabase, Client, Service, ShareToken } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  client: Client;
  onClose: () => void;
};

function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function randomSuffix(length = 10): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => alphabet[b % alphabet.length]).join('');
}

function generateToken(clientName: string): string {
  const slug = slugify(clientName) || 'client';
  return `${slug}-${randomSuffix()}`;
}

function ServicePicker({
  services,
  selected,
  onChange,
}: {
  services: Service[];
  selected: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  const allSelected = selected.size === 0 || selected.size === services.length;

  const toggleAll = () => {
    onChange(new Set());
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      if (next.size === 0) { onChange(new Set()); return; }
    } else {
      next.add(id);
    }
    if (next.size === services.length) { onChange(new Set()); return; }
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 py-1 cursor-pointer group">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={toggleAll}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm font-medium text-gray-700">All services</span>
        {!allSelected && (
          <span className="text-xs text-gray-400">({selected.size} of {services.length} selected)</span>
        )}
      </label>
      <div className="ml-1 space-y-1 border-l-2 border-gray-100 pl-3">
        {services.map(s => (
          <label key={s.id} className="flex items-center gap-2 py-0.5 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected || selected.has(s.id)}
              onChange={() => toggle(s.id)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">{s.business_name || s.name}</span>
            {s.status !== 'Active' && (
              <span className="text-[10px] uppercase font-semibold text-amber-600 bg-amber-50 px-1.5 rounded">{s.status}</span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

export function ShareTokenModal({ client, onClose }: Props) {
  const { user } = useAuth();
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('Client Dashboard');
  const [showPicker, setShowPicker] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingToken, setEditingToken] = useState<string | null>(null);
  const [editSelected, setEditSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {
    const [{ data: tokensData }, { data: servicesData }] = await Promise.all([
      supabase.from('client_share_tokens').select('*').eq('client_id', client.id).order('created_at', { ascending: false }),
      supabase.from('services').select('id,name,business_name,status').eq('client_id', client.id).order('created_at'),
    ]);
    setTokens(tokensData || []);
    setServices(servicesData as Service[] || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, [client.id]);

  const serviceIdsForInsert = (sel: Set<string>): string[] | null => {
    if (sel.size === 0 || sel.size === services.length) return null;
    return Array.from(sel);
  };

  const createToken = async () => {
    setCreating(true);
    let token = generateToken(client.company_name);
    for (let attempt = 0; attempt < 5; attempt++) {
      const { error } = await supabase.from('client_share_tokens').insert({
        user_id: user!.id,
        client_id: client.id,
        token,
        label: newLabel || 'Client Dashboard',
        service_ids: serviceIdsForInsert(selectedIds),
      });
      if (!error) break;
      if (error.code !== '23505') break;
      token = generateToken(client.company_name);
    }
    await fetchAll();
    setCreating(false);
    setNewLabel('Client Dashboard');
    setSelectedIds(new Set());
    setShowPicker(false);
  };

  const deleteToken = async (id: string) => {
    await supabase.from('client_share_tokens').delete().eq('id', id);
    setTokens(tokens.filter(t => t.id !== id));
  };

  const startEdit = (token: ShareToken) => {
    setEditingToken(token.id);
    setEditSelected(token.service_ids ? new Set(token.service_ids) : new Set());
  };

  const saveEdit = async (tokenId: string) => {
    setSaving(true);
    await supabase
      .from('client_share_tokens')
      .update({ service_ids: serviceIdsForInsert(editSelected) })
      .eq('id', tokenId);
    await fetchAll();
    setEditingToken(null);
    setSaving(false);
  };

  const copyLink = (token: string, id: string) => {
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;

  const serviceCount = (t: ShareToken) =>
    t.service_ids && t.service_ids.length > 0 ? t.service_ids.length : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Share Dashboard</h2>
            <p className="text-sm text-gray-600 mt-0.5">{client.company_name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          <p className="text-sm text-gray-600">
            Generate a secure link to share a read-only dashboard. You can restrict which services are visible per link.
          </p>

          {/* Create new token */}
          <div className="space-y-3 border border-gray-200 rounded-lg p-4">
            <div className="flex gap-3">
              <input
                type="text"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Link label"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
              <button
                onClick={createToken}
                disabled={creating}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {creating ? 'Creating...' : 'New Link'}
              </button>
            </div>

            {services.length > 0 && (
              <div>
                <button
                  onClick={() => setShowPicker(!showPicker)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {showPicker ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  {selectedIds.size === 0
                    ? 'Filter services (all visible by default)'
                    : `${selectedIds.size} of ${services.length} services selected`}
                </button>
                {showPicker && (
                  <div className="mt-2.5 pt-2.5 border-t border-gray-100">
                    <ServicePicker services={services} selected={selectedIds} onChange={setSelectedIds} />
                  </div>
                )}
              </div>
            )}
          </div>

          {loading ? (
            <div className="text-center py-4 text-gray-500 text-sm">Loading...</div>
          ) : tokens.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-lg">
              No share links yet. Create one above.
            </div>
          ) : (
            <div className="space-y-3">
              {tokens.map(token => (
                <div key={token.id} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="font-medium text-sm text-gray-900">{token.label}</div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-gray-500">
                          Created {new Date(token.created_at).toLocaleDateString()}
                        </span>
                        {token.open_count > 0 ? (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600"
                            title={`Primer apertura: ${new Date(token.first_opened_at!).toLocaleString('es-UY')}`}
                          >
                            👁 {token.open_count} {token.open_count === 1 ? 'apertura' : 'aperturas'}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">no abierto</span>
                        )}
                        {serviceCount(token) !== null && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                            {serviceCount(token)} service{serviceCount(token) !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => editingToken === token.id ? setEditingToken(null) : startEdit(token)}
                        className="p-1.5 hover:bg-gray-100 text-gray-400 hover:text-gray-600 rounded-md transition-colors"
                        title="Edit services"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => copyLink(token.token, token.id)}
                        className="p-1.5 hover:bg-blue-50 text-gray-600 hover:text-blue-600 rounded-md transition-colors"
                        title="Copy link"
                      >
                        {copiedId === token.id ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => deleteToken(token.id)}
                        className="p-1.5 hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-md transition-colors"
                        title="Delete link"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 bg-gray-50 rounded-md px-3 py-1.5">
                    <Link className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-600 font-mono truncate">{shareUrl(token.token)}</span>
                  </div>

                  {/* Inline service editor */}
                  {editingToken === token.id && services.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100 space-y-3">
                      <p className="text-xs text-gray-500">Select which services this link can see:</p>
                      <ServicePicker services={services} selected={editSelected} onChange={setEditSelected} />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingToken(null)}
                          className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(token.id)}
                          disabled={saving}
                          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 pb-6 pt-2 border-t border-gray-100">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
