import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, CheckCircle2, Clock, AlertTriangle, Hand, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { supabase, Service, Client } from '../lib/supabase';

// Estado del auto-actualizador de scripts (update-scripts.ps1 / update-scripts.sh) por equipo.
// - Versiones de GitHub: tabla script_versions, filas "file:<nombre>" que llena sync-script-versions
//   (variant = plataforma si el actualizador lo maneja, "<plataforma>-manual" si no).
// - Lo instalado: heartbeat source "update-scripts" que manda el actualizador (>= 1.3.0) al terminar.

const UPDATER_STALE_DAYS = 3; // corre cada 48 h: si pasan más de 3 días, no está corriendo

type Platform = 'windows' | 'linux';
type Latest = Record<string, { version: string; platform: Platform; manual: boolean }>;

type UpdaterPayload = {
  platform?: Platform;
  branch?: string;
  installed?: Record<string, string>;
  updated?: string[];
  errors?: string[];
  task?: { name?: string; state?: string; next_run?: string | null; last_run?: string | null; last_result?: number; schedule?: string } | null;
  script_version?: string;
};

type Machine = {
  serviceId: string;
  name: string;
  clientName: string;
  platform: Platform | null;
  updater: { at: string; status: string; payload: UpdaterPayload } | null;
  healthVersion: string | null;
  /** Archivo que mandó el system-health (script_name; los viejos no lo mandan) */
  healthScript?: string | null;
  healthAt: string | null;
  hostKey: string;               // IP pública + local: identifica servicios que son el mismo servidor
  sharedWith?: string;           // nombre del servicio del que toma el reporte del actualizador
};

type Verdict = 'ok' | 'auto' | 'manual';

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

const ago = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (h < 1) return 'hace minutos';
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
};
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-UY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const VERDICT: Record<Verdict, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok:     { label: 'Al día',              cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 },
  auto:   { label: 'Se actualiza solo',   cls: 'bg-blue-50 text-blue-700 border-blue-200',          Icon: Clock },
  manual: { label: 'Necesita push manual', cls: 'bg-red-50 text-red-700 border-red-200',             Icon: Hand },
};

export function ScriptUpdatesView({ services, clients }: { services: Service[]; clients: Client[] }) {
  const [latest, setLatest] = useState<Latest>({});
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const ids = services.map(s => s.id);
    const [{ data: sv }, { data: hb }] = await Promise.all([
      supabase.from('script_versions').select('source, variant, version, fetched_at').like('source', 'file:%'),
      ids.length
        ? supabase.from('service_heartbeats').select('service_id, source, status, payload, received_at')
            .in('service_id', ids).in('source', ['update-scripts', 'system-health']).gte('received_at', since)
            .order('received_at', { ascending: false }).limit(5000)
        : Promise.resolve({ data: [] as never[] }),
    ]);

    const lt: Latest = {};
    let maxAt: string | null = null;
    for (const r of (sv ?? []) as { source: string; variant: string; version: string; fetched_at: string }[]) {
      const name = r.source.slice(5);
      const platform = (r.variant.startsWith('linux') ? 'linux' : 'windows') as Platform;
      lt[`${platform}:${name}`] = { version: r.version, platform, manual: r.variant.endsWith('-manual') };
      if (!maxAt || r.fetched_at > maxAt) maxAt = r.fetched_at;
    }
    setLatest(lt);
    setSyncedAt(maxAt);

    const clientName = new Map(clients.map(c => [c.id, c.company_name]));
    const byId = new Map<string, Machine>();
    for (const h of (hb ?? []) as { service_id: string; source: string; status: string; payload: Record<string, unknown> | null; received_at: string }[]) {
      const svc = services.find(s => s.id === h.service_id);
      if (!svc) continue;
      let m = byId.get(h.service_id);
      if (!m) {
        m = { serviceId: svc.id, name: svc.business_name || svc.name, clientName: clientName.get(svc.client_id) ?? '', platform: null, updater: null, healthVersion: null, healthAt: null, hostKey: '' };
        byId.set(svc.id, m);
      }
      const p = (h.payload ?? {}) as Record<string, unknown>;
      if (h.source === 'update-scripts' && !m.updater) {
        m.updater = { at: h.received_at, status: h.status, payload: p as UpdaterPayload };
        if (p.platform === 'windows' || p.platform === 'linux') m.platform = p.platform;
      }
      if (h.source === 'system-health' && !m.healthAt) {
        m.healthAt = h.received_at;
        m.healthVersion = typeof p.script_version === 'string' ? p.script_version : null;
        m.healthScript = typeof p.script_name === 'string' ? p.script_name : null;
        if (p.public_ip || p.local_ip) m.hostKey = `${p.public_ip ?? ''}|${p.local_ip ?? ''}`;
        // Windows manda os_caption ("Microsoft Windows …"); Linux manda load_avg
        if (!m.platform) {
          const os = String(p.os_caption ?? p.os_name ?? '').toLowerCase();
          m.platform = os.includes('windows') ? 'windows' : p.load_avg != null ? 'linux' : 'windows';
        }
      }
    }
    // Solo equipos que reportaron en la última semana (los demás están apagados o dados de baja)
    const weekAgo = Date.now() - 7 * 86_400_000;
    // Varios servicios en el mismo servidor (ej. RMI): el actualizador reporta en uno solo
    const all = [...byId.values()];
    for (const m of all) {
      if (m.updater || !m.hostKey) continue;
      const sib = all.find(o => o !== m && o.updater && o.hostKey === m.hostKey);
      if (sib) { m.updater = sib.updater; m.platform = m.platform ?? sib.platform; m.sharedWith = sib.name; }
    }
    setMachines([...byId.values()].filter(m => new Date(m.updater?.at ?? m.healthAt ?? 0).getTime() > weekAgo));
    setLoading(false);
  }, [services, clients]);

  useEffect(() => { load(); }, [load]);

  const syncNow = async () => {
    setSyncing(true);
    setSyncError('');
    const { error } = await supabase.functions.invoke('sync-script-versions', { body: {} });
    if (error) setSyncError(error.message);
    await load();
    setSyncing(false);
  };

  const rows = useMemo(() => machines.map(m => {
    const plat = m.platform ?? 'windows';
    const installed = m.updater?.payload.installed ?? {};
    const outdated = Object.entries(installed)
      .filter(([name]) => name !== 'config.ps1')
      .map(([name, ver]) => ({ name, ver, latest: latest[`${plat}:${name}`]?.version }))
      .filter(x => x.latest && cmpVersion(x.ver, x.latest) < 0) as { name: string; ver: string; latest: string }[];

    const reasons: string[] = [];
    let verdict: Verdict;
    const u = m.updater;
    const daysSince = u ? (Date.now() - new Date(u.at).getTime()) / 86_400_000 : Infinity;
    // En Windows puede correr system-health.ps1 o system-health-server.ps1: si el script no dice cuál,
    // se compara con la versión de los dos que sigue a la actual (nunca se marca vieja una más nueva)
    const healthLatest = (() => {
      if (m.healthScript) return latest[`${plat}:${m.healthScript}`]?.version;
      if (plat === 'linux') return latest['linux:system-health.sh']?.version;
      const cands = ['system-health.ps1', 'system-health-server.ps1']
        .map(n => latest[`windows:${n}`]?.version).filter((v): v is string => !!v);
      if (!m.healthVersion) return cands.sort(cmpVersion)[cands.length - 1];
      return cands.filter(c => cmpVersion(c, m.healthVersion!) >= 0).sort(cmpVersion)[0];
    })();
    const healthOld = m.healthVersion && healthLatest && cmpVersion(m.healthVersion, healthLatest) < 0;

    if (!u) {
      verdict = 'manual';
      reasons.push('El actualizador nunca reportó (versión anterior a la 1.3.0 o sin programar).');
    } else if (daysSince > UPDATER_STALE_DAYS) {
      verdict = 'manual';
      reasons.push(`El actualizador no corre desde ${fmtDate(u.at)}: revisá la tarea programada o el cron.`);
    } else if (plat === 'windows' && !u.payload.task) {
      verdict = outdated.length ? 'manual' : 'ok';
      reasons.push('No hay tarea programada para update-scripts: se corrió a mano. Corré setup-scheduled-tasks.ps1.');
    } else if (u.payload.task && typeof u.payload.task.last_result === 'number' && u.payload.task.last_result !== 0 && u.payload.task.last_result !== 267009) {
      verdict = 'manual';
      reasons.push(`La tarea programada terminó con código ${u.payload.task.last_result}.`);
    } else if ((u.payload.errors ?? []).length) {
      verdict = 'manual';
      reasons.push(`Errores en la última corrida: ${(u.payload.errors ?? []).join(' · ')}`);
    } else {
      verdict = outdated.length ? 'auto' : 'ok';
    }
    if (m.sharedWith) reasons.unshift(`Mismo servidor que "${m.sharedWith}".`);
    if (verdict === 'auto') {
      const next = u?.payload.task?.next_run;
      reasons.push(next ? `Próxima corrida: ${fmtDate(next)}.` : 'Se actualiza en la próxima corrida del cron.');
    }
    return { m, plat, outdated, verdict, reasons, healthLatest, healthOld };
  }).sort((a, b) => {
    const order: Record<Verdict, number> = { manual: 0, auto: 1, ok: 2 };
    return order[a.verdict] - order[b.verdict] || a.m.clientName.localeCompare(b.m.clientName) || a.m.name.localeCompare(b.m.name);
  }), [machines, latest]);

  const syncStale = !syncedAt || Date.now() - new Date(syncedAt).getTime() > 36 * 3_600_000;
  const counts = { ok: rows.filter(r => r.verdict === 'ok').length, auto: rows.filter(r => r.verdict === 'auto').length, manual: rows.filter(r => r.verdict === 'manual').length };
  const manualFiles = Object.entries(latest).filter(([, v]) => v.manual).map(([k, v]) => ({ name: k.split(':')[1], ...v }));

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">Cargando…</div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <p className="text-sm text-gray-600">
            Cada equipo baja solo las versiones nuevas de GitHub (rama <span className="font-mono">main</span>) cada 48 h.
            Acá ves si eso está pasando o si hace falta actualizar a mano.
          </p>
          <button onClick={() => setShowHelp(v => !v)} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
            <Info className="w-3.5 h-3.5" /> {showHelp ? 'Ocultar' : 'Cómo funciona'}
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className={syncStale ? 'text-amber-700' : ''} title="Se revisa solo todos los días a las 03:00 (06:00 UTC)">
            {syncStale && <AlertTriangle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />}
            GitHub revisado: <span className="font-medium text-gray-700">{fmtDate(syncedAt)}</span> ({ago(syncedAt)})
          </span>
          <button onClick={syncNow} disabled={syncing}
            className="inline-flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 bg-white rounded-lg px-2.5 py-1.5 text-gray-700 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} /> Revisar GitHub ahora
          </button>
        </div>
      </div>
      {syncStale && !syncError && (
        <p className="text-xs text-amber-700">La revisión automática de GitHub (todos los días 03:00) no corrió en más de un día: tocá "Revisar GitHub ahora" y si falla avisá.</p>
      )}
      {syncError && <p className="text-xs text-red-600">No se pudo revisar GitHub: {syncError}</p>}

      {showHelp && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-700 space-y-1.5 max-w-3xl">
          <p><strong>Windows:</strong> tarea programada <span className="font-mono">ServiceCatalog-UpdateScripts</span> cada 48 h (la crea <span className="font-mono">setup-scheduled-tasks.ps1</span>). <strong>Linux:</strong> cron cada 2 días (<span className="font-mono">0 4 */2 * * /srv/scripts/update-scripts.sh</span>).</p>
          <p>Baja cada script de <span className="font-mono">main</span> y lo reemplaza solo si el <span className="font-mono">SCRIPT_VERSION</span> es mayor. Un cambio en una rama sin mergear no llega a ningún equipo.</p>
          <p><span className="font-mono">config.ps1</span> nunca se pisa: la versión nueva queda como <span className="font-mono">config.ps1.new</span>. Los scripts de monitoreo que se actualizan se corren una vez enseguida.</p>
          <p>Al terminar le avisa al portal qué quedó instalado (desde la versión 1.3.0 del actualizador). Si un equipo no aparece como reportando, actualizalo a mano una vez y desde ahí sigue solo.</p>
          <p><strong>Push manual en Windows:</strong> <span className="font-mono">cd C:\Scripts; .\update-scripts.ps1</span> · <strong>Linux:</strong> <span className="font-mono">sudo /srv/scripts/update-scripts.sh</span></p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['manual', 'auto', 'ok'] as Verdict[]).map(v => {
          const { label, cls, Icon } = VERDICT[v];
          return (
            <span key={v} className={`inline-flex items-center gap-1.5 border rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
              <Icon className="w-3.5 h-3.5" /> {label}: <span className="tabular-nums">{counts[v]}</span>
            </span>
          );
        })}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left text-xs font-semibold text-gray-500">
                <th className="px-4 py-2.5">Equipo</th>
                <th className="px-4 py-2.5">Estado</th>
                <th className="px-4 py-2.5">Último reporte</th>
                <th className="px-4 py-2.5">Actualizador</th>
                <th className="px-4 py-2.5">Pendientes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">Ningún equipo reportó en la última semana.</td></tr>
              )}
              {rows.map(({ m, plat, outdated, verdict, reasons, healthLatest, healthOld }) => {
                const { label, cls, Icon } = VERDICT[verdict];
                const u = m.updater;
                const expanded = open === m.serviceId;
                const installed = Object.entries(u?.payload.installed ?? {}).sort(([a], [b]) => a.localeCompare(b));
                return (
                  <tr key={m.serviceId} className="align-top hover:bg-gray-50/60">
                    <td className="px-4 py-3 min-w-[12rem]">
                      <div className="font-medium text-gray-900">{m.name}</div>
                      <div className="text-xs text-gray-500">{m.clientName} · {plat === 'linux' ? 'Linux' : 'Windows'}</div>
                    </td>
                    <td className="px-4 py-3 min-w-[14rem]">
                      <span className={`inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cls}`}>
                        <Icon className="w-3 h-3" /> {label}
                      </span>
                      {reasons.map(r => <p key={r} className="text-xs text-gray-500 mt-1 max-w-xs">{r}</p>)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {m.healthAt ? (
                        <>
                          <div className="text-gray-800">{fmtDate(m.healthAt)}</div>
                          <div className="text-gray-400">system-health · {ago(m.healthAt)}</div>
                        </>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                      {u ? (
                        <>
                          <div className="text-gray-800">Corrió: {fmtDate(u.at)}</div>
                          <div className="text-gray-400">{ago(u.at)} · v{u.payload.script_version ?? '?'}{u.payload.task?.name ? ` · ${u.payload.task.name === 'cron' ? 'cron' : 'tarea programada'}` : ''}</div>
                          {u.payload.task?.next_run && <div className="text-gray-400">Próxima: {fmtDate(u.payload.task.next_run)}</div>}
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Nunca reportó</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {u ? (
                        <>
                          {outdated.length === 0
                            ? <span className="text-gray-400">Nada</span>
                            : outdated.map(o => (
                                <div key={o.name} className="font-mono text-gray-700 whitespace-nowrap">{o.name} <span className="text-gray-400">{o.ver} →</span> <span className="text-blue-700">{o.latest}</span></div>
                              ))}
                          <button onClick={() => setOpen(expanded ? null : m.serviceId)} className="mt-1 inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-600">
                            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {installed.length} instalados
                          </button>
                          {expanded && (
                            <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 font-mono text-[11px] text-gray-500">
                              {installed.map(([n, v]) => <Fragment2 key={n} n={n} v={v} />)}
                            </div>
                          )}
                        </>
                      ) : m.healthVersion ? (
                        healthOld
                          ? <div className="font-mono text-gray-700 whitespace-nowrap">system-health <span className="text-gray-400">{m.healthVersion} →</span> <span className="text-blue-700">{healthLatest}</span></div>
                          : <span className="text-gray-500">system-health {m.healthVersion} (al día)</span>
                      ) : <span className="text-gray-400">No manda versión (muy viejo)</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {manualFiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-900">Scripts que el actualizador no maneja</h3>
          <p className="text-xs text-gray-500">Estos se copian a mano en cada equipo que los use.</p>
          <div className="flex flex-wrap gap-1.5">
            {manualFiles.map(f => (
              <span key={`${f.platform}:${f.name}`} className="inline-flex items-center gap-1 text-xs border border-gray-200 bg-white rounded-md px-2 py-1 font-mono text-gray-700">
                {f.name} <span className="text-gray-400">{f.version} · {f.platform === 'linux' ? 'Linux' : 'Windows'}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Fragment2({ n, v }: { n: string; v: string }) {
  return (<><span>{n}</span><span>{v}</span></>);
}
