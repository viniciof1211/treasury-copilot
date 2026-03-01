// ---------------------------------------------------------------------------
// ERP Modules Types — Facturas, Contratos por Proyecto, Hitos por Contrato
// Source: PcGraf Euromobilia / Siawin0
// ---------------------------------------------------------------------------

// ── Facturas ────────────────────────────────────────────────────────────────

export interface Factura {
  sPedido: string;
  sFactura: string;
  sTipoFactura: string;
  dFecha: string;
  dVencimiento: string;
  sCodigo_Cliente: string;
  sNombre_Cliente: string;
  sNegocio: string;
  sVendedor: string;
  monto_gravado: number;
  monto_impuesto: number;
  monto_total: number;
  monto_exento: number;
  monto_descuento: number;
  pct_descuento: number;
  iTipo_Moneda: number;
  tipo_cambio: number;
  bEstado: number;
  bEstadoFactura: number;
  iPlazo: number;
  bForma_Pago: number;
  bProforma: number;
  sQuien_Ingreso: string;
  dFecha_Ingreso: string;
  sProyecto: string;
  sOrigen: string;
}

export interface FacturaHeader extends Factura {
  sCedula: string;
  sTelefono: string;
  sDireccion_1: string;
  sDireccion_2: string;
  sBodega: string;
  sProAtencion: string;
  sProVigencia: string;
  sProCondiciones: string;
  sProTEntrega: string;
}

export interface FacturaLinea {
  iLinea: number;
  sCodigo_Producto: string;
  sDescripcion: string;
  cantidad: number;
  costo: number;
  precio_venta: number;
  descuento: number;
  impuesto: number;
  sBodega: string;
  sEmpaque: string;
  subtotal: number;
  bEstado: number;
  sLote: string;
}

export interface FacturasKPIs {
  total_facturas: number;
  clientes_unicos: number;
  negocios: number;
  sum_total: number;
  sum_gravado: number;
  sum_impuesto: number;
  sum_descuento: number;
  avg_precio: number;
  fecha_min: string;
  fecha_max: string;
}

export interface FacturasKPIsResponse {
  all_time: FacturasKPIs;
  last_30_days: {
    facturas_30d: number;
    total_30d: number;
  };
}

export interface NegocioBreakdown {
  negocio: string;
  num_facturas: number;
  clientes: number;
  total_precio: number;
  total_gravado: number;
  total_impuesto: number;
  desde: string;
  hasta: string;
}

export interface MonthlyTrend {
  anio: number;
  mes: number;
  num_facturas: number;
  total_precio: number;
  total_gravado: number;
  total_impuesto: number;
  clientes: number;
}

export interface TopCliente {
  codigo: string;
  nombre: string;
  num_facturas: number;
  total_precio: number;
  total_gravado: number;
  primera_factura: string;
  ultima_factura: string;
}

// ── Contratos por Proyecto ──────────────────────────────────────────────────

export interface ContratoProyecto {
  proyecto: string;
  num_facturas: number;
  clientes: number;
  total_precio: number;
  total_gravado: number;
  fecha_inicio: string;
  fecha_fin: string;
  cliente_principal: string;
  [key: string]: unknown; // dynamic columns from HO00
}

export interface ContratoImport {
  IDLinea: number;
  CodProyecto: number;
  NombreDocumento: string;
  Grupo: number;
  Observaciones: string;
  Extension: string;
  QuienIngreso: string;
  FechaIngreso: string;
  FileName: string;
  CodCaso: string;
  [key: string]: unknown;
}

export interface ContratosResponse {
  contracts: ContratoProyecto[];
  total: number;
  source: string;
  imports: ContratoImport[];
  imports_count: number;
  tables_available: Record<string, boolean>;
}

// ── Hitos por Contrato ──────────────────────────────────────────────────────

export interface HitoTableData {
  available: boolean;
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
  total: number;
  error?: string;
}

export interface HitosResponse {
  hitos: Record<string, HitoTableData>;
}

// ── Table Schema Discovery ──────────────────────────────────────────────────

export interface TableColumn {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  CHARACTER_MAXIMUM_LENGTH: number | null;
  IS_NULLABLE: string;
}

export interface TableSchemaResponse {
  table: string;
  exists: boolean;
  columns: TableColumn[];
  row_count: number;
  sample: Record<string, unknown> | null;
}
