import { useMemo, useState } from 'react';
import { ExternalLink, Globe, Search, Copy, Check } from 'lucide-react';
import { Client, Service } from '../lib/supabase';
import { AnyDeskButton, anydeskIdOf } from './AnyDeskButton';

type Props = {
  services: Service[];
  clients: Client[];
};

type Entry = {
  service: Service;
  client: Client;
  domain: string | null;
  anydesk: string | null;
  hostname: string | null;
  os: string | null;
  tailscaleIp: string | null;
};

const STATUS_STYLE: Record<string, string> = {
  Active:    'bg-green-100 text-green-700',
  Suspended: 'bg-yellow-100 text-yellow-700',
  Cancelled: 'bg-red-100 text-red-700',
  Pending:   'bg-slate-100 text-slate-600',
};

const spec = (s: Service, k: string): string | null => {
  const v = (s.specifications as Record<string, unknown> | null)?.[k];
  return v != null && v !== '' ? String(v) : null;
};

/**
 * Referencia rápida de acceso a los equipos: AnyDesk, IPs (pública, LAN, Tailscale), dominio.
 * Casi todo lo completan solos los scripts (system-health, rdp-report) a través de ingest-heartbeat.
 */
export function InfrastructureView({ services, clients }: Props) {
  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [onlyAnydesk, setOnlyAnydesk] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map(c => [c.id, c])),
    [clients],
  );

  const entries = useMemo<Entry[]>(() => {
    return services
      .filter(s => s.status !== 'Cancelled')
      .map(s => ({
        service: s,
        client: clientMap[s.client_id],
        domain: s.reverse_proxy_domain ?? null,
        anydesk: anydeskIdOf(s),
        hostname: spec(s, 'hostname'),
        os: spec(s, 'os'),
        tailscaleIp: spec(s, 'tailscale_ip'),
      }))
      .filter(e => e.client && (e.domain || e.anydesk || e.tailscaleIp || e.service.ip_public || e.service.ip_internal || e.service.server_ip))
      .sort((a, b) => {
        const ca = a.client.company_name.toLowerCase();
        const cb = b.client.company_name.toLowerCase();
        return ca !== cb ? ca.localeCompare(cb) : (a.service.business_name || a.service.name).localeCompare(b.service.business_name || b.service.name);
      });
  }, [services, clientMap]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return entries.filter(e => {
      if (clientFilter !== 'all' && e.client.id !== clientFilter) return false;
      if (onlyAnydesk && !e.anydesk) return false;
      if (!q) return true;
      return [
        e.domain, e.anydesk, e.hostname, e.tailscaleIp, e.service.name, e.service.business_name,
        e.client.company_name, e.service.provider, e.service.ip_public, e.service.ip_internal, e.service.server_ip,
      ].some(v => (v ?? '').toLowerCase().includes(q));
    });
  }, [entries, search, clientFilter, onlyAnydesk]);

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

  const IpLine = ({ k, label, value, muted = false }: { k: string; label: string; value: string; muted?: boolean }) => (
    <button
      onClick={() => copyText(k, value)}
      title={`Copiar ${label}`}
      className={`group inline-flex items-center gap-1 font-mono text-xs ${muted ? 'text-slate-500' : 'text-gray-800'} hover:text-blue-700`}
    >
      <span className="text-[10px] font-sans text-gray-400 w-8 text-left">{label}</span>
      {value}
      {copiedId === k
        ? <Check className="w-3 h-3 text-green-500" />
        : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 text-gray-400" />}
    </button>
  );

  const withAnydesk = entries.filter(e => e.anydesk).length;

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
            {entries.length} {entries.length === 1 ? 'equipo' : 'equipos'} de {activeClients.length} {activeClients.length === 1 ? 'cliente' : 'clientes'} · {withAnydesk} con AnyDesk.
            {' '}IPs, AnyDesk y nombre del equipo se actualizan solos desde los scripts.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Equipo, IP, AnyDesk, dominio, cliente…"
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
          <option value="all">Todos los clientes</option>
          {activeClients.map(c => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
        </select>

        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={onlyAnydesk} onChange={e => setOnlyAnydesk(e.target.checked)} className="rounded border-gray-300" />
          Solo con AnyDesk
        </label>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">
          {entries.length === 0 ? 'Ningún servicio tiene IP, dominio o AnyDesk cargado.' : 'Nada coincide con los filtros.'}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cliente</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Equipo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">AnyDesk</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">IPs</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Dominio</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Proveedor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(({ service, client, domain, anydesk, hostname, os, tailscaleIp }) => {
                const publicIp = service.ip_public || service.server_ip;
                const lanIp = service.ip_internal && service.ip_internal !== publicIp ? service.ip_internal : null;
                return (
                  <tr key={service.id} className="hover:bg-slate-50 transition-colors align-top">
                    <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{client.company_name}</td>
                    <td className="px-4 py-3">
                      <div className="text-gray-800">{service.business_name || service.name}</div>
                      {(hostname || os) && (
                        <div className="text-xs text-gray-400">{[hostname, os].filter(Boolean).join(' · ')}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {anydesk ? <AnyDeskButton id={anydesk} /> : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {publicIp && <IpLine k={`pub-${service.id}`} label="WAN" value={publicIp} />}
                        {lanIp && <IpLine k={`lan-${service.id}`} label="LAN" value={lanIp} muted />}
                        {tailscaleIp && <IpLine k={`ts-${service.id}`} label="TS" value={tailscaleIp} muted />}
                        {!publicIp && !lanIp && !tailscaleIp && <span className="text-gray-300">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {domain ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openDomain(domain)}
                            className="font-mono text-xs text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 group"
                            title={`Abrir https://${domain}`}
                          >
                            {domain}
                            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          </button>
                          <button
                            onClick={() => copyText(`domain-${service.id}`, domain)}
                            className="text-gray-300 hover:text-gray-500 transition-colors shrink-0"
                            title="Copiar dominio"
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
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                      {service.provider || service.cloud_provider || <span className="text-gray-300">—</span>}
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
        </div>
      )}
    </div>
  );
}
