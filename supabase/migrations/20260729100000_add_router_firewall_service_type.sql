INSERT INTO service_types (name, description, icon, is_revenue)
SELECT 'Router / Firewall', 'Router con función de firewall — MikroTik, pfSense, OPNsense, FortiGate, etc.', '🛡️', true
WHERE NOT EXISTS (
  SELECT 1 FROM service_types WHERE name = 'Router / Firewall'
);
