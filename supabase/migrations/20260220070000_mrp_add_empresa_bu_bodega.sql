/*
  Add empresa, unidad_negocio, bodega, tipo_compra columns to mrp_master
  for multi-company, business-unit, and warehouse filtering.
  Also adds periodo_mes/periodo_anio for historical analysis.
*/

-- New segmentation columns
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS empresa text;
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS unidad_negocio text;
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS bodega text;
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS tipo_compra text;  -- 'Local', 'Internacional', 'Sin Definir'
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS periodo_mes integer;
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS periodo_anio integer;
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS bodega_excluida boolean DEFAULT false;

-- Curation metadata
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS curado_por text;
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS curado_at timestamptz;
ALTER TABLE silver_finance.mrp_master ADD COLUMN IF NOT EXISTS notas_curacion text;

-- Indexes for new filters
CREATE INDEX IF NOT EXISTS idx_mrp_master_empresa ON silver_finance.mrp_master(empresa);
CREATE INDEX IF NOT EXISTS idx_mrp_master_unidad_negocio ON silver_finance.mrp_master(unidad_negocio);
CREATE INDEX IF NOT EXISTS idx_mrp_master_bodega ON silver_finance.mrp_master(bodega);
CREATE INDEX IF NOT EXISTS idx_mrp_master_tipo_compra ON silver_finance.mrp_master(tipo_compra);
CREATE INDEX IF NOT EXISTS idx_mrp_master_periodo ON silver_finance.mrp_master(periodo_anio, periodo_mes);

-- ══════════════════════════════════════════════════════════════════════════════
-- Immutable backup table for PcGraf data snapshots
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bronze_finance.pcgraf_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_type text NOT NULL,           -- 'full', 'incremental', 'pre_curation'
  source_database text,
  source_table text,
  row_count integer DEFAULT 0,
  backup_data jsonb,                   -- actual data snapshot
  checksum text,                       -- SHA-256 of backup_data for integrity
  created_by text DEFAULT 'system',
  created_at timestamptz DEFAULT now(),
  metadata jsonb                       -- additional context
);

-- Make backups immutable: no UPDATE or DELETE allowed
ALTER TABLE bronze_finance.pcgraf_backups ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Backups are insert-only" ON bronze_finance.pcgraf_backups
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Revoke UPDATE and DELETE from all roles on backups table
REVOKE UPDATE, DELETE ON bronze_finance.pcgraf_backups FROM PUBLIC;
REVOKE UPDATE, DELETE ON bronze_finance.pcgraf_backups FROM anon;
REVOKE UPDATE, DELETE ON bronze_finance.pcgraf_backups FROM authenticated;
-- service_role keeps full access for emergency recovery only

-- ══════════════════════════════════════════════════════════════════════════════
-- Curation audit log — tracks all edits made through the curation module
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS silver_finance.curation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  edited_by text DEFAULT 'system',
  edited_at timestamptz DEFAULT now(),
  sync_to_pcgraf boolean DEFAULT false,
  sync_status text DEFAULT 'pending',  -- 'pending', 'synced', 'failed'
  sync_at timestamptz,
  notes text
);

CREATE INDEX IF NOT EXISTS idx_curation_log_record ON silver_finance.curation_log(record_id);
CREATE INDEX IF NOT EXISTS idx_curation_log_sync ON silver_finance.curation_log(sync_status);

ALTER TABLE silver_finance.curation_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all for treasury tools" ON silver_finance.curation_log
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════════════════════
-- Code mapping table — AI-assisted vendor code to internal code correlation
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS silver_finance.code_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_interno text,
  codigo_proveedor text,
  proveedor text,
  descripcion_interna text,
  descripcion_proveedor text,
  similarity_score numeric DEFAULT 0,  -- 0-1 AI confidence
  match_method text,                   -- 'exact', 'fuzzy', 'ai_embedding', 'manual'
  confirmed boolean DEFAULT false,
  confirmed_by text,
  confirmed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  metadata jsonb
);

CREATE INDEX IF NOT EXISTS idx_code_mappings_interno ON silver_finance.code_mappings(codigo_interno);
CREATE INDEX IF NOT EXISTS idx_code_mappings_proveedor ON silver_finance.code_mappings(codigo_proveedor, proveedor);

ALTER TABLE silver_finance.code_mappings ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "Allow all for treasury tools" ON silver_finance.code_mappings
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
