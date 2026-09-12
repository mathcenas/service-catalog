-- Return logo_url and company_name from user_settings in validate_email_audit_token
CREATE OR REPLACE FUNCTION validate_email_audit_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec   email_audit_tokens;
  logo  text;
  cname text;
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

  SELECT logo_url, company_name
  INTO logo, cname
  FROM user_settings
  WHERE user_id = rec.user_id;

  RETURN jsonb_build_object(
    'valid',        true,
    'token_id',     rec.id,
    'client_name',  rec.client_name,
    'logo_url',     logo,
    'company_name', cname
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_email_audit_token(text) TO anon, authenticated;
