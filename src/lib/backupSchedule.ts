import type { Service } from './supabase';

export const DEFAULT_BACKUP_MAX_AGE_HOURS = 26;

// Días hábiles: el backup del viernes tiene que aguantar hasta el del lunes (72 h + margen).
export const BACKUP_SCHEDULE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Daily (overdue after 26h)' },
  { value: '74', label: 'Weekdays, Mon–Fri (overdue after 74h)' },
  { value: '194', label: 'Weekly (overdue after 8 days)' },
  { value: '0', label: 'Not monitored' },
];

/** Hours without a backup before the service counts as overdue; null = not monitored. */
export function backupMaxAgeHours(service: Pick<Service, 'backup_max_age_hours'>): number | null {
  const v = service.backup_max_age_hours;
  if (v === 0) return null;
  return v ?? DEFAULT_BACKUP_MAX_AGE_HOURS;
}
