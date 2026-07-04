/*
  # Fix anon RLS policies — security hardening

  ## Problem
  Several tables had `USING (true)` for the anon role, meaning any unauthenticated
  request with the public anon key could read all rows across all clients:
    - client_share_tokens — exposed ALL tokens (effectively nullifying every other policy)
    - client_licenses     — exposed all license keys, costs, and expiry dates
    - user_settings       — exposed admin branding (low severity but still unnecessary)
    - clients/services/projects — were correctly scoped via EXISTS, but missing
      expires_at check on the token

  ## Solution
  Introduce two SECURITY DEFINER functions that can read client_share_tokens
  internally (bypassing RLS in a controlled way) without exposing the table
  directly to anon. All anon policies now delegate to these functions.

  A third function (resolve_share_token) replaces the direct table query in
  SharePage.tsx, returning only client_id + user_id + label for a valid token.

  ## Required code change (SharePage.tsx)
  Replace:
    supabase.from('client_share_tokens').select('*').eq('token', token).maybeSingle()
  With:
    supabase.rpc('resolve_share_token', { p_token: token })
  and use tokenRows?.[0] as the result.

  ## Tables affected
  - client_share_tokens : DROP anon SELECT policy (table now private)
  - clients             : scope now also checks expires_at
  - services            : scope now also checks expires_at
  - projects            : scope now also checks expires_at
  - client_licenses     : was USING(true) → now scoped via has_valid_share_token
  - user_settings       : was USING(true) → now scoped via has_valid_share_token_for_user
*/

-- ============================================================
-- 1. SECURITY DEFINER functions
--    These run as the DB owner so they can read client_share_tokens
--    even after we remove anon access to it.
-- ============================================================

-- Returns true if the given client_id has at least one non-expired share token.
-- Used inside anon SELECT policies on clients, services, projects, client_licenses.
CREATE OR REPLACE FUNCTION public.has_valid_share_token(p_client_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM client_share_tokens t
    WHERE t.client_id = p_client_id
      AND (t.expires_at IS NULL OR t.expires_at > now())
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_valid_share_token(uuid) TO anon;

-- Returns true if the given user_id has at least one non-expired share token.
-- Used inside the anon SELECT policy on user_settings (portal branding).
CREATE OR REPLACE FUNCTION public.has_valid_share_token_for_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM client_share_tokens t
    WHERE t.user_id = p_user_id
      AND (t.expires_at IS NULL OR t.expires_at > now())
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_valid_share_token_for_user(uuid) TO anon;

-- Resolves a raw token string to (client_id, user_id, label).
-- Called from SharePage.tsx via supabase.rpc('resolve_share_token', { p_token }).
-- Returns 0 rows for invalid, unknown, or expired tokens.
CREATE OR REPLACE FUNCTION public.resolve_share_token(p_token text)
RETURNS TABLE(client_id uuid, user_id uuid, label text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.client_id, t.user_id, t.label
  FROM client_share_tokens t
  WHERE t.token = p_token
    AND (t.expires_at IS NULL OR t.expires_at > now())
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_share_token(text) TO anon;

-- ============================================================
-- 2. client_share_tokens — remove anon SELECT entirely
--    anon no longer needs direct table access; resolve_share_token
--    handles the only legitimate anon use case.
-- ============================================================

DROP POLICY IF EXISTS "Anon can read tokens by token"      ON client_share_tokens;
DROP POLICY IF EXISTS "Public can read tokens for share page" ON client_share_tokens;

-- ============================================================
-- 3. clients — replace EXISTS with function (adds expires_at check)
-- ============================================================

DROP POLICY IF EXISTS "Anon can read clients via share token"  ON clients;
DROP POLICY IF EXISTS "Public can read clients for share page" ON clients;

CREATE POLICY "Anon can read clients via share token"
  ON clients FOR SELECT TO anon
  USING (public.has_valid_share_token(clients.id));

-- ============================================================
-- 4. services — replace EXISTS with function (adds expires_at check)
-- ============================================================

DROP POLICY IF EXISTS "Anon can read services via share token"  ON services;
DROP POLICY IF EXISTS "Public can read services for share page" ON services;

CREATE POLICY "Anon can read services via share token"
  ON services FOR SELECT TO anon
  USING (public.has_valid_share_token(services.client_id));

-- ============================================================
-- 5. projects — replace EXISTS with function (adds expires_at check)
-- ============================================================

DROP POLICY IF EXISTS "Anon can read projects via share token" ON projects;

CREATE POLICY "Anon can read projects via share token"
  ON projects FOR SELECT TO anon
  USING (public.has_valid_share_token(projects.client_id));

-- ============================================================
-- 6. client_licenses — was USING(true), now properly scoped
-- ============================================================

DROP POLICY IF EXISTS "Anon can read licenses for share page"  ON client_licenses;
DROP POLICY IF EXISTS "Anon can read licenses via share token" ON client_licenses;

CREATE POLICY "Anon can read licenses via share token"
  ON client_licenses FOR SELECT TO anon
  USING (public.has_valid_share_token(client_licenses.client_id));

-- ============================================================
-- 7. user_settings — was USING(true), now scoped to users who
--    have at least one active share token (i.e. active portals)
-- ============================================================

DROP POLICY IF EXISTS "Anon can read user_settings for portal branding" ON user_settings;
DROP POLICY IF EXISTS "Anon can read user_settings via share token"     ON user_settings;

CREATE POLICY "Anon can read user_settings via share token"
  ON user_settings FOR SELECT TO anon
  USING (public.has_valid_share_token_for_user(user_settings.user_id));
