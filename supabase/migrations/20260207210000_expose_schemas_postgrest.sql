-- Expose bronze_finance, silver_finance, dim schemas in PostgREST
ALTER ROLE authenticator SET pgrst.db_schemas = 'public, bronze_finance, silver_finance, dim';

-- Grant schema USAGE to Supabase roles so PostgREST can access them
GRANT USAGE ON SCHEMA bronze_finance TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA silver_finance TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA dim TO anon, authenticated, service_role;

-- Grant full table access (RLS policies control row-level access)
GRANT ALL ON ALL TABLES IN SCHEMA bronze_finance TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA silver_finance TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA dim TO anon, authenticated, service_role;

-- Grant default privileges for any future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA bronze_finance GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA silver_finance GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA dim GRANT ALL ON TABLES TO anon, authenticated, service_role;

-- Grant sequence usage (for gen_random_uuid defaults)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA bronze_finance TO anon, authenticated, service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA silver_finance TO anon, authenticated, service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA dim TO anon, authenticated, service_role;

-- Reload PostgREST config
NOTIFY pgrst, 'reload config';
