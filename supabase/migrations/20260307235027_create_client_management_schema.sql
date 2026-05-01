/*
  # Client Management System Schema

  ## Overview
  This migration creates a comprehensive client management system for service providers
  to track clients, services, billing, and related information.

  ## New Tables

  ### 1. `clients`
  Stores client/customer information
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users) - Owner of this client record
  - `company_name` (text) - Client's company name
  - `contact_name` (text) - Primary contact person
  - `email` (text) - Client email
  - `phone` (text, optional) - Contact phone
  - `address` (text, optional) - Physical address
  - `status` (text) - Active, Inactive, Pending
  - `notes` (text, optional) - Internal notes
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### 2. `service_types`
  Categories of services offered
  - `id` (uuid, primary key)
  - `name` (text) - VPS, Shared Hosting, Domain, etc.
  - `description` (text, optional)
  - `icon` (text, optional) - Icon identifier
  - `created_at` (timestamptz)

  ### 3. `services`
  Individual services provided to clients
  - `id` (uuid, primary key)
  - `user_id` (uuid, references auth.users) - Owner
  - `client_id` (uuid, references clients)
  - `service_type_id` (uuid, references service_types)
  - `name` (text) - Service name/identifier
  - `description` (text, optional) - Service details
  - `status` (text) - Active, Suspended, Cancelled, Pending
  - `price` (decimal) - Cost per billing cycle
  - `currency` (text) - USD, EUR, etc.
  - `billing_cycle` (text) - Monthly, Yearly, etc.
  - `next_renewal_date` (date, optional)
  - `provider` (text, optional) - Hosting provider name
  - `server_ip` (text, optional)
  - `specifications` (jsonb, optional) - CPU, RAM, Storage, etc.
  - `login_url` (text, optional)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## Security
  - Enable RLS on all tables
  - Add policies for authenticated users to manage their own data only
  
  ## Important Notes
  1. All tables use UUID primary keys for security
  2. Timestamps track creation and updates
  3. JSONB used for flexible service specifications
  4. Multi-currency support for international clients
  5. Soft status tracking instead of hard deletes
*/

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  company_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text,
  address text,
  status text NOT NULL DEFAULT 'Active',
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT valid_status CHECK (status IN ('Active', 'Inactive', 'Pending'))
);

-- Create service_types table
CREATE TABLE IF NOT EXISTS service_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  icon text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create services table
CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
  service_type_id uuid REFERENCES service_types(id) NOT NULL,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'Active',
  price decimal(10,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'USD',
  billing_cycle text NOT NULL DEFAULT 'Monthly',
  next_renewal_date date,
  provider text,
  server_ip text,
  specifications jsonb,
  login_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT valid_service_status CHECK (status IN ('Active', 'Suspended', 'Cancelled', 'Pending')),
  CONSTRAINT valid_billing_cycle CHECK (billing_cycle IN ('Monthly', 'Quarterly', 'Semi-Annually', 'Annually', 'Biennially', 'One-Time'))
);

-- Insert default service types
INSERT INTO service_types (name, description, icon) VALUES
  ('VPS', 'Virtual Private Server', 'server'),
  ('Dedicated Server', 'Dedicated Server Hosting', 'hard-drive'),
  ('Shared Hosting', 'Shared Web Hosting', 'share-2'),
  ('Reseller Hosting', 'Reseller Hosting Package', 'users'),
  ('Domain', 'Domain Registration', 'globe'),
  ('SSL Certificate', 'SSL/TLS Certificate', 'shield'),
  ('Email Hosting', 'Email Hosting Service', 'mail'),
  ('Other', 'Other Services', 'box')
ON CONFLICT (name) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

-- RLS Policies for clients table
CREATE POLICY "Users can view own clients"
  ON clients FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own clients"
  ON clients FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own clients"
  ON clients FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own clients"
  ON clients FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for service_types (read-only for all authenticated users)
CREATE POLICY "Authenticated users can view service types"
  ON service_types FOR SELECT
  TO authenticated
  USING (true);

-- RLS Policies for services table
CREATE POLICY "Users can view own services"
  ON services FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own services"
  ON services FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own services"
  ON services FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own services"
  ON services FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_clients_user_id ON clients(user_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_services_user_id ON services(user_id);
CREATE INDEX IF NOT EXISTS idx_services_client_id ON services(client_id);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_renewal_date ON services(next_renewal_date);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers for updated_at
CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();