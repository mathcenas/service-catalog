import { useState, useMemo } from 'react';
import { Mail, Phone, Building2, Share2, Search, MoreHorizontal, Pencil, Trash2, Server, ExternalLink } from 'lucide-react';
import { Client, Service, supabase } from '../lib/supabase';
import { EditClientModal } from './EditClientModal';
import { ShareTokenModal } from './ShareTokenModal';

type Props = {
  clients: Client[];
  services: Service[];
  onUpdate: () => void;
};

export function ClientList({ clients, services, onUpdate }: Props) {
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [sharingClient, setSharingClient] = useState<Client | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Inactive' | 'Pending'>('all');
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const serviceCountMap = useMemo(() => {
    const map = new Map<string, number>();
    services.forEach(s => {
      if (s.status === 'Active') {
        map.set(s.client_id, (map.get(s.client_id) || 0) + 1);
      }
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
            return (
              <div
                key={client.id}
                className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50/60 transition-colors group"
              >
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
                <div className="hidden md:flex items-center gap-4 shrink-0">
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
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0 relative">
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
    </>
  );
}
