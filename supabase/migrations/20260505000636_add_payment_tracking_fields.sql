/*
  # Add payment tracking fields to services

  1. Changes
    - Add `paid_by` column to `services` — who pays the bill for this service (`Me` or `Client`). Nullable so existing services are unaffected.
    - Add `payment_card_last4` column to `services` — last 4 digits of the card used to pay, for quick visual identification. Nullable. Constrained to exactly 4 digits when provided.

  2. Security
    - No RLS changes needed; services table already has row-level policies scoped by `user_id`.

  3. Notes
    - Both columns are optional and default to NULL; no backfill is performed.
    - A CHECK constraint ensures `payment_card_last4` is either null or exactly 4 numeric digits, so this cannot be abused to store full card numbers.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'paid_by'
  ) THEN
    ALTER TABLE services ADD COLUMN paid_by text;
    ALTER TABLE services ADD CONSTRAINT services_paid_by_check
      CHECK (paid_by IS NULL OR paid_by IN ('Me', 'Client'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'services' AND column_name = 'payment_card_last4'
  ) THEN
    ALTER TABLE services ADD COLUMN payment_card_last4 text;
    ALTER TABLE services ADD CONSTRAINT services_card_last4_check
      CHECK (payment_card_last4 IS NULL OR payment_card_last4 ~ '^[0-9]{4}$');
  END IF;
END $$;
