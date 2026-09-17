import { useMemo, useState, useEffect } from 'react';
import { ExternalLink, Globe, Search, Copy, Check } from 'lucide-react';
import { Client, Service, supabase } from '../lib/supabase';

type Props = {
  services: Service[];
  clients: Client[];
};

type Entry = {
  service: Service;
  client: Client;
  domain: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  Active:    'bg-green-100 text-green-700',
  Suspended: 'bg-yellow-100 text-yellow-700',
  Cancelled: 'bg-red-100 text-red-700',
  Pending:   'bg-slate-100 text-slate-600',
};

export function InfrastructureView({ services, clients }: Props) {
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [anydeskMap, setAnydeskMap] = useState<Record<string, string>>({});

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map(c => [c.id, c])),
    [clients],
  );

  useEffect(() => {
    const ids = services.map(s => s.id);
    if (ids.length === 0) return;
    supabase
      .from('service_heartbeats')
      .select('service_id, payload')
      .eq('source', 'rdp')
      .in('service_id', ids)
      .order('received_at', { ascending: false })
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        for (const hb of data) {
          if (!map[hb.service_id]) {
            const p = hb.payload as Record<string, unknown>;
            if (p?.anydesk_id) map[hb.service_id] = String(p.anydesk_id);
          }
        }
        setAnydeskMap(map);
      });
  }, [services]);

  const entries = useMemo<Entry[]>(() => {
    return services
      .filter(s => s.reverse_proxy_domain || anydeskMap[s.id])
      .map(s => ({
        service: s,
        client: clientMap[s.client_id],
        domain: s.reverse_proxy_domain ?? null,
      }))
      .filter(e => e.client)
      .sort((a, b) => {
        const ca = a.client.company_name.toLowerCase();
        const cb = b.client.company_name.toLowerCase();
        return ca !== cb ? ca.localeCompare(cb) : (a.domain ?? '').localeCompare(b.domain ?? '');
      });
  }, [services, clientMap, anydeskMap]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter(e => {
      if (clientFilter !== 'all' && e.client.id !== clientFilter) return false;
      if (!q) return true;
      const anydesk = anydeskMap[e.service.id] ?? '';
      return (
        (e.domain ?? '').toLowerCase().includes(q) ||
        e.service.name.toLowerCase().includes(q) ||
        e.client.company_name.toLowerCase().includes(q) ||
        (e.service.provider ?? '').toLowerCase().includes(q) ||
        anydesk.toLowerCase().includes(q)
      );
    });
  }, [entries, search, clientFilter, anydeskMap]);

  const activeClients = useMemo(() => {
    const ids = new Set(entries.map(e => e.client.id));
    return clients.filter(c => ids.has(c.id));
  }, [entries, clients]);

  function copyText(key: string, text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function openDomain(domain: string) {
    const url = domain.startsWith('http') ? domain : `https://${domain}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Globe className="w-5 h-5 text-blue-600" />
            Infrastructure
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {entries.length} {entries.length === 1 ? 'service' : 'services'} across {activeClients.length} {activeClients.length === 1 ? 'client' : 'clients'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Domain, AnyDesk, service, client…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
        </div>

        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All clients</option>
          {activeClients.map(c => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {entries.length === 0
            ? 'No services have a domain or AnyDesk configured.'
            : 'No results match your filters.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Service</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Domain</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">AnyDesk</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Provider</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(({ service, client, domain }) => {
                const anydesk = anydeskMap[service.id];
                return (
                  <tr key={service.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">
                      {client.company_name}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {service.name}
                    </td>
                    <td className="px-4 py-3">
                      {domain ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openDomain(domain)}
                            className="font-mono text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 group"
                            title={`Open https://${domain}`}
                          >
                            {domain}
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          </button>
                          <button
                            onClick={() => copyText(`domain-${service.id}`, domain)}
                            className="text-gray-300 hover:text-gray-500 transition-colors shrink-0"
                            title="Copy domain"
                          >
                            {copiedId === `domain-${service.id}`
                              ? <Check className="w-3.5 h-3.5 text-green-500" />
                              : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {anydesk ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-gray-700 text-xs">{anydesk}</span>
                          <button
                            onClick={() => copyText(`anydesk-${service.id}`, anydesk)}
                            className="text-gray-300 hover:text-gray-500 transition-colors shrink-0"
                            title="Copy AnyDesk ID"
                          >
                            {copiedId === `anydesk-${service.id}`
                              ? <Check className="w-3.5 h-3.5 text-green-500" />
                              : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {service.provider ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[service.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {service.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
