-- Recordatorio sugerido (segundo aviso) de un incidente: cuándo se mandó, para no sugerir un tercero
ALTER TABLE public.roadmap_items ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
