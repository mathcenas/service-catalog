import type {
  Client, Service, UserSettings, ServiceType, Project, ServiceChange, RoadmapItem, RoadmapItemUpdate,
  ClientLicense, SupportHour, ServiceHeartbeat, ClientApp, ServiceIncident,
} from './supabase';
import { SHARE_COLUMNS } from '../../supabase/functions/_shared/shareColumns.ts';

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
// user_settings.weekly_digest_email; service_incidents.external_id, reported_by;
// support_hours.tt_task_id.
export { SHARE_COLUMNS };

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
