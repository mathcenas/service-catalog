import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, Clock, Ticket, ChevronDown, Link2 } from 'lucide-react';
import { supabase, Client } from '../lib/supabase';

// Tickets que sync-alert-tickets abre y cierra en Task Tracker (tabla alert_tickets).
// Sirve para validar desde acá que una tarea se cerró sola cuando volvió el backup / la señal,
// sin entrar a Task Tracker.

type Row = {
  id: string; alert_key: string; kind: string; client_id: string | null; title: string; detail: string | null;
  status: 'open' | 'resolved'; tt_task_id: string | null; tt_error: string | null;
  opened_at: string; last_seen_at: string; clear_count: number; resolved_at: string | null; resolve_note: string | null; notes_sent?: number;
};

const fmt = (iso: string) => new Date(iso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dur = (from: string, to?: string | null) => {
  const h = ((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 3_600_000;
  return h < 1 ? 'menos de 1 h' : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} días`;
};

export function AlertTicketsPanel({ clients }: { clients: Client[] }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const clientName = (id: string | null) => clients.find(c => c.id === id)?.company_name ?? '';
  const [copied, setCopied] = useState<Record<string, string>>({});

  // Link al portal del cliente, directo al aviso "Requiere tu atención" (para mandarle "mirá esto")
  const copyClientLink = async (r: Row) => {
    let text = '';
    try {
      const { data } = await supabase.from('client_share_tokens').select('token').eq('client_id', r.client_id ?? '').order('created_at', { ascending: false }).limit(1);
      const token = data?.[0]?.token;
      if (!token) { setCopied(c => ({ ...c, [r.id]: 'El cliente no tiene portal: crealo en Clientes → Compartir' })); return; }
      text = `${window.location.origin}/share/${token}#atencion`;
      await navigator.clipboard.writeText(text);
      setCopied(c => ({ ...c, [r.id]: 'Link copiado' }));
    } catch {
      setCopied(c => ({ ...c, [r.id]: text ? `No se pudo copiar: ${text}` : 'No se pudo copiar' }));
    }
    setTimeout(() => setCopied(c => { const n = { ...c }; delete n[r.id]; return n; }), 4000);
  };

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data } = await supabase.from('alert_tickets').select('*')
      .or(`status.eq.open,resolved_at.gte.${since}`).order('opened_at', { ascending: false });
    setRows((data ?? []) as Row[]);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const checkNow = async () => {
    setChecking(true); setMsg('');
    const { data, error } = await supabase.functions.invoke('sync-alert-tickets', { body: {} });
    if (error) setMsg(`No se pudo revisar: ${error.message}`);
    else {
      const r = data as { opened: number; resolved: number; waiting_to_resolve: number; errors: string[] };
      setMsg([`${r.opened} abiertos`, `${r.resolved} cerrados`, r.waiting_to_resolve ? `${r.waiting_to_resolve} por cerrarse` : '', r.errors?.length ? `${r.errors.length} con error` : '']
        .filter(Boolean).join(' · '));
    }
    await load();
    setChecking(false);
  };

  const open = rows.filter(r => r.status === 'open');
  const resolved = rows.filter(r => r.status === 'resolved');
  if (loading) return null;

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200">
      <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-3 border-b border-gray-100">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-gray-900 inline-flex items-center gap-2"><Ticket className="w-4 h-4 text-gray-400" /> Tickets automáticos</h2>
          <p className="text-xs text-gray-500">Se abren en Task Tracker con cada alerta y se cierran solos cuando la alerta desaparece dos chequeos seguidos (cada hora, a los :17).</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-xs text-gray-500">{msg}</span>}
          <button onClick={checkNow} disabled={checking}
            className="inline-flex items-center gap-1.5 text-xs border border-gray-200 hover:border-gray-300 rounded-lg px-2.5 py-1.5 text-gray-700 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> Revisar ahora
          </button>
        </div>
      </div>

      <div className="divide-y divide-gray-100">
        {open.length === 0 && <p className="px-5 py-4 text-sm text-gray-400">No hay tickets abiertos.</p>}
        {open.map(r => {
          const closing = r.clear_count > 0;
          return (
            <div key={r.id} className="px-5 py-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">{r.title}</p>
                <p className="text-xs text-gray-500 whitespace-pre-line">{clientName(r.client_id)}{r.detail ? ` · ${r.detail}` : ''}</p>
                {!!r.notes_sent && <p className="text-[11px] text-gray-400">{r.notes_sent} {r.notes_sent === 1 ? 'novedad enviada' : 'novedades enviadas'} a la tarea</p>}
                {r.tt_error && <p className="text-xs text-amber-700 mt-0.5">{r.tt_error}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {closing
                  ? <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700" title="La alerta ya no está; se cierra en el próximo chequeo si sigue así">
                      <CheckCircle2 className="w-3 h-3" /> por cerrarse
                    </span>
                  : <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 text-gray-600"><Clock className="w-3 h-3" /> abierto hace {dur(r.opened_at)}</span>}
                <span className={`rounded-md border px-1.5 py-0.5 ${r.tt_task_id ? 'border-blue-100 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-400'}`}>
                  {r.tt_task_id ? 'en Task Tracker' : 'sin tarea'}
                </span>
                {r.kind === 'health' && r.client_id && (
                  <button type="button" onClick={() => copyClientLink(r)}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 min-h-6 text-gray-700 hover:border-gray-300"
                    title="Copia el link del portal del cliente, directo al aviso explicado para él">
                    <Link2 className="w-3 h-3" aria-hidden="true" /> Link para el cliente
                  </button>
                )}
                <span role="status" className="text-gray-500">{copied[r.id] ?? ''}</span>
              </div>
            </div>
          );
        })}
      </div>

      {resolved.length > 0 && (
        <div className="border-t border-gray-100">
          <button onClick={() => setShowResolved(v => !v)} aria-expanded={showResolved}
            className="w-full px-5 py-3 flex items-center justify-between text-sm text-gray-700 hover:bg-gray-50">
            <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> Cerrados solos en los últimos 7 días ({resolved.length})</span>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showResolved ? 'rotate-180' : ''}`} />
          </button>
          {showResolved && (
            <div className="divide-y divide-gray-100 border-t border-gray-100">
              {resolved.map(r => (
                <div key={r.id} className="px-5 py-3">
                  <p className="text-sm font-medium text-gray-900">{r.title} <span className="text-xs font-normal text-gray-500">· {clientName(r.client_id)}</span></p>
                  <p className="text-xs text-gray-500">Abierto {fmt(r.opened_at)} · cerrado {r.resolved_at ? fmt(r.resolved_at) : ''} · duró {dur(r.opened_at, r.resolved_at)}{r.tt_task_id ? ' · cerrado también en Task Tracker' : ''}</p>
                  {r.resolve_note && <p className="text-xs text-gray-400 mt-0.5">Nota: {r.resolve_note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
