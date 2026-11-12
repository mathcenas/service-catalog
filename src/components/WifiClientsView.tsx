import { useEffect, useMemo, useState } from 'react';
import { Wifi, Download, Search, Smartphone } from 'lucide-react';
import { supabase, type Service, type Client } from '../lib/supabase';
import { BRAND, pdfHeader, pdfSection, openPrintWindow } from '../lib/pdfBrand';

type WifiClient = {
  id: string;
  service_id: string;
  client_id: string | null;
  mac: string;
  ip: string | null;
  hostname: string | null;
  comment: string | null;
  ssid: string | null;
  signal: number | null;
  tx_rate: string | null;
  uptime: string | null;
  connected: boolean;
  first_seen: string;
  last_seen: string;
};

type DeviceOwner = { hostname: string; ip: string | null; local_user: string | null; m365_user: string | null };

type Range = 'now' | '7' | '30';
const RANGE_LABEL: Record<Range, string> = { now: 'Conectados ahora', '7': 'Últimos 7 días', '30': 'Últimos 30 días' };

/** MAC privada / aleatoria (iPhone, Android, Windows): bit "localmente administrada" */
const isRandomMac = (mac: string) => /^.[26AE]/i.test(mac);

const fmt = (iso: string) => new Date(iso).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' });

function signalLabel(dbm: number | null): { text: string; cls: string } {
  if (dbm === null) return { text: '—', cls: 'text-gray-400' };
  if (dbm >= -60) return { text: `${dbm} dBm · buena`, cls: 'text-emerald-700' };
  if (dbm >= -70) return { text: `${dbm} dBm · aceptable`, cls: 'text-amber-700' };
  return { text: `${dbm} dBm · débil`, cls: 'text-red-600' };
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function WifiClientsView({ services, clients, logoUrl }: { services: Service[]; clients: Client[]; logoUrl?: string | null }) {
  const [rows, setRows] = useState<WifiClient[]>([]);
  const [owners, setOwners] = useState<DeviceOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [serviceId, setServiceId] = useState<string>('');
  const [range, setRange] = useState<Range>('7');
  const [search, setSearch] = useState('');

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [{ data }, { data: devs }] = await Promise.all([
        supabase.from('wifi_clients')
          .select('id, service_id, client_id, mac, ip, hostname, comment, ssid, signal, tx_rate, uptime, connected, first_seen, last_seen')
          .gte('last_seen', since)
          .order('last_seen', { ascending: false })
          .limit(5000),
        supabase.from('device_reports').select('hostname, ip, local_user, m365_user'),
      ]);
      const list = (data as WifiClient[]) || [];
      setRows(list);
      setOwners((devs as DeviceOwner[]) || []);
      setServiceId(prev => prev || list[0]?.service_id || '');
      setLoading(false);
    })();
  }, []);

  const routerIds = useMemo(() => Array.from(new Set(rows.map(r => r.service_id))), [rows]);
  const svc = services.find(s => s.id === serviceId);
  const client = clients.find(c => c.id === svc?.client_id);

  // Usuario del equipo según device-report.ps1 (por IP o por nombre)
  const ownerOf = (r: WifiClient) => {
    const host = (r.hostname || '').toUpperCase();
    const o = owners.find(d => (r.ip && d.ip === r.ip) || (host && d.hostname === host));
    return o ? (o.m365_user || o.local_user || '') : '';
  };

  const visible = useMemo(() => {
    const cutoff = range === 'now' ? 0 : Date.now() - Number(range) * 86_400_000;
    const q = search.trim().toLowerCase();
    return rows
      .filter(r => r.service_id === serviceId)
      .filter(r => (range === 'now' ? r.connected : new Date(r.last_seen).getTime() >= cutoff))
      .filter(r => !q || [r.hostname, r.comment, r.ip, r.mac, r.ssid].some(v => (v || '').toLowerCase().includes(q)))
      .sort((a, b) => Number(b.connected) - Number(a.connected) || b.last_seen.localeCompare(a.last_seen));
  }, [rows, serviceId, range, search]);

  const bySsid = useMemo(() => {
    const m = new Map<string, number>();
    visible.forEach(r => m.set(r.ssid || 'Sin SSID', (m.get(r.ssid || 'Sin SSID') ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [visible]);

  const exportPdf = () => {
    const now = new Date().toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const routerName = svc?.business_name || svc?.name || 'Router';
    const groups = new Map<string, WifiClient[]>();
    visible.forEach(r => {
      const k = r.ssid || 'Sin SSID';
      groups.set(k, [...(groups.get(k) ?? []), r]);
    });
    const th = `style="text-align:left;padding:7px 10px;font-size:10px;color:${BRAND.textMid};text-transform:uppercase;letter-spacing:.4px;border-bottom:1px solid #e2e8f0;"`;
    const tdBase = 'padding:7px 10px;font-size:11px;border-bottom:1px solid #f1f5f9;vertical-align:top;';
    const td = `style="${tdBase}"`;
    const tdMono = (size = 11) => `style="${tdBase}font-family:monospace;font-size:${size}px;"`;
    const sections = [...groups.entries()].map(([ssid, list]) => `
      ${pdfSection(`Red ${esc(ssid)} — ${list.length} dispositivo${list.length === 1 ? '' : 's'}`)}
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>
          <th ${th}>Dispositivo</th><th ${th}>Usuario</th><th ${th}>IP</th><th ${th}>MAC</th>
          <th ${th}>Señal</th><th ${th}>Última vez</th><th ${th}>Primera vez</th>
        </tr></thead>
        <tbody>
          ${list.map(r => `<tr>
            <td ${td}><strong>${esc(r.comment || r.hostname || 'Sin nombre')}</strong>${r.comment && r.hostname ? `<br><span style="color:#94a3b8;font-size:10px;">${esc(r.hostname)}</span>` : ''}</td>
            <td ${td}>${esc(ownerOf(r)) || '<span style="color:#cbd5e1;">—</span>'}</td>
            <td ${tdMono()}>${esc(r.ip) || '—'}</td>
            <td ${tdMono(10)}>${esc(r.mac)}${isRandomMac(r.mac) ? '<br><span style="color:#94a3b8;">privada</span>' : ''}</td>
            <td ${td}>${r.signal ?? '—'}${r.signal !== null ? ' dBm' : ''}</td>
            <td ${td}>${r.connected ? '<span style="color:#15803d;font-weight:600;">Conectado</span>' : esc(fmt(r.last_seen))}</td>
            <td ${td}>${esc(fmt(r.first_seen))}</td>
          </tr>`).join('')}
        </tbody>
      </table>`).join('');

    const body = `
      ${pdfHeader({
        logoUrl,
        companyName: 'Cenas IT Solutions',
        title: `Dispositivos en la red Wi-Fi — ${client?.company_name || routerName}`,
        subtitle: `${routerName} · ${RANGE_LABEL[range]} · ${visible.length} dispositivos · Generado el ${now}`,
        date: now,
      })}
      <p style="font-size:11px;color:#475569;margin:12px 0 0;line-height:1.5;">
        Equipos que se conectaron al Wi-Fi según el router. El nombre sale del comentario o del nombre que el equipo informa al pedir IP.
        Los celulares y notebooks modernos usan una <strong>MAC privada</strong> por red: un mismo equipo puede aparecer con otra MAC si cambia esa opción.
        Revisá la lista y avisanos si hay algún dispositivo que no reconocés.
      </p>
      ${sections || '<p style="font-size:12px;color:#64748b;margin-top:24px;">Sin dispositivos en el período.</p>'}`;
    openPrintWindow(`Wi-Fi — ${client?.company_name || routerName}`, body);
  };

  if (loading) return <div className="py-16 text-center text-sm text-gray-400">Cargando…</div>;

  if (rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <Wifi className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-600 font-medium">Todavía no hay datos de Wi-Fi</p>
        <p className="text-sm text-gray-400 mt-1">Corré <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">mk-wifi-report.sh</code> en el VPS de monitoreo (usa la misma config que mk-monitor).</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <Wifi className="w-5 h-5 text-gray-500" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">Dispositivos Wi-Fi</h2>
            <p className="text-sm text-gray-600 mt-0.5">Quién se conecta al Wi-Fi de cada MikroTik.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={serviceId} onChange={e => setServiceId(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            {routerIds.map(id => {
              const s = services.find(x => x.id === id);
              const c = clients.find(x => x.id === s?.client_id);
              return <option key={id} value={id}>{c ? `${c.company_name} — ` : ''}{s?.business_name || s?.name || id.slice(0, 8)}</option>;
            })}
          </select>
          <select value={range} onChange={e => setRange(e.target.value as Range)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            {(Object.keys(RANGE_LABEL) as Range[]).map(r => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
          </select>
          <button onClick={exportPdf}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-2 rounded-lg transition-colors">
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-2.5" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar nombre, IP, MAC…"
            className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-64 max-w-full focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        {bySsid.map(([ssid, n]) => (
          <span key={ssid} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2 py-1 rounded-full font-medium">{ssid} · {n}</span>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                {['Dispositivo', 'Usuario', 'IP', 'MAC', 'Red', 'Señal', 'Última vez', 'Primera vez'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visible.map(r => {
                const sig = signalLabel(r.signal);
                const owner = ownerOf(r);
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-900">{r.comment || r.hostname || <span className="text-gray-400 italic">Sin nombre</span>}</div>
                      {r.comment && r.hostname && <div className="text-xs text-gray-400">{r.hostname}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{owner || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{r.ip || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500 whitespace-nowrap">
                      {r.mac}
                      {isRandomMac(r.mac) && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-gray-400" title="MAC privada (aleatoria) del dispositivo">
                          <Smartphone className="w-3 h-3" /> privada
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">{r.ssid || '—'}</td>
                    <td className={`px-4 py-2.5 text-xs whitespace-nowrap ${sig.cls}`}>{sig.text}</td>
                    <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                      {r.connected
                        ? <span className="text-emerald-700 font-semibold">● Conectado{r.uptime ? ` · ${r.uptime}` : ''}</span>
                        : <span className="text-gray-500">{fmt(r.last_seen)}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 whitespace-nowrap">{fmt(r.first_seen)}</td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Sin dispositivos en el período.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-gray-400">
        El nombre sale del comentario del lease DHCP en el MikroTik o del nombre que informa el equipo. Para ponerle nombre a un dispositivo,
        agregá un comentario a su lease en el router. "Usuario" se cruza con el inventario de equipos (device-report).
      </p>
    </div>
  );
}
