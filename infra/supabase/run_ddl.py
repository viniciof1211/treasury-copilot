"""
Connect directly to Supabase Postgres and create the tms schema + CDC tables.
Tries multiple connection methods.
"""
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / "agent" / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_DB_PASSWORD = os.environ.get("SUPABASE_DB_PASSWORD", "")

# Extract project ref from URL
ref = SUPABASE_URL.split("//")[1].split(".")[0] if SUPABASE_URL else ""

DDL = """
-- Create tms schema
CREATE SCHEMA IF NOT EXISTS tms;

-- CDC events table
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

-- CDC watermarks table
CREATE TABLE IF NOT EXISTS tms.cdc_watermarks (
    sql_table_name  text PRIMARY KEY,
    last_poll_at    timestamptz,
    last_max_pk     text,
    last_max_date   text,
    rows_synced     integer DEFAULT 0,
    status          text DEFAULT 'idle',
    updated_at      timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cdc_events_table ON tms.cdc_events (sql_table_name);
CREATE INDEX IF NOT EXISTS idx_cdc_events_created ON tms.cdc_events (created_at DESC);

-- Grants
GRANT USAGE ON SCHEMA tms TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA tms TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA tms TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tms GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA tms GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Expose tms schema via PostgREST
ALTER ROLE authenticator SET pgrst.db_extra_search_path TO 'public', 'tms';
NOTIFY pgrst, 'reload config';
"""

# Also create in public schema as fallback
DDL_PUBLIC = """
CREATE TABLE IF NOT EXISTS public.cdc_events (
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

CREATE TABLE IF NOT EXISTS public.cdc_watermarks (
    sql_table_name  text PRIMARY KEY,
    last_poll_at    timestamptz,
    last_max_pk     text,
    last_max_date   text,
    rows_synced     integer DEFAULT 0,
    status          text DEFAULT 'idle',
    updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pub_cdc_events_table ON public.cdc_events (sql_table_name);
CREATE INDEX IF NOT EXISTS idx_pub_cdc_events_created ON public.cdc_events (created_at DESC);
"""


def try_direct_postgres():
    """Try connecting directly to Supabase Postgres."""
    if not SUPABASE_DB_PASSWORD:
        print("No SUPABASE_DB_PASSWORD set, skipping direct Postgres connection")
        return False
    
    import psycopg2
    # Try multiple connection strings
    conn_strings = [
        f"postgresql://postgres.{ref}:{SUPABASE_DB_PASSWORD}@aws-0-us-east-2.pooler.supabase.com:5432/postgres",
        f"postgresql://postgres:{SUPABASE_DB_PASSWORD}@db.{ref}.supabase.co:5432/postgres",
        f"postgresql://postgres.{ref}:{SUPABASE_DB_PASSWORD}@aws-0-us-east-2.pooler.supabase.com:6543/postgres",
    ]
    for cs in conn_strings:
        try:
            print(f"Trying: {cs[:60]}...")
            conn = psycopg2.connect(cs, connect_timeout=10)
            conn.autocommit = True
            cur = conn.cursor()
            for stmt in DDL.split(";"):
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt + ";")
                    print(f"  OK: {stmt[:60]}...")
            for stmt in DDL_PUBLIC.split(";"):
                stmt = stmt.strip()
                if stmt:
                    cur.execute(stmt + ";")
                    print(f"  OK: {stmt[:60]}...")
            conn.close()
            print("\n✓ All DDL executed successfully!")
            return True
        except Exception as e:
            print(f"  Failed: {e}")
    return False


def try_supabase_management_api():
    """Try using Supabase Management API to run SQL."""
    import httpx
    # Need a Supabase access token (from dashboard login)
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "")
    if not token:
        print("No SUPABASE_ACCESS_TOKEN set, skipping Management API")
        return False
    
    resp = httpx.post(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        content=DDL + DDL_PUBLIC,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    )
    if resp.status_code in (200, 201):
        print("✓ DDL executed via Management API!")
        return True
    else:
        print(f"Management API failed: {resp.status_code} {resp.text[:200]}")
        return False


def main():
    print(f"Supabase project ref: {ref}")
    print(f"Attempting to create tms schema + CDC tables...\n")
    
    if try_direct_postgres():
        return
    
    if try_supabase_management_api():
        return
    
    print("\n" + "="*60)
    print("MANUAL STEP REQUIRED")
    print("="*60)
    print(f"\nPlease open the Supabase SQL Editor and run the SQL:")
    print(f"  https://supabase.com/dashboard/project/{ref}/sql/new")
    print(f"\nSQL file: infra/supabase/create_tms_tables.sql")
    print(f"\nOr copy-paste this SQL:\n")
    print(DDL)
    print(DDL_PUBLIC)


if __name__ == "__main__":
    main()
