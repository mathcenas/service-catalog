import { useState, useEffect } from 'react';
import { X, Link, Trash2, Copy, Check, Plus } from 'lucide-react';
import { supabase, Client, ShareToken } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Props = {
  client: Client;
  onClose: () => void;
};

function generateToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

export function ShareTokenModal({ client, onClose }: Props) {
  const { user } = useAuth();
  const [tokens, setTokens] = useState<ShareToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('Client Dashboard');

  const fetchTokens = async () => {
    const { data } = await supabase
      .from('client_share_tokens')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false });
    setTokens(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchTokens(); }, [client.id]);

  const createToken = async () => {
    setCreating(true);
    const token = generateToken();
    await supabase.from('client_share_tokens').insert({
      user_id: user!.id,
      client_id: client.id,
      token,
      label: newLabel || 'Client Dashboard',
    });
    await fetchTokens();
    setCreating(false);
    setNewLabel('Client Dashboard');
  };

  const deleteToken = async (id: string) => {
    await supabase.from('client_share_tokens').delete().eq('id', id);
    setTokens(tokens.filter(t => t.id !== id));
  };

  const copyLink = (token: string, id: string) => {
    const url = `${window.location.origin}/share/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const shareUrl = (token: string) => `${window.location.origin}/share/${token}`;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Share Dashboard</h2>
            <p className="text-sm text-gray-600 mt-0.5">{client.company_name}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <p className="text-sm text-gray-600">
            Generate a secure link to share a read-only dashboard with your client. They can view their services, costs, and renewal dates without logging in.
          </p>

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
                      <div className="text-xs text-gray-500 mt-0.5">
                        Created {new Date(token.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
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
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 pb-6">
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
