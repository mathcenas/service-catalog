import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Check, X, EyeOff, RefreshCw } from 'lucide-react';
import { supabase, ClientApp } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { buildMap, type Container, type TsInfo, type NodeOverride, type EdgeOverride, type MapNode, type MapRole } from '../lib/serviceMap';
import { appKind } from '../lib/appKinds';

// Red → Servidores: mapa isométrico de un servidor con Docker, armado del último reporte de
// system-health (contenedores + Tailscale). Lo que se corrige o confirma queda en
// service_map_nodes / service_map_edges.

type Svc = { id: string; name: string; business_name: string | null; client_id: string };
type Host = { key: string; hostServiceId: string; serviceIds: string[]; clientId: string; label: string; containers: Container[]; tailscale: TsInfo; at: string };

const S = 22;
const iso = (x: number, y: number, z = 0): [number, number] => [(x - y) * S * 0.866, (x + y) * S * 0.5 - z * S];
const pts = (a: [number, number][]) => a.map(p => p.join(',')).join(' ');
const BOX = { w: 2.4, d: 2.4, h: 1.25 };
const center = (n: MapNode): [number, number] => n.role === 'users' ? [n.x + 1.6, n.y + 1.4] : [n.x + BOX.w / 2, n.y + BOX.d / 2];

const FACES: Record<string, [string, string, string]> = {
  proxy: ['#A8B5C7', '#8494AB', '#64748B'], app: ['#CBD5E1', '#A9B6C8', '#94A3B8'], testing: ['#EEF2F6', '#DCE3EB', '#CBD5E1'],
  tool: ['#F1F5F9', '#E2E8F0', '#D3DCE6'], vpn: ['#C3CFE0', '#9DAEC6', '#9DAEC6'], remote: ['#F1F5F9', '#E2E8F0', '#D3DCE6'],
  db: ['#C3CFE0', '#9DAEC6', '#9DAEC6'], storage: ['#C3CFE0', '#9DAEC6', '#9DAEC6'], down: ['#FCA5A5', '#F87171', '#EF4444'],
};
const ROLE_LABEL: Record<MapRole, string> = {
  users: 'Usuarios', proxy: 'Entrada (proxy)', app: 'App', testing: 'Testing', db: 'Base de datos',
  storage: 'Almacenamiento', tool: 'Herramienta', vpn: 'VPN', remote: 'Equipo remoto', cloud: 'Internet',
};

// Punto a la mitad de una polilínea (para el candado del túnel)
function midpoint(p: [number, number][]): [number, number] {
  const seg = p.slice(1).map((q, i) => Math.hypot(q[0] - p[i][0], q[1] - p[i][1]));
  let half = seg.reduce((a, b) => a + b, 0) / 2;
  for (let i = 0; i < seg.length; i++) {
    if (half <= seg[i]) { const t = seg[i] ? half / seg[i] : 0; return [p[i][0] + (p[i + 1][0] - p[i][0]) * t, p[i][1] + (p[i + 1][1] - p[i][1]) * t]; }
    half -= seg[i];
  }
  return p[p.length - 1];
}

export function VpsMapView() {
  const { user } = useAuth();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [services, setServices] = useState<Svc[]>([]);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});
  const [tsIp, setTsIp] = useState<Record<string, { id: string; name: string }>>({});
  const [hostKey, setHostKey] = useState('');
  const [nodeOv, setNodeOv] = useState<NodeOverride[]>([]);
  const [edgeOv, setEdgeOv] = useState<EdgeOverride[]>([]);
  const [apps, setApps] = useState<ClientApp[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Arrastre: posición provisoria mientras se mueve; al soltar se guarda en service_map_nodes
  const [dragPos, setDragPos] = useState<Record<string, { x: number; y: number }>>({});
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);

  // ---- Servidores con contenedores o Tailscale
  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const [{ data: svcs }, { data: cls }, { data: hbs }] = await Promise.all([
        supabase.from('services').select('id, name, business_name, client_id').eq('status', 'Active'),
        supabase.from('clients').select('id, company_name'),
        supabase.from('service_heartbeats').select('service_id, payload, received_at').eq('source', 'system-health')
          .gte('received_at', since).order('received_at', { ascending: false }).limit(3000),
      ]);
      const svcList = (svcs ?? []) as Svc[];
      const svcById = new Map(svcList.map(s => [s.id, s]));
      const latest = new Map<string, { payload: Record<string, unknown>; at: string }>();
      for (const h of (hbs ?? []) as { service_id: string; payload: Record<string, unknown> | null; received_at: string }[]) {
        if (!latest.has(h.service_id) && h.payload) latest.set(h.service_id, { payload: h.payload, at: h.received_at });
      }
      const ipMap: Record<string, { id: string; name: string }> = {};
      const byHost = new Map<string, Host>();
      for (const [sid, { payload: p, at }] of latest) {
        const svc = svcById.get(sid);
        if (!svc) continue;
        const ts = (p.tailscale ?? null) as TsInfo;
        const selfIp = ts?.self?.ip;
        if (selfIp) ipMap[selfIp] = { id: sid, name: svc.business_name || svc.name };
        const containers = Array.isArray(p.docker_containers) ? p.docker_containers as Container[] : [];
        if (!containers.length) continue;
        const key = p.public_ip || p.local_ip ? `${p.public_ip ?? ''}|${p.local_ip ?? ''}` : sid;
        const h = byHost.get(key);
        if (h) { h.serviceIds.push(sid); continue; }
        byHost.set(key, { key, hostServiceId: sid, serviceIds: [sid], clientId: svc.client_id, label: '', containers, tailscale: ts, at });
      }
      const names = Object.fromEntries(((cls ?? []) as { id: string; company_name: string }[]).map(c => [c.id, c.company_name]));
      const list = [...byHost.values()].map(h => ({
        ...h,
        label: `${names[h.clientId] ?? ''} — ${h.serviceIds.map(id => svcById.get(id)).map(s => s?.business_name || s?.name).join(' / ')}`,
      })).sort((a, b) => a.label.localeCompare(b.label));
      setServices(svcList); setClientNames(names); setTsIp(ipMap); setHosts(list);
      setHostKey(k => k || list[0]?.key || '');
      setLoading(false);
    })();
  }, []);

  const host = hosts.find(h => h.key === hostKey) ?? null;

  const loadOverrides = useCallback(async () => {
    if (!host) return;
    const [{ data: n }, { data: e }] = await Promise.all([
      supabase.from('service_map_nodes').select('node, role, service_id, hidden, notes, x, y').eq('host_service_id', host.hostServiceId),
      supabase.from('service_map_edges').select('a, b, status').eq('host_service_id', host.hostServiceId),
    ]);
    setNodeOv((n ?? []) as NodeOverride[]);
    setDragPos({});
    setEdgeOv((e ?? []) as EdgeOverride[]);
  }, [host]);
  useEffect(() => { setSelected(null); loadOverrides(); }, [loadOverrides]);

  const map = useMemo(() => {
    if (!host) return null;
    const ov = [...nodeOv];
    for (const [node, p] of Object.entries(dragPos)) {
      const i = ov.findIndex(o => o.node === node);
      if (i >= 0) ov[i] = { ...ov[i], x: p.x, y: p.y };
      else ov.push({ node, role: null, service_id: null, hidden: false, notes: null, x: p.x, y: p.y });
    }
    return buildMap({ containers: host.containers, tailscale: host.tailscale, overrides: ov, edgeOverrides: edgeOv, tsIpToService: tsIp });
  }, [host, nodeOv, edgeOv, tsIp, dragPos]);

  // "Qué corre" de los equipos del mapa que son servicios del catálogo
  useEffect(() => {
    const ids = [...new Set((map?.nodes ?? []).map(n => n.serviceId).filter(Boolean) as string[])];
    if (!ids.length) { setApps([]); return; }
    supabase.from('client_apps').select('*').in('service_id', ids).order('kind').then(({ data }) => setApps((data ?? []) as ClientApp[]));
  }, [map]);

  // ---- Guardar correcciones
  const saveNode = async (node: string, patch: Partial<{ role: MapRole | null; service_id: string | null; hidden: boolean; x: number | null; y: number | null }>) => {
    if (!host || !user) return;
    const cur = nodeOv.find(o => o.node === node);
    await supabase.from('service_map_nodes').upsert({
      user_id: user.id, host_service_id: host.hostServiceId, node,
      role: cur?.role ?? null, service_id: cur?.service_id ?? null, hidden: cur?.hidden ?? false,
      x: cur?.x ?? null, y: cur?.y ?? null, ...patch,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'host_service_id,node' });
    loadOverrides();
  };
  const saveEdge = async (a: string, b: string, status: 'confirmed' | 'removed') => {
    if (!host || !user) return;
    await supabase.from('service_map_edges').upsert({ user_id: user.id, host_service_id: host.hostServiceId, a, b, status, updated_at: new Date().toISOString() },
      { onConflict: 'host_service_id,a,b' });
    loadOverrides();
  };
  const resetPositions = async () => {
    if (!host) return;
    await supabase.from('service_map_nodes').update({ x: null, y: null }).eq('host_service_id', host.hostServiceId);
    loadOverrides();
  };

  // ---- Arrastre (pantalla → grilla isométrica)
  const toSvg = (clientX: number, clientY: number) => {
    const svg = svgRef.current; const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const r = pt.matrixTransform(ctm.inverse());
    return { x: r.x, y: r.y };
  };
  const startDrag = (n: MapNode, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toSvg(e.clientX, e.clientY);
    dragRef.current = { id: n.id, sx: p.x, sy: p.y, ox: n.x, oy: n.y, moved: false };
    const move = (ev: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      const q = toSvg(ev.clientX, ev.clientY);
      const dx = q.x - d.sx, dy = q.y - d.sy;
      if (!d.moved && Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      // inversa de iso(): dx = (gx - gy)·S·0.866, dy = (gx + gy)·S·0.5
      const a = dx / (S * 0.866), b = dy / (S * 0.5);
      const gx = Math.round(((a + b) / 2 + d.ox) * 5) / 5, gy = Math.round(((b - a) / 2 + d.oy) * 5) / 5;
      setDragPos(cur => ({ ...cur, [d.id]: { x: gx, y: gy } }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      const d = dragRef.current; dragRef.current = null;
      if (!d) return;
      if (!d.moved) { setSelected(d.id); return; }
      setDragPos(cur => { const p2 = cur[d.id]; if (p2) saveNode(d.id, { x: p2.x, y: p2.y }); return cur; });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const resetEdge = async (a: string, b: string) => {
    if (!host) return;
    await supabase.from('service_map_edges').delete().eq('host_service_id', host.hostServiceId).eq('a', a).eq('b', b);
    loadOverrides();
  };

  // ---- Geometría
  const geo = useMemo(() => {
    if (!map) return null;
    const byId = new Map(map.nodes.map(n => [n.id, n]));
    const edgePaths = map.edges.map(e => {
      const A = byId.get(e.a)!, B = byId.get(e.b)!;
      const [ax, ay] = center(A), [bx, by] = center(B);
      const d = 'M' + [iso(ax, ay, 0.05), iso(bx, ay, 0.05), iso(bx, by, 0.05)].map(p => p.join(',')).join(' L');
      return { ...e, d, pts: [iso(ax, ay, 0.05), iso(bx, ay, 0.05), iso(bx, by, 0.05)] as [number, number][] };
    });
    const P: [number, number][] = [];
    for (const z of map.zones) P.push(iso(z.x, z.y), iso(z.x + z.w, z.y), iso(z.x + z.w, z.y + z.h), iso(z.x, z.y + z.h));
    for (const n of map.nodes) P.push(iso(n.x, n.y, 2.4), iso(n.x + 3.2, n.y, 2.4), iso(n.x + 3.2, n.y + 2.8, 0), iso(n.x, n.y + 2.8, 0));
    const xs = P.map(p => p[0]), ys = P.map(p => p[1]);
    const vb = [Math.min(...xs) - 70, Math.min(...ys) - 40, Math.max(...xs) - Math.min(...xs) + 140, Math.max(...ys) - Math.min(...ys) + 80];
    const tunnel = edgePaths.find(e => e.tunnel && e.a.startsWith('ts:'));
    const lock = tunnel && byId.has('__internet') ? midpoint(tunnel.pts) : null;
    return { byId, edgePaths, viewBox: vb.join(' '), lock };
  }, [map]);

  // ---- Animación de pedidos (imperativa sobre <g ref>)
  const dotsRef = useRef<SVGGElement>(null);
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});
  useEffect(() => {
    const g = dotsRef.current;
    if (!g || !map || !geo || !running) { g?.replaceChildren(); return; }
    const NS = 'http://www.w3.org/2000/svg';
    const edges = geo.edgePaths;
    const down = new Set(map.nodes.filter(n => n.state === 'down').map(n => n.id));
    const origins = new Set(['__users', ...map.nodes.filter(n => n.role === 'remote' && n.state === 'up').map(n => n.id)]);
    type P = { i: number; dir: 1 | -1; kind: 'req' | 'res'; d: number; c: SVGCircleElement };
    let parts: P[] = [];
    const next = edges.map(() => Math.random() * 1.5);
    const spawn = (i: number, dir: 1 | -1, kind: 'req' | 'res') => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', '4'); c.setAttribute('fill', kind === 'res' ? '#10B981' : '#64748B');
      c.setAttribute('stroke', '#0B192C'); c.setAttribute('stroke-width', '1');
      g.appendChild(c); parts.push({ i, dir, kind, d: 0, c });
    };
    const fail = (x: number, y: number) => {
      const c = document.createElementNS(NS, 'circle');
      c.setAttribute('r', '6'); c.setAttribute('fill', '#EF4444'); c.setAttribute('stroke', '#0B192C');
      c.setAttribute('transform', `translate(${x},${y})`); g.appendChild(c);
      setTimeout(() => c.remove(), 900);
    };
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      edges.forEach((e, i) => {
        if (!origins.has(e.a)) return;
        next[i] -= dt;
        if (next[i] <= 0) { spawn(i, 1, 'req'); next[i] = e.a === '__users' ? 1 + Math.random() : 3 + Math.random() * 2; }
      });
      for (let k = parts.length - 1; k >= 0; k--) {
        const p = parts[k], e = edges[p.i], path = pathRefs.current[e.key];
        if (!path) { p.c.remove(); parts.splice(k, 1); continue; }
        const len = path.getTotalLength();
        p.d += 120 * dt;
        const at = Math.min(p.d, len);
        const pt = path.getPointAtLength(p.dir === 1 ? at : len - at);
        p.c.setAttribute('transform', `translate(${pt.x},${pt.y})`);
        if (p.d < len) continue;
        p.c.remove(); parts.splice(k, 1);
        const target = p.dir === 1 ? e.b : e.a;
        if (p.kind === 'res') {
          const back = edges.findIndex(x => x.b === target);
          if (back >= 0 && !origins.has(target)) spawn(back, -1, 'res');
          continue;
        }
        if (down.has(target)) { fail(pt.x, pt.y); continue; }
        const outs = edges.map((x, j) => ({ x, j })).filter(o => o.x.a === target);
        if (outs.length && Math.random() < 0.8) spawn(outs[Math.floor(Math.random() * outs.length)].j, 1, 'req');
        else spawn(p.i, -1, 'res');
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(t => { last = t; raf = requestAnimationFrame(tick); });
    return () => { cancelAnimationFrame(raf); parts.forEach(p => p.c.remove()); parts = []; g.replaceChildren(); };
  }, [map, geo, running]);

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">Cargando…</div>;
  if (!hosts.length) return <div className="text-center py-12 text-gray-400 text-sm">Ningún servidor reportó contenedores en los últimos 3 días.</div>;

  const sel = selected && geo ? geo.byId.get(selected) ?? null : null;
  const clientSvcs = host ? services.filter(s => s.client_id === host.clientId) : [];
  const guesses = geo?.edgePaths.filter(e => e.guess) ?? [];
  const confirmed = edgeOv.filter(e => e.status === 'confirmed');
  const removed = edgeOv.filter(e => e.status === 'removed');
  const hiddenNodes = nodeOv.filter(o => o.hidden);
  const nodeName = (id: string) => geo?.byId.get(id)?.label ?? id.replace(/^ts:/, '').replace(/^__/, '');
  const down = map?.nodes.filter(n => n.state === 'down' && n.role !== 'users') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select value={hostKey} onChange={e => setHostKey(e.target.value)}
          className="bg-white border border-slate-200 text-slate-700 text-xs rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-sky-500 max-w-full">
          {hosts.map(h => <option key={h.key} value={h.key}>{h.label}</option>)}
        </select>
        {host && <span className="text-xs text-gray-500">{host.containers.length} contenedores · reporte {new Date(host.at).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
        {down.length > 0 && <span className="text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">{down.length} caído{down.length > 1 ? 's' : ''}: {down.map(n => n.label).join(', ')}</span>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto" style={{ backgroundImage: 'linear-gradient(#EEF2F6 1px, transparent 1px), linear-gradient(90deg, #EEF2F6 1px, transparent 1px)', backgroundSize: '22px 22px' }}>
          {geo && map && (
            <svg ref={svgRef} viewBox={geo.viewBox} className="block h-auto select-none" style={{ width: 'max(100%, 760px)', touchAction: 'none' }} role="img" aria-label="Mapa del servidor">
              {map.zones.map(z => {
                const [lx, ly] = iso(z.x + z.w, z.y + z.h);
                const w = z.label.length * 6 + 14;
                return (
                  <g key={z.label}>
                    <polygon points={pts([iso(z.x, z.y), iso(z.x + z.w, z.y), iso(z.x + z.w, z.y + z.h), iso(z.x, z.y + z.h)])} fill="#EEF2F6" stroke="#E2E8F0" strokeWidth={1.5} />
                    <rect x={lx - w / 2} y={ly + 4} width={w} height={15} rx={7.5} fill="#fff" stroke="#0B192C" strokeWidth={1.1} />
                    <text x={lx} y={ly + 15} textAnchor="middle" fontSize={9} fontFamily="ui-monospace, monospace" fill="#0B192C">{z.label}</text>
                  </g>
                );
              })}
              {map.nodes.filter(n => n.role === 'cloud').map(n => (
                <MapNodeShape key={n.id} n={n} selected={n.id === selected} onPointerDown={e => startDrag(n, e)} inCatalog={false} appsCount={0} />
              ))}
              {geo.edgePaths.filter(e => e.tunnel).map(e => <path key={'b' + e.key} d={e.d} fill="none" stroke="#C3CFE0" strokeWidth={15} strokeLinecap="round" opacity={0.7} />)}
              {geo.edgePaths.map(e => (
                <path key={e.key} ref={el => { pathRefs.current[e.key] = el; }} d={e.d} fill="none"
                  stroke={e.tunnel ? '#9DAEC6' : '#0B192C'} strokeWidth={e.tunnel ? 3.2 : 1.4} strokeDasharray={e.guess ? '4 4' : undefined} />
              ))}
              <g ref={dotsRef} />
              {geo.lock && (
                <g transform={`translate(${geo.lock[0]},${geo.lock[1] - 4})`} pointerEvents="none">
                  <circle r={13} fill="#fff" stroke="#9DAEC6" strokeWidth={2} />
                  <path d="M-4,-2 V-5 A4,4 0 0 1 4,-5 V-2" fill="none" stroke="#0B192C" strokeWidth={1.6} strokeLinecap="round" />
                  <rect x={-6} y={-2} width={12} height={9} rx={2} fill="#0B192C" />
                  <rect x={-58} y={-36} width={116} height={15} rx={7.5} fill="#fff" stroke="#9DAEC6" strokeWidth={1.5} />
                  <text x={0} y={-25} textAnchor="middle" fontSize={9} fontFamily="ui-monospace, monospace" fill="#0B192C">túnel cifrado · VPN</text>
                </g>
              )}
              {[...map.nodes].filter(n => n.role !== 'cloud').sort((p, q) => (p.x + p.y) - (q.x + q.y)).map(n => (
                <MapNodeShape key={n.id} n={n} selected={n.id === selected} onPointerDown={e => startDrag(n, e)}
                  inCatalog={!!n.serviceId} appsCount={apps.filter(a => a.service_id && a.service_id === n.serviceId).length} />
              ))}
            </svg>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-gray-100 text-xs text-gray-500">
          <div className="flex flex-wrap gap-4">
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-slate-500 inline-block" /> pedido</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> respuesta</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> caído</span>
            <span className="inline-flex items-center gap-1.5"><svg width="24" height="6" aria-hidden="true"><line x1="0" y1="3" x2="24" y2="3" stroke="#0B192C" strokeDasharray="4 4" /></svg> a confirmar</span>
            <span className="inline-flex items-center gap-1.5"><svg width="24" height="8" aria-hidden="true"><line x1="2" y1="4" x2="22" y2="4" stroke="#C3CFE0" strokeWidth="8" strokeLinecap="round" /><line x1="2" y1="4" x2="22" y2="4" stroke="#9DAEC6" strokeWidth="3" /></svg> túnel VPN</span>
            <span className="inline-flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block ring-1 ring-slate-800" /> en el catálogo</span>
          </div>
          <span className="flex gap-2">
          {nodeOv.some(o => o.x != null) && (
            <button onClick={resetPositions} className="inline-flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-1 text-gray-700 hover:bg-gray-50" title="Volver a ubicar todo automáticamente">
              <RefreshCw className="w-3.5 h-3.5" /> Acomodo automático
            </button>
          )}
          <button onClick={() => setRunning(v => !v)} className="inline-flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-1 text-gray-700 hover:bg-gray-50">
            {running ? <><Pause className="w-3.5 h-3.5" /> Pausar</> : <><Play className="w-3.5 h-3.5" /> Reproducir</>}
          </button>
          </span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Ficha del nodo */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 min-w-0">
          {!sel ? (
            <p className="text-sm text-gray-500">Tocá una caja del mapa para ver qué es, corregir su rol o vincularla a un servicio del catálogo. Arrastrala para moverla: la posición queda guardada.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-mono text-sm font-semibold text-gray-900 break-all">{sel.label}</h3>
                  <p className="text-xs text-gray-500">{ROLE_LABEL[sel.role]}{sel.roleGuessed ? ' (detectado por el nombre)' : ''} · {sel.stateText || '—'}</p>
                </div>
                <span className={`shrink-0 text-xs rounded-full px-2 py-0.5 border ${sel.state === 'down' ? 'bg-red-50 text-red-700 border-red-200' : sel.state === 'up' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200'}`}>
                  {sel.state === 'down' ? 'caído' : sel.state === 'up' ? 'en marcha' : '—'}
                </span>
              </div>
              {sel.peer && (
                <p className="text-xs text-gray-600">Tailscale {sel.peer.ip}{sel.peer.key_days_left != null ? ` · clave ${sel.peer.key_days_left < 0 ? 'vencida' : `vence en ${sel.peer.key_days_left} días`}` : ' · sin vencimiento'}</p>
              )}
              {sel.role !== 'users' && sel.role !== 'cloud' && (
                <div className="grid sm:grid-cols-2 gap-2">
                  {!sel.id.startsWith('ts:') && !sel.id.startsWith('__') && (
                    <label className="text-xs text-gray-500 space-y-1">
                      <span>Rol</span>
                      <select value={nodeOv.find(o => o.node === sel.id)?.role ?? ''} onChange={e => saveNode(sel.id, { role: (e.target.value || null) as MapRole | null })}
                        className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-800">
                        <option value="">Automático ({ROLE_LABEL[sel.roleGuessed ? sel.role : sel.role]})</option>
                        {(['proxy', 'app', 'testing', 'db', 'storage', 'tool', 'vpn'] as MapRole[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="text-xs text-gray-500 space-y-1">
                    <span>Servicio del catálogo</span>
                    <select value={sel.serviceId ?? ''} onChange={e => saveNode(sel.id, { service_id: e.target.value || null })}
                      className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm text-gray-800">
                      <option value="">Sin vincular (no se controla aparte)</option>
                      {clientSvcs.map(s => <option key={s.id} value={s.id}>{s.business_name || s.name}</option>)}
                    </select>
                  </label>
                </div>
              )}
              {sel.serviceId && (
                <div>
                  <p className="text-xs font-medium text-gray-600 mb-1">Qué corre</p>
                  {apps.filter(a => a.service_id === sel.serviceId).length === 0
                    ? <p className="text-xs text-gray-400">Nada cargado. Se agrega en el formulario del servicio.</p>
                    : <ul className="text-sm text-gray-700 space-y-0.5">{apps.filter(a => a.service_id === sel.serviceId).map(a => <li key={a.id}>{appKind(a.kind).icon} {a.name}{a.vendor ? <span className="text-gray-400"> · {a.vendor}</span> : null}</li>)}</ul>}
                </div>
              )}
              {sel.role !== 'users' && sel.role !== 'cloud' && (
                <button onClick={() => { saveNode(sel.id, { hidden: true }); setSelected(null); }} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                  <EyeOff className="w-3.5 h-3.5" /> Ocultar del mapa
                </button>
              )}
            </>
          )}
        </section>

        {/* Conexiones a confirmar */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 min-w-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Conexiones a confirmar ({guesses.length})</h3>
            <p className="text-xs text-gray-500">Supuestas por el nombre de cada contenedor. Revisalas en Nginx Proxy Manager o en el compose y confirmá o descartá.</p>
          </div>
          {guesses.length === 0 && <p className="text-xs text-gray-400">No queda nada por confirmar.</p>}
          <ul className="space-y-1.5">
            {guesses.map(e => (
              <li key={e.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-mono text-xs text-gray-700 min-w-0 break-all">{nodeName(e.a)} → {nodeName(e.b)}</span>
                <span className="flex gap-1 shrink-0">
                  <button onClick={() => saveEdge(e.a, e.b, 'confirmed')} className="inline-flex items-center gap-1 text-xs border border-emerald-200 text-emerald-700 rounded-md px-2 py-0.5 hover:bg-emerald-50"><Check className="w-3 h-3" /> Confirmar</button>
                  <button onClick={() => saveEdge(e.a, e.b, 'removed')} className="inline-flex items-center gap-1 text-xs border border-gray-200 text-gray-600 rounded-md px-2 py-0.5 hover:bg-gray-50"><X className="w-3 h-3" /> No existe</button>
                </span>
              </li>
            ))}
          </ul>
          {(confirmed.length > 0 || removed.length > 0 || hiddenNodes.length > 0) && (
            <details className="text-xs text-gray-500">
              <summary className="cursor-pointer">Ya revisadas: {confirmed.length} confirmadas, {removed.length} descartadas, {hiddenNodes.length} ocultos</summary>
              <ul className="mt-2 space-y-1">
                {[...confirmed, ...removed].map(e => (
                  <li key={e.a + e.b} className="flex items-center justify-between gap-2">
                    <span className="font-mono break-all">{e.status === 'confirmed' ? '✓' : '✕'} {nodeName(e.a)} → {nodeName(e.b)}</span>
                    <button onClick={() => resetEdge(e.a, e.b)} className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-700"><RefreshCw className="w-3 h-3" /> deshacer</button>
                  </li>
                ))}
                {hiddenNodes.map(o => (
                  <li key={o.node} className="flex items-center justify-between gap-2">
                    <span className="font-mono break-all">oculto: {o.node.replace(/^ts:/, '')}</span>
                    <button onClick={() => saveNode(o.node, { hidden: false })} className="inline-flex items-center gap-1 text-gray-400 hover:text-gray-700"><RefreshCw className="w-3 h-3" /> mostrar</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </div>
      {host && <p className="text-xs text-gray-400">Cliente: {clientNames[host.clientId]}. Los contenedores y su estado salen del último reporte de system-health; Tailscale, de system-health 1.11 o posterior.</p>}
    </div>
  );
}

function MapNodeShape({ n, selected, onPointerDown, inCatalog, appsCount }: { n: MapNode; selected: boolean; onPointerDown: (e: React.PointerEvent) => void; inCatalog: boolean; appsCount: number }) {
  const line = '#0B192C';
  const outline = selected ? '#06B6D4' : line;
  const ow = selected ? 3 : 1.4;
  const label = n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label;
  const common = { role: 'button', tabIndex: 0, onPointerDown, style: { cursor: 'grab' }, 'aria-label': n.label };

  if (n.role === 'cloud') {
    const [cx, cy] = iso(n.x + 1.2, n.y + 1.2, 1.1);
    const C: [number, number, number][] = [[-22, 4, 13], [-6, -8, 17], [14, -4, 14], [26, 6, 10], [2, 8, 14]];
    return (
      <g {...common}>
        {C.map(([dx, dy, r], i) => <circle key={'s' + i} cx={cx + dx} cy={cy + dy} r={r + 0.7} fill="none" stroke={selected ? '#06B6D4' : line} strokeWidth={selected ? 2.4 : 1.4} />)}
        {C.map(([dx, dy, r], i) => <circle key={'f' + i} cx={cx + dx} cy={cy + dy} r={r} fill="#fff" />)}
        <text x={cx + 2} y={cy + 3} textAnchor="middle" fontSize={9} fontFamily="ui-monospace, monospace" fill={line}>internet</text>
      </g>
    );
  }

  if (n.role === 'users') {
    const pl = [iso(n.x, n.y, 0.25), iso(n.x + 3.2, n.y, 0.25), iso(n.x + 3.2, n.y + 2.8, 0.25), iso(n.x, n.y + 2.8, 0.25)];
    const side = [iso(n.x, n.y + 2.8, 0.25), iso(n.x + 3.2, n.y + 2.8, 0.25), iso(n.x + 3.2, n.y + 2.8, 0), iso(n.x, n.y + 2.8, 0)];
    const people: [number, number][] = [];
    for (let a = 0.5; a < 3; a += 0.75) for (let b = 0.5; b < 2.6; b += 0.75) people.push(iso(n.x + a, n.y + b, 0.25));
    const [tx, ty] = iso(n.x + 1.6, n.y + 1.4, 0.25);
    return (
      <g {...common}>
        <polygon points={pts(side)} fill="#DCE3EB" stroke={line} strokeWidth={1.4} />
        <polygon points={pts(pl)} fill="#fff" stroke={outline} strokeWidth={ow} />
        {people.map(([px, py], i) => (
          <g key={i}>
            <rect x={px - 3.5} y={py - 13} width={7} height={10} rx={3} fill={['#C3CFE0', '#CBD5E1', '#A8B5C7', '#F1F5F9'][i % 4]} stroke={line} strokeWidth={1} />
            <circle cx={px} cy={py - 16} r={3.2} fill="#fff" stroke={line} strokeWidth={1} />
          </g>
        ))}
        <rect x={tx - 34} y={ty + 30} width={68} height={16} rx={8} fill="#fff" stroke={line} strokeWidth={1.1} />
        <text x={tx} y={ty + 41.5} textAnchor="middle" fontSize={8.5} fontFamily="ui-monospace, monospace" fill={line}>internet</text>
      </g>
    );
  }

  const f = n.state === 'down' ? FACES.down : FACES[n.role] ?? FACES.app;
  let top: [number, number];
  let shape: JSX.Element;
  if (n.role === 'db' || n.role === 'storage') {
    const [cx, cy] = iso(n.x + BOX.w / 2, n.y + BOX.d / 2, 0);
    const rx = S * 1.25, ry = S * 0.62, h = S * 1.6;
    shape = (
      <>
        <path d={`M${cx - rx},${cy - h} L${cx - rx},${cy} A${rx},${ry} 0 0 0 ${cx + rx},${cy} L${cx + rx},${cy - h}`} fill={f[1]} stroke={line} strokeWidth={1.4} />
        <ellipse cx={cx} cy={cy - h} rx={rx} ry={ry} fill={f[0]} stroke={outline} strokeWidth={ow} />
      </>
    );
    top = [cx, cy - h];
  } else {
    const { w, d, h } = BOX, x = n.x, y = n.y;
    shape = (
      <>
        <polygon points={pts([iso(x, y + d, h), iso(x + w, y + d, h), iso(x + w, y + d, 0), iso(x, y + d, 0)])} fill={f[1]} stroke={line} strokeWidth={1.4} strokeLinejoin="round" />
        <polygon points={pts([iso(x + w, y, h), iso(x + w, y + d, h), iso(x + w, y + d, 0), iso(x + w, y, 0)])} fill={f[2]} stroke={line} strokeWidth={1.4} strokeLinejoin="round" />
        <polygon points={pts([iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h)])} fill={f[0]} stroke={outline} strokeWidth={ow} strokeLinejoin="round" />
      </>
    );
    top = iso(x + w / 2, y + d / 2, h);
  }
  const [tx, ty] = top;
  const [bx, by] = iso(n.x + BOX.w, n.y, BOX.h);
  const [ax, ay] = iso(n.x, n.y + BOX.d, BOX.h);
  return (
    <g {...common}>
      {shape}
      <text x={tx} y={ty - 1} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily="ui-monospace, monospace" fill={line}>{label}</text>
      <text x={tx} y={ty + 10} textAnchor="middle" fontSize={8.5} fontFamily="ui-monospace, monospace" fill={line} opacity={0.75}>{n.state === 'down' ? '✕ caído' : n.sub}</text>
      {inCatalog && <circle cx={bx} cy={by - 2} r={5} fill="#10B981" stroke={line} strokeWidth={1.2}><title>En el catálogo</title></circle>}
      {appsCount > 0 && (
        <g>
          <rect x={ax - 30} y={ay - 10} width={58} height={16} rx={8} fill="#fff" stroke={line} strokeWidth={1.1} />
          <text x={ax - 1} y={ay + 1.5} textAnchor="middle" fontSize={8.5} fontFamily="ui-monospace, monospace" fill={line}>{appsCount} apps</text>
        </g>
      )}
    </g>
  );
}
