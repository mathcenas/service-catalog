-- Resend webhook tracking: clicks, bounces, complaints

-- 1. email_opens: store Resend email_id for correlation with webhooks
ALTER TABLE email_opens
  ADD COLUMN IF NOT EXISTS resend_email_id text,
  ADD COLUMN IF NOT EXISTS delivered_at    timestamptz;

CREATE INDEX IF NOT EXISTS email_opens_resend_email_id_idx
  ON email_opens(resend_email_id)
  WHERE resend_email_id IS NOT NULL;

-- 2. clients: bounce and complaint flags
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS email_bounced    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_complained boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_status_at  timestamptz;

-- 3. email_clicks: one row per link click event from Resend webhook
CREATE TABLE IF NOT EXISTS email_clicks (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  resend_email_id text       NOT NULL,
  client_email   text,
  client_id      uuid        REFERENCES clients(id) ON DELETE SET NULL,
  roadmap_item_id uuid,
  clicked_url    text,
  clicked_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_clicks_resend_email_id_idx ON email_clicks(resend_email_id);
CREATE INDEX IF NOT EXISTS email_clicks_client_id_idx       ON email_clicks(client_id);
CREATE INDEX IF NOT EXISTS email_clicks_clicked_at_idx      ON email_clicks(clicked_at DESC);

ALTER TABLE email_clicks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own email clicks"
  ON email_clicks FOR SELECT
  USING (auth.uid() = user_id);
