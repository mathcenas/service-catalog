-- Horas trabajadas que vienen del Task Tracker (función sync-support-hours, cada hora).
-- tt_task_id identifica la tarea para actualizarla o borrarla sin duplicar; las cargadas
-- a mano quedan con source = 'manual' y tt_task_id null.
ALTER TABLE support_hours ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE support_hours ADD COLUMN IF NOT EXISTS tt_task_id text;
ALTER TABLE support_hours ADD COLUMN IF NOT EXISTS project_name text;
CREATE UNIQUE INDEX IF NOT EXISTS support_hours_tt_task_id_key ON support_hours (tt_task_id);
CREATE INDEX IF NOT EXISTS support_hours_client_date_idx ON support_hours (client_id, work_date);

-- Sincronización con el Task Tracker cada hora
select cron.unschedule('sync-support-hours-hourly') where exists (select 1 from cron.job where jobname = 'sync-support-hours-hourly');
select cron.schedule('sync-support-hours-hourly', '41 * * * *', $$select public.cron_call_function('sync-support-hours')$$);
