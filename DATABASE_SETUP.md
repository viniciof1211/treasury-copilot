# Database Setup Guide

This guide will help you set up the complete database schema for the Treasury Cashflow AI Management Agent.

## Prerequisites

- Access to your Supabase project
- Supabase CLI installed (optional, for local development)
- Admin access to your Supabase dashboard

## Schema Overview

The database includes 13 tables with comprehensive Row Level Security (RLS) policies:

### Core Tables
- **users** - User accounts with role-based access
- **company_bus** - Business units for multi-tenant architecture
- **data_sources** - External data connection configurations
- **audit_logs** - Comprehensive audit trail

### Financial Data Tables
- **cashflow_snapshots** - Point-in-time cashflow positions
- **payables_items** - Accounts payable tracking
- **receivables_items** - Accounts receivable tracking
- **bank_movements** - Bank transaction records
- **projections_12m** - 12-month liquidity forecasts

### Project & Analytics
- **engagement_projects** - Initiative tracking with ROI
- **kpi_records** - Key performance indicators

### AI & Chat
- **chat_conversations** - User chat sessions
- **chat_messages** - Messages with AI responses and generated images

## Manual Setup Steps

### Step 1: Create Enum Types

Run these SQL commands in the Supabase SQL Editor:

```sql
CREATE TYPE user_role AS ENUM ('admin', 'finance_manager', 'treasury_analyst', 'viewer');
CREATE TYPE data_source_type AS ENUM ('databricks', 'csv_upload', 'api', 'manual');
CREATE TYPE data_source_status AS ENUM ('active', 'inactive', 'error', 'syncing');
CREATE TYPE project_status AS ENUM ('planning', 'active', 'completed', 'on_hold', 'cancelled');
CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
```

### Step 2: Create Core Tables

Execute the complete migration file that includes all table definitions, indexes, and triggers. The migration file contains:

1. All table schemas with proper data types
2. Foreign key relationships
3. Default values and constraints
4. Indexes for performance optimization
5. Row Level Security policies
6. Updated_at triggers

You can find the complete SQL in the codebase or request the full migration file.

### Step 3: Enable Row Level Security

RLS is automatically enabled in the migration. Verify with:

```sql
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
AND tablename IN (
  'users', 'company_bus', 'data_sources',
  'cashflow_snapshots', 'payables_items',
  'receivables_items', 'bank_movements',
  'projections_12m', 'engagement_projects',
  'kpi_records', 'chat_conversations',
  'chat_messages', 'audit_logs'
);
```

### Step 4: Create Storage Bucket for Images

In Supabase Dashboard:
1. Go to Storage
2. Create a new bucket named `ai-images`
3. Set it to **public** (images need to be accessible)
4. Configure policies:

```sql
-- Allow authenticated users to upload
CREATE POLICY "Authenticated users can upload images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'ai-images');

-- Allow public read access
CREATE POLICY "Public can read images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'ai-images');
```

### Step 5: Seed Initial Data

Create initial business units:

```sql
INSERT INTO company_bus (id, name, code, description, is_active) VALUES
  (gen_random_uuid(), 'ARA Group - Corporate', 'ARA-CORP', 'Corporate headquarters and central treasury', true),
  (gen_random_uuid(), 'CVE Division', 'CVE-DIV', 'CVE certified operations', true),
  (gen_random_uuid(), 'Aurea Ventures', 'AUREA', 'Investment and venture capital arm', true),
  (gen_random_uuid(), 'ECS Solutions', 'ECS', 'Enterprise consulting services', true);
```

Create your first admin user (replace with your auth user ID):

```sql
-- First, sign up through the application or Supabase Auth
-- Then, update the user role:
UPDATE users
SET role = 'admin',
    company_bu_id = (SELECT id FROM company_bus WHERE code = 'ARA-CORP' LIMIT 1)
WHERE email = 'your-email@company.com';
```

### Step 6: Deploy Edge Functions

The Edge Functions are ready to deploy. Use the Supabase CLI or dashboard:

```bash
# Using Supabase CLI (if installed)
supabase functions deploy ai-chat
supabase functions deploy sync-data
```

Or through the Supabase Dashboard:
1. Go to Edge Functions
2. Create new function
3. Upload the code from `supabase/functions/ai-chat/index.ts`
4. Repeat for `sync-data`

### Step 7: Configure Secrets

Set environment variables for Edge Functions in Supabase Dashboard:

```bash
# In Supabase Dashboard > Edge Functions > Settings
FOUNDARY_AGENT_BASE_URL=https://your-foundry-endpoint.com
FOUNDARY_AGENT_API_KEY=your-foundry-api-key
FOUNDARY_AGENT_ID=your-agent-id
GEMINI_API_KEY=your-gemini-api-key
GEMINI_IMAGE_MODEL=nano-banana-pro
```

## Verification

### 1. Check Tables Exist

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

### 2. Verify RLS Policies

```sql
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE schemaname = 'public';
```

### 3. Test User Authentication

Try signing up and logging in through the application. Verify your user appears in the `users` table.

### 4. Test Data Access

Create sample data and verify users can only see data from their business unit:

```sql
-- As admin, create test data
INSERT INTO cashflow_snapshots (
  company_bu_id,
  snapshot_date,
  total_cash,
  total_payables,
  total_receivables,
  net_position,
  currency_code
) VALUES (
  (SELECT id FROM company_bus WHERE code = 'ARA-CORP' LIMIT 1),
  CURRENT_DATE,
  3500000,
  400000,
  470000,
  3070000,
  'USD'
);
```

## Troubleshooting

### Cannot Create Tables
- Ensure you have admin access to the Supabase project
- Check for existing tables with the same names
- Verify extensions are enabled (uuid-ossp, pgcrypto)

### RLS Blocking Access
- Verify user has `company_bu_id` assigned
- Check user role is set correctly
- Review policy conditions match your use case
- For testing, you can temporarily disable RLS (not recommended for production)

### Edge Functions Failing
- Verify all environment variables are set
- Check Edge Function logs in Supabase Dashboard
- Ensure service role key is available (auto-provided by Supabase)
- Verify external API endpoints are accessible

## Security Considerations

1. **Never disable RLS** in production
2. **Audit logs are append-only** - no delete/update policies
3. **Service role key** should never be exposed to frontend
4. **Business unit isolation** is enforced at database level
5. **Regular backups** should be configured in Supabase

## Migration Management

For future schema changes:
1. Create new migration files with descriptive names
2. Always include rollback procedures
3. Test migrations on development database first
4. Document breaking changes clearly
5. Update this guide with new setup steps

## Support

If you encounter issues:
1. Check Supabase Dashboard logs
2. Review RLS policy definitions
3. Verify user assignments and roles
4. Contact your database administrator

---

**Next Steps:** After completing database setup, return to README.md for application configuration and deployment.
