// Arma el mapa de un servidor (Red → Servidores) a partir del último reporte de system-health:
// contenedores de Docker + estado de Tailscale. Lo que el admin corrige (rol, servicio del
// catálogo, ocultar) y las conexiones que confirma o descarta vienen de service_map_nodes/_edges.

export type MapRole = 'users' | 'proxy' | 'app' | 'testing' | 'db' | 'storage' | 'tool' | 'vpn' | 'remote';

export type Container = { name: string; state: string; status?: string };
export type TsPeer = { name: string; ip: string | null; os?: string; online?: boolean; last_seen?: string; key_days_left?: number | null };
export type TsInfo = { container?: string | null; backend?: string; self?: { name?: string; ip?: string | null; key_days_left?: number | null }; peers?: TsPeer[] } | null;

export type NodeOverride = { node: string; role: MapRole | null; service_id: string | null; hidden: boolean; notes: string | null };
export type EdgeOverride = { a: string; b: string; status: 'confirmed' | 'removed' };

export type MapNode = {
  id: string;            // nombre del contenedor / equipo (estable entre reportes)
  label: string;
  sub: string;
  role: MapRole;
  roleGuessed: boolean;
  state: 'up' | 'down' | 'unknown';
  stateText: string;
  serviceId: string | null;      // servicio del catálogo que es este nodo
  peer?: TsPeer;
  x: number; y: number;
};
export type MapEdge = { a: string; b: string; key: string; guess: boolean; tunnel: boolean };
export type MapZone = { label: string; x: number; y: number; w: number; h: number };

const RX = {
  vpn: /tailscale|wireguard|wg-easy|headscale|netbird|zerotier/i,
  proxy: /(^|[-_])npm(old)?([-_]|app|$)|nginx-?pm|nginx-?proxy|proxy-?manager|traefik|caddy|haproxy|^nginx$|^nginx[-_]/i,
  tool: /portainer|goaccess|watchtower|uptime-?kuma|netdata|beszel|adminer|pgadmin|homer|myspeed|fail2ban|dozzle|grafana|prometheus|monitor/i,
  // postgres(?!t): "postgrest" es una API, no una base
  db: /postgres(?!t)|pos?t?gis|(^|[-_])sql([-_]|$)|mysql|maria|mongo|redis|mssql|sqlserver|(^|[-_])db|db([-_\d]|$)|database/i,
  storage: /rustfs|minio|seaweed|garage|(^|[-_])s3([-_]|$)/i,
  testing: /test|testing|staging|(^|[-_])demo([-_]|$)|(^|[-_])qa([-_]|$)/i,
};

export function guessRole(name: string): MapRole {
  // Orden: herramientas y bases antes que el proxy ("nginxpm-portainer", "nginxpm-npmdb" son del stack del proxy)
  if (RX.vpn.test(name)) return 'vpn';
  if (RX.tool.test(name)) return 'tool';
  if (RX.storage.test(name)) return 'storage';
  if (RX.db.test(name)) return RX.testing.test(name) ? 'testing' : 'db';
  if (RX.proxy.test(name)) return 'proxy';
  if (RX.testing.test(name)) return 'testing';
  return 'app';
}

const ROLE_SUB: Record<MapRole, string> = {
  users: 'usuarios', proxy: 'entrada', app: 'app', testing: 'pruebas', db: 'base de datos',
  storage: 'almacenamiento', tool: 'herramienta', vpn: 'VPN', remote: 'equipo remoto',
};

// Raíz del nombre para agrupar app ↔ base: "pgsis-test-adminer-1" → "pgsis", "wp_echo_prod" → "wp"
const stem = (n: string) => n.toLowerCase().replace(/[-_](\d+)$/, '').split(/[-_]/)[0];

export function buildMap(opts: {
  containers: Container[];
  tailscale: TsInfo;
  overrides: NodeOverride[];
  edgeOverrides: EdgeOverride[];
  /** IP de Tailscale → servicio del catálogo (de los reportes de otros equipos) */
  tsIpToService: Record<string, { id: string; name: string }>;
}): { nodes: MapNode[]; edges: MapEdge[]; zones: MapZone[] } {
  const ov = new Map(opts.overrides.map(o => [o.node, o]));
  const nodes: MapNode[] = [];
  const add = (n: Omit<MapNode, 'x' | 'y'>) => { const o = ov.get(n.id); if (o?.hidden) return; nodes.push({ ...n, x: 0, y: 0 }); };

  add({ id: '__users', label: 'Usuarios', sub: 'internet', role: 'users', roleGuessed: false, state: 'unknown', stateText: '', serviceId: null });

  for (const c of opts.containers) {
    const o = ov.get(c.name);
    const guessed = guessRole(c.name);
    const role = (o?.role as MapRole) ?? guessed;
    const up = c.state === 'running';
    add({
      id: c.name, label: c.name, sub: ROLE_SUB[role], role, roleGuessed: !o?.role,
      state: up ? 'up' : 'down', stateText: `${c.state}${c.status ? ` · ${c.status}` : ''}`,
      serviceId: o?.service_id ?? null,
    });
  }

  // Tailscale: si no corre en un contenedor, igual se dibuja el nodo VPN del servidor
  const ts = opts.tailscale;
  let vpnId: string | null = nodes.find(n => n.role === 'vpn')?.id ?? null;
  if (ts && !vpnId) {
    add({ id: '__tailscale', label: 'tailscale', sub: 'VPN · en el servidor', role: 'vpn', roleGuessed: false,
      state: ts.backend === 'Running' ? 'up' : 'down', stateText: ts.backend ?? '', serviceId: null });
    vpnId = '__tailscale';
  }
  if (ts && vpnId) {
    for (const p of ts.peers ?? []) {
      const id = `ts:${p.name}`;
      const svc = p.ip ? opts.tsIpToService[p.ip] : undefined;
      const o = ov.get(id);
      add({
        id, label: svc?.name ?? p.name, sub: `${p.os ?? 'equipo'} · ${p.ip ?? ''}`, role: 'remote', roleGuessed: false,
        state: p.online ? 'up' : 'down',
        stateText: p.online ? 'conectado' : `desconectado${p.last_seen ? ` · visto ${new Date(p.last_seen).toLocaleDateString('es-UY')}` : ''}`,
        serviceId: o?.service_id ?? svc?.id ?? null, peer: p,
      });
    }
  }

  // ---- Conexiones supuestas
  const byRole = (r: MapRole) => nodes.filter(n => n.role === r);
  const proxies = byRole('proxy'), apps = byRole('app'), tests = byRole('testing'), dbs = byRole('db'), stores = byRole('storage');
  const raw: { a: string; b: string; tunnel?: boolean }[] = [];
  if (proxies.length) {
    raw.push({ a: '__users', b: proxies[0].id });
    for (const t of [...apps, ...tests]) raw.push({ a: proxies[0].id, b: t.id });
  } else {
    for (const t of apps) raw.push({ a: '__users', b: t.id });
  }
  for (const d of [...dbs, ...tests.filter(t => RX.db.test(t.id))]) {
    const owner = [...apps, ...tests].find(x => x.id !== d.id && !RX.db.test(x.id) && stem(x.id) === stem(d.id));
    if (owner) raw.push({ a: owner.id, b: d.id });
  }
  for (const s of stores) {
    for (const a of apps.filter(a => /upload|file|backup|media/i.test(a.id))) raw.push({ a: a.id, b: s.id });
  }
  if (vpnId && nodes.some(n => n.id === vpnId)) {
    for (const r of byRole('remote')) raw.push({ a: r.id, b: vpnId, tunnel: true });
    if (stores[0]) raw.push({ a: vpnId, b: stores[0].id, tunnel: true });
  }

  const eo = new Map(opts.edgeOverrides.map(e => [`${e.a}→${e.b}`, e.status]));
  const ids = new Set(nodes.map(n => n.id));
  const edges: MapEdge[] = raw
    .filter(e => ids.has(e.a) && ids.has(e.b))
    .map(e => {
      const key = `${e.a}→${e.b}`;
      const st = eo.get(key);
      // usuarios → entrada y los equipos que el VPS ve por Tailscale son datos, no supuestos
      const known = e.a === '__users' || e.a.startsWith('ts:');
      return { a: e.a, b: e.b, key, tunnel: !!e.tunnel, guess: !known && st !== 'confirmed', removed: st === 'removed' };
    })
    .filter(e => !e.removed)
    .map(({ removed: _r, ...e }) => e);

  // ---- Ubicación: columnas por rol, de izquierda (internet) a derecha (oficinas por VPN)
  const zones: MapZone[] = [];
  const STEP = 4.2;
  const place = (list: MapNode[], x: number, y0: number) => list.forEach((n, i) => { n.x = x; n.y = y0 + i * STEP; });
  const zoneOf = (label: string, list: MapNode[]) => {
    if (!list.length) return;
    const xs = list.map(n => n.x), ys = list.map(n => n.y);
    zones.push({ label, x: Math.min(...xs) - 0.8, y: Math.min(...ys) - 0.8, w: Math.max(...xs) - Math.min(...xs) + 4, h: Math.max(...ys) - Math.min(...ys) + 4 });
  };
  place(proxies, 5.6, 4);
  place(apps, 10, 0);
  zoneOf('producción', apps);
  place(tests, 15, -1);
  zoneOf('testing', tests);
  const dataY = tests.length ? tests.length * STEP + 1 : 0;
  const data = [...dbs, ...stores];
  place(data, 15, dataY);
  zoneOf('datos', data);
  const vpnNode = nodes.find(n => n.id === vpnId);
  if (vpnNode) { vpnNode.x = 20; vpnNode.y = data.length ? dataY + (data.length - 1) * STEP : dataY; }
  const remotes = byRole('remote');
  place(remotes, 26, vpnNode ? vpnNode.y - ((remotes.length - 1) * STEP) / 2 : 0);
  zoneOf('equipos por VPN', remotes);
  const tools = byRole('tool');
  const frontY = Math.max(4, ...nodes.filter(n => n.role !== 'tool').map(n => n.y)) + 5;
  tools.forEach((n, i) => { n.x = 1 + i * STEP; n.y = frontY; });
  zoneOf('herramientas', tools);
  const users = nodes.find(n => n.id === '__users');
  if (users) { users.x = 0; users.y = proxies.length ? 4 : Math.max(0, (apps.length - 1) * STEP / 2); }

  return { nodes, edges, zones };
}
