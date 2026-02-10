/*
  MRP / Compras Schema — silver_finance.mrp_master
  Stores consolidated MRP Planning data for Purchases module.
  Columns aligned with "MRP Planning V2" Excel workbook structure.
*/

-- Silver: MRP Master (consolidated purchasing & inventory data)
CREATE TABLE IF NOT EXISTS silver_finance.mrp_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_run_id uuid REFERENCES bronze_finance.ingest_runs(id),

  -- Item identity
  codigo text,
  descripcion text,
  abc_class text,                    -- A, B, C
  tipo_stock text,                   -- MTS (Make-to-Stock), MTO (Make-to-Order)
  comprador text,                    -- Buyer name
  tipo_item text,                    -- Importado, Local, Sin Definir

  -- Supplier / logistics
  proveedor text,
  lead_time_dias numeric DEFAULT 0,  -- Supplier lead time in days
  origen text,                       -- Europa, Asia, Local, America, etc.
  dificultad_logistica numeric DEFAULT 0,  -- 0-10 score
  compra_minima numeric DEFAULT 0,
  unidad_medida text,                -- UNIDADES, METROS, M2, KILOS, etc.

  -- Consumption history (8 months rolling)
  consumo_m1 numeric DEFAULT 0,
  consumo_m2 numeric DEFAULT 0,
  consumo_m3 numeric DEFAULT 0,
  consumo_m4 numeric DEFAULT 0,
  consumo_m5 numeric DEFAULT 0,
  consumo_m6 numeric DEFAULT 0,
  consumo_m7 numeric DEFAULT 0,
  consumo_m8 numeric DEFAULT 0,
  consumo_promedio numeric DEFAULT 0,
  consumo_diario numeric DEFAULT 0,  -- consumo_promedio / 25
  desv_estandar numeric DEFAULT 0,

  -- Inventory
  inventario numeric DEFAULT 0,
  reserva numeric DEFAULT 0,
  inventario_disponible numeric DEFAULT 0,
  transito numeric DEFAULT 0,
  inventario_total numeric DEFAULT 0,
  dias_cobertura numeric DEFAULT 0,

  -- MRP Parameters
  minimo_inventario numeric DEFAULT 0,
  dias_stock numeric DEFAULT 0,
  stock_seguridad numeric DEFAULT 0,
  punto_reorden numeric DEFAULT 0,
  max_inventario numeric DEFAULT 0,

  -- Costs (USD)
  costo_unitario numeric DEFAULT 0,
  costo_inventario numeric DEFAULT 0,
  costo_inventario_transito numeric DEFAULT 0,
  costo_total_inventario numeric DEFAULT 0,
  costo_stock_seguridad numeric DEFAULT 0,
  costo_inv_min numeric DEFAULT 0,
  costo_inv_reorden numeric DEFAULT 0,
  costo_inv_max numeric DEFAULT 0,

  -- Alerts & Actions
  alerta_desabasto text,             -- 'Alerta' or null
  hacer_pedido text,                 -- 'Si' or 'No'
  cantidad_requerida numeric DEFAULT 0,
  analisis_parametros text,          -- 'Bajo Parametro', 'Dentro parametro', 'Sobre parametro'

  -- Classification & metadata
  familia text,
  infaltable text,                   -- 'Infaltable' flag
  descontinuado text,                -- 'X' flag
  subclasificacion text,             -- 'Critico'

  created_at timestamptz DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_mrp_master_codigo ON silver_finance.mrp_master(codigo);
CREATE INDEX idx_mrp_master_proveedor ON silver_finance.mrp_master(proveedor);
CREATE INDEX idx_mrp_master_abc ON silver_finance.mrp_master(abc_class);
CREATE INDEX idx_mrp_master_alerta ON silver_finance.mrp_master(alerta_desabasto);
CREATE INDEX idx_mrp_master_pedido ON silver_finance.mrp_master(hacer_pedido);
CREATE INDEX idx_mrp_master_ingest ON silver_finance.mrp_master(ingest_run_id);

-- RLS
ALTER TABLE silver_finance.mrp_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for treasury tools" ON silver_finance.mrp_master FOR ALL USING (true);
