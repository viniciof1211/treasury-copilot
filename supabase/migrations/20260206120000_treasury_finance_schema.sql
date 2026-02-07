/*
  Treasury Finance Schema — bronze_finance, silver_finance, dim_*
  Aligned with CxP/CxC process docs and Excel structures (GV CXP Totales, Flujo Semanal).
*/

-- Schemas
CREATE SCHEMA IF NOT EXISTS bronze_finance;
CREATE SCHEMA IF NOT EXISTS silver_finance;
CREATE SCHEMA IF NOT EXISTS dim;

-- Ingest tracking (requerido por root prompt)
CREATE TABLE bronze_finance.ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file text NOT NULL,
  source_sheet text,
  file_bucket text,
  file_path text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  rows_inserted int DEFAULT 0,
  error_message text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- Dim: Business Units (Euromobilia, Paneltech, Multiclamp, etc.)
CREATE TABLE dim.business_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Dim: Allocation rules (default 25% per BU)
CREATE TABLE dim.allocation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text NOT NULL,
  bu_id uuid REFERENCES dim.business_units(id),
  allocation_pct numeric NOT NULL CHECK (allocation_pct >= 0 AND allocation_pct <= 100),
  effective_from date,
  effective_to date,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Dim: Payment priority calendar (lunes prioritarios)
CREATE TABLE dim.payment_priority_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  priority_order int NOT NULL,
  week_monday date NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

-- Silver: CxP items (from GV CXP Totales structure)
CREATE TABLE silver_finance.cxp_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_run_id uuid REFERENCES bronze_finance.ingest_runs(id),
  empresa text,
  negocio text,
  responsable text,
  vencimiento_fecha date,
  fecha_max_pago date,
  vencidos_dias int,
  prioridad text,
  monto_usd numeric,
  original_moneda text,
  monto_original numeric,
  tipo_proveedor text,
  proveedor text,
  detalle text,
  clasificacion text,
  observacion text,
  bu_id uuid REFERENCES dim.business_units(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_cxp_items_vencimiento ON silver_finance.cxp_items(vencimiento_fecha);
CREATE INDEX idx_cxp_items_prioridad ON silver_finance.cxp_items(prioridad);
CREATE INDEX idx_cxp_items_bu ON silver_finance.cxp_items(bu_id);
CREATE INDEX idx_cxp_items_ingest ON silver_finance.cxp_items(ingest_run_id);

-- Silver: Flujo Semanal (weekly operations)
CREATE TABLE silver_finance.flujo_semanal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_run_id uuid REFERENCES bronze_finance.ingest_runs(id),
  compania text,
  tipo text,
  operacion text,
  vencimiento date,
  saldo_original numeric,
  principal numeric,
  intereses numeric,
  cuota numeric,
  capital numeric,
  capital_actualizado numeric,
  moneda text,
  banco text,
  observaciones text,
  semana_inicio date,
  semana_fin date,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_flujo_semanal_vencimiento ON silver_finance.flujo_semanal(vencimiento);
CREATE INDEX idx_flujo_semanal_compania ON silver_finance.flujo_semanal(compania);

-- Silver: Proyección 12M
CREATE TABLE silver_finance.projection_12m (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bu_id uuid REFERENCES dim.business_units(id),
  projection_month date NOT NULL,
  projected_inflows numeric DEFAULT 0,
  projected_outflows numeric DEFAULT 0,
  projected_balance numeric DEFAULT 0,
  confidence_score numeric,
  assumptions jsonb DEFAULT '{}',
  source_ingest_run_id uuid REFERENCES bronze_finance.ingest_runs(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_projection_12m_month ON silver_finance.projection_12m(projection_month);
CREATE INDEX idx_projection_12m_bu ON silver_finance.projection_12m(bu_id);
CREATE UNIQUE INDEX projection_12m_bu_month_key ON silver_finance.projection_12m(bu_id, projection_month);

-- RLS: Allow service role full access; anon/authenticated read-only on silver/dim
ALTER TABLE bronze_finance.ingest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE silver_finance.cxp_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE silver_finance.flujo_semanal ENABLE ROW LEVEL SECURITY;
ALTER TABLE silver_finance.projection_12m ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim.business_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim.allocation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim.payment_priority_calendar ENABLE ROW LEVEL SECURITY;

-- Internal app: allow all for now (service role used by Edge Functions)
CREATE POLICY "Allow all for treasury tools" ON bronze_finance.ingest_runs FOR ALL USING (true);
CREATE POLICY "Allow all for treasury tools" ON silver_finance.cxp_items FOR ALL USING (true);
CREATE POLICY "Allow all for treasury tools" ON silver_finance.flujo_semanal FOR ALL USING (true);
CREATE POLICY "Allow all for treasury tools" ON silver_finance.projection_12m FOR ALL USING (true);
CREATE POLICY "Allow all for treasury tools" ON dim.business_units FOR ALL USING (true);
CREATE POLICY "Allow all for treasury tools" ON dim.allocation_rules FOR ALL USING (true);
CREATE POLICY "Allow all for treasury tools" ON dim.payment_priority_calendar FOR ALL USING (true);

-- Seed default BUs from docs (Euromobilia, Paneltech, Multiclamp)
INSERT INTO dim.business_units (code, name) VALUES
  ('EUROMOBILIA', 'Euromobilia'),
  ('PANELTECH', 'Paneltech'),
  ('MULTICLAMP', 'Multiclamp')
ON CONFLICT (code) DO NOTHING;

-- Default allocation 25% per BU (regla de negocio)
INSERT INTO dim.allocation_rules (rule_name, bu_id, allocation_pct)
SELECT 'default_25pct', id, 25 FROM dim.business_units;

-- Storage bucket for Excel ingest
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'treasury-files',
  'treasury-files',
  false,
  52428800,
  ARRAY['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- RPC for read-only SQL (bronze_finance, silver_finance, dim only)
CREATE OR REPLACE FUNCTION public.exec_sql(sql_query text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = bronze_finance, silver_finance, dim, public
AS $$
DECLARE
  result jsonb;
  stmt text;
BEGIN
  stmt := trim(sql_query);
  IF stmt !~* '^\s*SELECT\s' THEN
    RAISE EXCEPTION 'Only SELECT allowed';
  END IF;
  IF stmt ~* '\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT)\b' THEN
    RAISE EXCEPTION 'Forbidden SQL keywords';
  END IF;
  EXECUTE format('SELECT jsonb_agg(t) FROM (%s) t', stmt) INTO result;
  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- Expose schemas for PostgREST (Supabase)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    EXECUTE 'ALTER ROLE authenticator SET pgrst.db_schemas = ''public, bronze_finance, silver_finance, dim''';
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- Skip if no permission
END $$;
