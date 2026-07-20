export type FieldKind = 'text' | 'number' | 'url' | 'boolean' | 'select';

export type SpecField = {
  key: string;
  label: string;
  kind: FieldKind;
  storage: 'column' | 'spec';
  options?: string[];
  placeholder?: string;
  colSpan?: 1 | 2;
};

const COLUMN_KEYS = new Set([
  'provider',
  'server_ip',
  'login_url',
  'reverse_proxy_domain',
  'location',
  'cloud_provider',
  'cloud_account_payer',
  'ip_internal',
]);

export const COLUMN_FIELD_KEYS = COLUMN_KEYS;

export const SERVICE_TYPE_FIELDS: Record<string, SpecField[]> = {
  'VPS': [
    { key: 'provider', label: 'Provider', kind: 'text', storage: 'column', placeholder: 'e.g., DigitalOcean, Hetzner' },
    { key: 'location', label: 'Region', kind: 'text', storage: 'column', placeholder: 'e.g., nyc1, eu-central' },
    { key: 'server_ip', label: 'IP Address', kind: 'text', storage: 'column', placeholder: 'e.g., 192.0.2.10' },
    { key: 'reverse_proxy_domain', label: 'Domain / Reverse Proxy', kind: 'text', storage: 'column', placeholder: 'e.g., app.client.com' },
    { key: 'os', label: 'Operating System', kind: 'text', storage: 'spec', placeholder: 'e.g., Ubuntu 22.04 LTS' },
    { key: 'cpu', label: 'vCPU', kind: 'text', storage: 'spec', placeholder: 'e.g., 2 cores' },
    { key: 'ram', label: 'RAM', kind: 'text', storage: 'spec', placeholder: 'e.g., 4 GB' },
    { key: 'storage', label: 'Storage', kind: 'text', storage: 'spec', placeholder: 'e.g., 80 GB SSD' },
    { key: 'login_url', label: 'Control Panel URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'Dedicated Server': [
    { key: 'provider', label: 'Provider', kind: 'text', storage: 'column', placeholder: 'e.g., Hetzner, OVH' },
    { key: 'location', label: 'Datacenter / Rack', kind: 'text', storage: 'column', placeholder: 'e.g., FSN1 / Rack A12' },
    { key: 'server_ip', label: 'IP Address', kind: 'text', storage: 'column' },
    { key: 'reverse_proxy_domain', label: 'Domain / Reverse Proxy', kind: 'text', storage: 'column', placeholder: 'e.g., erp.client.com' },
    { key: 'cpu_model', label: 'CPU Model', kind: 'text', storage: 'spec', placeholder: 'e.g., Xeon E-2236' },
    { key: 'ram', label: 'RAM', kind: 'text', storage: 'spec', placeholder: 'e.g., 64 GB ECC' },
    { key: 'storage', label: 'Storage', kind: 'text', storage: 'spec', placeholder: 'e.g., 2x 1TB NVMe RAID1' },
    { key: 'os', label: 'Operating System', kind: 'text', storage: 'spec', placeholder: 'e.g., Debian 12' },
    { key: 'login_url', label: 'Management URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'Email Hosting': [
    { key: 'provider', label: 'Platform', kind: 'text', storage: 'column', placeholder: 'e.g., Google Workspace, M365, Zimbra' },
    { key: 'mail_domain', label: 'Domain', kind: 'text', storage: 'spec', placeholder: 'e.g., acme.com' },
    { key: 'mailbox_count', label: 'Mailbox Count', kind: 'number', storage: 'spec', placeholder: 'e.g., 10' },
    { key: 'storage_per_mailbox', label: 'Storage per Mailbox', kind: 'text', storage: 'spec', placeholder: 'e.g., 30 GB' },
    { key: 'login_url', label: 'Admin URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'Domain': [
    { key: 'provider', label: 'Registrar', kind: 'text', storage: 'column', placeholder: 'e.g., Namecheap, Cloudflare' },
    { key: 'domain_name', label: 'Domain Name', kind: 'text', storage: 'spec', placeholder: 'e.g., acme.com' },
    { key: 'nameservers', label: 'Nameservers', kind: 'text', storage: 'spec', placeholder: 'comma-separated', colSpan: 2 },
    { key: 'auto_renew', label: 'Auto-Renew Enabled', kind: 'boolean', storage: 'spec' },
    { key: 'dnssec', label: 'DNSSEC Enabled', kind: 'boolean', storage: 'spec' },
    { key: 'login_url', label: 'Registrar Login URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'Web Hosting': [
    { key: 'provider', label: 'Provider', kind: 'text', storage: 'column', placeholder: 'e.g., SiteGround, Hostinger' },
    { key: 'server_ip', label: 'IP Address', kind: 'text', storage: 'column', placeholder: 'e.g., 203.0.113.5' },
    { key: 'reverse_proxy_domain', label: 'Domain / Reverse Proxy', kind: 'text', storage: 'column', placeholder: 'e.g., www.client.com' },
    { key: 'control_panel', label: 'Control Panel', kind: 'select', options: ['cPanel', 'Plesk', 'DirectAdmin', 'CyberPanel', 'Custom', 'None'], storage: 'spec' },
    { key: 'disk_space', label: 'Disk Space', kind: 'text', storage: 'spec', placeholder: 'e.g., 50 GB' },
    { key: 'bandwidth', label: 'Bandwidth', kind: 'text', storage: 'spec', placeholder: 'e.g., Unlimited' },
    { key: 'php_version', label: 'PHP Version', kind: 'text', storage: 'spec', placeholder: 'e.g., 8.2' },
    { key: 'login_url', label: 'Control Panel URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'Backup': [
    { key: 'provider', label: 'Provider / Software', kind: 'text', storage: 'column', placeholder: 'e.g., Veeam, Restic, Duplicati' },
    { key: 'destination', label: 'Destination', kind: 'text', storage: 'spec', placeholder: 'e.g., Wasabi, Backblaze B2, local NAS' },
    { key: 'frequency', label: 'Frequency', kind: 'select', options: ['Hourly', 'Daily', 'Weekly', 'Monthly'], storage: 'spec' },
    { key: 'retention_days', label: 'Retention (days)', kind: 'number', storage: 'spec', placeholder: 'e.g., 30' },
    { key: 'total_size', label: 'Total Size', kind: 'text', storage: 'spec', placeholder: 'e.g., 500 GB' },
    { key: 'encrypted', label: 'Encrypted at Rest', kind: 'boolean', storage: 'spec' },
    { key: 'login_url', label: 'Admin URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'CDN': [
    { key: 'provider', label: 'Provider', kind: 'text', storage: 'column', placeholder: 'e.g., Cloudflare, Bunny, Fastly' },
    { key: 'zones', label: 'Zones / Domains', kind: 'text', storage: 'spec', placeholder: 'comma-separated', colSpan: 2 },
    { key: 'bandwidth', label: 'Bandwidth Included', kind: 'text', storage: 'spec', placeholder: 'e.g., 1 TB / month' },
    { key: 'login_url', label: 'Dashboard URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'Firewall': [
    { key: 'provider', label: 'Vendor / Model', kind: 'text', storage: 'column', placeholder: 'e.g., Fortinet FG-60F, pfSense' },
    { key: 'location', label: 'Location', kind: 'text', storage: 'column', placeholder: 'e.g., Main Office' },
    { key: 'server_ip', label: 'Management IP', kind: 'text', storage: 'column' },
    { key: 'ha_enabled', label: 'High Availability', kind: 'boolean', storage: 'spec' },
    { key: 'rule_count', label: 'Rule Count', kind: 'number', storage: 'spec' },
    { key: 'login_url', label: 'Management URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'Monitoring': [
    { key: 'provider', label: 'Platform', kind: 'text', storage: 'column', placeholder: 'e.g., Uptime Kuma, Zabbix, Grafana' },
    { key: 'monitor_count', label: 'Monitors Configured', kind: 'number', storage: 'spec' },
    { key: 'alert_channels', label: 'Alert Channels', kind: 'text', storage: 'spec', placeholder: 'e.g., Email, Slack, Telegram', colSpan: 2 },
    { key: 'login_url', label: 'Dashboard URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'VPN': [
    { key: 'provider', label: 'VPN Software', kind: 'text', storage: 'column', placeholder: 'e.g., WireGuard, OpenVPN, IPsec' },
    { key: 'vpn_type', label: 'Type', kind: 'select', options: ['Site-to-Site', 'Remote Access', 'Hybrid'], storage: 'spec' },
    { key: 'endpoints', label: 'Endpoints / Peers', kind: 'text', storage: 'spec', placeholder: 'e.g., Office-HQ <-> AWS-VPC', colSpan: 2 },
    { key: 'user_count', label: 'User Count', kind: 'number', storage: 'spec' },
    { key: 'server_ip', label: 'Public Endpoint / IP', kind: 'text', storage: 'column' },
  ],
  'Database': [
    { key: 'provider', label: 'Provider', kind: 'text', storage: 'column', placeholder: 'e.g., UpCloud, AWS RDS, Supabase' },
    { key: 'db_engine', label: 'Engine', kind: 'select', options: ['PostgreSQL', 'MySQL', 'MariaDB', 'Redis', 'MongoDB', 'SQLite', 'MSSQL', 'Other'], storage: 'spec' },
    { key: 'db_version', label: 'Version', kind: 'text', storage: 'spec', placeholder: 'e.g., 15.3' },
    { key: 'ip_internal', label: 'Private Endpoint / Host', kind: 'text', storage: 'column', placeholder: 'e.g., db-host.internal or 10.0.0.5' },
    { key: 'db_port', label: 'Port', kind: 'number', storage: 'spec', placeholder: 'e.g., 5432' },
    { key: 'db_name', label: 'Database Name', kind: 'text', storage: 'spec', placeholder: 'e.g., production_db' },
    { key: 'storage', label: 'Storage', kind: 'text', storage: 'spec', placeholder: 'e.g., 50 GB SSD' },
    { key: 'ha_enabled', label: 'High Availability', kind: 'boolean', storage: 'spec' },
    { key: 'automated_backups', label: 'Automated Backups', kind: 'boolean', storage: 'spec' },
    { key: 'login_url', label: 'Admin / Dashboard URL', kind: 'url', storage: 'column', placeholder: 'https://' },
  ],
  'Router / Switch': [
    { key: 'provider', label: 'Vendor / Model', kind: 'text', storage: 'column', placeholder: 'e.g., MikroTik RB5009, Cisco SG350' },
    { key: 'location', label: 'Location', kind: 'text', storage: 'column', placeholder: 'e.g., Main Office, Server Room' },
    { key: 'server_ip', label: 'Management IP', kind: 'text', storage: 'column', placeholder: 'e.g., 192.168.88.1' },
    { key: 'os_version', label: 'Firmware / RouterOS Version', kind: 'text', storage: 'spec', placeholder: 'e.g., 7.14.3' },
    { key: 'serial', label: 'Serial Number', kind: 'text', storage: 'spec' },
    { key: 'ha_enabled', label: 'High Availability / VRRP', kind: 'boolean', storage: 'spec' },
    { key: 'login_url', label: 'WebFig / Management URL', kind: 'url', storage: 'column', placeholder: 'https://192.168.88.1' },
  ],
  'Managed Service': [
    { key: 'provider', label: 'Provider / Team', kind: 'text', storage: 'column' },
    { key: 'location', label: 'Location / Environment', kind: 'text', storage: 'column' },
    { key: 'server_ip', label: 'IP Address', kind: 'text', storage: 'column', placeholder: 'e.g., 192.168.1.10' },
    { key: 'reverse_proxy_domain', label: 'Domain / Reverse Proxy', kind: 'text', storage: 'column', placeholder: 'e.g., portal.client.com' },
  ],
};

export function getFieldsForType(typeName: string | undefined): SpecField[] {
  if (!typeName) return [];
  return SERVICE_TYPE_FIELDS[typeName] || [];
}

export const EXCLUDED_SERVICE_TYPE_NAMES = new Set<string>(['SSL Certificate']);
