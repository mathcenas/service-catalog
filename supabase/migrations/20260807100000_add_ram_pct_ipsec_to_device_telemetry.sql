-- Add RAM% and IPsec status columns to device_telemetry
-- (MikroTik logs report RAM as percentage, not MB; IPsec is ONLINE/OFFLINE)
ALTER TABLE device_telemetry
  ADD COLUMN IF NOT EXISTS ram_pct      numeric(5,2),
  ADD COLUMN IF NOT EXISTS ipsec_online boolean,
  ADD COLUMN IF NOT EXISTS wan_in_mbps  numeric(10,3);
