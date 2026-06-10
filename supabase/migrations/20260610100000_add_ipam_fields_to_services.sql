-- Add IPAM fields to services table
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS ip_internal text,
  ADD COLUMN IF NOT EXISTS ip_public text,
  ADD COLUMN IF NOT EXISTS dns_record text;
