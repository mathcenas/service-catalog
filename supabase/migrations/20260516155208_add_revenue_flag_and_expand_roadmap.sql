/*
  # Add revenue flag to service_types and expand roadmap items

  1. Modified Tables
    - `service_types`
      - `is_revenue` (boolean, default true) - Whether this type counts toward monthly managed-service revenue.
        Set to false for cloud infrastructure, software licenses, domains that are just pass-through costs.

    - `roadmap_items`
      - `category` (text, default 'idea') - Category of the roadmap item:
        'backup' = Veeam/backup integration
        'payment' = Upcoming payment due (service or hardware)
        'idea' = New service, hardware, or feature in talks/development
        'visit' = Technical or provider visit needing coordination
      - `requested_by` (text) - Name of the client or person who requested this item
      - `service_id` (uuid, nullable, FK) - Optional link to a specific service (for payment items)
      - `amount` (numeric, nullable) - Payment amount if applicable

  2. Data Updates
    - Sets is_revenue=false for VPS, Dedicated Server, CDN, Domain, SSL Certificate (infrastructure/pass-through)
    - Keeps is_revenue=true for Managed Service, Backup, Monitoring, Email Hosting, Firewall, VPN, Web Hosting (your actual services)

  3. Notes
    - Monthly revenue in Dashboard will only sum services whose type has is_revenue=true
    - Roadmap categories allow organizing items by purpose
    - service_id FK lets payment items link directly to the service they belong to
*/

-- Add is_revenue to service_types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'service_types' AND column_name = 'is_revenue'
  ) THEN
    ALTER TABLE service_types ADD COLUMN is_revenue boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- Mark infrastructure/pass-through types as non-revenue
UPDATE service_types SET is_revenue = false
WHERE name IN ('VPS', 'Dedicated Server', 'CDN', 'Domain', 'SSL Certificate');

-- Add category to roadmap_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmap_items' AND column_name = 'category'
  ) THEN
    ALTER TABLE roadmap_items ADD COLUMN category text NOT NULL DEFAULT 'idea';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmap_items' AND column_name = 'requested_by'
  ) THEN
    ALTER TABLE roadmap_items ADD COLUMN requested_by text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmap_items' AND column_name = 'service_id'
  ) THEN
    ALTER TABLE roadmap_items ADD COLUMN service_id uuid REFERENCES services(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roadmap_items' AND column_name = 'amount'
  ) THEN
    ALTER TABLE roadmap_items ADD COLUMN amount numeric;
  END IF;
END $$;
