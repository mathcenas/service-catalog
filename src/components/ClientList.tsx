import { useState, useMemo } from 'react';
import { Mail, Phone, Building2, Share2, Search, MoreHorizontal, Pencil, Trash2, Server, ExternalLink, AppWindow, FileText, AlertTriangle, Check, Newspaper } from 'lucide-react';
import { Client, Service, supabase } from '../lib/supabase';
import { EditClientModal } from './EditClientModal';
import { ShareTokenModal } from './ShareTokenModal';
import { ClientAppsManager } from './ClientAppsManager';
import { ClientBriefModal } from './ClientBriefModal';

type Props = {
  clients: Client[];
  services: Service[];
  onUpdate: () => void;
};

const RISK_CATEGORIES: { label: string; flags: { id: string; label: string }[] }[] = [
  {
    label: 'Conectividad',
    flags: [{ id: 'no_isp_redundancy', label: 'Sin redundancia de internet (ISP único)' }],
  },
  {
    label: 'Backups',
    flags: [
      { id: 'no_endpoint_backup', label: 'Sin backup de endpoints' },
      { id: 'no_offsite_backup', label: 'Sin backup offsite' },
      { id: 'no_321_rule', label: 'No cumple regla 3-2-1' },
    ],
  },
  {
    label: 'Infraestructura',
    flags: [{ id: 'no_ups', label: 'Sin UPS' }],
  },
  {
    label: 'Seguridad',
    flags: [
      { id: 'no_mfa', label: 'Sin doble factor de autenticación' },
      { id: 'no_password_manager', label: 'Sin gestión centralizada de contraseñas' },
      { id: 'free_antivirus', label: 'Antivirus gratuito (sin gestión centralizada)' },
    ],
  },
  {
    label: 'Continuidad',
    flags: [{ id: 'no_bco_plan', label: 'Sin plan de BCO documentado' }],
  },
];

const RESTORE_TEST_MAX_DAYS = 90;

function isRestoreTestStale(services: Service[]): boolean {
  return services.every(s => {
    if (!s.last_restore_test_at) return true;
    const days = (Date.now() - new Date(s.last_restore_test_at).getTime()) / 86400000;
    return days > RESTORE_TEST_MAX_DAYS;
  });
}

function RiskFlagsPanel({
  client,
  clientServices,
  onSaved,
}: {
  client: Client;
  clientServices: Service[];
  onSaved: (flags: string[]) => void;
}) {
  const [flags, setFlags] = useState<string[]>(client.risk_flags ?? []);
  const [saving, setSaving] = useState(false);
  const autoRestoreStale = isRestoreTestStale(clientServices);

  const toggle = (id: string) =>
    setFlags(prev => prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]);

  const save = async () => {
    setSaving(true);
    await supabase.from('clients').update({ risk_flags: flags }).eq('id', client.id);
    setSaving(false);
    onSaved(flags);
  };

  return (
    <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50 flex flex-col gap-4">
      {/* Auto-detected */}
      {autoRestoreStale && (
        <div className="flex items-start gap-2.5 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2.5">
          <span className="text-xs font-bold text-violet-700 bg-violet-200 rounded-full w-5 h-5 flex items-center justify-center shrink-0 mt-0.5">⚡</span>
          <div>
            <p className="text-xs font-semibold text-violet-700">Sin pruebas de restauración periódicas</p>
            <p className="text-xs text-violet-500 mt-0.5">Detectado automáticamente — ningún servicio registra restore test en los últimos {RESTORE_TEST_MAX_DAYS} días</p>
          </div>
        </div>
      )}

      {/* Manual flags */}
      {RISK_CATEGORIES.map(cat => (
        <div key={cat.label} className="flex flex-col gap-1">
          <p className="text-[10px] font-bold tracking-widest uppercase text-gray-400 pb-1 border-b border-gray-100">{cat.label}</p>
          {cat.flags.map(flag => {
            const checked = flags.includes(flag.id);
            return (
              <label key={flag.id} className="flex items-center gap-2.5 py-1 px-1 rounded-md cursor-pointer hover:bg-gray-100 transition-colors">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(flag.id)}
                  className="w-3.5 h-3.5 rounded accent-red-500 cursor-pointer"
                />
                <span className={`text-sm ${checked ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                  {flag.label}
                </span>
              </label>
            );
          })}
        </div>
      ))}

      {/* Save row */}
      <div className="flex justify-end gap-2 pt-1 border-t border-gray-100">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
        >
          <Check className="w-3 h-3" />
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}

export function ClientList({ clients, services, onUpdate }: Props) {
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [sharingClient, setSharingClient] = useState<Client | null>(null);
  const [digestPreview, setDigestPreview] = useState<{ html: string; name: string } | null>(null);
  const [loadingDigest, setLoadingDigest] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive' | 'Pending'>('all');
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [expandedApps, setExpandedApps] = useState<string | null>(null);
  const [expandedRisks, setExpandedRisks] = useState<string | null>(null);
  const [briefClient, setBriefClient] = useState<Client | null>(null);
  const [clientRiskFlags, setClientRiskFlags] = useState<Record<string, string[]>>({});

  async function previewDigest(client: Client) {
    setLoadingDigest(client.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const SUPABASE_URL = (supabase as any).supabaseUrl as string;
      const res = await fetch(`${SUPABASE_URL}/functions/v1/client-weekly-digest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
          'apikey': (supabase as any).supabaseKey as string,
        },
        body: JSON.stringify({ preview: true, client_id: client.id }),
      });
      const json = await res.json();
      if (json.html) setDigestPreview({ html: json.html, name: client.company_name });
    } catch (e) {
      console.error('digest preview error', e);
    }
    setLoadingDigest(null);
  }

  const serviceCountMap = useMemo(() => {
    const map = new Map<string, number>();
    services.forEach(s => {
      if (s.status === 'Active') {
        map.set(s.client_id, (map.get(s.client_id) || 0) + 1);
      }
    });
    return map;
  }, [services]);

  const servicesByClient = useMemo(() => {
    const map = new Map<string, Service[]>();
    services.forEach(s => {
      const list = map.get(s.client_id) ?? [];
      list.push(s);
      map.set(s.client_id, list);
    });
    return map;
  }, [services]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return clients.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return [c.company_name, c.contact_name, c.email, c.phone, c.address]
        .filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [clients, query, statusFilter]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this client and all associated services?')) return;
    setDeletingId(id);
    await supabase.from('clients').delete().eq('id', id);
    setDeletingId(null);
    setOpenMenu(null);
    onUpdate();
  };

  const getRiskCount = (client: Client) => {
    const flags = clientRiskFlags[client.id] ?? client.risk_flags ?? [];
    const clientSvcs = servicesByClient.get(client.id) ?? [];
    const autoCount = isRestoreTestStale(clientSvcs) ? 1 : 0;
    return flags.length + autoCount;
  };

  if (clients.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
        <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No clients yet</h3>
        <p className="text-gray-500 text-sm">Get started by adding your first client.</p>
      </div>
    );
  }

  const statusCounts = {
    all: clients.length,
    Active: clients.filter(c => c.status === 'Active').length,
    Inactive: clients.filter(c => c.status === 'Inactive').length,
    Pending: clients.filter(c => c.status === 'Pending').length,
  };

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {/* Toolbar */}
        <div className="px-5 py-3 border-b border-gray-100 flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="relative flex-1 w-full sm:max-w-xs">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search clients..."
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white outline-none transition-colors"
            />
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 text-xs font-medium">
            {(['all', 'Active', 'Inactive', 'Pending'] as const).map(key => {
              const count = statusCounts[key];
              if (key !== 'all' && count === 0) return null;
              return (
                <button key={key} onClick={() => setStatusFilter(key)}
                  className={`px-2.5 py-1.5 rounded-md transition-colors ${
                    statusFilter === key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
                  }`}>
                  {key === 'all' ? 'All' : key} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* List */}
        <div className="divide-y divide-gray-100">
          {filtered.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">
              No clients match your search.
            </div>
          ) : filtered.map(client => {
            const svcCount = serviceCountMap.get(client.id) || 0;
            const riskCount = getRiskCount(client);
            const clientSvcs = servicesByClient.get(client.id) ?? [];
            const isRisksOpen = expandedRisks === client.id;
            const isAppsOpen = expandedApps === client.id;

            return (
              <div key={client.id} className="divide-y divide-gray-100">
                {/* Row */}
                <div className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50/60 transition-colors group">
                  {/* Avatar */}
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                    client.status === 'Active' ? 'bg-blue-50 text-blue-700' :
                    client.status === 'Inactive' ? 'bg-gray-100 text-gray-500' :
                    'bg-amber-50 text-amber-700'
                  }`}>
                    {client.company_name.charAt(0).toUpperCase()}
                  </div>

                  {/* Main info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900 truncate">{client.company_name}</span>
                      <span className={`shrink-0 w-2 h-2 rounded-full ${
                        client.status === 'Active' ? 'bg-emerald-500' :
                        client.status === 'Inactive' ? 'bg-gray-300' :
                        'bg-amber-400'
                      }`} title={client.status} />
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-gray-500 truncate">{client.contact_name}</span>
                      {client.email && (
                        <span className="hidden sm:inline-flex items-center gap-1 text-xs text-gray-400">
                          <Mail className="w-3 h-3" /> {client.email}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="hidden md:flex items-center gap-3 shrink-0">
                    {client.phone && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                        <Phone className="w-3 h-3" /> {client.phone}
                      </span>
                    )}
                    {svcCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                        <Server className="w-3 h-3" /> {svcCount}
                      </span>
                    )}
                    {riskCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" /> {riskCount}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 relative">
                    <button
                      onClick={() => { setExpandedRisks(isRisksOpen ? null : client.id); setExpandedApps(null); }}
                      className={`p-2 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${isRisksOpen ? 'text-red-600 bg-red-50 opacity-100' : 'text-gray-400 hover:text-red-500 hover:bg-red-50'} ${riskCount > 0 ? 'opacity-100' : ''}`}
                      title="Riesgos / Alcance"
                    >
                      <AlertTriangle className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setExpandedApps(isAppsOpen ? null : client.id); setExpandedRisks(null); }}
                      className={`p-2 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${isAppsOpen ? 'text-violet-600 bg-violet-50 opacity-100' : 'text-gray-400 hover:text-violet-600 hover:bg-violet-50'}`}
                      title="Apps & Software"
                    >
                      <AppWindow className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setBriefClient(client)}
                      className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title="Generar resumen"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setSharingClient(client)}
                      className="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title="Share portal"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setEditingClient(client)}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <div className="relative">
                      <button
                        onClick={() => setOpenMenu(openMenu === client.id ? null : client.id)}
                        className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {openMenu === client.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                          <div className="absolute right-0 top-full mt-1 bg-white rounded-lg border border-gray-200 shadow-lg z-20 py-1 w-40">
                            <button
                              onClick={() => { setEditingClient(client); setOpenMenu(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                            <button
                              onClick={() => { setSharingClient(client); setOpenMenu(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <Share2 className="w-3.5 h-3.5" /> Share Portal
                            </button>
                            {client.digest_enabled && (
                              <button
                                onClick={() => { previewDigest(client); setOpenMenu(null); }}
                                disabled={loadingDigest === client.id}
                                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                              >
                                <Newspaper className="w-3.5 h-3.5" />
                                {loadingDigest === client.id ? 'Cargando…' : 'Preview Digest'}
                              </button>
                            )}
                            <div className="border-t border-gray-100 my-1" />
                            <button
                              onClick={() => handleDelete(client.id)}
                              disabled={deletingId === client.id}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Apps panel */}
                {isAppsOpen && (
                  <div className="px-5 py-4 bg-gray-50/50">
                    <ClientAppsManager clientId={client.id} />
                  </div>
                )}

                {/* Risk flags panel */}
                {isRisksOpen && (
                  <RiskFlagsPanel
                    client={{ ...client, risk_flags: clientRiskFlags[client.id] ?? client.risk_flags ?? [] }}
                    clientServices={clientSvcs}
                    onSaved={flags => setClientRiskFlags(prev => ({ ...prev, [client.id]: flags }))}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 bg-gray-50/60 border-t border-gray-100 text-xs text-gray-500">
          {filtered.length} of {clients.length} clients
        </div>
      </div>

      {editingClient && (
        <EditClientModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSuccess={() => {
            setEditingClient(null);
            onUpdate();
          }}
        />
      )}

      {sharingClient && (
        <ShareTokenModal
          client={sharingClient}
          onClose={() => setSharingClient(null)}
        />
      )}

      {briefClient && (
        <ClientBriefModal
          client={briefClient}
          onClose={() => setBriefClient(null)}
        />
      )}

      {/* Digest preview modal */}
      {digestPreview && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">Preview — Resumen Semanal</p>
                <p className="font-semibold text-gray-900">{digestPreview.name}</p>
              </div>
              <button onClick={() => setDigestPreview(null)} className="text-gray-400 hover:text-gray-600">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-slate-50">
              <iframe
                srcDoc={digestPreview.html}
                title="Digest preview"
                className="w-full rounded border border-gray-200 bg-white"
                style={{ minHeight: 600 }}
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
