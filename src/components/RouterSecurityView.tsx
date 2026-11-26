import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, MinusCircle, Clock, ShieldCheck, ShieldAlert, RefreshCw, Router as RouterIcon } from 'lucide-react';
import { supabase, Service, Client } from '../lib/supabase';
import { evaluateBaseline, baselineScore, openPorts, netwatchDown, type RouterSecurity, type BaselineCheck } from '../lib/routerBaseline';

// Estado de cada MikroTik contra el estándar Cenas (mk-baseline.rsc), con lo que manda
// mk-network-report.rsc 1.3.0+ en payload.security.

type NetPayload = {
  identity?: string; board?: string; routeros_version?: string; script_version?: string;
  report_interval_s?: number; public_ip?: string; security?: RouterSecurity;
};
type Row = { svc: Service; clientName: string; at: string; p: NetPayload };

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('es-UY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (iso: string) => {
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  return h < 1 ? 'hace minutos' : h < 48 ? `hace ${Math.round(h)} h` : `hace ${Math.round(h / 24)} días`;
};

function CheckIcon({ c }: { c: BaselineCheck }) {
  if (c.ok === null) return <MinusCircle className="w-4 h-4 text-gray-300 shrink-0" />;
  if (c.ok) return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
  if (c.pending) return <Clock className="w-4 h-4 text-amber-500 shrink-0" />;
  return <XCircle className={`w-4 h-4 shrink-0 ${c.critical ? 'text-red-600' : 'text-red-400'}`} />;
}

export function RouterSecurityView({ services, clients }: { services: Service[]; clients: Client[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const ids = services.map(s => s.id);
    const { data } = ids.length
      ? await supabase.from('service_heartbeats').select('service_id, payload, received_at')
          .in('service_id', ids).eq('source', 'mk-network')
          .gte('received_at', new Date(Date.now() - 14 * 86_400_000).toISOString())
          .order('received_at', { ascending: false }).limit(1000)
      : { data: [] };
    const clientName = new Map(clients.map(c => [c.id, c.company_name]));
    const seen = new Map<string, Row>();
    for (const h of (data ?? []) as { service_id: string; payload: NetPayload | null; received_at: string }[]) {
      if (seen.has(h.service_id)) continue;
      const svc = services.find(s => s.id === h.service_id);
      if (svc) seen.set(h.service_id, { svc, clientName: clientName.get(svc.client_id) ?? '', at: h.received_at, p: h.payload ?? {} });
    }
    setRows([...seen.values()]);
    setLoading(false);
  }, [services, clients]);

  useEffect(() => { load(); }, [load]);

  const evaluated = useMemo(() => rows.map(r => {
    const checks = evaluateBaseline(r.p.security, r.p.report_interval_s);
    return { ...r, checks, score: baselineScore(checks), critical: checks.some(c => c.critical && c.ok === false) };
  }).sort((a, b) =>
    Number(b.critical) - Number(a.critical)
    || (a.score.total ? a.score.ok / a.score.total : 2) - (b.score.total ? b.score.ok / b.score.total : 2)
    || a.clientName.localeCompare(b.clientName)), [rows]);

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">Cargando…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-gray-600 max-w-3xl">
          Cada MikroTik contra el estándar Cenas. Lo que falta se aplica corriendo{' '}
          <span className="font-mono">mk-baseline</span> en el router (no toca lo que puede cortar servicio: eso lo avisa).
          Hace falta <span className="font-mono">mk-network-report</span> 1.3.0 o más nuevo.
        </p>
        <button onClick={load} className="inline-flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 bg-white rounded-lg px-2.5 py-1.5 text-xs text-gray-700">
          <RefreshCw className="w-3.5 h-3.5" /> Actualizar
        </button>
      </div>

      {evaluated.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-400">Ningún router reportó en las últimas dos semanas.</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {evaluated.map(({ svc, clientName, at, p, checks, score, critical }) => {
          const sec = p.security;
          const vpn = sec?.vpn_servers ?? {};
          const open = sec ? openPorts(sec) : [];
          const down = netwatchDown(sec);
          return (
            <div key={svc.id} className={`bg-white rounded-xl border p-4 space-y-3 min-w-0 ${critical ? 'border-red-300' : 'border-gray-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 font-medium text-gray-900">
                    <RouterIcon className="w-4 h-4 text-gray-400 shrink-0" /> <span className="truncate">{svc.business_name || svc.name}</span>
                  </div>
                  <div className="text-xs text-gray-500">{clientName} · {p.identity} · {p.board} · RouterOS {p.routeros_version}</div>
                  <div className="text-xs text-gray-400">Reporte: {fmtDate(at)} ({ago(at)}) · script {p.script_version ?? '?'}</div>
                </div>
                {sec ? (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums whitespace-nowrap ${
                    critical ? 'bg-red-50 text-red-700 border-red-200'
                    : score.ok === score.total ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {critical || score.ok < score.total ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                    {score.ok}/{score.total}
                  </span>
                ) : null}
              </div>

              {!sec ? (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Este router tiene mk-network-report {p.script_version ?? 'viejo'}: actualizalo a 1.3.0 para ver la seguridad.
                </p>
              ) : (
                <>
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {checks.map(c => (
                      <li key={c.id} className="flex items-start gap-1.5 text-xs min-w-0">
                        <CheckIcon c={c} />
                        <span className="min-w-0">
                          <span className={c.ok === false && !c.pending ? 'text-gray-900' : 'text-gray-600'}>{c.label}</span>
                          {c.detail && <span className="block text-gray-400">{c.detail}{c.pending && c.ok === false ? ' · decisión pendiente' : ''}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 border-t border-gray-100 pt-2">
                    <span>
                      VPN: {(['pptp', 'sstp', 'l2tp', 'ovpn'] as const).filter(k => vpn[k]).map(k => k.toUpperCase()).join(', ') || 'ninguna'}
                      {sec.ppp_secrets ? ` · ${sec.ppp_active ?? 0}/${sec.ppp_secrets} usuarios conectados` : ''}
                    </span>
                    {sec.pptp_bruteforce && <span>Bloqueadas ahora: <span className="tabular-nums">{sec.blocked_ips ?? 0}</span></span>}
                    <span>
                      Abierto a Internet: {open.length ? <span className="font-mono text-red-700">{open.join(' · ')}</span> : <span className="text-emerald-700">nada</span>}
                    </span>
                  </div>

                  {(sec.netwatch ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(sec.netwatch ?? []).filter(n => !n.disabled).map(n => (
                        <span key={n.host} title={n.since ? `desde ${n.since}` : undefined}
                          className={`text-[11px] rounded-md border px-1.5 py-0.5 ${n.status === 'down' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                          {n.status === 'down' ? '▼' : '▲'} {n.comment || n.host}
                        </span>
                      ))}
                      {down.length > 0 && <span className="text-[11px] text-red-700">{down.length} sin respuesta ahora</span>}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
