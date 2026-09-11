-- Shorten token default to 16 hex chars (8 bytes) and add open tracking
ALTER TABLE email_audit_tokens
  ALTER COLUMN token SET DEFAULT encode(gen_random_bytes(8), 'hex');

ALTER TABLE email_audit_tokens
  ADD COLUMN IF NOT EXISTS first_opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS open_count      integer NOT NULL DEFAULT 0;

-- Update validate function to track opens
CREATE OR REPLACE FUNCTION validate_email_audit_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec email_audit_tokens;
BEGIN
  SELECT * INTO rec
  FROM email_audit_tokens
  WHERE token = p_token AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false);
  END IF;

  UPDATE email_audit_tokens
  SET
    open_count      = open_count + 1,
    first_opened_at = COALESCE(first_opened_at, now())
  WHERE id = rec.id;

  RETURN jsonb_build_object(
    'valid',       true,
    'token_id',    rec.id,
    'client_name', rec.client_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_email_audit_token(text) TO anon, authenticated;
