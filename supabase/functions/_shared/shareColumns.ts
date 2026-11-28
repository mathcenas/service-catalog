// Columnas que el portal del cliente (/share/<token>) lee con la clave anon.
// Fuente única: la usan el portal (src/lib/shareColumns.ts) y la prueba diaria del portal
// (portal-selftest), que verifica que anon pueda leer cada una. Tienen que coincidir con los
// GRANT SELECT (<columnas>) ... TO anon de las migraciones: si el portal necesita una columna
// nueva, agregarla acá y en un GRANT.
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
  client_licenses: ['id', 'client_id', 'service_id', 'software_name', 'quantity', 'quantity_label', 'expiration_date', 'last_renewed_at'],
  support_hours: ['id', 'client_id', 'service_id', 'work_date', 'hours', 'type', 'title', 'description', 'source', 'project_name'],
  service_heartbeats: ['id', 'service_id', 'source', 'status', 'message', 'payload', 'received_at'],
  client_apps: ['id', 'client_id', 'service_id', 'name', 'vendor', 'kind', 'support_phone', 'whatsapp_url', 'notes', 'sort_order'],
  service_incidents: ['id', 'client_id', 'service_id', 'title', 'description', 'status', 'notes', 'started_at', 'resolved_at'],
  // details: lo muestra BackupMetricsModal (historial de backups)
  service_backups: ['id', 'service_id', 'job_name', 'status', 'size_bytes', 'duration_seconds', 'details', 'backed_up_at', 'expected_interval_hours'],
  uptime_events: ['id', 'service_id', 'monitor_name', 'event_type', 'message', 'duration_seconds', 'occurred_at'],
  user_settings: ['user_id', 'company_name', 'logo_url'],
} as const;
