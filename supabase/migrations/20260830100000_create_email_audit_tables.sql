-- Email audit tokens (one per company/client, admin creates)
CREATE TABLE IF NOT EXISTS email_audit_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  client_id   uuid        REFERENCES clients(id) ON DELETE CASCADE,
  client_name text        NOT NULL,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '30 days',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_audit_tokens_token ON email_audit_tokens (token);
ALTER TABLE email_audit_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON email_audit_tokens FOR ALL USING (auth.uid() = user_id);

-- Email audit submissions (one row per person who submits the form)
CREATE TABLE IF NOT EXISTS email_audit_submissions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_id     uuid        NOT NULL REFERENCES email_audit_tokens(id) ON DELETE CASCADE,
  contact_name text        NOT NULL,
  accounts     jsonb       NOT NULL DEFAULT '[]',
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_audit_submissions_token ON email_audit_submissions (token_id);
ALTER TABLE email_audit_submissions ENABLE ROW LEVEL SECURITY;
-- Admin can see their own token's submissions
CREATE POLICY "owner_select" ON email_audit_submissions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM email_audit_tokens t
      WHERE t.id = token_id AND t.user_id = auth.uid()
    )
  );
-- Anon inserts are handled via security-definer function below

-- Anon-callable: validate token and return client info
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

  RETURN jsonb_build_object(
    'valid',       true,
    'token_id',    rec.id,
    'client_name', rec.client_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION validate_email_audit_token(text) TO anon, authenticated;

-- Anon-callable: submit the form
CREATE OR REPLACE FUNCTION submit_email_audit(
  p_token       text,
  p_contact     text,
  p_accounts    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token_id uuid;
BEGIN
  SELECT id INTO v_token_id
  FROM email_audit_tokens
  WHERE token = p_token AND expires_at > now();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalid');
  END IF;

  INSERT INTO email_audit_submissions (token_id, contact_name, accounts)
  VALUES (v_token_id, p_contact, p_accounts);

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION submit_email_audit(text, text, jsonb) TO anon, authenticated;
