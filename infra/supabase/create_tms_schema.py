"""Create the tms schema and CDC tables in Supabase."""
import os
import httpx
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).parent.parent.parent / "agent" / ".env")

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

HEADERS = {
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "apikey": SUPABASE_KEY,
    "Content-Type": "application/json",
}

SQL_STATEMENTS = [
    # 1. Create tms schema
    "CREATE SCHEMA IF NOT EXISTS tms;",

    # 2. Grant usage to PostgREST roles
    "GRANT USAGE ON SCHEMA tms TO anon, authenticated, service_role;",
    "GRANT ALL ON ALL TABLES IN SCHEMA tms TO anon, authenticated, service_role;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA tms GRANT ALL ON TABLES TO anon, authenticated, service_role;",

    # 3. Expose tms schema via PostgREST
    """
    DO $$
    DECLARE
        current_schemas text;
    BEGIN
        SELECT INTO current_schemas current_setting('pgrst.db_schemas', true);
        IF current_schemas IS NULL OR current_schemas = '' THEN
            current_schemas := 'public';
        END IF;
        IF position('tms' in current_schemas) = 0 THEN
            PERFORM set_config('pgrst.db_schemas', current_schemas || ',tms', false);
        END IF;
    END $$;
    """,

    # 4. CDC events table
    """
    CREATE TABLE IF NOT EXISTS tms.cdc_events (
        id              bigserial PRIMARY KEY,
        sql_table_name  text NOT NULL,
        event_type      text NOT NULL DEFAULT 'INSERT',
        row_pk          text,
        new_data        jsonb,
        committed_to_supabase boolean DEFAULT true,
        committed_to_kafka    boolean DEFAULT false,
        kafka_topic     text,
        created_at      timestamptz DEFAULT now()
    );
    """,

    # 5. CDC watermarks table
    """
    CREATE TABLE IF NOT EXISTS tms.cdc_watermarks (
        sql_table_name  text PRIMARY KEY,
        last_poll_at    timestamptz,
        last_max_pk     text,
        last_max_date   text,
        rows_synced     integer DEFAULT 0,
        status          text DEFAULT 'idle',
        updated_at      timestamptz DEFAULT now()
    );
    """,

    # 6. Index on cdc_events for fast lookups
    "CREATE INDEX IF NOT EXISTS idx_cdc_events_table ON tms.cdc_events (sql_table_name);",
    "CREATE INDEX IF NOT EXISTS idx_cdc_events_created ON tms.cdc_events (created_at DESC);",

    # 7. Re-grant after table creation
    "GRANT ALL ON ALL TABLES IN SCHEMA tms TO anon, authenticated, service_role;",
    "GRANT ALL ON ALL SEQUENCES IN SCHEMA tms TO anon, authenticated, service_role;",
]


def main():
    for i, sql in enumerate(SQL_STATEMENTS):
        sql = sql.strip()
        if not sql:
            continue
        print(f"[{i+1}/{len(SQL_STATEMENTS)}] Executing: {sql[:80]}...")
        resp = httpx.post(
            f"{SUPABASE_URL}/rest/v1/rpc/exec_sql",
            json={"sql_query": sql},
            headers=HEADERS,
            timeout=30.0,
        )
        if resp.status_code in (200, 201, 204):
            print(f"  ✓ OK")
        else:
            print(f"  ✗ {resp.status_code}: {resp.text[:200]}")


if __name__ == "__main__":
    main()
