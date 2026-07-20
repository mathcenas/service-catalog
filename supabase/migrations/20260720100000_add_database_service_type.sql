-- Add "Database" service type if it doesn't exist yet
-- Fields like db_engine, db_port, db_name are stored in specifications (jsonb)
-- ip_internal column already exists from ipam migration

INSERT INTO service_types (name, description, icon, is_revenue)
SELECT 'Database', 'Database as a Service — managed DB instances (AWS RDS, UpCloud, Supabase, etc.)', '🗄️', true
WHERE NOT EXISTS (
  SELECT 1 FROM service_types WHERE name = 'Database'
);
