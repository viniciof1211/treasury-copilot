-- ══════════════════════════════════════════════════════════════════════════════
-- TMS Phase 1 — Transactional Entities for Full Read/Write TMS
-- ══════════════════════════════════════════════════════════════════════════════
-- Adds 19 new entities to tms.* schema for:
--   - Project Finance (contratos, hitos)
--   - Debt Management (instruments, schedules)
--   - Cashflow Forecasting (forecasts, scenarios)
--   - Payment Processing (batches, instructions)
--   - Approval Workflows (workflows, steps)
--   - Bank Reconciliation (statements, lines, matches)
--   - FX Management (positions, hedges)
--   - System (business_rules, audit_log, notifications, report_templates)
-- ══════════════════════════════════════════════════════════════════════════════

-- Ensure tms schema exists (idempotent)
CREATE SCHEMA IF NOT EXISTS tms;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. PROJECT FINANCE
-- ══════════════════════════════════════════════════════════════════════════════

-- 1.1 Contratos (Project Contracts)
-- Source: doc/PROYECTOS/ContratosMain.xlsx + PcGraf HO00
CREATE TABLE IF NOT EXISTS tms.contratos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text,
  _synced_at          timestamptz,
  _cdc_seq            bigint DEFAULT 0,
  _curated            boolean DEFAULT false,
  _curated_by         text,
  _curated_at         timestamptz,
  -- Identity
  numero_contrato     text NOT NULL,
  nombre              text NOT NULL,
  descripcion         text,
  -- Parties
  cliente_id          uuid REFERENCES tms.clientes(id),
  codigo_cliente      text,
  nombre_cliente      text,
  area_comercial      text,
  vendedor            text,
  project_manager     text,
  -- Financials (USD)
  monto_contrato      numeric(18,4) DEFAULT 0,
  monto_facturado     numeric(18,4) DEFAULT 0,
  monto_cobrado       numeric(18,4) DEFAULT 0,
  monto_pendiente     numeric(18,4) GENERATED ALWAYS AS (monto_contrato - monto_facturado) STORED,
  saldo               numeric(18,4) GENERATED ALWAYS AS (monto_contrato - monto_cobrado) STORED,
  moneda              text DEFAULT 'USD',
  tipo_cambio         numeric(12,4) DEFAULT 1,
  -- Lifecycle
  estado              text DEFAULT 'propuesta'
    CHECK (estado IN ('propuesta','negociacion','firmado','en_ejecucion','cerrado','cancelado')),
  fecha_inicio        date,
  fecha_fin_estimada  date,
  fecha_fin_real      date,
  fecha_firma         date,
  -- Classification
  tipo_proyecto       text,
  categoria           text,
  empresa             text,
  -- Multi-tenancy / Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz,
  version             integer DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_contratos_numero ON tms.contratos(numero_contrato);
CREATE INDEX IF NOT EXISTS idx_contratos_cliente ON tms.contratos(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_contratos_estado ON tms.contratos(estado);
CREATE INDEX IF NOT EXISTS idx_contratos_empresa ON tms.contratos(empresa);
CREATE INDEX IF NOT EXISTS idx_contratos_deleted ON tms.contratos(deleted_at) WHERE deleted_at IS NULL;

-- 1.2 Hitos de Contrato (Contract Milestones / Billing Schedule)
-- Source: doc/PROYECTOS/ContratosMain.xlsx formulas N=L-M, P=L-O + PcGraf HO01/HO03/HO05
CREATE TABLE IF NOT EXISTS tms.hitos_contrato (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text,
  _synced_at          timestamptz,
  _cdc_seq            bigint DEFAULT 0,
  _curated            boolean DEFAULT false,
  _curated_by         text,
  _curated_at         timestamptz,
  -- Parent
  contrato_id         uuid NOT NULL REFERENCES tms.contratos(id) ON DELETE CASCADE,
  -- Identity
  numero_hito         integer NOT NULL,
  nombre              text NOT NULL,
  descripcion         text,
  -- Financials
  monto               numeric(18,4) DEFAULT 0,
  monto_facturado     numeric(18,4) DEFAULT 0,
  monto_cobrado       numeric(18,4) DEFAULT 0,
  moneda              text DEFAULT 'USD',
  -- BR-007: pendiente = monto - facturado
  pendiente           numeric(18,4) GENERATED ALWAYS AS (monto - monto_facturado) STORED,
  -- BR-008: saldo = monto - cobrado
  saldo               numeric(18,4) GENERATED ALWAYS AS (monto - monto_cobrado) STORED,
  -- Lifecycle
  estado              text DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','facturado','cobrado','cerrado','cancelado')),
  fecha_programada    date,
  fecha_facturacion   date,
  fecha_cobro         date,
  -- Reference
  factura_referencia  text,
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz,
  version             integer DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hitos_contrato ON tms.hitos_contrato(contrato_id);
CREATE INDEX IF NOT EXISTS idx_hitos_estado ON tms.hitos_contrato(estado);
CREATE INDEX IF NOT EXISTS idx_hitos_fecha ON tms.hitos_contrato(fecha_programada);

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. DEBT MANAGEMENT
-- ══════════════════════════════════════════════════════════════════════════════

-- 2.1 Debt Instruments (Loans, Credit Lines)
-- Source: doc/Flujo y Operaciones JD.xlsx → Operaciones sheet (203 formulas)
CREATE TABLE IF NOT EXISTS tms.debt_instruments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identity
  numero_operacion    text NOT NULL,
  nombre              text NOT NULL,
  descripcion         text,
  -- Classification
  tipo                text NOT NULL
    CHECK (tipo IN ('largo_plazo','capital_trabajo','linea_credito','arrendamiento','otro')),
  -- Parties
  banco               text NOT NULL,
  empresa             text NOT NULL,
  -- Terms
  moneda              text DEFAULT 'USD',
  monto_original      numeric(18,4) NOT NULL,
  -- BR-014: saldo_actual = monto_original - Σ(pagos principal)
  saldo_actual        numeric(18,4) NOT NULL,
  tasa_interes        numeric(8,4),
  tasa_tipo           text DEFAULT 'fija' CHECK (tasa_tipo IN ('fija','variable','mixta')),
  tasa_referencia     text,
  spread_bps          numeric(8,2) DEFAULT 0,
  fecha_desembolso    date,
  fecha_vencimiento   date NOT NULL,
  plazo_meses         integer,
  frecuencia_pago     text DEFAULT 'mensual'
    CHECK (frecuencia_pago IN ('semanal','quincenal','mensual','trimestral','semestral','anual','al_vencimiento')),
  -- State
  estado              text DEFAULT 'vigente'
    CHECK (estado IN ('aprobado','vigente','vencido','cancelado','reestructurado')),
  -- Covenants
  covenants           jsonb DEFAULT '[]',
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz,
  version             integer DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_debt_empresa ON tms.debt_instruments(empresa);
CREATE INDEX IF NOT EXISTS idx_debt_banco ON tms.debt_instruments(banco);
CREATE INDEX IF NOT EXISTS idx_debt_vencimiento ON tms.debt_instruments(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_debt_estado ON tms.debt_instruments(estado);

-- 2.2 Debt Schedules (Amortization Table)
-- BR-015: cuota = principal + intereses
CREATE TABLE IF NOT EXISTS tms.debt_schedules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrumento_id      uuid NOT NULL REFERENCES tms.debt_instruments(id) ON DELETE CASCADE,
  numero_cuota        integer NOT NULL,
  fecha_pago          date NOT NULL,
  principal           numeric(18,4) DEFAULT 0,
  intereses           numeric(18,4) DEFAULT 0,
  cuota               numeric(18,4) GENERATED ALWAYS AS (principal + intereses) STORED,
  saldo_despues       numeric(18,4) DEFAULT 0,
  -- State
  estado              text DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','pagado','vencido','parcial')),
  fecha_pago_real     date,
  monto_pagado        numeric(18,4) DEFAULT 0,
  referencia_pago     text,
  -- Audit
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_debt_sched_instrumento ON tms.debt_schedules(instrumento_id);
CREATE INDEX IF NOT EXISTS idx_debt_sched_fecha ON tms.debt_schedules(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_debt_sched_estado ON tms.debt_schedules(estado);

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CASHFLOW FORECASTING
-- ══════════════════════════════════════════════════════════════════════════════

-- 3.1 Cashflow Scenarios
-- Source: doc/Flujo por Unidad de Negocio.xlsx → Ejecutado/Proyectado toggle (BR-001, BR-020)
CREATE TABLE IF NOT EXISTS tms.cashflow_scenarios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              text NOT NULL,
  descripcion         text,
  tipo                text DEFAULT 'base'
    CHECK (tipo IN ('base','optimista','pesimista','stress','custom')),
  es_activo           boolean DEFAULT true,
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now()
);

-- Seed default scenario
INSERT INTO tms.cashflow_scenarios (nombre, descripcion, tipo)
VALUES ('Base', 'Escenario base — mezcla de ejecutado y proyectado', 'base')
ON CONFLICT DO NOTHING;

-- 3.2 Cashflow Forecast Entries
-- BR-001: Each entry is either "ejecutado" (actual) or "proyectado" (forecast)
CREATE TABLE IF NOT EXISTS tms.cashflow_forecast (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id         uuid REFERENCES tms.cashflow_scenarios(id) ON DELETE CASCADE,
  empresa             text NOT NULL,
  -- Period
  semana_inicio       date NOT NULL,
  semana_fin          date,
  -- BR-020: status drives real vs forecast
  status              text DEFAULT 'proyectado'
    CHECK (status IN ('ejecutado','proyectado')),
  -- Flows
  ingresos            numeric(18,4) DEFAULT 0,
  egresos             numeric(18,4) DEFAULT 0,
  flujo_neto          numeric(18,4) GENERATED ALWAYS AS (ingresos - egresos) STORED,
  saldo_acumulado     numeric(18,4) DEFAULT 0,
  -- Breakdown
  moneda              text DEFAULT 'USD',
  categoria           text,
  subcategoria        text,
  detalle             text,
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cf_scenario ON tms.cashflow_forecast(scenario_id);
CREATE INDEX IF NOT EXISTS idx_cf_empresa ON tms.cashflow_forecast(empresa);
CREATE INDEX IF NOT EXISTS idx_cf_semana ON tms.cashflow_forecast(semana_inicio);
CREATE INDEX IF NOT EXISTS idx_cf_status ON tms.cashflow_forecast(status);

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. PAYMENT PROCESSING
-- ══════════════════════════════════════════════════════════════════════════════

-- 4.1 Payment Batches
-- BR-002: Priority-driven payment scheduling
CREATE TABLE IF NOT EXISTS tms.payment_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              text NOT NULL,
  descripcion         text,
  fecha_pago          date NOT NULL,
  empresa             text NOT NULL,
  -- Totals
  total_items         integer DEFAULT 0,
  total_monto         numeric(18,4) DEFAULT 0,
  moneda              text DEFAULT 'USD',
  -- Lifecycle
  estado              text DEFAULT 'borrador'
    CHECK (estado IN ('borrador','pendiente_aprobacion','aprobado','rechazado',
                      'en_proceso','ejecutado','parcial','cancelado')),
  -- Approval
  aprobado_por        text,
  aprobado_at         timestamptz,
  rechazado_por       text,
  rechazado_at        timestamptz,
  motivo_rechazo      text,
  -- Audit
  created_by          text NOT NULL,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now(),
  deleted_at          timestamptz,
  version             integer DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_pb_fecha ON tms.payment_batches(fecha_pago);
CREATE INDEX IF NOT EXISTS idx_pb_estado ON tms.payment_batches(estado);
CREATE INDEX IF NOT EXISTS idx_pb_empresa ON tms.payment_batches(empresa);

-- 4.2 Payment Instructions (individual wire/SINPE payments)
CREATE TABLE IF NOT EXISTS tms.payment_instructions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            uuid REFERENCES tms.payment_batches(id) ON DELETE SET NULL,
  -- Payee
  proveedor_id        uuid REFERENCES tms.proveedores(id),
  codigo_proveedor    text,
  nombre_beneficiario text NOT NULL,
  -- Reference
  documento_cxp       text,
  cxp_id              uuid REFERENCES tms.cuentas_por_pagar(id),
  factura_referencia  text,
  -- Amount
  monto               numeric(18,4) NOT NULL,
  moneda              text DEFAULT 'USD',
  tipo_cambio         numeric(12,4) DEFAULT 1,
  -- Payment Method
  metodo_pago         text DEFAULT 'transferencia'
    CHECK (metodo_pago IN ('transferencia','sinpe','cheque','tarjeta','efectivo','otro')),
  banco_origen        text,
  cuenta_origen       text,
  banco_destino       text,
  cuenta_destino      text,
  -- BR-002: Priority
  prioridad           text DEFAULT '2'
    CHECK (prioridad IN ('1_urge','1','2','3','no_proceder')),
  -- State
  estado              text DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','aprobado','rechazado','ejecutado','fallido','cancelado')),
  fecha_ejecucion     timestamptz,
  referencia_bancaria text,
  -- Classification
  empresa             text,
  negocio             text,
  clasificacion       text,
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pi_batch ON tms.payment_instructions(batch_id);
CREATE INDEX IF NOT EXISTS idx_pi_proveedor ON tms.payment_instructions(codigo_proveedor);
CREATE INDEX IF NOT EXISTS idx_pi_estado ON tms.payment_instructions(estado);
CREATE INDEX IF NOT EXISTS idx_pi_prioridad ON tms.payment_instructions(prioridad);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. APPROVAL WORKFLOWS
-- ══════════════════════════════════════════════════════════════════════════════

-- 5.1 Approval Workflows (template definitions)
CREATE TABLE IF NOT EXISTS tms.approval_workflows (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              text NOT NULL,
  modulo              text NOT NULL,
  entity_type         text NOT NULL,
  descripcion         text,
  -- STP (Straight-Through Processing) rules
  stp_enabled         boolean DEFAULT false,
  stp_max_monto       numeric(18,4),
  stp_conditions      jsonb DEFAULT '{}',
  -- Chain definition
  pasos               jsonb NOT NULL DEFAULT '[]',
  -- e.g. [{"orden":1,"rol":"treasury_analyst","accion":"crear"},
  --       {"orden":2,"rol":"finance_manager","accion":"aprobar"}]
  es_activo           boolean DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Seed default workflows
INSERT INTO tms.approval_workflows (nombre, modulo, entity_type, descripcion, stp_enabled, stp_max_monto, pasos) VALUES
  ('Aprobación Pagos', 'cxp', 'payment_batch', 'Flujo de aprobación para lotes de pago', true, 500,
   '[{"orden":1,"rol":"treasury_analyst","accion":"crear"},{"orden":2,"rol":"finance_manager","accion":"aprobar"}]'),
  ('Aprobación Facturas', 'invoicing', 'invoice', 'Flujo para creación de facturas', false, null,
   '[{"orden":1,"rol":"treasury_analyst","accion":"crear"},{"orden":2,"rol":"finance_manager","accion":"aprobar"}]'),
  ('Aprobación Contratos', 'projects', 'contract', 'Flujo para nuevos contratos', false, null,
   '[{"orden":1,"rol":"treasury_analyst","accion":"crear"},{"orden":2,"rol":"finance_manager","accion":"aprobar"}]')
ON CONFLICT DO NOTHING;

-- 5.2 Approval Steps (actual approval/rejection actions)
CREATE TABLE IF NOT EXISTS tms.approval_steps (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id         uuid NOT NULL REFERENCES tms.approval_workflows(id),
  -- What is being approved
  entity_type         text NOT NULL,
  entity_id           uuid NOT NULL,
  -- Step info
  paso_numero         integer NOT NULL,
  -- Action
  accion              text NOT NULL
    CHECK (accion IN ('aprobar','rechazar','devolver','escalar')),
  comentario          text,
  -- Who
  usuario_id          text NOT NULL,
  usuario_nombre      text,
  rol                 text,
  -- When
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_entity ON tms.approval_steps(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_approval_workflow ON tms.approval_steps(workflow_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. BANK RECONCILIATION
-- ══════════════════════════════════════════════════════════════════════════════

-- 6.1 Bank Statements (imported statement headers)
CREATE TABLE IF NOT EXISTS tms.bank_statements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_bancaria     text NOT NULL,
  banco               text NOT NULL,
  fecha_inicio        date NOT NULL,
  fecha_fin           date NOT NULL,
  saldo_inicial       numeric(18,4) DEFAULT 0,
  saldo_final         numeric(18,4) DEFAULT 0,
  total_debitos       numeric(18,4) DEFAULT 0,
  total_creditos      numeric(18,4) DEFAULT 0,
  moneda              text DEFAULT 'USD',
  -- Import info
  archivo_origen      text,
  formato             text DEFAULT 'csv'
    CHECK (formato IN ('csv','mt940','bai2','ofx','api','manual')),
  total_lineas        integer DEFAULT 0,
  lineas_conciliadas  integer DEFAULT 0,
  -- State
  estado              text DEFAULT 'importado'
    CHECK (estado IN ('importado','en_proceso','conciliado','cerrado')),
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bs_cuenta ON tms.bank_statements(cuenta_bancaria);
CREATE INDEX IF NOT EXISTS idx_bs_fecha ON tms.bank_statements(fecha_inicio);

-- 6.2 Bank Statement Lines (individual bank transactions)
CREATE TABLE IF NOT EXISTS tms.bank_statement_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id        uuid NOT NULL REFERENCES tms.bank_statements(id) ON DELETE CASCADE,
  -- Transaction
  fecha               date NOT NULL,
  fecha_valor         date,
  descripcion         text,
  referencia          text,
  monto               numeric(18,4) NOT NULL,
  tipo                text CHECK (tipo IN ('debito','credito')),
  saldo_despues       numeric(18,4),
  -- Matching
  conciliado          boolean DEFAULT false,
  match_id            uuid,
  match_confidence    numeric(5,2),
  -- Audit
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bsl_statement ON tms.bank_statement_lines(statement_id);
CREATE INDEX IF NOT EXISTS idx_bsl_fecha ON tms.bank_statement_lines(fecha);
CREATE INDEX IF NOT EXISTS idx_bsl_conciliado ON tms.bank_statement_lines(conciliado) WHERE NOT conciliado;

-- 6.3 Reconciliation Matches (bank txn ↔ ERP txn)
CREATE TABLE IF NOT EXISTS tms.recon_matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_line_id        uuid NOT NULL REFERENCES tms.bank_statement_lines(id),
  -- What it matched to
  matched_entity_type text NOT NULL,
  matched_entity_id   uuid NOT NULL,
  -- Quality
  match_type          text DEFAULT 'manual'
    CHECK (match_type IN ('auto_exact','auto_fuzzy','ai_suggested','manual')),
  confidence          numeric(5,2) DEFAULT 100,
  -- State
  estado              text DEFAULT 'propuesto'
    CHECK (estado IN ('propuesto','confirmado','rechazado')),
  -- Audit
  confirmado_por      text,
  confirmado_at       timestamptz,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recon_bank ON tms.recon_matches(bank_line_id);
CREATE INDEX IF NOT EXISTS idx_recon_entity ON tms.recon_matches(matched_entity_type, matched_entity_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. FX MANAGEMENT
-- ══════════════════════════════════════════════════════════════════════════════

-- 7.1 FX Positions (open currency exposure)
-- BR-016: exposure = Σ(USD AR) - Σ(USD AP) - Σ(USD debt)
CREATE TABLE IF NOT EXISTS tms.fx_positions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa             text NOT NULL,
  moneda_base         text DEFAULT 'CRC',
  moneda_exposicion   text DEFAULT 'USD',
  fecha_calculo       date NOT NULL,
  -- Position breakdown
  cxc_usd             numeric(18,4) DEFAULT 0,
  cxp_usd             numeric(18,4) DEFAULT 0,
  deuda_usd           numeric(18,4) DEFAULT 0,
  efectivo_usd        numeric(18,4) DEFAULT 0,
  exposicion_neta     numeric(18,4) GENERATED ALWAYS AS (cxc_usd - cxp_usd - deuda_usd + efectivo_usd) STORED,
  -- FX rate at calc time
  tipo_cambio_compra  numeric(12,4),
  tipo_cambio_venta   numeric(12,4),
  -- Equivalent in base currency
  exposicion_crc      numeric(18,4) DEFAULT 0,
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fx_empresa ON tms.fx_positions(empresa);
CREATE INDEX IF NOT EXISTS idx_fx_fecha ON tms.fx_positions(fecha_calculo);

-- 7.2 FX Hedges (forwards, options)
CREATE TABLE IF NOT EXISTS tms.fx_hedges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa             text NOT NULL,
  -- Instrument
  tipo                text NOT NULL
    CHECK (tipo IN ('forward','opcion_call','opcion_put','swap','ndf','collar')),
  contraparte         text NOT NULL,
  -- Terms
  moneda_compra       text NOT NULL,
  moneda_venta        text NOT NULL,
  monto_nocional      numeric(18,4) NOT NULL,
  tasa_pactada        numeric(12,4) NOT NULL,
  fecha_inicio        date NOT NULL,
  fecha_vencimiento   date NOT NULL,
  -- Valuation
  tasa_mercado        numeric(12,4),
  valor_mark_to_market numeric(18,4) DEFAULT 0,
  -- State
  estado              text DEFAULT 'vigente'
    CHECK (estado IN ('propuesto','vigente','vencido','liquidado','cancelado')),
  fecha_liquidacion   date,
  resultado           numeric(18,4),
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now(),
  version             integer DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_hedge_empresa ON tms.fx_hedges(empresa);
CREATE INDEX IF NOT EXISTS idx_hedge_vencimiento ON tms.fx_hedges(fecha_vencimiento);
CREATE INDEX IF NOT EXISTS idx_hedge_estado ON tms.fx_hedges(estado);

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. SYSTEM TABLES
-- ══════════════════════════════════════════════════════════════════════════════

-- 8.1 Business Rules (configurable thresholds and formulas)
CREATE TABLE IF NOT EXISTS tms.business_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id             text NOT NULL UNIQUE,
  modulo              text NOT NULL,
  nombre              text NOT NULL,
  descripcion         text,
  -- Rule definition
  condicion           jsonb NOT NULL DEFAULT '{}',
  accion              jsonb NOT NULL DEFAULT '{}',
  -- Control
  es_activo           boolean DEFAULT true,
  prioridad           integer DEFAULT 100,
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now()
);

-- Seed business rules from ARCHITECTURE.md Section 6.1
INSERT INTO tms.business_rules (rule_id, modulo, nombre, descripcion, condicion, accion) VALUES
  ('BR-001', 'cash',     'Estado Semana Flujo',       'Week status toggle: Ejecutado vs Proyectado',
   '{"field":"status","values":["ejecutado","proyectado"]}',
   '{"set_label":"IF status=ejecutado THEN Real ELSE Proyectado"}'),
  ('BR-002', 'cxp',      'Prioridad Pago',            '1 URGE → immediate, 1 → this cycle, 2 → next, No Proceder → hold',
   '{"field":"prioridad","mapping":{"1_urge":"immediate","1":"this_cycle","2":"next_cycle","no_proceder":"hold"}}',
   '{"schedule":"payment_cycle_based"}'),
  ('BR-003', 'cxp',      'Asignación BU Default',     'Default 25% per BU allocation',
   '{"applies_to":"all_bus"}',
   '{"allocation_pct":25}'),
  ('BR-009', 'mrp',      'Clasificación ABC',         'A < 80% acumulado, B < 95%, C = resto',
   '{"thresholds":{"A":80,"B":95,"C":100}}',
   '{"set_field":"abc_class"}'),
  ('BR-010', 'mrp',      'Punto de Reorden',          'ROP = (consumo_diario × lead_time) + safety_stock',
   '{"formula":"(consumo_diario * lead_time_dias) + stock_seguridad"}',
   '{"set_field":"punto_reorden"}'),
  ('BR-011', 'mrp',      'Stock de Seguridad',        'SS = 1.65 × σ × √(lead_time)',
   '{"formula":"1.65 * desv_estandar * sqrt(lead_time_dias)","service_level":0.95}',
   '{"set_field":"stock_seguridad"}'),
  ('BR-013', 'mrp',      'Alerta Desabasto',          'Trigger when días_cobertura < lead_time_dias',
   '{"condition":"dias_cobertura < lead_time_dias"}',
   '{"set_field":"alerta_desabasto","value":"Alerta"}'),
  ('BR-018', 'cxc',      'Depuración Cartera',        'Batch purge > 90 days; RT purge > 60 days',
   '{"batch_threshold_days":90,"rt_threshold_days":60}',
   '{"action":"purge","target":"cxc_items"}')
ON CONFLICT (rule_id) DO NOTHING;

-- 8.2 Audit Log (immutable transaction trail)
CREATE TABLE IF NOT EXISTS tms.audit_log (
  id                  bigserial PRIMARY KEY,
  timestamp           timestamptz DEFAULT now(),
  -- Who
  user_id             text,
  user_name           text,
  user_role           text,
  ip_address          text,
  -- What
  action              text NOT NULL
    CHECK (action IN ('CREATE','UPDATE','DELETE','APPROVE','REJECT','RETURN','EXECUTE','LOGIN','EXPORT')),
  entity_type         text NOT NULL,
  entity_id           text,
  -- Changes
  old_values          jsonb,
  new_values          jsonb,
  -- Context
  modulo              text,
  workflow_id         uuid,
  approval_step_id    uuid,
  metadata            jsonb DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON tms.audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON tms.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON tms.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON tms.audit_log(action);

-- 8.3 Notifications
CREATE TABLE IF NOT EXISTS tms.notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Target
  user_id             text NOT NULL,
  -- Content
  titulo              text NOT NULL,
  mensaje             text NOT NULL,
  tipo                text DEFAULT 'info'
    CHECK (tipo IN ('info','warning','error','success','approval_required')),
  -- Reference
  modulo              text,
  entity_type         text,
  entity_id           text,
  action_url          text,
  -- State
  leido               boolean DEFAULT false,
  leido_at            timestamptz,
  -- Audit
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_user ON tms.notifications(user_id, leido);
CREATE INDEX IF NOT EXISTS idx_notif_created ON tms.notifications(created_at);

-- 8.4 Report Templates
CREATE TABLE IF NOT EXISTS tms.report_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre              text NOT NULL,
  descripcion         text,
  modulo              text NOT NULL,
  tipo                text DEFAULT 'dashboard'
    CHECK (tipo IN ('dashboard','pdf','excel','email','slide')),
  -- Definition
  config              jsonb NOT NULL DEFAULT '{}',
  -- Scheduling
  programado          boolean DEFAULT false,
  cron_expression     text,
  destinatarios       text[],
  -- Audit
  created_by          text,
  created_at          timestamptz DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. UPDATE TABLE REGISTRY with new entities
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO tms.table_registry (sql_table_name, entity_name, display_name, erp_module, description, pk_columns_erp, supabase_table, cdc_enabled) VALUES
  ('_contratos',            'contratos',            'Contratos de Proyecto',         'Proyectos',    'Contratos con clientes para proyectos',                    ARRAY[]::text[], 'tms.contratos',            false),
  ('_hitos_contrato',       'hitos_contrato',       'Hitos de Contrato',             'Proyectos',    'Hitos de facturación y cobro por contrato',                ARRAY[]::text[], 'tms.hitos_contrato',       false),
  ('_debt_instruments',     'debt_instruments',     'Instrumentos de Deuda',         'Tesorería',    'Préstamos, líneas de crédito, arrendamientos',             ARRAY[]::text[], 'tms.debt_instruments',     false),
  ('_debt_schedules',       'debt_schedules',       'Tablas de Amortización',        'Tesorería',    'Calendario de pagos por instrumento de deuda',             ARRAY[]::text[], 'tms.debt_schedules',       false),
  ('_cashflow_scenarios',   'cashflow_scenarios',   'Escenarios de Flujo',           'Tesorería',    'Contenedores de escenarios what-if',                       ARRAY[]::text[], 'tms.cashflow_scenarios',   false),
  ('_cashflow_forecast',    'cashflow_forecast',    'Pronóstico de Flujo',           'Tesorería',    'Entradas semanales de flujo (ejecutado + proyectado)',      ARRAY[]::text[], 'tms.cashflow_forecast',    false),
  ('_payment_batches',      'payment_batches',      'Lotes de Pago',                 'CxP',          'Agrupación de pagos para aprobación y ejecución',          ARRAY[]::text[], 'tms.payment_batches',      false),
  ('_payment_instructions', 'payment_instructions', 'Instrucciones de Pago',         'CxP',          'Pagos individuales (transferencia, SINPE, cheque)',         ARRAY[]::text[], 'tms.payment_instructions', false),
  ('_approval_workflows',   'approval_workflows',   'Flujos de Aprobación',          'Sistema',      'Definiciones de cadenas de aprobación maker-checker',      ARRAY[]::text[], 'tms.approval_workflows',   false),
  ('_approval_steps',       'approval_steps',       'Pasos de Aprobación',           'Sistema',      'Acciones individuales de aprobación/rechazo',              ARRAY[]::text[], 'tms.approval_steps',       false),
  ('_bank_statements',      'bank_statements',      'Estados de Cuenta Bancarios',   'Bancos',       'Encabezados de estados de cuenta importados',              ARRAY[]::text[], 'tms.bank_statements',      false),
  ('_bank_statement_lines', 'bank_statement_lines', 'Líneas Estado Cuenta',          'Bancos',       'Transacciones individuales de estados de cuenta',          ARRAY[]::text[], 'tms.bank_statement_lines', false),
  ('_recon_matches',        'recon_matches',        'Conciliaciones',                'Bancos',       'Matches entre transacciones bancarias y ERP',              ARRAY[]::text[], 'tms.recon_matches',        false),
  ('_fx_positions',         'fx_positions',         'Posiciones FX',                 'FX',           'Exposición neta de divisas por empresa',                   ARRAY[]::text[], 'tms.fx_positions',         false),
  ('_fx_hedges',            'fx_hedges',            'Coberturas FX',                 'FX',           'Forwards, opciones y otros derivados de cobertura',        ARRAY[]::text[], 'tms.fx_hedges',            false),
  ('_business_rules',       'business_rules',       'Reglas de Negocio',             'Sistema',      'Reglas configurables de umbral y fórmula',                 ARRAY[]::text[], 'tms.business_rules',       false),
  ('_audit_log',            'audit_log',            'Log de Auditoría',              'Sistema',      'Registro inmutable de todas las transacciones',            ARRAY[]::text[], 'tms.audit_log',            false),
  ('_notifications',        'notifications',        'Notificaciones',                'Sistema',      'Cola de notificaciones para usuarios',                     ARRAY[]::text[], 'tms.notifications',        false),
  ('_report_templates',     'report_templates',     'Plantillas de Reportes',        'Sistema',      'Configuraciones de reportes guardadas',                    ARRAY[]::text[], 'tms.report_templates',     false)
ON CONFLICT (sql_table_name) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════════
-- 10. RLS — enable on all new tables, allow full access for service role
-- ══════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  tbl text;
  new_tables text[] := ARRAY[
    'contratos','hitos_contrato','debt_instruments','debt_schedules',
    'cashflow_scenarios','cashflow_forecast','payment_batches','payment_instructions',
    'approval_workflows','approval_steps','bank_statements','bank_statement_lines',
    'recon_matches','fx_positions','fx_hedges','business_rules','audit_log',
    'notifications','report_templates'
  ];
BEGIN
  FOREACH tbl IN ARRAY new_tables LOOP
    EXECUTE format('ALTER TABLE tms.%I ENABLE ROW LEVEL SECURITY', tbl);
    BEGIN
      EXECUTE format(
        'CREATE POLICY "Allow all for service role" ON tms.%I FOR ALL USING (true) WITH CHECK (true)',
        tbl
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- Grant access to PostgREST roles
DO $$
BEGIN
  EXECUTE 'GRANT USAGE ON SCHEMA tms TO anon, authenticated, service_role';
  EXECUTE 'GRANT ALL ON ALL TABLES IN SCHEMA tms TO anon, authenticated, service_role';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA tms TO anon, authenticated, service_role';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Expose tms schema via PostgREST
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    EXECUTE 'ALTER ROLE authenticator SET pgrst.db_schemas = ''public, bronze_finance, silver_finance, dim, tms''';
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
