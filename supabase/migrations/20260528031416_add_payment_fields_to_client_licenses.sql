/*
  # Add payment tracking fields to client_licenses

  1. Modified Tables
    - `client_licenses`
      - `paid_by` (text, nullable) - Who pays: 'Me' or 'Client'
      - `currency` (text, default 'USD') - Currency code for cost
      - `payment_card_last4` (text, nullable) - Last 4 digits of payment card

  2. Notes
    - Allows licenses to appear in the Payments view alongside services
    - Licenses with paid_by = 'Me' will show up in the admin payments tracker
    - service_id was already nullable, so licenses can already exist without a service link
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_licenses' AND column_name = 'paid_by'
  ) THEN
    ALTER TABLE client_licenses ADD COLUMN paid_by text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_licenses' AND column_name = 'currency'
  ) THEN
    ALTER TABLE client_licenses ADD COLUMN currency text NOT NULL DEFAULT 'USD';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'client_licenses' AND column_name = 'payment_card_last4'
  ) THEN
    ALTER TABLE client_licenses ADD COLUMN payment_card_last4 text;
  END IF;
END $$;
