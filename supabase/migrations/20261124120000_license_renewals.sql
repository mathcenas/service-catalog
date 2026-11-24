-- Renovaciones de licencias: historial y aviso "Licencia renovada" al cliente (notify-license-renewed).
ALTER TABLE public.client_licenses ADD COLUMN IF NOT EXISTS last_renewed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.license_renewals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  license_id          uuid NOT NULL REFERENCES public.client_licenses(id) ON DELETE CASCADE,
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  previous_expiration date,
  new_expiration      date,
  cost                numeric,
  currency            text,
  notes               text,
  renewed_at          timestamptz NOT NULL DEFAULT now(),
  notified_at         timestamptz,
  notified_to         text[]
);
CREATE INDEX IF NOT EXISTS license_renewals_client_idx ON public.license_renewals (client_id, renewed_at DESC);
CREATE INDEX IF NOT EXISTS license_renewals_license_idx ON public.license_renewals (license_id, renewed_at DESC);

ALTER TABLE public.license_renewals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "license_renewals owner" ON public.license_renewals;
CREATE POLICY "license_renewals owner" ON public.license_renewals
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- El portal muestra "Renovada el …" (permisos por columna de 20261123110000)
GRANT SELECT (last_renewed_at) ON public.client_licenses TO anon;
