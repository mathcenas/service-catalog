import { supabase, RoadmapItem, Service } from './supabase';

// Recordatorio sugerido (segundo aviso) de un incidente que espera una decisión del cliente.
// Se sugiere una sola vez, a los REMINDER_AFTER_DAYS del último aviso si en el medio no hubo novedades
// (mandar una actualización mueve notified_at). El texto sale de la telemetría y se edita antes de mandar.

export const REMINDER_AFTER_DAYS = 7;
const REMINDER_CATEGORIES = new Set(['problem']);

export function reminderDue(item: RoadmapItem): number | null {
  if (!item.client_id || item.status === 'Released' || item.reminded_at || !item.notified_at) return null;
  if (!REMINDER_CATEGORIES.has(item.category)) return null;
  const days = Math.floor((Date.now() - new Date(item.notified_at).getTime()) / 86_400_000);
  return days >= REMINDER_AFTER_DAYS ? days : null;
}

const dateUy = (iso: string) => new Date(iso).toLocaleDateString('es-UY', { day: 'numeric', month: 'numeric' });

/** "REPLICA_20319KORE_LOCAL" → "KORE": nombres de trabajos de backup sin lo técnico */
export function friendlyJob(job: string): string {
  const s = job
    .replace(/^[\w.]+ - /, '')            // "Veeam - …"
    .replace(/^(replica|backup|job|copia|bkp)[_\s-]*/i, '')
    .replace(/[_\s-]*(local|remote|remoto|offsite|daily|diario|semanal|weekly)$/i, '')
    .replace(/^\d+/, '')
    .replace(/[_]+/g, ' ')
    .trim();
  return s || job;
}

const HW_RE = /(error de hardware|no pudo escribir|smart|sector|disco .*fall|falla .*disco|bad block|i\/o)/i;

export async function buildReminderDraft(item: RoadmapItem, services: Service[]): Promise<string> {
  const clientSvcs = services.filter(s => s.client_id === item.client_id);
  const ids = clientSvcs.map(s => s.id);
  const nameOf = (id: string) => { const s = clientSvcs.find(x => x.id === id); return s?.business_name || s?.name || 'el equipo'; };
  const since = item.notified_at ?? new Date(Date.now() - 7 * 86_400_000).toISOString();

  // 1. Lo que la telemetría sigue viendo: problemas de hardware en el último reporte de cada equipo
  const hwLines: string[] = [];
  if (ids.length) {
    const { data: hbs } = await supabase.from('service_heartbeats')
      .select('service_id, payload, received_at')
      .in('service_id', ids).eq('source', 'system-health')
      .gte('received_at', new Date(Date.now() - 48 * 3_600_000).toISOString())
      .order('received_at', { ascending: false }).limit(300);
    const seen = new Set<string>();
    for (const h of (hbs ?? []) as { service_id: string; payload: Record<string, unknown> | null; received_at: string }[]) {
      if (seen.has(h.service_id)) continue;
      seen.add(h.service_id);
      const issues = String(h.payload?.issues ?? '');
      if (HW_RE.test(issues)) hwLines.push(`el disco de ${nameOf(h.service_id)} sigue dando errores (último control: ${dateUy(h.received_at)})`);
    }
  }

  // 2. La consecuencia: respaldos que fallan desde el aviso, con su último respaldo bueno
  const failing: { job: string; lastOk: string | null }[] = [];
  if (ids.length) {
    const { data: bks } = await supabase.from('service_backups')
      .select('service_id, job_name, status, backed_up_at')
      .in('service_id', ids)
      .gte('backed_up_at', new Date(new Date(since).getTime() - 30 * 86_400_000).toISOString())
      .order('backed_up_at', { ascending: false }).limit(3000);
    const byJob = new Map<string, { latest: string; latestAt: string; lastOk: string | null }>();
    for (const b of (bks ?? []) as { service_id: string; job_name: string | null; status: string; backed_up_at: string }[]) {
      const key = `${b.service_id}|${b.job_name ?? ''}`;
      const cur = byJob.get(key);
      if (!cur) byJob.set(key, { latest: b.status, latestAt: b.backed_up_at, lastOk: b.status === 'success' ? b.backed_up_at : null });
      else if (!cur.lastOk && b.status === 'success') cur.lastOk = b.backed_up_at;
    }
    for (const [key, v] of byJob) {
      if (v.latest === 'success') continue;
      if (v.latestAt < since) continue;            // trabajos que ya no corren (ej. nombres con fecha)
      if (/resumen|summary/i.test(key)) continue;  // resúmenes diarios: repiten los trabajos de verdad
      if (v.lastOk && v.lastOk > since) continue;   // falló hoy pero anduvo después del aviso: no es consecuencia
      failing.push({ job: friendlyJob(key.split('|')[1] || nameOf(key.split('|')[0])), lastOk: v.lastOk });
    }
  }

  const jobs = [...new Set(failing.map(f => f.job))];
  const lastOk = failing.map(f => f.lastOk).filter((d): d is string => !!d).sort()[0];
  const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`;

  const lines = [
    `Te escribimos de nuevo por el aviso del ${dateUy(since)}.`,
    hwLines.length ? `Qué sigue pasando: ${hwLines[0]}.` : 'Qué sigue pasando: [completá qué sigue fallando].',
    jobs.length
      ? `Consecuencia: los respaldos de ${list(jobs)} no se están completando${lastOk ? ` (el último bueno es del ${dateUy(lastOk)})` : ''}. Si el disco deja de funcionar, se pierde lo que no está respaldado.`
      : 'Consecuencia: [completá qué riesgo hay si no se resuelve].',
    'Necesitamos tu confirmación para avanzar con la solución.',
  ];
  return lines.join('\n');
}
