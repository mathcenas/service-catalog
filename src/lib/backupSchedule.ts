import type { Service } from './supabase';

export const DEFAULT_BACKUP_MAX_AGE_HOURS = 26;

// Días hábiles: el backup del viernes tiene que aguantar hasta el del lunes (72 h + margen).
export const BACKUP_SCHEDULE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Daily (overdue after 26h)' },
  { value: '74', label: 'Weekdays, Mon–Fri (overdue after 74h)' },
  { value: '194', label: 'Weekly (overdue after 8 days)' },
  { value: '770', label: 'Monthly (overdue after 32 days)' },
  { value: '0', label: 'Not monitored' },
];

/** Hours without a backup before the service counts as overdue; null = not monitored. */
export function backupMaxAgeHours(service: Pick<Service, 'backup_max_age_hours'>): number | null {
  const v = service.backup_max_age_hours;
  if (v === 0) return null;
  return v ?? DEFAULT_BACKUP_MAX_AGE_HOURS;
}

export const WEEKLY_MAX_AGE_HOURS = 194;
export const MONTHLY_MAX_AGE_HOURS = 770;

/** Frecuencia que sugiere el nombre del job ("Respaldo-Semanal", "OMV Weekly", "…Mensual"). */
function maxAgeFromJobName(jobName: string | null | undefined): number | null {
  const n = (jobName ?? '').toLowerCase();
  if (/mensual|monthly/.test(n)) return MONTHLY_MAX_AGE_HOURS;
  if (/semanal|weekly/.test(n)) return WEEKLY_MAX_AGE_HOURS;
  return null;
}

/**
 * Horas sin backup antes de que UN job cuente como vencido. Parte de la frecuencia del
 * servicio, pero un servicio diario puede tener jobs semanales o mensuales: se toma el
 * mayor entre la frecuencia del servicio, la que sugiere el nombre del job y la que
 * muestra su propio historial (mediana entre corridas + 20 %, si es mayor). null = no se controla.
 */
export function jobMaxAgeHours(
  serviceMaxAge: number | null,
  jobName: string | null | undefined,
  runsNewestFirst: string[],
  /** Frecuencia que informa la herramienta (política de Kopia): manda sobre las adivinanzas */
  expectedIntervalHours?: number | null,
): number | null {
  if (serviceMaxAge === null) return null;
  if (expectedIntervalHours && expectedIntervalHours > 0) {
    // 10 % + 2 h de margen: un diario vence a las 28 h, un semanal a los ~7,8 días
    return Math.max(serviceMaxAge, Math.round(expectedIntervalHours * 1.1 + 2));
  }
  let max = serviceMaxAge;
  const byName = maxAgeFromJobName(jobName);
  if (byName) max = Math.max(max, byName);
  if (runsNewestFirst.length >= 3) {
    const gaps: number[] = [];
    for (let i = 0; i < Math.min(runsNewestFirst.length - 1, 8); i++) {
      const g = (new Date(runsNewestFirst[i]).getTime() - new Date(runsNewestFirst[i + 1]).getTime()) / 3_600_000;
      if (g > 1) gaps.push(g); // corridas repetidas el mismo día no cuentan
    }
    if (gaps.length >= 2) {
      gaps.sort((a, b) => a - b);
      const median = gaps[Math.floor(gaps.length / 2)];
      // Solo si el job corre claramente menos seguido que el servicio (un diario sigue en 26 h)
      if (median > max) max = Math.round(median * 1.2);
    }
  }
  return max;
}

/**
 * Un job que no corre hace más de 30 días mientras el servicio tiene otros jobs más nuevos
 * es un job viejo (renombrado o dado de baja): no se muestra como vencido.
 */
export function isRetiredJob(lastRunIso: string, newestRunOfServiceIso: string): boolean {
  const last = new Date(lastRunIso).getTime();
  const newest = new Date(newestRunOfServiceIso).getTime();
  return Date.now() - last > 30 * 86_400_000 && newest - last > 7 * 86_400_000;
}
