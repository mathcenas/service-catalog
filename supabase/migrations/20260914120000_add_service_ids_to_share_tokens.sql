-- Add service_ids filter to client_share_tokens
-- Allows a share token to expose only a subset of the client's services
-- NULL = show all services (existing behavior)

ALTER TABLE client_share_tokens ADD COLUMN IF NOT EXISTS service_ids uuid[] DEFAULT NULL;

-- Update resolve_share_token to return service_ids
-- DROP required because the return type (OUT columns) changed
DROP FUNCTION IF EXISTS public.resolve_share_token(text);
CREATE OR REPLACE FUNCTION public.resolve_share_token(p_token text)
RETURNS TABLE(client_id uuid, user_id uuid, label text, open_count integer, first_opened_at timestamptz, service_ids uuid[])
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
         COALESCE(rec.first_opened_at, now()),
         rec.service_ids;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_share_token(text) TO anon, authenticated;

-- Allow authenticated users to update their own tokens (for editing service_ids / label)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'client_share_tokens'
      AND policyname = 'Users can update own share tokens'
  ) THEN
    CREATE POLICY "Users can update own share tokens"
      ON client_share_tokens FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
