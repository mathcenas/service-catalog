ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS webhook_url   text,
  ADD COLUMN IF NOT EXISTS webhook_token text;
