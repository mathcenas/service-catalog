import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wifi, Download, Search, Smartphone, Upload, X } from 'lucide-react';
import { supabase, type Service, type Client } from '../lib/supabase';
import { BRAND, pdfHeader, pdfSection, openPrintWindow } from '../lib/pdfBrand';
import { parseFile, buildDevices, arpInterfacesOf, type ParsedFile } from '../lib/mikrotikImport';

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

  const [showImport, setShowImport] = useState(false);

  const load = useCallback(async (selectService?: string) => {
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
    setServiceId(prev => selectService || prev || list[0]?.service_id || '');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

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
        <p className="text-sm text-gray-400 mt-1">Corré <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">mk-wifi-report.sh</code> en el VPS de monitoreo, o importá los listados exportados del MikroTik.</p>
        <button onClick={() => setShowImport(true)}
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-white bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg">
          <Upload className="w-4 h-4" /> Importar desde MikroTik
        </button>
        {showImport && <ImportModal services={services} clients={clients} onClose={() => setShowImport(false)} onDone={sid => { setShowImport(false); load(sid); }} />}
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
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900 border border-gray-300 hover:border-gray-400 px-3 py-2 rounded-lg transition-colors bg-white">
            <Upload className="w-4 h-4" /> Importar
          </button>
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
      {showImport && <ImportModal services={services} clients={clients} defaultServiceId={serviceId} onClose={() => setShowImport(false)} onDone={sid => { setShowImport(false); load(sid); }} />}
    </div>
  );
}

const KIND_LABEL: Record<ParsedFile['kind'], string> = {
  wifi: 'Tabla Wi-Fi', dhcp: 'Leases DHCP', arp: 'ARP', unknown: 'No reconocido',
};

/** Importa listados exportados del MikroTik (print terse o JSON de la API) a wifi_clients */
function ImportModal({ services, clients, defaultServiceId, onClose, onDone }: {
  services: Service[];
  clients: Client[];
  defaultServiceId?: string;
  onClose: () => void;
  onDone: (serviceId: string) => void;
}) {
  const [serviceId, setServiceId] = useState(defaultServiceId || '');
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [servers, setServers] = useState<Set<string>>(new Set());
  const [arpIfs, setArpIfs] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const options = useMemo(() => services
    .filter(s => s.status !== 'Cancelled')
    .map(s => ({ id: s.id, label: `${clients.find(c => c.id === s.client_id)?.company_name ?? 'Sin cliente'} — ${s.business_name || s.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label)), [services, clients]);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const parsed = await Promise.all([...list].map(async f => parseFile(f.name, await f.text())));
    setFiles(prev => {
      const next = [...prev.filter(p => !parsed.some(n => n.name === p.name)), ...parsed];
      // Por defecto, todos los servidores DHCP marcados
      const all = new Set(next.filter(f => f.kind === 'dhcp').flatMap(f => f.rows.map(r => r.server || '')));
      setServers(all);
      setArpIfs(new Set(arpInterfacesOf(next).filter(i => i.lan).map(i => i.name)));
      return next;
    });
  };

  const hasWifi = files.some(f => f.kind === 'wifi');
  const dhcpServers = useMemo(
    () => [...new Set(files.filter(f => f.kind === 'dhcp').flatMap(f => f.rows.map(r => r.server || '')))].sort(),
    [files]);
  const arpInterfaces = useMemo(() => arpInterfacesOf(files), [files]);
  const devices = useMemo(
    () => buildDevices(files, hasWifi ? undefined : servers, new Date(), hasWifi ? undefined : arpIfs),
    [files, servers, hasWifi, arpIfs]);
  const toggle = (set: Set<string>, v: string) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; };

  const save = async () => {
    const svc = services.find(s => s.id === serviceId);
    if (!svc || !devices.length) return;
    setSaving(true);
    setError('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Sesión vencida'); setSaving(false); return; }
    const rows = devices.map(d => ({
      user_id: user.id,
      client_id: svc.client_id ?? null,
      service_id: svc.id,
      mac: d.mac, ip: d.ip, hostname: d.hostname, comment: d.comment, ssid: d.ssid, interface: d.interface,
      signal: d.signal, tx_rate: d.tx_rate, rx_rate: d.rx_rate, uptime: d.uptime,
      // Es una foto: no queda como "conectado" para siempre
      connected: false,
      last_seen: d.last_seen,
    }));
    const { error: err } = await supabase.from('wifi_clients').upsert(rows, { onConflict: 'service_id,mac' });
    setSaving(false);
    if (err) setError(err.message);
    else onDone(svc.id);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onMouseDown={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 text-left" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Importar desde MikroTik</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>

        <label className="block mb-3">
          <span className="text-xs font-medium text-gray-600">Router (servicio)</span>
          <select value={serviceId} onChange={e => setServiceId(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">Elegí el servicio del MikroTik…</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>

        <label className="block mb-3">
          <span className="text-xs font-medium text-gray-600">Archivos (.txt de <code>print terse file=…</code> o JSON de la API)</span>
          <input type="file" multiple accept=".txt,.rsc,.json,text/plain,application/json"
            onChange={e => { addFiles(e.target.files); e.target.value = ''; }}
            className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
        </label>

        {files.length > 0 && (
          <ul className="mb-3 space-y-1">
            {files.map(f => (
              <li key={f.name} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-1.5">
                <span className="font-mono text-gray-700 truncate">{f.name}</span>
                <span className={f.kind === 'unknown' ? 'text-red-600' : 'text-gray-500'}>{KIND_LABEL[f.kind]} · {f.rows.length}</span>
              </li>
            ))}
          </ul>
        )}

        {!hasWifi && dhcpServers.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-600 mb-1">
              Sin tabla Wi-Fi: se toman los leases DHCP. Marcá solo los servidores de la red Wi-Fi para no mezclar equipos cableados.
            </p>
            <div className="flex flex-wrap gap-2">
              {dhcpServers.map(sv => (
                <label key={sv || '_'} className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-2 py-1">
                  <input type="checkbox" checked={servers.has(sv)} onChange={() => setServers(prev => toggle(prev, sv))} />
                  {sv || '(sin servidor)'}
                </label>
              ))}
            </div>
          </div>
        )}

        {!hasWifi && arpInterfaces.length > 0 && (
          <div className="mb-3">
            <p className="text-xs text-gray-600 mb-1">
              Sumar equipos con IP fija (están en ARP pero no en DHCP) de estas interfaces. La WAN viene desmarcada.
            </p>
            <div className="flex flex-wrap gap-2">
              {arpInterfaces.map(i => (
                <label key={i.name || '_'} className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded-lg px-2 py-1">
                  <input type="checkbox" checked={arpIfs.has(i.name)} onChange={() => setArpIfs(prev => toggle(prev, i.name))} />
                  {i.name || '(sin interfaz)'}{!i.lan && <span className="text-gray-400">· WAN</span>}
                </label>
              ))}
            </div>
          </div>
        )}

        {!hasWifi && files.some(f => f.kind === 'dhcp') && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
            Sin la tabla Wi-Fi no se puede separar Wi-Fi de cableado: el reporte va a mostrar todos los equipos de la red elegida.
          </p>
        )}

        {files.length > 0 && (
          <p className="text-sm text-gray-700 mb-3">
            <strong>{devices.length}</strong> dispositivo{devices.length === 1 ? '' : 's'} para importar
            {hasWifi ? ' (de la tabla Wi-Fi, con IP y nombre de DHCP/ARP).' : ' (de los leases DHCP).'}
          </p>
        )}
        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button onClick={save} disabled={!serviceId || !devices.length || saving}
            className="px-3 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-40">
            {saving ? 'Importando…' : 'Importar'}
          </button>
        </div>
      </div>
    </div>
  );
}
