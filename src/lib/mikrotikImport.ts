// Parser de listados exportados desde un MikroTik para el reporte Wi-Fi.
//
// Formatos aceptados (se detectan solos):
//   - `print terse file=…`  → una línea por ítem, pares key=value
//       ej:  0 D address=192.168.88.20 mac-address=AA:BB:CC:DD:EE:01 host-name=NB-CONTA comment=Notebook Conta status=bound
//   - JSON de la REST API   → curl -k -u user:pass https://router/rest/ip/dhcp-server/lease
//
// Tipos de listado (también se detectan solos):
//   - wifi   : registration-table de /interface/wifi, wifiwave2, wireless o /caps-man
//   - dhcp   : /ip dhcp-server lease
//   - arp    : /ip arp
//   - neighbor: /ip neighbor (nombre de switches, APs y otros equipos de red)

export type MkRow = Record<string, string>;
export type MkListKind = 'wifi' | 'dhcp' | 'arp' | 'neighbor' | 'unknown';

export type ParsedFile = { name: string; kind: MkListKind; rows: MkRow[] };

export type ImportedDevice = {
  mac: string;
  ip: string | null;
  hostname: string | null;
  comment: string | null;
  ssid: string | null;
  interface: string | null;
  signal: number | null;
  tx_rate: string | null;
  rx_rate: string | null;
  uptime: string | null;
  /** Momento estimado de la última vez visto (last-seen del lease, o ahora si estaba en la tabla Wi-Fi) */
  last_seen: string;
  dhcp_server: string | null;
};

const MAC_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

/** Parsea una línea `print terse`: los valores pueden tener espacios (comentarios) */
function parseTerseLine(line: string): MkRow | null {
  const keyRe = /(?:^|\s)([a-z][a-z0-9.\-]*)=/g;
  const marks: { key: string; start: number; valueStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(line))) {
    const start = m.index + (m[0].startsWith(' ') || m[0].startsWith('\t') ? 1 : 0);
    marks.push({ key: m[1], start, valueStart: m.index + m[0].length });
  }
  if (!marks.length) return null;
  const row: MkRow = {};
  marks.forEach((k, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].start : line.length;
    let v = line.slice(k.valueStart, end).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\"/g, '"');
    row[k.key] = v;
  });
  return row;
}

export function parseMikrotikText(text: string): MkRow[] {
  const t = text.replace(/^﻿/, '').trim();
  if (t.startsWith('[')) {
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) {
        return arr.filter(x => x && typeof x === 'object').map(x =>
          Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v == null ? '' : String(v)])));
      }
    } catch { /* cae al formato terse */ }
  }
  // Los print largos pueden partir una línea con "\" al final
  return t.replace(/\\\r?\n\s*/g, '')
    .split(/\r?\n/)
    .map(l => l.trimEnd())
    .filter(l => l && !l.startsWith('#') && !/^Flags:/i.test(l.trim()) && !/^Columns:/i.test(l.trim()))
    .map(parseTerseLine)
    .filter((r): r is MkRow => !!r && !!r['mac-address']);
}

export function detectKind(rows: MkRow[]): MkListKind {
  if (!rows.length) return 'unknown';
  const keys = new Set(rows.flatMap(r => Object.keys(r)));
  const has = (k: string) => keys.has(k);
  if (has('identity') && (has('platform') || has('board') || has('version'))) return 'neighbor';
  if (has('signal') || has('signal-strength') || has('rx-signal') || has('tx-ccq') || has('ap')
      || (has('uptime') && has('interface') && !has('address'))) return 'wifi';
  if (has('host-name') || has('server') || has('active-address') || has('expires-after') || has('lease-time')) return 'dhcp';
  if (has('address') && has('interface')) return 'arp';
  return 'unknown';
}

export function parseFile(name: string, text: string): ParsedFile {
  const rows = parseMikrotikText(text);
  return { name, kind: detectKind(rows), rows };
}

/** "1w2d3h4m5s" / "00:05:10" → segundos (null si "never" o vacío) */
export function parseDuration(v?: string): number | null {
  if (!v || /never/i.test(v)) return null;
  const hms = v.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const units: Record<string, number> = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 };
  let total = 0, found = false;
  for (const [, n, u] of v.matchAll(/(\d+)([wdhms])/g)) { total += +n * units[u]; found = true; }
  return found ? total : null;
}

const normMac = (v?: string) => (v || '').trim().toUpperCase().replace(/-/g, ':');
const num = (v?: string) => {
  const m = (v || '').match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
};
const nz = (v?: string) => (v && v.trim() ? v.trim() : null);

/**
 * Arma la lista de dispositivos.
 * - Si hay listado Wi-Fi, esos son los dispositivos (los leases y ARP solo completan IP / nombre).
 * - Si no, se usan los leases DHCP de los servidores elegidos (ej: el de la red Wi-Fi).
 */
export function buildDevices(
  files: ParsedFile[],
  dhcpServers?: Set<string>,
  now = new Date(),
  /** Sin tabla Wi-Fi: sumar equipos que están en ARP pero no en DHCP (IP fija), de estas interfaces */
  arpInterfaces?: Set<string>,
): ImportedDevice[] {
  const wifi = files.filter(f => f.kind === 'wifi').flatMap(f => f.rows);
  const dhcp = files.filter(f => f.kind === 'dhcp').flatMap(f => f.rows);
  const arp = files.filter(f => f.kind === 'arp').flatMap(f => f.rows);
  const neighbors = files.filter(f => f.kind === 'neighbor').flatMap(f => f.rows);
  // Nombre anunciado por el equipo (MNDP/LLDP/CDP): switches, APs, otros MikroTik
  const neighborByMac = new Map(neighbors.map(n => [normMac(n['mac-address']), n]));

  const leaseByMac = new Map(dhcp.map(r => [normMac(r['mac-address']), r]));
  const arpByMac = new Map(arp.map(r => [normMac(r['mac-address']), r.address]));
  const nowMs = now.getTime();
  const lastSeenFromLease = (l?: MkRow) => {
    const secs = parseDuration(l?.['last-seen']);
    return new Date(secs === null ? nowMs : nowMs - secs * 1000).toISOString();
  };

  const out = new Map<string, ImportedDevice>();
  const base = (mac: string, l?: MkRow): ImportedDevice => ({
    mac,
    ip: nz(l?.['active-address']) ?? nz(l?.address) ?? nz(arpByMac.get(mac)),
    hostname: nz(l?.['host-name']) ?? nz(neighborByMac.get(mac)?.identity),
    comment: nz(l?.comment) ?? (neighborByMac.get(mac)
      ? nz([neighborByMac.get(mac)!.platform, neighborByMac.get(mac)!.board].filter(Boolean).join(' ')) : null),
    ssid: null, interface: null, signal: null, tx_rate: null, rx_rate: null, uptime: null,
    last_seen: lastSeenFromLease(l),
    dhcp_server: nz(l?.server),
  });

  if (wifi.length) {
    for (const r of wifi) {
      const mac = normMac(r['mac-address']);
      if (!MAC_RE.test(mac)) continue;
      const d = base(mac, leaseByMac.get(mac));
      d.ip = d.ip ?? nz(r['last-ip']);
      d.comment = d.comment ?? nz(r.comment);
      d.ssid = nz(r.ssid);
      d.interface = nz(r.interface);
      d.signal = num(r.signal ?? r['signal-strength'] ?? r['rx-signal']);
      d.tx_rate = nz(r['tx-rate']);
      d.rx_rate = nz(r['rx-rate']);
      d.uptime = nz(r.uptime);
      d.last_seen = now.toISOString();
      out.set(mac, d);
    }
  } else {
    for (const l of dhcp) {
      const mac = normMac(l['mac-address']);
      if (!MAC_RE.test(mac)) continue;
      if (dhcpServers && dhcpServers.size && !dhcpServers.has(l.server || '')) continue;
      const d = base(mac, l);
      d.ssid = nz(l.server);   // sin tabla Wi-Fi, la "red" es el servidor DHCP
      out.set(mac, d);
    }
    if (arpInterfaces?.size) {
      for (const a of arp) {
        const mac = normMac(a['mac-address']);
        if (!MAC_RE.test(mac) || mac === '00:00:00:00:00:00' || out.has(mac) || leaseByMac.has(mac)) continue;
        if (!arpInterfaces.has(a.interface || '')) continue;
        const d = base(mac);
        d.ip = nz(a.address);
        d.interface = nz(a.interface);
        d.ssid = 'IP fija';
        d.last_seen = now.toISOString();
        out.set(mac, d);
      }
    }
  }
  return [...out.values()];
}

/** Interfaces del ARP y si conviene marcarlas por defecto (solo IPs privadas = LAN, no la WAN) */
export function arpInterfacesOf(files: ParsedFile[]): { name: string; lan: boolean }[] {
  const priv = (ip?: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip || '');
  const byIf = new Map<string, boolean>();
  for (const a of files.filter(f => f.kind === 'arp').flatMap(f => f.rows)) {
    const k = a.interface || '';
    byIf.set(k, (byIf.get(k) ?? true) && priv(a.address));
  }
  return [...byIf.entries()].map(([name, lan]) => ({ name, lan })).sort((a, b) => a.name.localeCompare(b.name));
}
