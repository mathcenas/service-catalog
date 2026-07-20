INSERT INTO service_types (name, description, icon, is_revenue)
SELECT 'Router / Switch', 'Network routing and switching — MikroTik, Cisco, Ubiquiti, etc.', '🔀', true
WHERE NOT EXISTS (
  SELECT 1 FROM service_types WHERE name = 'Router / Switch'
);
