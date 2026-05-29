import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Client = {
  id: string;
  user_id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  address?: string;
  status: 'Active' | 'Inactive' | 'Pending';
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type ServiceType = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  is_revenue: boolean;
  created_at: string;
};

export type InfrastructureType = 'Cloud' | 'Physical' | 'Managed Service';

export type ManagedRole =
  | 'Active Directory'
  | 'VPN Site-to-Site'
  | 'Backups'
  | 'Firewall'
  | 'Monitoring'
  | 'DNS'
  | 'DHCP'
  | 'File Server'
  | 'Mail Server'
  | 'Web Server'
  | 'Database Server'
  | 'Other';

export const MANAGED_ROLES: ManagedRole[] = [
  'Active Directory',
  'VPN Site-to-Site',
  'Backups',
  'Firewall',
  'Monitoring',
  'DNS',
  'DHCP',
  'File Server',
  'Mail Server',
  'Web Server',
  'Database Server',
  'Other',
];

export type Project = {
  id: string;
  user_id: string;
  client_id: string;
  name: string;
  description?: string;
  status: 'Active' | 'On Hold' | 'Completed' | 'Cancelled';
  start_date?: string;
  end_date?: string;
  created_at: string;
  updated_at: string;
};

export type Service = {
  id: string;
  user_id: string;
  client_id: string;
  project_id?: string;
  service_type_id: string;
  name: string;
  description?: string;
  status: 'Active' | 'Suspended' | 'Cancelled' | 'Pending';
  price: number;
  currency: string;
  billing_cycle: 'Monthly' | 'Quarterly' | 'Semi-Annually' | 'Annually' | 'Biennially' | 'One-Time';
  next_renewal_date?: string;
  provider?: string;
  server_ip?: string;
  specifications?: Record<string, any>;
  login_url?: string;
  infrastructure_type?: InfrastructureType;
  cloud_provider?: string;
  cloud_account_payer?: string;
  confirmed_hours_monthly?: number;
  managed_roles?: ManagedRole[];
  location?: string;
  business_name?: string;
  business_description?: string;
  sla_level?: string;
  includes?: string[];
  excludes?: string[];
  client_responsibilities?: string[];
  operational_status?: OperationalStatus;
  uptime_badge_url?: string;
  uptime_status_url?: string;
  rto?: string;
  rpo?: string;
  maintenance_window?: string;
  last_backup_at?: string;
  storage_used_pct?: number;
  ram_used_pct?: number;
  resource_updated_at?: string;
  reverse_proxy_domain?: string;
  infrastructure_cost?: number;
  allocated_hours?: number;
  extra_hour_rate?: number;
  paid_by?: PaidBy;
  payment_card_last4?: string;
  created_at: string;
  updated_at: string;
};

export type PaidBy = 'Me' | 'Client';

export const PAID_BY_OPTIONS: PaidBy[] = ['Me', 'Client'];

export type OperationalStatus = 'Operational' | 'Maintenance' | 'Degraded' | 'Down';

export const OPERATIONAL_STATUSES: OperationalStatus[] = ['Operational', 'Maintenance', 'Degraded', 'Down'];

export type ServiceChange = {
  id: string;
  user_id: string;
  service_id: string;
  change_date: string;
  summary: string;
  details?: string;
  created_at: string;
};

export type RoadmapStatus = 'Planned' | 'In Progress' | 'Next Release' | 'Released';

export const ROADMAP_STATUSES: RoadmapStatus[] = ['Planned', 'In Progress', 'Next Release', 'Released'];

export type RoadmapCategory = 'idea' | 'payment' | 'backup' | 'visit';

export const ROADMAP_CATEGORIES: { value: RoadmapCategory; label: string }[] = [
  { value: 'idea', label: 'New Service / Idea' },
  { value: 'payment', label: 'Pending Payment' },
  { value: 'backup', label: 'Backup Integration' },
  { value: 'visit', label: 'Visit / Coordination' },
];

export type RoadmapItem = {
  id: string;
  user_id: string;
  title: string;
  description?: string;
  eta?: string;
  status: RoadmapStatus;
  category: RoadmapCategory;
  requested_by?: string;
  service_id?: string;
  amount?: number;
  sort_order: number;
  is_public: boolean;
  created_at: string;
  updated_at: string;
};

export type ClientLicense = {
  id: string;
  user_id: string;
  client_id: string;
  service_id?: string;
  software_name: string;
  license_key?: string;
  quantity: number;
  quantity_label: string;
  expiration_date?: string;
  billing_cycle: string;
  cost?: number;
  currency: string;
  paid_by?: PaidBy;
  payment_card_last4?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
};

export type ServiceHeartbeat = {
  id: string;
  user_id: string;
  service_id: string;
  source: string;
  payload: Record<string, unknown>;
  status: 'ok' | 'warning' | 'error';
  message?: string;
  received_at: string;
};

export type ShareToken = {
  id: string;
  user_id: string;
  client_id: string;
  token: string;
  label: string;
  expires_at?: string;
  created_at: string;
};
