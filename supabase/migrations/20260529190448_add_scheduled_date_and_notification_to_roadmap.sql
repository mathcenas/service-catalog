/*
  # Add scheduling and notification fields to roadmap_items

  1. Modified Tables
    - `roadmap_items`
      - `scheduled_date` (date, nullable) - Concrete date for planned action (upgrade, installation, visit)
      - `client_id` (uuid, nullable, FK to clients) - Which client this action is for
      - `notified_at` (timestamptz, nullable) - When the client was last notified via email
      - `publish_to_changelog` (boolean, default false) - Whether to auto-create a changelog entry on release

  2. Notes
    - scheduled_date allows precise scheduling alongside the existing free-text ETA field
    - client_id links the roadmap item directly to a client for notification purposes
    - notified_at tracks whether the email notification has been sent
    - publish_to_changelog flags items that should create a service_changes entry when released
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmap_items' AND column_name = 'scheduled_date'
  ) THEN
    ALTER TABLE roadmap_items ADD COLUMN scheduled_date date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmap_items' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE roadmap_items ADD COLUMN client_id uuid REFERENCES clients(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmap_items' AND column_name = 'notified_at'
  ) THEN
    ALTER TABLE roadmap_items ADD COLUMN notified_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmap_items' AND column_name = 'publish_to_changelog'
  ) THEN
    ALTER TABLE roadmap_items ADD COLUMN publish_to_changelog boolean NOT NULL DEFAULT false;
  END IF;
END $$;
