-- Add open tracking to client_share_tokens and acl_review_tokens
-- Also extend email_opens to support digest emails

-- 1. client_share_tokens: add open tracking columns
ALTER TABLE client_share_tokens
  ADD COLUMN IF NOT EXISTS open_count      integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_opened_at timestamptz;

-- 2. acl_review_tokens: add open tracking columns
ALTER TABLE acl_review_tokens
  ADD COLUMN IF NOT EXISTS open_count      integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_opened_at timestamptz;

-- 3. email_opens: add email_type and subject columns for digest/audit tracking
ALTER TABLE email_opens
  ADD COLUMN IF NOT EXISTS email_type text,      -- 'digest', 'audit_notification', 'roadmap', etc.
  ADD COLUMN IF NOT EXISTS subject    text,
  ADD COLUMN IF NOT EXISTS client_id  uuid REFERENCES clients(id) ON DELETE SET NULL;

-- 4. resolve_share_token: update to increment open_count on each valid resolution
CREATE OR REPLACE FUNCTION public.resolve_share_token(p_token text)
RETURNS TABLE(client_id uuid, user_id uuid, label text, open_count integer, first_opened_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec client_share_tokens;
BEGIN
  SELECT * INTO rec
  FROM client_share_tokens t
  WHERE t.token = p_token
    AND (t.expires_at IS NULL OR t.expires_at > now())
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE client_share_tokens
  SET
    open_count      = open_count + 1,
    first_opened_at = COALESCE(first_opened_at, now())
  WHERE id = rec.id;

  RETURN QUERY
  SELECT rec.client_id, rec.user_id, rec.label,
         rec.open_count + 1,
         COALESCE(rec.first_opened_at, now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_share_token(text) TO anon, authenticated;
