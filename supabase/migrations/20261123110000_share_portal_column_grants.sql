-- Portal del cliente (/share/<token>): anon solo puede leer las columnas que el portal usa.
--
-- Las políticas RLS anon (20261123100000_share_token_header_rls.sql) limitan las
-- FILAS al cliente/servicios del token del link, pero no las columnas: con
-- select('*') cualquier cliente con su link podía leer columnas internas de sus
-- propias filas, p.ej. services.ingest_secret (permite mandar heartbeats/backups
-- falsos a las funciones de ingest), services.payment_card_last4 / paid_by /
-- provider_email / notification_email / server_ip, client_licenses.license_key /
-- cost / payment_card_last4, clients.notes, user_settings.weekly_digest_email,
-- uptime_events.monitor_url.
--
-- Acá anon pierde SELECT sobre la tabla entera y recibe SELECT solo sobre las
-- columnas que lista SHARE_COLUMNS en src/lib/shareColumns.ts (incluidas las que
-- se usan en filtros, orden y en las políticas RLS). Las dos listas tienen que
-- coincidir: una columna nueva en el portal va en los dos lados, si no la
-- consulta falla con "permission denied".
--
-- Notas:
--  - authenticated y service_role no cambian.
--  - Las funciones SECURITY DEFINER (resolve_share_token, has_valid_share_token,
--    share_token_service_ids...) corren como owner y no se ven afectadas.
--  - Una columna que se agregue después a estas tablas NO queda visible para anon
--    hasta que se la conceda explícitamente.
--  - Solo SELECT: los demás privilegios de anon quedan como estaban (RLS sin
--    políticas de escritura para anon).

-- clients
REVOKE SELECT ON public.clients FROM anon;
GRANT SELECT (
  id, company_name, risk_flags, spof_free, uptime_status_url
) ON public.clients TO anon;

-- services
REVOKE SELECT ON public.services FROM anon;
GRANT SELECT (
  id, client_id, project_id, service_type_id, created_at, name, description,
  business_name, business_description, status, operational_status, price, currency,
  billing_cycle, next_renewal_date, confirmed_hours_monthly, allocated_hours,
  extra_hour_rate, infrastructure_cost, infrastructure_type, provider, location,
  specifications, managed_roles, sla_level, includes, excludes, client_responsibilities,
  rto, rpo, maintenance_window, uptime_badge_url, uptime_status_url, last_backup_at,
  last_backup_size_bytes, last_restore_test_at, last_restore_test_result,
  cloud_backup_enabled, cloud_backup_retention_days, storage_used_pct, ram_used_pct,
  backup_max_age_hours, spof, recovery_steps
) ON public.services TO anon;

-- projects
REVOKE SELECT ON public.projects FROM anon;
GRANT SELECT (
  id, client_id, name, created_at
) ON public.projects TO anon;

-- service_types
REVOKE SELECT ON public.service_types FROM anon;
GRANT SELECT (
  id, name
) ON public.service_types TO anon;

-- roadmap_items
REVOKE SELECT ON public.roadmap_items FROM anon;
GRANT SELECT (
  id, user_id, client_id, service_id, is_public, sort_order, created_at, title,
  description, status, category, eta, scheduled_date, amount, amount_type
) ON public.roadmap_items TO anon;

-- roadmap_item_updates
REVOKE SELECT ON public.roadmap_item_updates FROM anon;
GRANT SELECT (
  id, roadmap_item_id, note, status, created_at
) ON public.roadmap_item_updates TO anon;

-- service_changes
REVOKE SELECT ON public.service_changes FROM anon;
GRANT SELECT (
  id, service_id, change_date, summary, details
) ON public.service_changes TO anon;

-- client_licenses
REVOKE SELECT ON public.client_licenses FROM anon;
GRANT SELECT (
  id, client_id, service_id, software_name, quantity, quantity_label, expiration_date
) ON public.client_licenses TO anon;

-- support_hours
REVOKE SELECT ON public.support_hours FROM anon;
GRANT SELECT (
  id, client_id, service_id, work_date, hours, type, title, description, source,
  project_name
) ON public.support_hours TO anon;

-- service_heartbeats
REVOKE SELECT ON public.service_heartbeats FROM anon;
GRANT SELECT (
  id, service_id, source, status, message, payload, received_at
) ON public.service_heartbeats TO anon;

-- client_apps
REVOKE SELECT ON public.client_apps FROM anon;
GRANT SELECT (
  id, client_id, service_id, name, vendor, kind, support_phone, whatsapp_url, notes,
  sort_order
) ON public.client_apps TO anon;

-- service_incidents
REVOKE SELECT ON public.service_incidents FROM anon;
GRANT SELECT (
  id, client_id, service_id, title, description, status, notes, started_at, resolved_at
) ON public.service_incidents TO anon;

-- service_backups
REVOKE SELECT ON public.service_backups FROM anon;
GRANT SELECT (
  id, service_id, job_name, status, size_bytes, duration_seconds, details, backed_up_at
) ON public.service_backups TO anon;

-- uptime_events
REVOKE SELECT ON public.uptime_events FROM anon;
GRANT SELECT (
  id, service_id, monitor_name, event_type, message, duration_seconds, occurred_at
) ON public.uptime_events TO anon;

-- user_settings
REVOKE SELECT ON public.user_settings FROM anon;
GRANT SELECT (
  user_id, company_name, logo_url
) ON public.user_settings TO anon;

