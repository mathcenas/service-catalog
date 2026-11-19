import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Eye, AlertTriangle, Mail, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DigestPreviewModal, DIGEST_LABEL, type DigestVersion } from './DigestPreviewModal';

// Mismas reglas que las funciones (client-weekly-digest y backup-alert-digest),
// que corren todos los días a las 11:00 UTC por pg_cron:
//   - contactos 'all'     → resumen diario, todos los días
//   - contactos 'weekly'  → resumen semanal, los lunes (UTC)
//   - contactos 'monthly' → resumen mensual, el primer lunes del mes
//   - alerta de backups   → si hubo algún backup con advertencia o fallido en las 24 h previas,
//                           un mail INTERNO a Cenas IT (no a los contactos del cliente: ellos ven
//                           los backups en su resumen, con la frecuencia que eligieron)
// Un mail por grupo de frecuencia (todos los contactos del grupo en el mismo mail).
const RUN_HOUR_UTC = 11;
const RESEND_DAILY_LIMIT = 100;

type Contact = { client_id: string; name: string; email: string; digest_frequency: string };
type ClientRow = { id: string; company_name: string };
type FailedBackup = { service_id: string; status: string };

type Planned = {
  client: ClientRow;
  groups: { version: DigestVersion; contacts: Contact[] }[];
  alert: { problems: number; contacts: Contact[] } | null;
};

function nextRuns(count: number, from = new Date()): Date[] {
  const first = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), RUN_HOUR_UTC));
  if (first <= from) first.setUTCDate(first.getUTCDate() + 1);
  return Array.from({ length: count }, (_, i) => new Date(first.getTime() + i * 86_400_000));
}

const isMonday = (d: Date) => d.getUTCDay() === 1;
const isFirstMonday = (d: Date) => isMonday(d) && d.getUTCDate() <= 7;

const fmtRun = (d: Date) => d.toLocaleString('es-UY', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDay = (d: Date) => d.toLocaleDateString('es-UY', { weekday: 'short', day: 'numeric' });

const VERSION_STYLE: Record<DigestVersion, string> = {
  daily: 'bg-blue-50 text-blue-700 border-blue-100',
  weekly: 'bg-violet-50 text-violet-700 border-violet-100',
  monthly: 'bg-purple-50 text-purple-700 border-purple-100',
  alert: 'bg-amber-50 text-amber-800 border-amber-200',
};

export function DigestScheduleView() {
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [problemsByClient, setProblemsByClient] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [runIndex, setRunIndex] = useState(0);
  const [preview, setPreview] = useState<{ client: ClientRow; version: DigestVersion } | null>(null);

  const runs = useMemo(() => nextRuns(7), []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since24h = new Date(Date.now() - 86_400_000).toISOString();
      const [{ data: cl }, { data: ct }, { data: bk }, { data: sv }] = await Promise.all([
        supabase.from('clients').select('id, company_name').eq('status', 'Active').order('company_name'),
        supabase.from('client_contacts').select('client_id, name, email, digest_frequency'),
        supabase.from('service_backups').select('service_id, status').gte('backed_up_at', since24h).neq('status', 'success'),
        supabase.from('services').select('id, client_id'),
      ]);
      const svcClient = new Map(((sv ?? []) as { id: string; client_id: string }[]).map(s => [s.id, s.client_id]));
      const problems: Record<string, number> = {};
      for (const b of (bk ?? []) as FailedBackup[]) {
        const c = svcClient.get(b.service_id);
        if (c) problems[c] = (problems[c] ?? 0) + 1;
      }
      setClients((cl ?? []) as ClientRow[]);
      setContacts((ct ?? []) as Contact[]);
      setProblemsByClient(problems);
      setLoading(false);
    })();
  }, []);

  const planFor = (run: Date, withAlerts: boolean): Planned[] => clients.map(client => {
    const mine = contacts.filter(c => c.client_id === client.id);
    const groups: Planned['groups'] = [];
    const daily = mine.filter(c => c.digest_frequency === 'all');
    if (daily.length) groups.push({ version: 'daily', contacts: daily });
    if (isMonday(run)) {
      const weekly = mine.filter(c => c.digest_frequency === 'weekly');
      if (weekly.length) groups.push({ version: 'weekly', contacts: weekly });
    }
    if (isFirstMonday(run)) {
      const monthly = mine.filter(c => c.digest_frequency === 'monthly');
      if (monthly.length) groups.push({ version: 'monthly', contacts: monthly });
    }
    const problems = problemsByClient[client.id] ?? 0;
    // La alerta es interna: no va a contactos del cliente
    const alert = withAlerts && problems > 0 ? { problems, contacts: [] as Contact[] } : null;
    return { client, groups, alert };
  });

  const days = runs.map((run, i) => {
    const plan = planFor(run, i === 0);
    const mails = plan.reduce((n, p) => n + p.groups.length + (p.alert ? 1 : 0), 0);
    const recipients = plan.reduce((n, p) => n + p.groups.reduce((m, g) => m + g.contacts.length, 0) + (p.alert?.contacts.length ?? 0), 0);
    return { run, plan, mails, recipients };
  });

  const current = days[runIndex];
  const sending = current?.plan.filter(p => p.groups.length || p.alert) ?? [];
  const withoutDigest = clients.filter(c => !contacts.some(x => x.client_id === c.id && x.digest_frequency !== 'none'));

  if (loading) return <div className="text-center py-12 text-gray-400">Cargando…</div>;

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        Lo que se va a mandar en los próximos envíos automáticos (todos los días a las {RUN_HOUR_UTC}:00 UTC), según la
        frecuencia de cada contacto. Tocá un resumen para ver cómo le llega al cliente.
      </p>

      {/* Próximos 7 días */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
        {days.map((d, i) => (
          <button key={d.run.toISOString()} onClick={() => setRunIndex(i)}
            className={`rounded-lg border px-2 py-2 text-left transition-colors ${i === runIndex ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
            <div className="text-[11px] text-gray-500 capitalize">{fmtDay(d.run)}</div>
            <div className="text-lg font-bold text-gray-900 tabular-nums leading-tight">{d.mails}</div>
            <div className="text-[10px] text-gray-400">mail{d.mails === 1 ? '' : 's'}</div>
            <div className="flex flex-wrap gap-1 mt-1">
              {isMonday(d.run) && <span className="text-[9px] px-1 rounded bg-violet-100 text-violet-700">semanal</span>}
              {isFirstMonday(d.run) && <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-700">mensual</span>}
            </div>
          </button>
        ))}
      </div>

      {current && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="inline-flex items-center gap-1.5 text-gray-800 font-medium capitalize">
            <CalendarClock className="w-4 h-4 text-gray-400" /> {fmtRun(current.run)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-gray-600"><Mail className="w-4 h-4 text-gray-400" /> {current.mails} mails</span>
          <span className="inline-flex items-center gap-1.5 text-gray-600"><Users className="w-4 h-4 text-gray-400" /> {current.recipients} destinatarios</span>
          <span className={`text-xs ${current.recipients > RESEND_DAILY_LIMIT * 0.8 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
            Límite de Resend: {RESEND_DAILY_LIMIT} por día
          </span>
        </div>
      )}
      {runIndex === 0 ? (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          La alerta de backups se decide en el momento del envío, con los backups de las 24 h anteriores. Lo que ves acá es
          lo que saldría si el envío fuera ahora.
        </p>
      ) : (
        <p className="text-xs text-gray-400">Para días futuros no se puede saber si va a salir la alerta de backups: depende de cómo terminen esos backups.</p>
      )}

      {/* Detalle del envío elegido */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-left">
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Cliente</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Qué recibe</th>
                <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Destinatarios</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sending.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">No sale nada en este envío.</td></tr>
              )}
              {sending.map(p => {
                const items: { version: DigestVersion; contacts: Contact[]; extra?: string }[] = [
                  ...p.groups,
                  ...(p.alert ? [{ version: 'alert' as DigestVersion, contacts: p.alert.contacts, extra: `${p.alert.problems} con problemas` }] : []),
                ];
                return (
                  <tr key={p.client.id} className="hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.client.company_name}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {items.map(it => (
                          <button key={it.version} onClick={() => setPreview({ client: p.client, version: it.version })}
                            className={`inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 hover:brightness-95 ${VERSION_STYLE[it.version]}`}
                            title="Ver cómo le llega">
                            {it.version === 'alert' && <AlertTriangle className="w-3 h-3" />}
                            {DIGEST_LABEL[it.version]}{it.extra ? ` · ${it.extra}` : ''}
                            {it.version === 'alert' && ' · interna, te llega a vos'}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {items.map(it => it.contacts.length ? (
                        <div key={it.version}>
                          <span className="text-gray-400">{DIGEST_LABEL[it.version].replace('Resumen ', '')}:</span>{' '}
                          {it.contacts.map(c => c.name || c.email).join(', ')}
                        </div>
                      ) : null)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => setPreview({ client: p.client, version: items[0].version })}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-2 py-1 rounded-lg">
                        <Eye className="w-3.5 h-3.5" /> Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {withoutDigest.length > 0 && (
        <div className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">Sin ningún resumen configurado ({withoutDigest.length}):</span>{' '}
          {withoutDigest.map(c => c.company_name).join(', ')}. Agregales un contacto con frecuencia en la pestaña Contactos.
        </div>
      )}

      {preview && (
        <DigestPreviewModal
          clientId={preview.client.id}
          clientName={preview.client.company_name}
          initial={preview.version}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
