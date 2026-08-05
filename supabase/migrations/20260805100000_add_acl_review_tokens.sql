-- Add audit category to roadmap_items
ALTER TABLE roadmap_items DROP CONSTRAINT IF EXISTS roadmap_items_category_check;
ALTER TABLE roadmap_items ADD CONSTRAINT roadmap_items_category_check
  CHECK (category IN ('idea', 'payment', 'backup', 'visit', 'problem', 'change_request', 'audit'));

-- ACL review tokens table
CREATE TABLE IF NOT EXISTS acl_review_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  snapshot_id uuid        NOT NULL REFERENCES service_acl_snapshots(id) ON DELETE CASCADE,
  service_id  uuid        NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  client_id   uuid        REFERENCES clients(id) ON DELETE SET NULL,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 days',
  submitted_at timestamptz,
  responses   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acl_review_tokens_token ON acl_review_tokens (token);
CREATE INDEX IF NOT EXISTS idx_acl_review_tokens_snapshot ON acl_review_tokens (snapshot_id);

ALTER TABLE acl_review_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_all" ON acl_review_tokens FOR ALL USING (auth.uid() = user_id);
