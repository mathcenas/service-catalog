-- Add ingest_secret to services for per-service ingest authentication
ALTER TABLE services ADD COLUMN IF NOT EXISTS ingest_secret text;

-- Generate a secret for all existing services that don't have one
UPDATE services
SET ingest_secret = encode(gen_random_bytes(32), 'hex')
WHERE ingest_secret IS NULL;
