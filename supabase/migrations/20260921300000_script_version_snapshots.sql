-- Daily snapshot of outdated script count for progress tracking
CREATE TABLE IF NOT EXISTS script_version_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  snapshot_date date        NOT NULL,
  outdated_count integer    NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, snapshot_date)
);

ALTER TABLE script_version_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own snapshots"
  ON script_version_snapshots FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
