import { useEffect, useState } from 'react';
import { Mail, ChevronDown, ChevronUp, ExternalLink, Copy, Check, Plus } from 'lucide-react';
import { supabase, Client } from '../lib/supabase';

type Token = {
  id: string;
  token: string;
  client_id: string | null;
  client_name: string;
  expires_at: string;
  created_at: string;
};

type Account = {
  email: string;
  description?: string;
  screenshot?: string | null;
};

type Submission = {
  id: string;
  token_id: string;
  contact_name: string;
  accounts: Account[];
  submitted_at: string;
};

type Props = { clients: Client[] };

export function EmailAuditAdminView({ clients }: Props) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Create token modal state
  const [showCreate, setShowCreate] = useState(false);
  const [createClientId, setCreateClientId] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [{ data: toks }, { data: subs }] = await Promise.all([
      supabase
        .from('email_audit_tokens')
        .select('*')
        .order('created_at', { ascending: false }),
      supabase
        .from('email_audit_submissions')
        .select('*')
        .order('submitted_at', { ascending: false }),
    ]);
    setTokens(toks ?? []);
    setSubmissions(subs ?? []);
    setLoading(false);
  }

  async function createToken() {
    if (!createClientId) return;
    setCreating(true);
    const client = clients.find(c => c.id === createClientId);
    const { error } = await supabase.from('email_audit_tokens').insert({
      client_id:   createClientId,
      client_name: client?.company_name ?? createClientId,
    });
    setCreating(false);
    if (!error) {
      setShowCreate(false);
      setCreateClientId('');
      load();
    }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/email-audit/${token}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 1500);
  }

  function toggleExpand(tokenId: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(tokenId) ? next.delete(tokenId) : next.add(tokenId);
      return next;
    });
  }

  const subsForToken = (tokenId: string) =>
    submissions.filter(s => s.token_id === tokenId);

  const origin = window.location.origin;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Cargando…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-600" />
            Email Audit
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {tokens.length} {tokens.length === 1 ? 'enlace' : 'enlaces'} · {submissions.length} {submissions.length === 1 ? 'respuesta' : 'respuestas'}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nuevo enlace
        </button>
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-semibold text-gray-900 mb-4">Nuevo enlace de auditoría</h3>
            <label className="block text-sm text-gray-600 mb-1">Cliente</label>
            <select
              value={createClientId}
              onChange={e => setCreateClientId(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Seleccioná un cliente —</option>
              {clients.filter(c => c.status === 'Active').map(c => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowCreate(false); setCreateClientId(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancelar
              </button>
              <button
                onClick={createToken}
                disabled={!createClientId || creating}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {creating ? 'Creando…' : 'Crear enlace'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Token list */}
      {tokens.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          No hay enlaces creados todavía.
        </div>
      ) : (
        <div className="space-y-3">
          {tokens.map(tok => {
            const subs = subsForToken(tok.id);
            const isOpen = expanded.has(tok.id);
            const expired = new Date(tok.expires_at) < new Date();
            const link = `${origin}/email-audit/${tok.token}`;

            return (
              <div key={tok.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Token row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800">{tok.client_name}</span>
                      {expired ? (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600">expirado</span>
                      ) : (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">activo</span>
                      )}
                      <span className="text-xs text-gray-400">
                        vence {new Date(tok.expires_at).toLocaleDateString('es-UY')}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:underline font-mono truncate max-w-xs"
                      >
                        {link}
                      </a>
                      <ExternalLink className="w-3 h-3 text-gray-300 shrink-0" />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm text-gray-500">
                      {subs.length} {subs.length === 1 ? 'respuesta' : 'respuestas'}
                    </span>
                    <button
                      onClick={() => copyLink(tok.token)}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      title="Copiar enlace"
                    >
                      {copiedToken === tok.token
                        ? <Check className="w-4 h-4 text-green-500" />
                        : <Copy className="w-4 h-4" />}
                    </button>
                    {subs.length > 0 && (
                      <button
                        onClick={() => toggleExpand(tok.id)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        {isOpen
                          ? <ChevronUp className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Submissions */}
                {isOpen && subs.length > 0 && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {subs.map(sub => (
                      <div key={sub.id} className="px-4 py-3 bg-slate-50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm text-gray-700">{sub.contact_name}</span>
                          <span className="text-xs text-gray-400">
                            {new Date(sub.submitted_at).toLocaleString('es-UY')}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {(sub.accounts as Account[]).map((acc, i) => (
                            <div key={i} className="flex items-start gap-3 bg-white rounded-lg border border-gray-100 px-3 py-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-mono text-blue-700">{acc.email}</p>
                                {acc.description && (
                                  <p className="text-xs text-gray-500 mt-0.5">{acc.description}</p>
                                )}
                              </div>
                              {acc.screenshot && (
                                <a
                                  href={acc.screenshot}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0"
                                >
                                  <img
                                    src={acc.screenshot}
                                    alt="screenshot"
                                    className="w-16 h-12 object-cover rounded border border-gray-200 hover:opacity-80 transition-opacity"
                                  />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
