-- ══════════════════════════════════════════════════════════════════════════════
-- TMS Canonical Data Model — Supabase mirror of PcGraf siawin0 ERP
-- ══════════════════════════════════════════════════════════════════════════════
-- Design principles:
--   1. Each ERP table has a canonical Supabase counterpart with human-readable name
--   2. All tables have proper PKs, FKs, column types, and indexes
--   3. Curation happens HERE; push-to-PcGraf is optional and explicit
--   4. CDC watermarks track last-synced state per table
--   5. Every row carries _pcgraf_pk (original PK), _synced_at, _cdc_seq
-- ══════════════════════════════════════════════════════════════════════════════

-- Schema for the canonical TMS data model
CREATE SCHEMA IF NOT EXISTS tms;

-- ──────────────────────────────────────────────────────────────────────────────
-- 0. TABLE REGISTRY — maps SQL tech table name ↔ business-readable entity name
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.table_registry (
  id              serial PRIMARY KEY,
  sql_table_name  text NOT NULL UNIQUE,          -- e.g. 'IN04'
  entity_name     text NOT NULL,                 -- e.g. 'productos'
  display_name    text NOT NULL,                 -- e.g. 'Productos / Artículos'
  erp_module      text NOT NULL,                 -- e.g. 'Inventario'
  description     text,
  row_count_erp   integer DEFAULT 0,
  col_count_erp   integer DEFAULT 0,
  pk_columns_erp  text[],                        -- original PK column names in SQL Server
  supabase_table  text,                          -- e.g. 'tms.productos'
  kafka_topic     text,                          -- e.g. 'siawin0.IN04'
  cdc_enabled     boolean DEFAULT true,
  last_cdc_at     timestamptz,
  last_cdc_seq    bigint DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Seed the registry with all key ERP tables
INSERT INTO tms.table_registry (sql_table_name, entity_name, display_name, erp_module, description, pk_columns_erp, supabase_table, kafka_topic) VALUES
  -- ── Inventario ──
  ('IN04',  'productos',              'Productos / Artículos',           'Inventario',  'Maestro de productos con 213+ atributos: costos, precios, clasificación, proveedores, parámetros MRP', ARRAY['sCodigo'], 'tms.productos', 'siawin0.IN04'),
  ('IN11',  'movimientos_inventario', 'Movimientos de Inventario',       'Inventario',  'Entradas, salidas, ajustes, transferencias de inventario',                                              ARRAY['sConsecutivo'], 'tms.movimientos_inventario', 'siawin0.IN11'),
  ('IN13',  'proveedores',            'Proveedores',                     'Inventario',  'Maestro de proveedores con datos de contacto, condiciones, moneda',                                     ARRAY['sCodigo'], 'tms.proveedores', 'siawin0.IN13'),
  ('IN14',  'inventario_bodega',      'Inventario por Bodega',           'Inventario',  'Saldos de inventario por producto y bodega',                                                            ARRAY['sLlave'], 'tms.inventario_bodega', 'siawin0.IN14'),
  ('IN16',  'kardex',                 'Kardex / Detalle Movimientos',    'Inventario',  'Detalle de cada movimiento de inventario (kardex)',                                                      ARRAY['sLlave'], 'tms.kardex', 'siawin0.IN16'),
  ('IN19',  'listas_precios',         'Listas de Precios',               'Inventario',  'Precios por producto, lista, moneda',                                                                   ARRAY['sLlave'], 'tms.listas_precios', 'siawin0.IN19'),
  ('IN34',  'transacciones_inv',      'Transacciones Inventario',        'Inventario',  'Registro masivo de transacciones de inventario (40M+ filas)',                                            ARRAY['sLlave'], 'tms.transacciones_inv', 'siawin0.IN34'),
  ('IN42',  'ordenes_compra_inv',     'Órdenes de Compra (Inv)',         'Inventario',  'Órdenes de compra desde módulo de inventario',                                                          ARRAY['sOrden','iLinea'], 'tms.ordenes_compra_inv', 'siawin0.IN42'),
  ('IN51',  'lotes',                  'Lotes / Series',                  'Inventario',  'Control de lotes y números de serie',                                                                   ARRAY['sLlave'], 'tms.lotes', 'siawin0.IN51'),
  ('IN62',  'cambios_estado_prod',    'Cambios de Estado Producto',      'Inventario',  'Historial de cambios de estado de productos por bodega',                                                 ARRAY[]::text[], 'tms.cambios_estado_prod', 'siawin0.IN62'),
  ('IN64',  'bodegas',                'Bodegas / Almacenes',             'Inventario',  'Catálogo de bodegas y ubicaciones',                                                                     ARRAY['sCodigo'], 'tms.bodegas', 'siawin0.IN64'),
  ('IN74',  'familias_producto',      'Familias de Producto',            'Inventario',  'Clasificación jerárquica de familias/grupos de productos',                                              ARRAY['sCodigo'], 'tms.familias_producto', 'siawin0.IN74'),
  ('IN80',  'condiciones_compra',     'Condiciones de Compra',           'Inventario',  'Condiciones y contactos por proveedor/OC',                                                              ARRAY['sLlave'], 'tms.condiciones_compra', 'siawin0.IN80'),
  ('IN97',  'historico_costos',       'Histórico de Costos',             'Inventario',  'Historial de costos unitarios por producto y periodo',                                                   ARRAY['sLlave'], 'tms.historico_costos', 'siawin0.IN97'),
  -- ── Facturación / Ventas ──
  ('FA01',  'lineas_factura',         'Líneas de Factura',               'Facturación', 'Detalle de líneas por factura/pedido: producto, cantidad, precio, descuento',                            ARRAY['sPedido','iLinea'], 'tms.lineas_factura', 'siawin0.FA01'),
  ('FA12',  'facturas',               'Facturas (Cabecera)',             'Facturación', 'Cabecera de facturas: cliente, fecha, totales, estado',                                                  ARRAY['sPedido'], 'tms.facturas', 'siawin0.FA12'),
  ('FA20',  'clientes',               'Clientes',                        'Facturación', 'Maestro de clientes con datos fiscales, contacto, crédito',                                             ARRAY['sCodigo'], 'tms.clientes', 'siawin0.FA20'),
  ('FA25',  'recibos_caja',           'Recibos de Caja',                 'Facturación', 'Recibos de caja y pagos recibidos',                                                                     ARRAY['sRecibo'], 'tms.recibos_caja', 'siawin0.FA25'),
  ('FA47',  'vendedores',             'Vendedores',                      'Facturación', 'Catálogo de vendedores y comisiones',                                                                   ARRAY['sCodigo'], 'tms.vendedores', 'siawin0.FA47'),
  ('FA50',  'notas_credito',          'Notas de Crédito/Débito',         'Facturación', 'Notas de crédito y débito sobre facturas',                                                              ARRAY['sNota'], 'tms.notas_credito', 'siawin0.FA50'),
  ('FA60',  'consecutivos_fact',      'Consecutivos Facturación',        'Facturación', 'Control de consecutivos de documentos',                                                                 ARRAY[]::text[], 'tms.consecutivos_fact', 'siawin0.FA60'),
  ('FA00Ad','pedidos_aduana',         'Pedidos Aduana (Adicional)',       'Facturación', 'Datos aduaneros adicionales por pedido: país origen, guía, incoterms',                                  ARRAY['sPedido'], 'tms.pedidos_aduana', 'siawin0.FA00Ad'),
  -- ── Compras / Cuentas por Pagar ──
  ('CP10',  'ordenes_compra',         'Órdenes de Compra (Cabecera)',    'Compras',     'Cabecera de OC: proveedor, fecha, moneda, estado, totales',                                              ARRAY['sOrden'], 'tms.ordenes_compra', 'siawin0.CP10'),
  ('CP11',  'lineas_oc',              'Líneas de Orden de Compra',       'Compras',     'Detalle de líneas por OC: producto, cantidad, costo, bodega destino',                                    ARRAY['sOrden','iLinea'], 'tms.lineas_oc', 'siawin0.CP11'),
  ('CP12',  'recepciones_compra',     'Recepciones de Compra',           'Compras',     'Recepciones de mercadería contra OC',                                                                   ARRAY['sRecepcion','iLinea'], 'tms.recepciones_compra', 'siawin0.CP12'),
  ('CP21',  'cuentas_por_pagar',      'Cuentas por Pagar',               'Compras',     'Documentos pendientes de pago a proveedores',                                                           ARRAY['sDocumento'], 'tms.cuentas_por_pagar', 'siawin0.CP21'),
  ('CP31',  'pagos_proveedores',      'Pagos a Proveedores',             'Compras',     'Registro de pagos realizados a proveedores',                                                            ARRAY['sDocumento'], 'tms.pagos_proveedores', 'siawin0.CP31'),
  -- ── Cuentas por Cobrar ──
  ('CC10',  'cuentas_por_cobrar',     'Cuentas por Cobrar',              'CxC',         'Documentos pendientes de cobro a clientes',                                                             ARRAY['cAnio','bMes','sTipo_Documento','sNumero_Documento','sCliente'], 'tms.cuentas_por_cobrar', 'siawin0.CC10'),
  ('CC12',  'cobros',                 'Cobros Realizados',               'CxC',         'Registro de cobros y aplicaciones de pago',                                                             ARRAY['sRecibo'], 'tms.cobros', 'siawin0.CC12'),
  ('CC14',  'notas_cc',               'Notas CxC',                       'CxC',         'Notas de crédito/débito en cuentas por cobrar',                                                         ARRAY[]::text[], 'tms.notas_cc', 'siawin0.CC14'),
  ('CC16',  'antiguedad_saldos',      'Antigüedad de Saldos',            'CxC',         'Análisis de antigüedad de saldos por cobrar',                                                           ARRAY[]::text[], 'tms.antiguedad_saldos', 'siawin0.CC16'),
  -- ── Contabilidad ──
  ('CO00',  'plan_cuentas',           'Plan de Cuentas',                 'Contabilidad','Catálogo de cuentas contables',                                                                         ARRAY['sCuenta'], 'tms.plan_cuentas', 'siawin0.CO00'),
  ('CO03',  'asientos_contables',     'Asientos Contables',              'Contabilidad','Detalle de asientos contables: cuenta, débito, crédito',                                                 ARRAY[]::text[], 'tms.asientos_contables', 'siawin0.CO03'),
  ('CO21',  'movimientos_contables',  'Movimientos Contables',           'Contabilidad','Movimientos contables por periodo',                                                                     ARRAY[]::text[], 'tms.movimientos_contables', 'siawin0.CO21'),
  -- ── Bancos / Tesorería ──
  ('BA10',  'movimientos_bancarios',  'Movimientos Bancarios',           'Bancos',      'Depósitos, cheques, transferencias, conciliación bancaria',                                              ARRAY['sDocumento'], 'tms.movimientos_bancarios', 'siawin0.BA10'),
  ('BA11',  'cuentas_bancarias',      'Cuentas Bancarias',               'Bancos',      'Catálogo de cuentas bancarias de la empresa',                                                           ARRAY['sCuenta'], 'tms.cuentas_bancarias', 'siawin0.BA11'),
  -- ── General ──
  ('GE01',  'catalogos_generales',    'Catálogos Generales',             'General',     'Catálogos maestros del sistema: tipos, códigos, parámetros',                                             ARRAY[]::text[], 'tms.catalogos_generales', 'siawin0.GE01'),
  ('TC',    'tipos_cambio',           'Tipos de Cambio',                 'General',     'Histórico de tipos de cambio por fecha',                                                                ARRAY['dFecha'], 'tms.tipos_cambio', 'siawin0.TC'),
  ('Cabys', 'cabys',                  'Códigos CABYS',                   'General',     'Catálogo de bienes y servicios (CABYS) para factura electrónica CR',                                     ARRAY[]::text[], 'tms.cabys_catalogo', 'siawin0.Cabys'),
  -- ── Factura Electrónica ──
  ('FE00L', 'factura_electronica',    'Factura Electrónica (Log)',        'FE',          'Log de facturas electrónicas enviadas a Hacienda',                                                      ARRAY[]::text[], 'tms.factura_electronica', 'siawin0.FE00L'),
  -- ── Auditoría ──
  ('DBT40', 'auditoria_detalle',      'Auditoría Detalle',               'Auditoría',   'Log detallado de cambios en el ERP',                                                                    ARRAY[]::text[], 'tms.auditoria_detalle', 'siawin0.DBT40'),
  ('DBT41', 'auditoria_sesiones',     'Auditoría Sesiones',              'Auditoría',   'Sesiones de usuario y operaciones',                                                                     ARRAY[]::text[], 'tms.auditoria_sesiones', 'siawin0.DBT41'),
  -- ── CRM / Notas ──
  ('AN03',  'notas_crm',              'Notas CRM / Servicio',            'CRM',         'Notas de servicio, garantías, seguimiento de clientes',                                                  ARRAY[]::text[], 'tms.notas_crm', 'siawin0.AN03')
ON CONFLICT (sql_table_name) DO NOTHING;


-- ──────────────────────────────────────────────────────────────────────────────
-- 1. CDC WATERMARKS — tracks last-synced state per table for polling
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.cdc_watermarks (
  id              serial PRIMARY KEY,
  sql_table_name  text NOT NULL UNIQUE REFERENCES tms.table_registry(sql_table_name),
  last_poll_at    timestamptz DEFAULT now(),
  last_row_hash   text,                          -- checksum of last polled batch
  last_max_pk     text,                          -- max PK value seen (for append-only)
  last_max_date   timestamptz,                   -- max date column seen (for date-partitioned)
  rows_synced     bigint DEFAULT 0,
  rows_pending    bigint DEFAULT 0,
  poll_interval_s integer DEFAULT 300,           -- 5 min default
  status          text DEFAULT 'idle',           -- 'idle', 'polling', 'error'
  error_message   text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. CDC EVENT LOG — immutable log of every change detected
-- ──────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.cdc_events (
  id              bigserial PRIMARY KEY,
  sql_table_name  text NOT NULL,
  event_type      text NOT NULL,                 -- 'INSERT', 'UPDATE', 'DELETE'
  row_pk          text NOT NULL,                 -- serialized PK of the affected row
  old_data        jsonb,                         -- previous values (for UPDATE)
  new_data        jsonb NOT NULL,                -- current values
  detected_at     timestamptz DEFAULT now(),
  committed_to_supabase boolean DEFAULT false,
  committed_to_kafka    boolean DEFAULT false,
  kafka_topic     text,
  kafka_offset    bigint,
  error           text
);

CREATE INDEX IF NOT EXISTS idx_cdc_events_table ON tms.cdc_events(sql_table_name, detected_at);
CREATE INDEX IF NOT EXISTS idx_cdc_events_pending ON tms.cdc_events(committed_to_supabase, committed_to_kafka) WHERE NOT committed_to_supabase OR NOT committed_to_kafka;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. CANONICAL TMS ENTITIES — human-readable mirrors of ERP tables
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 3.1 Productos (IN04) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.productos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,               -- original sCodigo from IN04
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  _curated            boolean DEFAULT false,
  _curated_by         text,
  _curated_at         timestamptz,
  -- Identity
  codigo              text NOT NULL,
  descripcion         text,
  descripcion_corta   text,
  grupo               text,
  subgrupo            text,
  familia             text,
  marca               text,
  modelo              text,
  unidad_medida       text,
  -- Classification
  abc_class           text,
  tipo_item           text,                      -- 'Importado', 'Local', 'Sin Definir'
  tipo_stock          text,                      -- MTS, MTO
  estado              smallint DEFAULT 1,        -- 1=activo, 0=inactivo, 4=descontinuado
  infaltable          boolean DEFAULT false,
  descontinuado       boolean DEFAULT false,
  -- Costs & Prices (USD)
  costo_promedio      numeric(18,6) DEFAULT 0,
  costo_ultimo        numeric(18,6) DEFAULT 0,
  costo_estandar      numeric(18,6) DEFAULT 0,
  costo_fob           numeric(18,6) DEFAULT 0,
  precio_publico      numeric(18,6) DEFAULT 0,
  precio_distribuidor numeric(18,6) DEFAULT 0,
  margen_publico      numeric(8,4) DEFAULT 0,
  margen_distribuidor numeric(8,4) DEFAULT 0,
  -- Supplier / Logistics
  proveedor_principal text,
  origen              text,
  lead_time_dias      integer DEFAULT 0,
  compra_minima       numeric(18,4) DEFAULT 0,
  empaque             numeric(18,4) DEFAULT 1,
  peso_kg             numeric(12,4) DEFAULT 0,
  volumen_m3          numeric(12,6) DEFAULT 0,
  -- MRP Parameters
  consumo_promedio    numeric(18,4) DEFAULT 0,
  stock_seguridad     numeric(18,4) DEFAULT 0,
  punto_reorden       numeric(18,4) DEFAULT 0,
  max_inventario      numeric(18,4) DEFAULT 0,
  -- Fiscal
  codigo_cabys        text,
  partida_arancelaria text,
  iva_pct             numeric(5,2) DEFAULT 13,
  dai_pct             numeric(5,2) DEFAULT 0,
  -- Metadata
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_productos_codigo ON tms.productos(codigo);
CREATE INDEX IF NOT EXISTS idx_productos_proveedor ON tms.productos(proveedor_principal);
CREATE INDEX IF NOT EXISTS idx_productos_familia ON tms.productos(familia);
CREATE INDEX IF NOT EXISTS idx_productos_abc ON tms.productos(abc_class);

-- ── 3.2 Proveedores (IN13) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.proveedores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  _curated            boolean DEFAULT false,
  codigo              text NOT NULL,
  nombre              text,
  nombre_corto        text,
  cedula_juridica     text,
  telefono            text,
  email               text,
  contacto            text,
  direccion           text,
  pais                text,
  moneda              text DEFAULT 'USD',
  condicion_pago      text,
  dias_credito        integer DEFAULT 0,
  estado              smallint DEFAULT 1,
  tipo                text,                      -- 'Nacional', 'Internacional'
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proveedores_codigo ON tms.proveedores(codigo);

-- ── 3.3 Bodegas (IN64) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.bodegas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  codigo              text NOT NULL,
  nombre              text,
  tipo                text,                      -- 'Principal', 'Tránsito', 'Devoluciones'
  ubicacion           text,
  responsable         text,
  activa              boolean DEFAULT true,
  excluida_analisis   boolean DEFAULT false,
  created_at          timestamptz DEFAULT now()
);

-- ── 3.4 Inventario por Bodega (IN14) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.inventario_bodega (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  producto_id         uuid REFERENCES tms.productos(id),
  bodega_id           uuid REFERENCES tms.bodegas(id),
  codigo_producto     text NOT NULL,
  codigo_bodega       text NOT NULL,
  grupo               text,
  unidad_medida       text,
  saldo_sistema       numeric(18,4) DEFAULT 0,
  saldo_pendiente     numeric(18,4) DEFAULT 0,
  saldo_reserva       numeric(18,4) DEFAULT 0,
  saldo_transito      numeric(18,4) DEFAULT 0,
  saldo_disponible    numeric(18,4) DEFAULT 0,
  costo_unitario      numeric(18,6) DEFAULT 0,
  costo_total         numeric(18,4) DEFAULT 0,
  estante             text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_bodega_producto ON tms.inventario_bodega(codigo_producto);
CREATE INDEX IF NOT EXISTS idx_inv_bodega_bodega ON tms.inventario_bodega(codigo_bodega);

-- ── 3.5 Clientes (FA20) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.clientes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  codigo              text NOT NULL,
  nombre              text,
  cedula              text,
  telefono            text,
  email               text,
  direccion           text,
  vendedor            text,
  zona                text,
  condicion_pago      text,
  limite_credito      numeric(18,4) DEFAULT 0,
  saldo_pendiente     numeric(18,4) DEFAULT 0,
  moneda              text DEFAULT 'CRC',
  estado              smallint DEFAULT 1,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_codigo ON tms.clientes(codigo);

-- ── 3.6 Órdenes de Compra — Cabecera (CP10) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.ordenes_compra (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  _curated            boolean DEFAULT false,
  orden               text NOT NULL,
  proveedor_id        uuid REFERENCES tms.proveedores(id),
  codigo_proveedor    text,
  fecha_orden         timestamptz,
  fecha_entrega       timestamptz,
  moneda              text DEFAULT 'USD',
  tipo_cambio         numeric(12,4) DEFAULT 1,
  subtotal            numeric(18,4) DEFAULT 0,
  impuestos           numeric(18,4) DEFAULT 0,
  total               numeric(18,4) DEFAULT 0,
  estado              text DEFAULT 'Pendiente',  -- 'Pendiente','Parcial','Completa','Anulada'
  bodega_destino      text,
  observaciones       text,
  quien_ingreso       text,
  fecha_ingreso       timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oc_orden ON tms.ordenes_compra(orden);
CREATE INDEX IF NOT EXISTS idx_oc_proveedor ON tms.ordenes_compra(codigo_proveedor);
CREATE INDEX IF NOT EXISTS idx_oc_estado ON tms.ordenes_compra(estado);

-- ── 3.7 Líneas de OC (CP11) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.lineas_oc (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  orden_compra_id     uuid REFERENCES tms.ordenes_compra(id),
  orden               text NOT NULL,
  linea               integer NOT NULL,
  producto_id         uuid REFERENCES tms.productos(id),
  codigo_producto     text,
  descripcion         text,
  cantidad            numeric(18,4) DEFAULT 0,
  cantidad_recibida   numeric(18,4) DEFAULT 0,
  costo_unitario      numeric(18,6) DEFAULT 0,
  costo_total         numeric(18,4) DEFAULT 0,
  bodega              text,
  estado              text DEFAULT 'Pendiente',
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lineas_oc_orden ON tms.lineas_oc(orden);

-- ── 3.8 Facturas — Cabecera (FA12) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.facturas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  pedido              text NOT NULL,
  cliente_id          uuid REFERENCES tms.clientes(id),
  codigo_cliente      text,
  fecha               timestamptz,
  fecha_vencimiento   timestamptz,
  vendedor            text,
  moneda              text DEFAULT 'CRC',
  tipo_cambio         numeric(12,4) DEFAULT 1,
  subtotal            numeric(18,4) DEFAULT 0,
  descuento           numeric(18,4) DEFAULT 0,
  impuestos           numeric(18,4) DEFAULT 0,
  total               numeric(18,4) DEFAULT 0,
  saldo_pendiente     numeric(18,4) DEFAULT 0,
  estado              text DEFAULT 'Pendiente',
  tipo_documento      text,                      -- 'FA', 'NC', 'ND'
  bodega              text,
  observaciones       text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_facturas_pedido ON tms.facturas(pedido);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON tms.facturas(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha ON tms.facturas(fecha);

-- ── 3.9 Líneas de Factura (FA01) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.lineas_factura (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  factura_id          uuid REFERENCES tms.facturas(id),
  pedido              text NOT NULL,
  linea               integer NOT NULL,
  producto_id         uuid REFERENCES tms.productos(id),
  codigo_producto     text,
  descripcion         text,
  cantidad            numeric(18,4) DEFAULT 0,
  costo               numeric(18,6) DEFAULT 0,
  precio_venta        numeric(18,6) DEFAULT 0,
  descuento_pct       numeric(8,4) DEFAULT 0,
  impuesto_pct        numeric(8,4) DEFAULT 0,
  total_linea         numeric(18,4) DEFAULT 0,
  bodega              text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lineas_fact_pedido ON tms.lineas_factura(pedido);

-- ── 3.10 Cuentas por Pagar (CP21) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.cuentas_por_pagar (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  documento           text NOT NULL,
  proveedor_id        uuid REFERENCES tms.proveedores(id),
  codigo_proveedor    text,
  tipo_documento      text,
  fecha_documento     timestamptz,
  fecha_vencimiento   timestamptz,
  moneda              text DEFAULT 'USD',
  tipo_cambio         numeric(12,4) DEFAULT 1,
  monto_original      numeric(18,4) DEFAULT 0,
  monto_pendiente     numeric(18,4) DEFAULT 0,
  estado              text DEFAULT 'Pendiente',
  orden_compra        text,
  asiento_contable    text,
  observaciones       text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cxp_proveedor ON tms.cuentas_por_pagar(codigo_proveedor);
CREATE INDEX IF NOT EXISTS idx_cxp_vencimiento ON tms.cuentas_por_pagar(fecha_vencimiento);

-- ── 3.11 Cuentas por Cobrar (CC10) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.cuentas_por_cobrar (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  anio                integer,
  mes                 smallint,
  tipo_documento      text,
  numero_documento    text NOT NULL,
  cliente_id          uuid REFERENCES tms.clientes(id),
  codigo_cliente      text,
  fecha               timestamptz,
  moneda              text DEFAULT 'CRC',
  tipo_cambio         numeric(12,4) DEFAULT 1,
  monto_original      numeric(18,4) DEFAULT 0,
  monto_pendiente     numeric(18,4) DEFAULT 0,
  estado              text DEFAULT 'Pendiente',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cxc_cliente ON tms.cuentas_por_cobrar(codigo_cliente);
CREATE INDEX IF NOT EXISTS idx_cxc_fecha ON tms.cuentas_por_cobrar(fecha);

-- ── 3.12 Plan de Cuentas (CO00) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.plan_cuentas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  cuenta              text NOT NULL,
  descripcion         text,
  tipo                text,                      -- 'Activo','Pasivo','Patrimonio','Ingreso','Gasto'
  nivel               integer DEFAULT 0,
  cuenta_padre        text,
  moneda              text,
  naturaleza          text,                      -- 'Deudora','Acreedora'
  activa              boolean DEFAULT true,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_cuentas_cuenta ON tms.plan_cuentas(cuenta);

-- ── 3.13 Movimientos Bancarios (BA10) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.movimientos_bancarios (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  _cdc_seq            bigint DEFAULT 0,
  documento           text NOT NULL,
  cuenta_bancaria     text,
  tipo_documento      text,
  fecha               timestamptz,
  monto               numeric(18,4) DEFAULT 0,
  moneda              text DEFAULT 'CRC',
  tipo_cambio         numeric(12,4) DEFAULT 1,
  proveedor           text,
  beneficiario        text,
  observaciones       text,
  estado              text,
  conciliado          boolean DEFAULT false,
  asiento_contable    text,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mov_banc_fecha ON tms.movimientos_bancarios(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_banc_cuenta ON tms.movimientos_bancarios(cuenta_bancaria);

-- ── 3.14 Tipos de Cambio (TC) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tms.tipos_cambio (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  _pcgraf_pk          text UNIQUE,
  _synced_at          timestamptz DEFAULT now(),
  fecha               date NOT NULL,
  compra              numeric(12,4),
  venta               numeric(12,4),
  moneda              text DEFAULT 'USD',
  fuente              text DEFAULT 'BCCR',
  created_at          timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tc_fecha_moneda ON tms.tipos_cambio(fecha, moneda);


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. RLS Policies — allow full access for service role, read for anon
-- ══════════════════════════════════════════════════════════════════════════════
DO $$ 
DECLARE
  tbl text;
BEGIN
  FOR tbl IN 
    SELECT tablename FROM pg_tables WHERE schemaname = 'tms'
  LOOP
    EXECUTE format('ALTER TABLE tms.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('
      DO $inner$ BEGIN
        CREATE POLICY "Allow all for service role" ON tms.%I FOR ALL USING (true) WITH CHECK (true);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $inner$;
    ', tbl);
  END LOOP;
END $$;
