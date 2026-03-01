-- ============================================================
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Creates the tms schema and CDC tables for the CDC pipeline
-- ============================================================

-- 1. Create tms schema
CREATE SCHEMA IF NOT EXISTS tms;

-- 2. CDC events table
CREATE TABLE IF NOT EXISTS tms.cdc_events (
    id                    bigserial PRIMARY KEY,
    sql_table_name        text NOT NULL,
    event_type            text NOT NULL DEFAULT 'INSERT',
    row_pk                text,
    new_data              jsonb,
    committed_to_supabase boolean DEFAULT true,
    committed_to_kafka    boolean DEFAULT false,
    kafka_topic           text,
    created_at            timestamptz DEFAULT now()
);

-- 3. CDC watermarks table (tracks polling state per table)
CREATE TABLE IF NOT EXISTS tms.cdc_watermarks (
    sql_table_name  text PRIMARY KEY,
    last_poll_at    timestamptz,
    last_max_pk     text,
    last_max_date   text,
    rows_synced     integer DEFAULT 0,
    status          text DEFAULT 'idle',
    updated_at      timestamptz DEFAULT now()
);

-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cdc_events_table ON tms.cdc_events (sql_table_name);
CREATE INDEX IF NOT EXISTS idx_cdc_events_created ON tms.cdc_events (created_at DESC);

-- 5. Grant access to PostgREST roles
GRANT USAGE ON SCHEMA tms TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA tms TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA tms TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tms GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tms GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 6. Expose tms schema via PostgREST (add to exposed schemas)
-- Go to: Dashboard → Settings → API → Exposed schemas → Add "tms"
-- OR run this if you have superuser access:
ALTER ROLE authenticator SET pgrst.db_extra_search_path TO 'public', 'tms';
NOTIFY pgrst, 'reload config';

-- Done! Verify with:
-- SELECT * FROM tms.cdc_events LIMIT 1;
-- SELECT * FROM tms.cdc_watermarks LIMIT 1;
