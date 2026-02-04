/*
  # Initial Database Schema for Treasury Cashflow AI Platform

  ## Overview
  This migration sets up the complete database schema for a multi-tenant corporate AI platform
  for Treasury and Finance teams, including cashflow analysis, AI-powered insights, and 
  automated visualizations.

  ## New Tables

  ### 1. business_units
  Multi-tenant organization structure
  - `id` (uuid, primary key)
  - `name` (text) - Business unit name
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 2. profiles
  Extended user profiles linked to auth.users
  - `id` (uuid, primary key, references auth.users)
  - `email` (text) - User email
  - `full_name` (text) - User's full name
  - `role` (text) - User role: admin, manager, analyst, viewer
  - `business_unit_id` (uuid) - References business_units
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 3. projects
  Treasury and finance projects
  - `id` (uuid, primary key)
  - `name` (text) - Project name
  - `description` (text) - Project description
  - `status` (text) - Project status: planning, active, completed
  - `business_unit_id` (uuid) - References business_units
  - `owner_id` (uuid) - References profiles
  - `budget` (numeric) - Project budget
  - `actual_cost` (numeric) - Actual costs incurred
  - `roi` (numeric) - Return on investment percentage
  - `start_date` (date) - Project start date
  - `end_date` (date) - Project end date
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 4. data_sources
  Connected data sources (Databricks, etc.)
  - `id` (uuid, primary key)
  - `name` (text) - Data source name
  - `type` (text) - Source type: databricks, api, database
  - `status` (text) - Connection status: connected, disconnected, error
  - `business_unit_id` (uuid) - References business_units
  - `config` (jsonb) - Connection configuration (encrypted)
  - `last_sync` (timestamptz) - Last successful sync
  - `created_at` (timestamptz) - Creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### 5. kpi_metrics
  KPI and cashflow metrics
  - `id` (uuid, primary key)
  - `business_unit_id` (uuid) - References business_units
  - `metric_type` (text) - Type: cashflow, revenue, expenses, etc.
  - `metric_name` (text) - Metric name
  - `value` (numeric) - Metric value
  - `period` (text) - Time period: daily, weekly, monthly, quarterly
  - `date` (date) - Metric date
  - `metadata` (jsonb) - Additional metric data
  - `created_at` (timestamptz) - Creation timestamp

  ### 6. chat_messages
  AI chat conversation history
  - `id` (uuid, primary key)
  - `user_id` (uuid) - References profiles
  - `business_unit_id` (uuid) - References business_units
  - `message` (text) - User or AI message
  - `role` (text) - Message role: user, assistant
  - `metadata` (jsonb) - Message metadata (charts, insights)
  - `created_at` (timestamptz) - Creation timestamp

  ### 7. audit_logs
  System audit trail
  - `id` (uuid, primary key)
  - `user_id` (uuid) - References profiles
  - `action` (text) - Action performed
  - `resource_type` (text) - Resource type affected
  - `resource_id` (uuid) - Resource ID
  - `details` (jsonb) - Action details
  - `ip_address` (text) - User IP address
  - `created_at` (timestamptz) - Creation timestamp

  ## Security
  - Row Level Security (RLS) enabled on all tables
  - Restrictive policies ensuring users can only access data within their business unit
  - Admin role has elevated permissions
  - Audit logging for all sensitive operations
*/

-- Create business_units table
CREATE TABLE IF NOT EXISTS business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'manager', 'analyst', 'viewer')),
  business_unit_id uuid REFERENCES business_units(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  status text NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'completed')),
  business_unit_id uuid REFERENCES business_units(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  budget numeric DEFAULT 0,
  actual_cost numeric DEFAULT 0,
  roi numeric DEFAULT 0,
  start_date date,
  end_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create data_sources table
CREATE TABLE IF NOT EXISTS data_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL DEFAULT 'databricks' CHECK (type IN ('databricks', 'api', 'database')),
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'error')),
  business_unit_id uuid REFERENCES business_units(id) ON DELETE CASCADE,
  config jsonb DEFAULT '{}'::jsonb,
  last_sync timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create kpi_metrics table
CREATE TABLE IF NOT EXISTS kpi_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit_id uuid REFERENCES business_units(id) ON DELETE CASCADE,
  metric_type text NOT NULL,
  metric_name text NOT NULL,
  value numeric NOT NULL,
  period text NOT NULL DEFAULT 'monthly' CHECK (period IN ('daily', 'weekly', 'monthly', 'quarterly', 'yearly')),
  date date NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES business_units(id) ON DELETE CASCADE,
  message text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  details jsonb DEFAULT '{}'::jsonb,
  ip_address text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_profiles_business_unit ON profiles(business_unit_id);
CREATE INDEX IF NOT EXISTS idx_projects_business_unit ON projects(business_unit_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_data_sources_business_unit ON data_sources(business_unit_id);
CREATE INDEX IF NOT EXISTS idx_kpi_metrics_business_unit ON kpi_metrics(business_unit_id);
CREATE INDEX IF NOT EXISTS idx_kpi_metrics_date ON kpi_metrics(date);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_business_unit ON chat_messages(business_unit_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);

-- Enable Row Level Security on all tables
ALTER TABLE business_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for business_units
CREATE POLICY "Users can view their business unit"
  ON business_units FOR SELECT
  TO authenticated
  USING (
    id IN (
      SELECT business_unit_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage business units"
  ON business_units FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for profiles
CREATE POLICY "Users can view profiles in their business unit"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    business_unit_id IN (
      SELECT business_unit_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "Admins can manage all profiles"
  ON profiles FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for projects
CREATE POLICY "Users can view projects in their business unit"
  ON projects FOR SELECT
  TO authenticated
  USING (
    business_unit_id IN (
      SELECT business_unit_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Managers and admins can create projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
      AND business_unit_id = projects.business_unit_id
    )
  );

CREATE POLICY "Project owners and admins can update projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete projects"
  ON projects FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- RLS Policies for data_sources
CREATE POLICY "Users can view data sources in their business unit"
  ON data_sources FOR SELECT
  TO authenticated
  USING (
    business_unit_id IN (
      SELECT business_unit_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Admins and managers can manage data sources"
  ON data_sources FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
      AND business_unit_id = data_sources.business_unit_id
    )
  );

-- RLS Policies for kpi_metrics
CREATE POLICY "Users can view KPIs in their business unit"
  ON kpi_metrics FOR SELECT
  TO authenticated
  USING (
    business_unit_id IN (
      SELECT business_unit_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Analysts and above can insert KPIs"
  ON kpi_metrics FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role IN ('admin', 'manager', 'analyst')
      AND business_unit_id = kpi_metrics.business_unit_id
    )
  );

-- RLS Policies for chat_messages
CREATE POLICY "Users can view their own chat messages"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own chat messages"
  ON chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can view all chat messages in their business unit"
  ON chat_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
      AND role = 'admin'
      AND business_unit_id = chat_messages.business_unit_id
    )
  );

-- RLS Policies for audit_logs
CREATE POLICY "Admins can view all audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_business_units_updated_at
  BEFORE UPDATE ON business_units
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_data_sources_updated_at
  BEFORE UPDATE ON data_sources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create function to automatically create profile on user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'viewer')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to auto-create profile
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();