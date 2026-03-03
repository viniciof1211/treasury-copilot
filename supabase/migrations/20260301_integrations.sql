-- ══════════════════════════════════════════════════════════════════════════════
-- M12 Integrations: Bank API, Hacienda e-Invoice, PcGraf Write-back, Full Sync
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Integration Connections — stores API credentials & config per integration
CREATE TABLE IF NOT EXISTS tms.integration_connections (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  provider        text NOT NULL,                -- 'bac', 'bn', 'bcr', 'hacienda_atv', 'almamater', 'pcgraf'
  display_name    text NOT NULL,                -- 'BAC San José', 'Banco Nacional', etc.
  category        text NOT NULL,                -- 'bank_api', 'einvoice', 'erp_writeback'
  config          jsonb NOT NULL DEFAULT '{}',  -- credentials, endpoints, etc. (encrypted at rest by Supabase)
  status          text NOT NULL DEFAULT 'disconnected', -- 'connected', 'disconnected', 'error', 'pending_setup'
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_error      text,
  enabled         boolean DEFAULT false,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (provider)
);

-- 2. Bank Accounts — real bank accounts linked to connections
CREATE TABLE IF NOT EXISTS tms.bank_accounts (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id   uuid REFERENCES tms.integration_connections(id),
  bank_name       text NOT NULL,
  account_number  text NOT NULL,                -- masked: ****1234
  account_raw     text,                         -- full number (encrypted)
  currency        text NOT NULL DEFAULT 'CRC',
  account_type    text NOT NULL DEFAULT 'corriente', -- corriente, ahorro, inversion
  iban            text,
  sinpe_number    text,
  balance         numeric(18,2),
  balance_date    timestamptz,
  api_type        text DEFAULT 'manual',        -- 'sinpe_api', 'sftp_mt940', 'web_scraping', 'manual'
  status          text DEFAULT 'active',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (bank_name, account_number)
);

-- 3. Bank Transactions — imported from bank statements or API
CREATE TABLE IF NOT EXISTS tms.bank_transactions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id      uuid REFERENCES tms.bank_accounts(id),
  txn_date        date NOT NULL,
  value_date      date,
  description     text,
  reference       text,
  debit           numeric(18,2) DEFAULT 0,
  credit          numeric(18,2) DEFAULT 0,
  balance_after   numeric(18,2),
  currency        text DEFAULT 'CRC',
  category        text,                         -- auto-classified
  matched         boolean DEFAULT false,        -- matched to CxP/CxC
  matched_entity  text,                         -- 'cxp_items', 'flujo_semanal', etc.
  matched_id      text,
  import_batch    text,                         -- batch ID for statement import
  source          text DEFAULT 'manual',        -- 'api', 'mt940', 'csv', 'manual'
  created_at      timestamptz DEFAULT now()
);

-- 4. E-Invoice Submissions — tracks Hacienda ATV submissions via Almamater
CREATE TABLE IF NOT EXISTS tms.einvoice_submissions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  numero_factura  text NOT NULL,
  tipo_documento  text DEFAULT '01',            -- 01=FE, 02=ND, 03=NC, 04=Tiquete, 08=Compra, 09=Gasto
  clave_numerica  text,                         -- 50-digit Hacienda key
  consecutivo     text,
  emisor_cedula   text,
  emisor_nombre   text,
  receptor_cedula text,
  receptor_nombre text,
  total           numeric(18,2) NOT NULL,
  currency        text DEFAULT 'CRC',
  fecha_emision   timestamptz,
  -- Almamater fields
  almamater_ref   text,
  almamater_status text DEFAULT 'pending',      -- 'pending', 'submitted', 'accepted', 'rejected', 'error'
  -- Hacienda fields
  hacienda_status text DEFAULT 'pending',       -- 'pending', 'enviado', 'aceptado', 'rechazado'
  hacienda_mensaje text,
  hacienda_xml_req text,                        -- stored XML request
  hacienda_xml_res text,                        -- stored XML response
  submitted_at    timestamptz,
  accepted_at     timestamptz,
  empresa         text,
  source_table    text DEFAULT 'tms.facturas',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 5. PcGraf Write-back Queue — records pending push to ERP
CREATE TABLE IF NOT EXISTS tms.writeback_queue (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  entity          text NOT NULL,                -- 'clientes', 'productos', 'proveedores', etc.
  pcgraf_table    text NOT NULL,                -- 'FA20', 'IN04', 'IN13', etc.
  record_id       text NOT NULL,                -- PK of the Supabase record
  direction       text DEFAULT 'supabase_to_pcgraf',
  operation       text NOT NULL,                -- 'INSERT', 'UPDATE', 'DELETE'
  old_data        jsonb,
  new_data        jsonb NOT NULL,
  status          text DEFAULT 'pending',       -- 'pending', 'approved', 'pushed', 'failed', 'rejected'
  approved_by     text,
  approved_at     timestamptz,
  pushed_at       timestamptz,
  error_message   text,
  retry_count     integer DEFAULT 0,
  created_by      text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- 6. Sync Jobs — orchestration log for all sync operations
CREATE TABLE IF NOT EXISTS tms.sync_jobs (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  integration     text NOT NULL,                -- 'bank_bac', 'bank_bn', 'einvoice_almamater', 'pcgraf_cdc', 'pcgraf_writeback', 'full_sync'
  job_type        text NOT NULL,                -- 'manual', 'scheduled', 'webhook', 'cdc'
  status          text DEFAULT 'running',       -- 'running', 'completed', 'failed', 'cancelled'
  started_at      timestamptz DEFAULT now(),
  completed_at    timestamptz,
  duration_ms     integer,
  rows_processed  integer DEFAULT 0,
  rows_created    integer DEFAULT 0,
  rows_updated    integer DEFAULT 0,
  rows_failed     integer DEFAULT 0,
  error_message   text,
  details         jsonb DEFAULT '{}',
  triggered_by    text DEFAULT 'system',
  created_at      timestamptz DEFAULT now()
);

-- 7. Sync Schedule — cron-like schedule for automated syncs
CREATE TABLE IF NOT EXISTS tms.sync_schedule (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  integration     text NOT NULL UNIQUE,
  enabled         boolean DEFAULT false,
  interval_minutes integer DEFAULT 60,
  last_run_at     timestamptz,
  next_run_at     timestamptz,
  last_status     text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Seed default integration connections
INSERT INTO tms.integration_connections (provider, display_name, category, config, status) VALUES
  ('bac',            'BAC San José',              'bank_api',       '{"api_type": "sftp_mt940", "host": "", "port": 22}', 'disconnected'),
  ('bn',             'Banco Nacional',            'bank_api',       '{"api_type": "sinpe_api", "endpoint": ""}', 'disconnected'),
  ('bcr',            'Banco de Costa Rica',       'bank_api',       '{"api_type": "web_scraping", "url": ""}', 'disconnected'),
  ('hacienda_atv',   'Hacienda ATV (Directo)',    'einvoice',       '{"endpoint": "https://api.comprobanteselectronicos.go.cr/recepcion/v1", "env": "production"}', 'disconnected'),
  ('almamater',      'Almamater E-Factura',       'einvoice',       '{"endpoint": "", "api_key": ""}', 'disconnected'),
  ('pcgraf',         'PcGraf ERP (SQL Server)',    'erp_writeback',  '{"host": "192.168.1.3", "user": "vflores", "database": "siawin0"}', 'disconnected')
ON CONFLICT (provider) DO NOTHING;

-- Seed default sync schedules
INSERT INTO tms.sync_schedule (integration, enabled, interval_minutes) VALUES
  ('bank_bac',             false, 60),
  ('bank_bn',              false, 60),
  ('bank_bcr',             false, 120),
  ('einvoice_almamater',   false, 30),
  ('pcgraf_cdc',           true,  5),
  ('pcgraf_writeback',     false, 15),
  ('full_sync',            false, 240)
ON CONFLICT (integration) DO NOTHING;

-- RLS
ALTER TABLE tms.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE tms.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tms.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tms.einvoice_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tms.writeback_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE tms.sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tms.sync_schedule ENABLE ROW LEVEL SECURITY;

-- Open policies (service-role for backend, anon for dashboard reads)
CREATE POLICY "read_all" ON tms.integration_connections FOR SELECT USING (true);
CREATE POLICY "write_all" ON tms.integration_connections FOR ALL USING (true);
CREATE POLICY "read_all" ON tms.bank_accounts FOR SELECT USING (true);
CREATE POLICY "write_all" ON tms.bank_accounts FOR ALL USING (true);
CREATE POLICY "read_all" ON tms.bank_transactions FOR SELECT USING (true);
CREATE POLICY "write_all" ON tms.bank_transactions FOR ALL USING (true);
CREATE POLICY "read_all" ON tms.einvoice_submissions FOR SELECT USING (true);
CREATE POLICY "write_all" ON tms.einvoice_submissions FOR ALL USING (true);
CREATE POLICY "read_all" ON tms.writeback_queue FOR SELECT USING (true);
CREATE POLICY "write_all" ON tms.writeback_queue FOR ALL USING (true);
CREATE POLICY "read_all" ON tms.sync_jobs FOR SELECT USING (true);
CREATE POLICY "write_all" ON tms.sync_jobs FOR ALL USING (true);
CREATE POLICY "read_all" ON tms.sync_schedule FOR SELECT USING (true);
CREATE POLICY "write_all" ON tms.sync_schedule FOR ALL USING (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_bank_txn_account ON tms.bank_transactions(account_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_einvoice_factura ON tms.einvoice_submissions(numero_factura);
CREATE INDEX IF NOT EXISTS idx_einvoice_status ON tms.einvoice_submissions(almamater_status);
CREATE INDEX IF NOT EXISTS idx_wb_status ON tms.writeback_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_jobs_integration ON tms.sync_jobs(integration, started_at DESC);
