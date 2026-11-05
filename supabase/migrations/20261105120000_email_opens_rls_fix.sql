-- Fix email_opens RLS:
-- 1. Allow service_role to insert (backup alerts, digest sends)
-- 2. Allow authenticated users to read ALL their own records,
--    including those inserted by service_role with their user_id
--    OR linked via client_id (backups don't always carry user_id)

-- Drop existing policies
DROP POLICY IF EXISTS "Users can read own email tracking data"  ON email_opens;
DROP POLICY IF EXISTS "Users can insert own email tracking data" ON email_opens;

-- SELECT: own rows by user_id OR rows linked to their clients
CREATE POLICY "Users read own email tracking"
  ON email_opens FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR client_id IN (
      SELECT id FROM clients WHERE user_id = auth.uid()
    )
  );

-- INSERT: authenticated users can insert their own rows
CREATE POLICY "Users insert own email tracking"
  ON email_opens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- INSERT: service_role bypass (edge functions using service key)
CREATE POLICY "Service role insert email tracking"
  ON email_opens FOR INSERT
  TO service_role
  WITH CHECK (true);

-- UPDATE: service_role only (track-open webhook updates opened_at)
CREATE POLICY "Service role update email tracking"
  ON email_opens FOR UPDATE
  TO service_role
  USING (true);
