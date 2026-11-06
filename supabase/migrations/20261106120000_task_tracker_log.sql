-- Log de cada push a TaskTracker. Se usa para validar facturación de horas.
CREATE TABLE IF NOT EXISTS task_tracker_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  source         text        NOT NULL,   -- 'ingest-incident' | 'alert-backup-stale' | 'manual'
  client_id      uuid        REFERENCES clients(id) ON DELETE SET NULL,
  tt_project_id  text,                   -- UUID del proyecto en TaskTracker
  tt_task_id     text,                   -- id retornado por TaskTracker (null si falló)
  title          text        NOT NULL,
  hours          real,                   -- horas enviadas (nullable si no aplica)
  status         text        NOT NULL CHECK (status IN ('ok', 'error', 'skipped')),
  error_message  text,
  http_status    int
);

ALTER TABLE task_tracker_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read task tracker log"
  ON task_tracker_log FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Service role insert task tracker log"
  ON task_tracker_log FOR INSERT
  TO service_role WITH CHECK (true);

CREATE INDEX task_tracker_log_created_at_idx ON task_tracker_log(created_at DESC);
CREATE INDEX task_tracker_log_client_id_idx  ON task_tracker_log(client_id);
CREATE INDEX task_tracker_log_status_idx     ON task_tracker_log(status);
