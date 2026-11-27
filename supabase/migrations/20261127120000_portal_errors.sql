-- Errores del portal del cliente (/share/<token>): los que ve un cliente al abrir su link
-- (source 'portal', los manda el navegador vía portal-error) y los de la prueba diaria
-- (source 'selftest', portal-selftest). Uno por cliente/origen/consulta/mensaje/día, con contador.
CREATE TABLE IF NOT EXISTS public.portal_errors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  source      text NOT NULL CHECK (source IN ('portal', 'selftest')),
  path        text NOT NULL,
  status      int,
  message     text NOT NULL DEFAULT '',
  day         date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Montevideo')::date,
  count       int NOT NULL DEFAULT 1,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, source, path, message, day)
);
CREATE INDEX IF NOT EXISTS portal_errors_last_seen_idx ON public.portal_errors (last_seen DESC);
ALTER TABLE public.portal_errors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner reads portal errors" ON public.portal_errors;
CREATE POLICY "Owner reads portal errors" ON public.portal_errors FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = portal_errors.client_id AND c.user_id = auth.uid()));
DROP POLICY IF EXISTS "Owner deletes portal errors" ON public.portal_errors;
CREATE POLICY "Owner deletes portal errors" ON public.portal_errors FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = portal_errors.client_id AND c.user_id = auth.uid()));
REVOKE ALL ON public.portal_errors FROM anon;

-- Corridas de la prueba diaria: cuándo corrió y cuántas consultas fallaron
CREATE TABLE IF NOT EXISTS public.portal_checks (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at    timestamptz NOT NULL DEFAULT now(),
  clients   int NOT NULL DEFAULT 0,
  checks    int NOT NULL DEFAULT 0,
  failures  int NOT NULL DEFAULT 0
);
ALTER TABLE public.portal_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated reads portal checks" ON public.portal_checks;
CREATE POLICY "Authenticated reads portal checks" ON public.portal_checks FOR SELECT TO authenticated USING (true);
REVOKE ALL ON public.portal_checks FROM anon;

-- Suma uno al error del día (o lo crea). Solo service_role (las funciones).
CREATE OR REPLACE FUNCTION public.log_portal_error(p_client uuid, p_source text, p_path text, p_status int, p_message text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO portal_errors (client_id, source, path, status, message)
  VALUES (p_client, p_source, left(p_path, 300), p_status, left(coalesce(p_message, ''), 500))
  ON CONFLICT (client_id, source, path, message, day)
  DO UPDATE SET count = portal_errors.count + 1, last_seen = now(), status = EXCLUDED.status;
$$;
REVOKE ALL ON FUNCTION public.log_portal_error(uuid, text, text, int, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_portal_error(uuid, text, text, int, text) TO service_role;
GRANT ALL ON public.portal_errors, public.portal_checks TO service_role;

-- Prueba diaria del portal: 07:23 hora de Uruguay
SELECT cron.schedule('portal-selftest-daily', '23 10 * * *', $$select public.cron_call_function('portal-selftest')$$);
