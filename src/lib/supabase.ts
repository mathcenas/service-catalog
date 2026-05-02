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
  created_at: string;
  updated_at: string;
};

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

export type ShareToken = {
  id: string;
  user_id: string;
  client_id: string;
  token: string;
  label: string;
  expires_at?: string;
  created_at: string;
};
