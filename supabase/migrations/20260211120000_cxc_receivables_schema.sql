-- ============================================================================
-- CxC (Cuentas por Cobrar) / Receivables Schema
-- ============================================================================

CREATE TABLE IF NOT EXISTS silver_finance.cxc_items (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa     text,                                -- BU / Company
  cliente     text,                                -- Customer name
  factura     text,                                -- Invoice number
  fecha_factura date,                              -- Invoice date
  vencimiento date,                                -- Due date
  monto       numeric,                             -- Amount
  moneda      text DEFAULT 'USD',                  -- Currency code
  estado      text DEFAULT 'Pendiente',            -- Pagada, Pendiente, Vencida, Parcial
  dias_mora   integer DEFAULT 0,                   -- Computed at app level: GREATEST(0, today - vencimiento)
  area_comercial text,                             -- Sales area (4 areas)
  gestor_cobro   text,                             -- Collection manager
  proyecto       text,                             -- Project / contract reference
  hito           text,                             -- Milestone
  tipo           text DEFAULT 'Normal',            -- Normal, Adelanto Proyecto, Nota Credito
  notas          text,
  ingest_run_id  text,
  created_at     timestamptz DEFAULT now()
);

-- View that computes dias_mora dynamically
CREATE OR REPLACE VIEW silver_finance.cxc_items_live AS
SELECT *,
  GREATEST(0, CURRENT_DATE - vencimiento)::integer AS dias_mora_live
FROM silver_finance.cxc_items;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cxc_vencimiento ON silver_finance.cxc_items (vencimiento);
CREATE INDEX IF NOT EXISTS idx_cxc_cliente     ON silver_finance.cxc_items (cliente);
CREATE INDEX IF NOT EXISTS idx_cxc_empresa     ON silver_finance.cxc_items (empresa);
CREATE INDEX IF NOT EXISTS idx_cxc_estado      ON silver_finance.cxc_items (estado);
CREATE INDEX IF NOT EXISTS idx_cxc_ingest      ON silver_finance.cxc_items (ingest_run_id);

-- Row Level Security
ALTER TABLE silver_finance.cxc_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated" ON silver_finance.cxc_items
  FOR ALL USING (true) WITH CHECK (true);

-- Grant access
GRANT ALL ON silver_finance.cxc_items TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA silver_finance TO anon, authenticated, service_role;
