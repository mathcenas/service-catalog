/*
  # Add cost breakdown fields to services

  1. Modified Tables
    - `services`
      - `infrastructure_cost` (numeric, default 0) - Raw infrastructure cost (VPS/physical server)
      - `allocated_hours` (numeric, default 0) - Monthly included support/maintenance hours
      - `extra_hour_rate` (numeric, default 0) - Cost per extra hour beyond allocation

  2. Notes
    - Enables ISO 20000 Financial Management of IT Services compliance
    - Client portal displays TCO breakdown: infrastructure vs. maintenance hours
    - The existing `price` field remains as the total monthly cost shown prominently
    - Breakdown shown below the total for transparency
    - Supports scenarios like test servers with 0 allocated hours (infra-only cost)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'infrastructure_cost'
  ) THEN
    ALTER TABLE services ADD COLUMN infrastructure_cost numeric NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'allocated_hours'
  ) THEN
    ALTER TABLE services ADD COLUMN allocated_hours numeric NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'extra_hour_rate'
  ) THEN
    ALTER TABLE services ADD COLUMN extra_hour_rate numeric NOT NULL DEFAULT 0;
  END IF;
END $$;
