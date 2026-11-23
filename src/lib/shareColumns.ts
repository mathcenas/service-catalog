import type {
  Client, Service, UserSettings, ServiceType, Project, ServiceChange, RoadmapItem, RoadmapItemUpdate,
  ClientLicense, SupportHour, ServiceHeartbeat, ClientApp, ServiceIncident,
} from './supabase';

// Columnas que el portal del cliente (/share/<token>, SharePage) lee con la clave anon.
//
// Tienen que coincidir con los GRANT SELECT (<columnas>) ... TO anon de
// supabase/migrations/20261123110000_share_portal_column_grants.sql: anon no tiene
// SELECT sobre la tabla entera, así que pedir una columna que no esté acá (o un
// select('*')) falla con "permission denied". Si el portal necesita una columna
// nueva, agregarla en los dos lados. Incluye las columnas que se usan en filtros
// y orden (client_id, created_at...) y en las políticas RLS.
//
// Fuera a propósito (internas): services.ingest_secret, paid_by,
// payment_card_last4, provider_email, notification_email, server_ip, ip_*,
// login_url...; client_licenses.license_key, cost, paid_by, payment_card_last4,
// notes; clients.notes, email, phone, contact_name...; uptime_events.monitor_url;
// user_settings.weekly_digest_email; service_incidents.external_id, reported_by.
export const SHARE_COLUMNS = {
  clients: ['id', 'company_name', 'risk_flags', 'spof_free', 'uptime_status_url'],
  services: [
    'id', 'client_id', 'project_id', 'service_type_id', 'created_at',
    'name', 'description', 'business_name', 'business_description', 'status', 'operational_status',
    'price', 'currency', 'billing_cycle', 'next_renewal_date', 'confirmed_hours_monthly',
    'allocated_hours', 'extra_hour_rate', 'infrastructure_cost',
    'infrastructure_type', 'provider', 'location', 'specifications', 'managed_roles',
    'sla_level', 'includes', 'excludes', 'client_responsibilities', 'rto', 'rpo', 'maintenance_window',
    'uptime_badge_url', 'uptime_status_url',
    'last_backup_at', 'last_backup_size_bytes', 'last_restore_test_at', 'last_restore_test_result',
    'cloud_backup_enabled', 'cloud_backup_retention_days', 'storage_used_pct', 'ram_used_pct',
    'backup_max_age_hours', 'spof', 'recovery_steps',
  ],
  projects: ['id', 'client_id', 'name', 'created_at'],
  service_types: ['id', 'name'],
  roadmap_items: [
    'id', 'user_id', 'client_id', 'service_id', 'is_public', 'sort_order', 'created_at',
    'title', 'description', 'status', 'category', 'eta', 'scheduled_date', 'amount', 'amount_type',
  ],
  roadmap_item_updates: ['id', 'roadmap_item_id', 'note', 'status', 'created_at'],
  service_changes: ['id', 'service_id', 'change_date', 'summary', 'details'],
  client_licenses: ['id', 'client_id', 'service_id', 'software_name', 'quantity', 'quantity_label', 'expiration_date'],
  support_hours: ['id', 'client_id', 'service_id', 'work_date', 'hours', 'type', 'title', 'description'],
  service_heartbeats: ['id', 'service_id', 'source', 'status', 'message', 'payload', 'received_at'],
  client_apps: ['id', 'client_id', 'service_id', 'name', 'vendor', 'kind', 'support_phone', 'whatsapp_url', 'notes', 'sort_order'],
  service_incidents: ['id', 'client_id', 'service_id', 'title', 'description', 'status', 'notes', 'started_at', 'resolved_at'],
  // details: lo muestra BackupMetricsModal (historial de backups)
  service_backups: ['id', 'service_id', 'job_name', 'status', 'size_bytes', 'duration_seconds', 'details', 'backed_up_at'],
  uptime_events: ['id', 'service_id', 'monitor_name', 'event_type', 'message', 'duration_seconds', 'occurred_at'],
  user_settings: ['user_id', 'company_name', 'logo_url'],
} as const;

type Cols<T extends keyof typeof SHARE_COLUMNS> = (typeof SHARE_COLUMNS)[T][number];

type Join<T extends readonly string[]> =
  T extends readonly [infer H extends string] ? H
  : T extends readonly [infer H extends string, ...infer R extends readonly string[]] ? `${H},${Join<R>}`
  : string;

/** Lista de columnas para .select(); el tipo literal deja que supabase-js infiera las filas. */
export const shareSelect = <T extends keyof typeof SHARE_COLUMNS>(table: T) =>
  SHARE_COLUMNS[table].join(',') as Join<(typeof SHARE_COLUMNS)[T]>;

export type ShareClient = Pick<Client, Cols<'clients'>>;
export type ShareService = Pick<Service, Cols<'services'>>;
export type ShareProject = Pick<Project, Cols<'projects'>>;
export type ShareServiceType = Pick<ServiceType, Cols<'service_types'>>;
export type ShareRoadmapItem = Pick<RoadmapItem, Cols<'roadmap_items'>>;
export type ShareRoadmapItemUpdate = Pick<RoadmapItemUpdate, Cols<'roadmap_item_updates'>>;
export type ShareServiceChange = Pick<ServiceChange, Cols<'service_changes'>>;
export type ShareClientLicense = Pick<ClientLicense, Cols<'client_licenses'>>;
export type ShareSupportHour = Pick<SupportHour, Cols<'support_hours'>>;
export type ShareServiceHeartbeat = Pick<ServiceHeartbeat, Cols<'service_heartbeats'>>;
export type ShareClientApp = Pick<ClientApp, Cols<'client_apps'>>;
export type ShareServiceIncident = Pick<ServiceIncident, Cols<'service_incidents'>>;
export type ShareUserSettings = Pick<UserSettings, 'company_name' | 'logo_url'>;
