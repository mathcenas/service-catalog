import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, Trash2, Globe } from 'lucide-react';
import { supabase, Client } from '../lib/supabase';

// Salud del portal del cliente (/share/<token>):
// - prueba diaria (portal-selftest): consulta con el link de cada cliente lo mismo que el portal
// - errores reales: lo que falló cuando un cliente abrió su link (portal-error)
// Si todo anda, es una línea verde; si algo falla, la lista con cliente, consulta y mensaje.

type ErrRow = { id: string; client_id: string | null; source: 'portal' | 'selftest'; path: string; status: number | null; message: string; count: number; last_seen: string };
type Check = { run_at: string; clients: number; checks: number; failures: number };

const fmt = (iso: string) => new Date(iso).toLocaleString('es-UY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function PortalHealthPanel({ clients }: { clients: Client[] }) {
  const [errors, setErrors] = useState<ErrRow[]>([]);
  const [check, setCheck] = useState<Check | null>(null);
  const [running, setRunning] = useState(false);
  const clientName = (id: string | null) => clients.find(c => c.id === id)?.company_name ?? '—';

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [{ data: e }, { data: c }] = await Promise.all([
      supabase.from('portal_errors').select('id, client_id, source, path, status, message, count, last_seen')
        .gte('last_seen', since).order('last_seen', { ascending: false }).limit(50),
      supabase.from('portal_checks').select('run_at, clients, checks, failures').order('run_at', { ascending: false }).limit(1),
    ]);
    setErrors((e ?? []) as ErrRow[]);
    setCheck(((c ?? [])[0] as Check) ?? null);
  }, []);

  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true);
    await supabase.functions.invoke('portal-selftest', { body: {} });
    await load();
    setRunning(false);
  };
  const dismiss = async (id: string) => {
    await supabase.from('portal_errors').delete().eq('id', id);
    setErrors(rs => rs.filter(r => r.id !== id));
  };

  const stale = !check || Date.now() - new Date(check.run_at).getTime() > 36 * 3_600_000;
  const ok = errors.length === 0 && !stale && check?.failures === 0;

  return (
    <div className={`bg-white rounded-xl border p-4 ${ok ? 'border-gray-200' : 'border-red-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="w-4 h-4 text-gray-400" />
        <h3 className="text-sm font-semibold text-gray-900">Portal de clientes</h3>
        {ok ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Todo anda</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-red-700"><AlertTriangle className="w-3.5 h-3.5" />
            {errors.length ? `${errors.length} error${errors.length > 1 ? 'es' : ''} en los últimos 7 días` : 'La prueba diaria no corrió'}
          </span>
        )}
        <span className="text-xs text-gray-400">
          · Prueba diaria: {check ? `${fmt(check.run_at)} — ${check.clients} clientes, ${check.checks} consultas, ${check.failures} con error` : 'nunca corrió'}
        </span>
        <button onClick={runNow} disabled={running}
          className="ml-auto inline-flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1 text-xs text-gray-700 disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} /> Probar ahora
        </button>
      </div>
      {errors.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="py-1.5 pr-3 font-semibold">Cliente</th>
                <th className="py-1.5 pr-3 font-semibold">Dónde</th>
                <th className="py-1.5 pr-3 font-semibold">Consulta</th>
                <th className="py-1.5 pr-3 font-semibold">Error</th>
                <th className="py-1.5 pr-3 font-semibold">Última vez</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {errors.map(r => (
                <tr key={r.id} className="align-top">
                  <td className="py-1.5 pr-3 text-gray-900 whitespace-nowrap">{clientName(r.client_id)}</td>
                  <td className="py-1.5 pr-3 text-gray-600 whitespace-nowrap">{r.source === 'portal' ? 'Lo vio el cliente' : 'Prueba diaria'}{r.count > 1 ? ` ×${r.count}` : ''}</td>
                  <td className="py-1.5 pr-3 font-mono text-gray-600 break-all max-w-[16rem]">{r.path.split('?')[0]}</td>
                  <td className="py-1.5 pr-3 text-red-700 min-w-[12rem]">{r.status ? `${r.status} · ` : ''}{r.message}</td>
                  <td className="py-1.5 pr-3 text-gray-500 whitespace-nowrap">{fmt(r.last_seen)}</td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => dismiss(r.id)} title="Ya está resuelto" className="p-1 text-gray-400 hover:text-gray-600"><Trash2 className="w-3.5 h-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
