-- Portal del cliente (/share/<token>): las políticas anon ahora exigen el token del link.
--
-- Antes, has_valid_share_token(client_id) solo comprobaba que el cliente tuviera
-- ALGÚN token vigente, así que cualquiera con la clave anon (pública, va en el
-- bundle) podía leer services, service_backups, clients, etc. de todos los
-- clientes con un link compartido, sin conocer ningún token.
--
-- Ahora el portal manda el token en el header `x-share-token` (cliente
-- supabase-js aparte, ver createShareClient en src/lib/supabase.ts) y las
-- políticas lo validan contra client_share_tokens: tiene que existir, no estar
-- vencido y ser del cliente/servicio de la fila. Si el token restringe
-- servicios (service_ids no vacío), las filas por servicio también lo respetan.

-- ── Helpers ─────────────────────────────────────────────────────────────────

-- Token del header de la request actual (PostgREST expone los headers en
-- request.headers). NULL si no vino o fuera de PostgREST.
CREATE OR REPLACE FUNCTION public.request_share_token()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT nullif(
    (nullif(current_setting('request.headers', true), '')::json) ->> 'x-share-token',
    ''
  );
$$;

-- Fila vigente de client_share_tokens que corresponde al token del header.
-- SECURITY DEFINER: anon no ve client_share_tokens (RLS sin política anon).
CREATE OR REPLACE FUNCTION public.current_share_token_scope()
RETURNS TABLE (client_id uuid, user_id uuid, service_ids uuid[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.client_id, t.user_id, t.service_ids
  FROM client_share_tokens t
  WHERE t.token = public.request_share_token()
    AND (t.expires_at IS NULL OR t.expires_at > now())
  LIMIT 1;
$$;

-- El token del header es de este cliente y está vigente.
CREATE OR REPLACE FUNCTION public.has_valid_share_token(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.current_share_token_scope() s
    WHERE s.client_id = p_client_id
  );
$$;

-- El token del header es de un cliente de este usuario (para user_settings:
-- nombre y logo del proveedor en el portal).
CREATE OR REPLACE FUNCTION public.has_valid_share_token_for_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.current_share_token_scope() s
    WHERE s.user_id = p_user_id
  );
$$;

-- Servicios visibles con el token del header: los del cliente del token,
-- limitados a service_ids si el token restringe servicios (NULL o vacío = todos,
-- igual que SharePage).
CREATE OR REPLACE FUNCTION public.share_token_service_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sv.id
  FROM public.current_share_token_scope() s
  JOIN services sv ON sv.client_id = s.client_id
  WHERE s.service_ids IS NULL
     OR cardinality(s.service_ids) = 0
     OR sv.id = ANY (s.service_ids);
$$;

CREATE OR REPLACE FUNCTION public.has_valid_share_token_for_service(p_service_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_service_id IN (SELECT public.share_token_service_ids());
$$;

REVOKE ALL ON FUNCTION public.request_share_token()                     FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_share_token_scope()               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_valid_share_token(uuid)               FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_valid_share_token_for_user(uuid)      FROM PUBLIC;
REVOKE ALL ON FUNCTION public.share_token_service_ids()                 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_valid_share_token_for_service(uuid)   FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_share_token()                   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.current_share_token_scope()             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_valid_share_token(uuid)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_valid_share_token_for_user(uuid)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.share_token_service_ids()               TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_valid_share_token_for_service(uuid) TO anon, authenticated;

-- ── Políticas anon ──────────────────────────────────────────────────────────
-- Las tablas grandes por servicio (heartbeats, backups, uptime) usan
-- `service_id IN (SELECT share_token_service_ids())`: el subselect no depende
-- de la fila, así que se evalúa una sola vez por consulta.

-- clients
DROP POLICY IF EXISTS "Anon can read clients via share token" ON public.clients;
CREATE POLICY "Anon can read clients via share token" ON public.clients
  FOR SELECT TO anon
  USING (public.has_valid_share_token(id));

-- services (respeta service_ids)
DROP POLICY IF EXISTS "Anon can read services via share token" ON public.services;
CREATE POLICY "Anon can read services via share token" ON public.services
  FOR SELECT TO anon
  USING (id IN (SELECT public.share_token_service_ids()));

-- projects
DROP POLICY IF EXISTS "Anon can read projects via share token" ON public.projects;
CREATE POLICY "Anon can read projects via share token" ON public.projects
  FOR SELECT TO anon
  USING (public.has_valid_share_token(client_id));

-- client_licenses (las atadas a un servicio, solo si el token lo incluye)
DROP POLICY IF EXISTS "Anon can read licenses via share token" ON public.client_licenses;
CREATE POLICY "Anon can read licenses via share token" ON public.client_licenses
  FOR SELECT TO anon
  USING (
    public.has_valid_share_token(client_id)
    AND (service_id IS NULL OR public.has_valid_share_token_for_service(service_id))
  );

-- support_hours (antes: EXISTS directo, sin vencimiento)
DROP POLICY IF EXISTS "Anon can read support hours for shared clients" ON public.support_hours;
CREATE POLICY "Anon can read support hours via share token" ON public.support_hours
  FOR SELECT TO anon
  USING (
    public.has_valid_share_token(client_id)
    AND (service_id IS NULL OR public.has_valid_share_token_for_service(service_id))
  );

-- client_apps (antes: TO public + EXISTS redundante)
DROP POLICY IF EXISTS "anon_read_via_token" ON public.client_apps;
CREATE POLICY "anon_read_via_token" ON public.client_apps
  FOR SELECT TO anon
  USING (
    public.has_valid_share_token(client_id)
    AND (service_id IS NULL OR public.has_valid_share_token_for_service(service_id))
  );

-- service_incidents (antes: TO public + EXISTS redundante)
DROP POLICY IF EXISTS "anon_read_via_token" ON public.service_incidents;
CREATE POLICY "anon_read_via_token" ON public.service_incidents
  FOR SELECT TO anon
  USING (
    client_id IS NOT NULL
    AND public.has_valid_share_token(client_id)
    AND (service_id IS NULL OR public.has_valid_share_token_for_service(service_id))
  );

-- service_backups (había dos políticas equivalentes)
DROP POLICY IF EXISTS "Anon sees backups via share token" ON public.service_backups;
DROP POLICY IF EXISTS "anon_read_backups_shared" ON public.service_backups;
CREATE POLICY "Anon sees backups via share token" ON public.service_backups
  FOR SELECT TO anon
  USING (service_id IN (SELECT public.share_token_service_ids()));

-- uptime_events
DROP POLICY IF EXISTS "anon_read_uptime_events_shared" ON public.uptime_events;
CREATE POLICY "anon_read_uptime_events_shared" ON public.uptime_events
  FOR SELECT TO anon
  USING (service_id IN (SELECT public.share_token_service_ids()));

-- service_heartbeats (antes: EXISTS directo, sin vencimiento)
DROP POLICY IF EXISTS "Anon can read heartbeats for shared clients" ON public.service_heartbeats;
CREATE POLICY "Anon can read heartbeats via share token" ON public.service_heartbeats
  FOR SELECT TO anon
  USING (service_id IN (SELECT public.share_token_service_ids()));

-- service_changes (antes: EXISTS directo, sin vencimiento)
DROP POLICY IF EXISTS "Anon can read service_changes via share token" ON public.service_changes;
CREATE POLICY "Anon can read service_changes via share token" ON public.service_changes
  FOR SELECT TO anon
  USING (service_id IN (SELECT public.share_token_service_ids()));

-- user_settings (nombre y logo del proveedor)
DROP POLICY IF EXISTS "Anon can read user_settings via share token" ON public.user_settings;
CREATE POLICY "Anon can read user_settings via share token" ON public.user_settings
  FOR SELECT TO anon
  USING (public.has_valid_share_token_for_user(user_id));

-- roadmap_items: antes cualquier ítem is_public de cualquier cliente era legible
-- sin token. Ahora: los del cliente del token, o los generales (client_id NULL)
-- del proveedor del token. Es el único consumidor anon (SharePage).
DROP POLICY IF EXISTS "Public can read public roadmap items" ON public.roadmap_items;
CREATE POLICY "Public can read public roadmap items" ON public.roadmap_items
  FOR SELECT TO anon
  USING (
    is_public = true
    AND (
      (client_id IS NOT NULL AND public.has_valid_share_token(client_id))
      OR (client_id IS NULL AND public.has_valid_share_token_for_user(user_id))
    )
  );

DROP POLICY IF EXISTS "anon_read_public" ON public.roadmap_item_updates;
CREATE POLICY "anon_read_public" ON public.roadmap_item_updates
  FOR SELECT TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.roadmap_items ri
      WHERE ri.id = roadmap_item_updates.roadmap_item_id
        AND ri.is_public = true
        AND (
          (ri.client_id IS NOT NULL AND public.has_valid_share_token(ri.client_id))
          OR (ri.client_id IS NULL AND public.has_valid_share_token_for_user(ri.user_id))
        )
    )
  );
