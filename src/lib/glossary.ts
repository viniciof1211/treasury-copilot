import type { TooltipMeta } from '../components/ui/InfoTooltip';

// ═══════════════════════════════════════════════════════════════════════════
// Central Glossary Registry
// Every metric, chart, table, and KPI across the Treasury-Finance universe.
// Used by InfoTooltip components AND the Glossary page.
// ═══════════════════════════════════════════════════════════════════════════

export type GlossaryEntry = TooltipMeta & {
  category: 'kpi' | 'chart' | 'table' | 'metric' | 'concept';
};

// ── Dashboard (Home) ──────────────────────────────────────────────────────
export const DASHBOARD: Record<string, GlossaryEntry> = {
  totalCxP: {
    label: 'Total CxP (Cuentas por Pagar)',
    description: 'Suma de todos los montos pendientes de pago a proveedores, expresados en USD.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items → monto_usd. Ingestado desde archivos XLSX de cuentas por pagar.',
    formula: 'SUM(cxp_items.monto_usd)',
    unit: 'USD',
    module: 'Dashboard',
    category: 'kpi',
  },
  totalInflows: {
    label: 'Total Ingresos (Flujo)',
    description: 'Suma de todas las cuotas de flujo semanal, convertidas a USD usando tipo de cambio BCCR.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → cuota. Moneda original CRC/USD, convertido a USD.',
    formula: 'SUM(flujo_semanal.cuota × TC_BCCR) donde moneda=CRC',
    unit: 'USD',
    module: 'Dashboard',
    category: 'kpi',
  },
  netCashflow: {
    label: 'Flujo de Caja Neto',
    description: 'Diferencia entre ingresos totales y cuentas por pagar. Positivo = superávit, negativo = déficit.',
    source: 'calculated',
    formula: 'Total Ingresos − Total CxP',
    unit: 'USD',
    module: 'Dashboard',
    category: 'kpi',
  },
  coverageRatio: {
    label: 'Ratio de Cobertura',
    description: 'Relación entre ingresos y egresos. >1 indica capacidad de pago, <1 indica déficit de liquidez.',
    source: 'calculated',
    formula: 'Total Ingresos / Total CxP',
    unit: 'ratio',
    module: 'Dashboard',
    category: 'kpi',
  },
  runway: {
    label: 'Runway (Meses)',
    description: 'Meses futuros con balance proyectado positivo. Indica la pista de liquidez antes de llegar a cero.',
    source: 'supabase',
    sourceDetail: 'silver_finance.projection_12m → projected_balance > 0',
    formula: 'COUNT(meses donde projected_balance > 0)',
    unit: 'meses',
    module: 'Dashboard',
    category: 'kpi',
  },
  debtLP: {
    label: 'Deuda Largo Plazo',
    description: 'Saldo original de créditos clasificados como Largo Plazo.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal WHERE tipo = "Largo Plazo" → saldo_original',
    formula: 'SUM(saldo_original) WHERE tipo = "Largo Plazo"',
    unit: 'USD',
    module: 'Dashboard',
    category: 'metric',
  },
  debtCP: {
    label: 'Deuda Corto Plazo',
    description: 'Saldo original de créditos de Capital Trabajo, Leasing, Revolving y Tarjeta.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal WHERE tipo NOT IN ("Largo Plazo") → saldo_original',
    formula: 'SUM(saldo_original) WHERE tipo ≠ "Largo Plazo"',
    unit: 'USD',
    module: 'Dashboard',
    category: 'metric',
  },
  cxpByPriority: {
    label: 'CxP por Prioridad',
    description: 'Distribución de cuentas por pagar agrupadas por prioridad: P1 Crítico, P2 Importante, P3 Normal, P4 Diferible.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items → GROUP BY prioridad',
    formula: 'SUM(monto_usd) GROUP BY prioridad',
    unit: 'USD',
    module: 'Dashboard',
    category: 'chart',
  },
  projectionChart: {
    label: 'Proyección 12 Meses',
    description: 'Proyección mensual de ingresos, egresos y balance neto para los próximos 12 meses.',
    source: 'supabase',
    sourceDetail: 'silver_finance.projection_12m → projected_inflows, projected_outflows, projected_balance',
    unit: 'USD',
    module: 'Dashboard',
    category: 'chart',
  },
  flujoByBank: {
    label: 'Flujo por Banco',
    description: 'Distribución de cuotas de crédito agrupadas por entidad bancaria.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → GROUP BY banco',
    formula: 'SUM(cuota) GROUP BY banco',
    unit: 'USD',
    module: 'Dashboard',
    category: 'chart',
  },
  debtComposition: {
    label: 'Composición de Deuda',
    description: 'Distribución de deuda por tipo: Largo Plazo, Capital Trabajo, Leasing, Revolving, Tarjeta.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → GROUP BY tipo → SUM(saldo_original)',
    formula: 'SUM(saldo_original) GROUP BY tipo',
    unit: 'USD',
    module: 'Dashboard',
    category: 'chart',
  },
};

// ── Cashflow Dashboard ────────────────────────────────────────────────────
export const CASHFLOW: Record<string, GlossaryEntry> = {
  weeklySchedule: {
    label: 'Calendarización Semanal de Pagos',
    description: 'Pagos programados agrupados por semana, mostrando cuota, principal e intereses.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → GROUP BY semana_inicio',
    formula: 'SUM(cuota), SUM(principal), SUM(intereses) por semana',
    unit: 'USD',
    module: 'Cashflow',
    category: 'chart',
  },
  cxpAging: {
    label: 'Antigüedad de CxP',
    description: 'Distribución de cuentas por pagar según días hasta vencimiento: Vencidas, 0-30, 31-60, 61-90, >90 días.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items → DATEDIFF(vencimiento_fecha, NOW())',
    formula: 'Bucket = DATEDIFF(vencimiento_fecha, today); SUM(monto_usd) GROUP BY bucket',
    unit: 'USD',
    module: 'Cashflow',
    category: 'chart',
  },
  cxpByVendor: {
    label: 'CxP por Proveedor (Top 10)',
    description: 'Los 10 proveedores con mayor saldo pendiente de pago.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items → GROUP BY proveedor → ORDER BY SUM DESC LIMIT 10',
    formula: 'SUM(monto_usd) GROUP BY proveedor ORDER BY total DESC LIMIT 10',
    unit: 'USD',
    module: 'Cashflow',
    category: 'chart',
  },
  cxpByBU: {
    label: 'CxP por Unidad de Negocio',
    description: 'Distribución de cuentas por pagar agrupadas por empresa / unidad de negocio.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items → GROUP BY empresa',
    formula: 'SUM(monto_usd) GROUP BY empresa',
    unit: 'USD',
    module: 'Cashflow',
    category: 'chart',
  },
  principalVsInterest: {
    label: 'Principal vs Intereses',
    description: 'Comparación entre montos de principal e intereses en flujo de créditos.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → SUM(principal), SUM(intereses)',
    formula: 'SUM(principal), SUM(intereses)',
    unit: 'USD',
    module: 'Cashflow',
    category: 'chart',
  },
  budgetVariance: {
    label: 'Varianza vs Presupuesto',
    description: 'Diferencia entre el gasto real acumulado y el presupuesto objetivo configurado por el usuario.',
    source: 'calculated',
    formula: 'Varianza = Total CxP − Presupuesto Objetivo',
    unit: 'USD',
    module: 'Cashflow',
    category: 'kpi',
  },
  cxpTable: {
    label: 'Tabla de Cuentas por Pagar',
    description: 'Listado detallado de todas las cuentas por pagar con filtros por BU, proveedor, prioridad y período.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items (ingestado desde XLSX de cuentas por pagar)',
    module: 'Cashflow',
    category: 'table',
  },
  flujoTable: {
    label: 'Tabla de Flujo Semanal',
    description: 'Listado detallado de todas las operaciones de crédito con cuotas, principal, intereses y saldo.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal (ingestado desde XLSX de flujo semanal)',
    module: 'Cashflow',
    category: 'table',
  },
};

// ── Credit Dashboard ──────────────────────────────────────────────────────
export const CREDIT: Record<string, GlossaryEntry> = {
  totalDebt: {
    label: 'Deuda Total',
    description: 'Suma de todos los saldos originales de crédito, convertidos a USD.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → SUM(saldo_original)',
    formula: 'SUM(saldo_original × TC_BCCR)',
    unit: 'USD',
    module: 'Crédito',
    category: 'kpi',
  },
  weightedAvgRate: {
    label: 'Tasa Promedio Ponderada',
    description: 'Tasa de interés promedio ponderada por saldo de cada operación de crédito.',
    source: 'calculated',
    formula: 'SUM(intereses / principal × saldo_original) / SUM(saldo_original)',
    unit: '%',
    module: 'Crédito',
    category: 'kpi',
  },
  debtByType: {
    label: 'Deuda por Tipo de Crédito',
    description: 'Distribución de deuda por tipo: Largo Plazo, Capital Trabajo, Leasing, Revolving, Tarjeta.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → GROUP BY tipo',
    formula: 'SUM(saldo_original) GROUP BY tipo',
    unit: 'USD',
    module: 'Crédito',
    category: 'chart',
  },
  debtByBank: {
    label: 'Deuda por Banco',
    description: 'Distribución de saldo de deuda agrupado por entidad bancaria.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → GROUP BY banco',
    formula: 'SUM(saldo_original) GROUP BY banco',
    unit: 'USD',
    module: 'Crédito',
    category: 'chart',
  },
  debtMaturityProfile: {
    label: 'Perfil de Madurez de Deuda',
    description: 'Cronograma de vencimientos de capital por período: 0-30d, 31-90d, 91-180d, 181-365d, >1 año.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.flujo_semanal → GROUP BY bucket(vencimiento)',
    formula: 'SUM(capital) por bucket de vencimiento',
    unit: 'USD',
    module: 'Crédito',
    category: 'chart',
  },
  dscr: {
    label: 'DSCR (Debt Service Coverage Ratio)',
    description: 'Ratio de cobertura del servicio de deuda. Mide capacidad de pago con ingresos disponibles.',
    source: 'calculated',
    formula: 'DSCR = Ingresos Operativos Netos / Servicio de Deuda Total (principal + intereses)',
    unit: 'ratio',
    module: 'Crédito',
    category: 'kpi',
  },
};

// ── Compras Dashboard ─────────────────────────────────────────────────────
export const COMPRAS: Record<string, GlossaryEntry> = {
  totalCompras: {
    label: 'Total Compras',
    description: 'Suma de todos los montos de compras a proveedores, expresados en USD.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items → SUM(monto_usd)',
    formula: 'SUM(monto_usd)',
    unit: 'USD',
    module: 'Compras',
    category: 'kpi',
  },
  topProveedores: {
    label: 'Top Proveedores',
    description: 'Los proveedores con mayor volumen de compras acumulado.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items → GROUP BY proveedor → ORDER BY SUM DESC',
    formula: 'SUM(monto_usd) GROUP BY proveedor ORDER BY total DESC',
    unit: 'USD',
    module: 'Compras',
    category: 'chart',
  },
  eoq: {
    label: 'EOQ (Cantidad Económica de Pedido)',
    description: 'Modelo Wilson: cantidad óptima de pedido que minimiza costos totales de inventario y orden.',
    source: 'calculated',
    formula: 'EOQ = √(2 × D × S / H) donde D=demanda anual, S=costo por orden, H=costo de mantener',
    unit: 'unidades',
    module: 'Compras',
    category: 'chart',
  },
  importVsLocal: {
    label: 'Importación vs Local',
    description: 'Comparación estratégica de costos entre compras importadas y compras locales.',
    source: 'xlsx',
    sourceDetail: 'silver_finance.cxp_items → clasificacion LIKE "Import%" vs resto',
    formula: 'SUM(monto_usd) WHERE clasificacion LIKE "Import%"',
    unit: 'USD',
    module: 'Compras',
    category: 'chart',
  },
  inventoryTurnover: {
    label: 'Rotación de Inventario por ABC',
    description: 'Frecuencia de rotación de inventario segmentada por clasificación ABC (volumen de consumo).',
    source: 'calculated',
    formula: 'Rotación = COGS / Inventario Promedio. Clase A: 80% valor, B: 15%, C: 5%.',
    unit: 'veces/año',
    module: 'Compras',
    category: 'chart',
  },
  demandVolatility: {
    label: 'Volatilidad de Demanda',
    description: 'Coeficiente de variación (CV) que mide la dispersión de la demanda histórica.',
    source: 'calculated',
    formula: 'CV = σ(demanda) / μ(demanda). Bajo <0.5, Medio 0.5-1.0, Alto >1.0',
    unit: 'ratio',
    module: 'Compras',
    category: 'chart',
  },
  workingCapitalImpact: {
    label: 'Impacto en Capital de Trabajo',
    description: 'Efecto de los Días de Inventario (DIO) en el capital de trabajo inmovilizado.',
    source: 'calculated',
    formula: 'Capital Inmovilizado = (DIO / 365) × COGS anual',
    unit: 'USD',
    module: 'Compras',
    category: 'chart',
  },
  supplierDependency: {
    label: 'Matriz de Dependencia de Proveedores',
    description: 'Riesgo de proveedores de fuente única. Alto riesgo = proveedor con >30% del gasto de su categoría.',
    source: 'calculated',
    formula: 'Riesgo = (Gasto con proveedor / Gasto total categoría) × 100',
    unit: '%',
    module: 'Compras',
    category: 'chart',
  },
  pcgrafConsole: {
    label: 'Consola PcGraf',
    description: 'Consulta directa a la base de datos PcGraf ERP (SQL Server on-premise) a través del proxy backend.',
    source: 'pcgraf',
    sourceDetail: 'Conexión a 192.168.1.3 via pymssql → agent/server.py /pcgraf/query',
    module: 'Compras',
    category: 'table',
  },
};

// ── Ingresos Dashboard ────────────────────────────────────────────────────
export const INGRESOS: Record<string, GlossaryEntry> = {
  totalIngresos: {
    label: 'Total Ingresos',
    description: 'Suma de todos los ingresos por cobros de proyectos y contratos.',
    source: 'supabase',
    sourceDetail: 'tms.contratos → SUM(monto_total) WHERE estado = "activo"',
    formula: 'SUM(monto_cobro)',
    unit: 'USD',
    module: 'Ingresos',
    category: 'kpi',
  },
  collectionRate: {
    label: 'Tasa de Cobro',
    description: 'Porcentaje de facturación que ha sido efectivamente cobrado.',
    source: 'calculated',
    formula: 'Tasa Cobro = (Monto Cobrado / Monto Facturado) × 100',
    unit: '%',
    module: 'Ingresos',
    category: 'kpi',
  },
  dso: {
    label: 'DSO (Days Sales Outstanding)',
    description: 'Promedio de días para cobrar una factura. Menor es mejor.',
    source: 'calculated',
    formula: 'DSO = (CxC promedio / Ventas a crédito) × días del período',
    unit: 'días',
    module: 'Ingresos',
    category: 'kpi',
  },
  revenueByArea: {
    label: 'Ingresos por Área de Negocio',
    description: 'Distribución de ingresos por área: Construcción, Mantenimiento, Cocinas, etc.',
    source: 'supabase',
    sourceDetail: 'tms.contratos → GROUP BY area_negocio',
    formula: 'SUM(monto_total) GROUP BY area_negocio',
    unit: 'USD',
    module: 'Ingresos',
    category: 'chart',
  },
};

// ── Projects Dashboard ────────────────────────────────────────────────────
export const PROJECTS: Record<string, GlossaryEntry> = {
  activeContracts: {
    label: 'Contratos Activos',
    description: 'Número de contratos de proyecto con estado activo en el período actual.',
    source: 'supabase',
    sourceDetail: 'tms.contratos WHERE estado = "activo" → COUNT(*)',
    formula: 'COUNT(*) WHERE estado = "activo"',
    module: 'Proyectos',
    category: 'kpi',
  },
  totalContractValue: {
    label: 'Valor Total de Contratos',
    description: 'Suma de montos de todos los contratos activos.',
    source: 'supabase',
    sourceDetail: 'tms.contratos → SUM(monto_total)',
    formula: 'SUM(monto_total) WHERE estado = "activo"',
    unit: 'USD',
    module: 'Proyectos',
    category: 'kpi',
  },
  executionRate: {
    label: 'Tasa de Ejecución',
    description: 'Porcentaje promedio de avance físico de los contratos activos.',
    source: 'calculated',
    formula: 'AVG(avance_fisico) WHERE estado = "activo"',
    unit: '%',
    module: 'Proyectos',
    category: 'kpi',
  },
  collectionEfficiency: {
    label: 'Eficiencia de Cobro',
    description: 'Porcentaje del monto facturado que ha sido efectivamente cobrado.',
    source: 'calculated',
    formula: '(Monto Cobrado / Monto Facturado) × 100',
    unit: '%',
    module: 'Proyectos',
    category: 'kpi',
  },
  portfolioChart: {
    label: 'Portafolio de Proyectos',
    description: 'Distribución visual del portafolio de contratos por cliente y monto.',
    source: 'supabase',
    sourceDetail: 'tms.contratos → GROUP BY cliente',
    module: 'Proyectos',
    category: 'chart',
  },
  ganttChart: {
    label: 'Diagrama de Gantt',
    description: 'Cronograma visual de hitos y entregables de cada proyecto/contrato.',
    source: 'supabase',
    sourceDetail: 'tms.hitos_contrato → fecha_inicio, fecha_fin, estado',
    module: 'Proyectos',
    category: 'chart',
  },
  milestoneAlerts: {
    label: 'Alertas de Hitos',
    description: 'Hitos próximos a vencer o vencidos que requieren atención. Se filtran por severidad.',
    source: 'supabase',
    sourceDetail: 'tms.hitos_contrato WHERE fecha_fin < NOW() + 14 días',
    formula: 'Severidad: Vencido (rojo) si fecha < hoy, Próximo (amarillo) si < 14 días, Normal (verde)',
    module: 'Proyectos',
    category: 'table',
  },
  weeklyForecast: {
    label: 'Pronóstico de Cobros Semanal',
    description: 'Proyección de cobros esperados por semana basado en hitos aprobados.',
    source: 'supabase',
    sourceDetail: 'tms.hitos_contrato → GROUP BY week(fecha_cobro)',
    formula: 'SUM(monto_hito) GROUP BY WEEK(fecha_cobro_estimado)',
    unit: 'USD',
    module: 'Proyectos',
    category: 'chart',
  },
  agingBuckets: {
    label: 'Antigüedad de CxC por Proyecto',
    description: 'Distribución de cuentas por cobrar por bucket de antigüedad.',
    source: 'calculated',
    formula: 'Buckets: 0-30d, 31-60d, 61-90d, 91-120d, >120d. SUM(monto) por bucket.',
    unit: 'USD',
    module: 'Proyectos',
    category: 'chart',
  },
  areaBreakdown: {
    label: 'Desglose por Área',
    description: 'Distribución de contratos y montos por área de negocio.',
    source: 'supabase',
    sourceDetail: 'tms.contratos → GROUP BY area_negocio',
    formula: 'SUM(monto_total), COUNT(*) GROUP BY area_negocio',
    unit: 'USD',
    module: 'Proyectos',
    category: 'chart',
  },
};

// ── ERP Modules Dashboard ─────────────────────────────────────────────────
export const ERP: Record<string, GlossaryEntry> = {
  facturasTotales: {
    label: 'Total Facturas ERP',
    description: 'Cantidad total de facturas registradas en el ERP PcGraf.',
    source: 'pcgraf',
    sourceDetail: 'siawin0.Facturas vía CDC pipeline → tms.facturas (Supabase mirror)',
    formula: 'COUNT(*) FROM facturas',
    module: 'ERP',
    category: 'kpi',
  },
  facturasMontoTotal: {
    label: 'Monto Total Facturado',
    description: 'Suma de todos los montos de facturas del ERP.',
    source: 'pcgraf',
    sourceDetail: 'siawin0.Facturas → SUM(total_factura) vía CDC → Supabase mirror',
    formula: 'SUM(total_factura)',
    unit: 'CRC/USD',
    module: 'ERP',
    category: 'kpi',
  },
  facturasByNegocio: {
    label: 'Facturas por Negocio',
    description: 'Distribución de facturas agrupadas por línea de negocio del ERP.',
    source: 'pcgraf',
    sourceDetail: 'siawin0.Facturas → GROUP BY negocio vía CDC',
    formula: 'SUM(total_factura) GROUP BY negocio',
    unit: 'CRC',
    module: 'ERP',
    category: 'chart',
  },
  topClientes: {
    label: 'Top Clientes ERP',
    description: 'Los clientes con mayor volumen de facturación en el ERP PcGraf.',
    source: 'pcgraf',
    sourceDetail: 'siawin0.Facturas → GROUP BY cliente → ORDER BY SUM DESC LIMIT 10',
    formula: 'SUM(total_factura) GROUP BY cliente ORDER BY total DESC LIMIT 10',
    unit: 'CRC',
    module: 'ERP',
    category: 'chart',
  },
  erpTableSchema: {
    label: 'Esquema de Tablas ERP',
    description: 'Estructura de tablas del ERP PcGraf: columnas, tipos de datos, llaves primarias y conteos de registros.',
    source: 'pcgraf',
    sourceDetail: 'INFORMATION_SCHEMA.COLUMNS + COUNT(*) por tabla, vía pymssql',
    module: 'ERP',
    category: 'table',
  },
};

// ── TMS Cash Management ──────────────────────────────────────────────────
export const TMS_CASH: Record<string, GlossaryEntry> = {
  cashPosition: {
    label: 'Posición de Caja',
    description: 'Saldo actual de efectivo en todas las cuentas bancarias, consolidado en USD.',
    source: 'supabase',
    sourceDetail: 'tms.bank_accounts → SUM(current_balance)',
    formula: 'SUM(current_balance × TC) agrupado por moneda',
    unit: 'USD',
    module: 'TMS Cash',
    category: 'kpi',
  },
  cashForecast: {
    label: 'Pronóstico de Caja',
    description: 'Proyección de flujo de caja a 12 semanas basada en cobros programados y pagos comprometidos.',
    source: 'calculated',
    formula: 'Balance[t+1] = Balance[t] + Inflows[t+1] − Outflows[t+1]',
    unit: 'USD',
    module: 'TMS Cash',
    category: 'chart',
  },
  liquidityGap: {
    label: 'Brecha de Liquidez',
    description: 'Diferencia entre activos líquidos y obligaciones por período de vencimiento.',
    source: 'calculated',
    formula: 'Gap = Activos Líquidos[bucket] − Obligaciones[bucket]',
    unit: 'USD',
    module: 'TMS Cash',
    category: 'chart',
  },
};

// ── TMS CxP Payments ─────────────────────────────────────────────────────
export const TMS_CXP: Record<string, GlossaryEntry> = {
  paymentSchedule: {
    label: 'Calendario de Pagos',
    description: 'Programación de pagos a proveedores con fechas, montos y prioridades.',
    source: 'supabase',
    sourceDetail: 'tms.payment_schedule → ORDER BY fecha_pago',
    module: 'TMS CxP',
    category: 'table',
  },
  dpo: {
    label: 'DPO (Days Payable Outstanding)',
    description: 'Promedio de días para pagar a proveedores. Mayor DPO = más tiempo de financiamiento.',
    source: 'calculated',
    formula: 'DPO = (CxP promedio / Compras a crédito) × días del período',
    unit: 'días',
    module: 'TMS CxP',
    category: 'kpi',
  },
};

// ── TMS CxC Collections ──────────────────────────────────────────────────
export const TMS_CXC: Record<string, GlossaryEntry> = {
  collectionWorklist: {
    label: 'Lista de Trabajo de Cobros',
    description: 'Facturas pendientes de cobro priorizadas por antigüedad y monto.',
    source: 'supabase',
    sourceDetail: 'tms.cxc_items → ORDER BY dias_vencido DESC, monto DESC',
    module: 'TMS CxC',
    category: 'table',
  },
  agingReceivables: {
    label: 'Antigüedad de CxC',
    description: 'Distribución de cuentas por cobrar por antigüedad: Corriente, 30d, 60d, 90d, >90d.',
    source: 'supabase',
    sourceDetail: 'tms.cxc_items → GROUP BY bucket(dias_vencido)',
    formula: 'SUM(monto) GROUP BY aging_bucket',
    unit: 'USD',
    module: 'TMS CxC',
    category: 'chart',
  },
};

// ── TMS Invoicing ────────────────────────────────────────────────────────
export const TMS_INVOICING: Record<string, GlossaryEntry> = {
  invoicingDashboard: {
    label: 'Panel de Facturación',
    description: 'Resumen de facturación: facturas emitidas, pendientes, cobradas y en mora.',
    source: 'supabase',
    sourceDetail: 'tms.facturas + tms.contratos → aggregations',
    module: 'TMS Facturación',
    category: 'kpi',
  },
  revenueRecognition: {
    label: 'Reconocimiento de Ingresos',
    description: 'Ingresos reconocidos vs facturados según NIIF 15 / avance de obra.',
    source: 'calculated',
    formula: 'Ingreso Reconocido = Precio × (Costo Incurrido / Costo Total Estimado)',
    unit: 'USD',
    module: 'TMS Facturación',
    category: 'metric',
  },
};

// ── TMS FX & Risk ────────────────────────────────────────────────────────
export const TMS_FX: Record<string, GlossaryEntry> = {
  fxExposure: {
    label: 'Exposición Cambiaria',
    description: 'Monto neto expuesto a riesgo de tipo de cambio CRC/USD.',
    source: 'calculated',
    formula: 'Exposición = Activos en USD − Pasivos en USD (neto)',
    unit: 'USD',
    module: 'TMS FX',
    category: 'kpi',
  },
  varFx: {
    label: 'VaR Cambiario',
    description: 'Value at Risk: pérdida máxima esperada por movimiento cambiario al 95% de confianza, horizonte 1 mes.',
    source: 'calculated',
    formula: 'VaR = Exposición × σ(TC) × Z(95%) × √(horizonte/252)',
    unit: 'USD',
    module: 'TMS FX',
    category: 'kpi',
  },
  fxScenarios: {
    label: 'Escenarios de Tipo de Cambio',
    description: 'Simulación de impacto financiero bajo diferentes escenarios de tipo de cambio.',
    source: 'calculated',
    formula: 'Impacto = Exposición Neta × (TC_escenario − TC_actual)',
    unit: 'USD',
    module: 'TMS FX',
    category: 'chart',
  },
  exchangeRate: {
    label: 'Tipo de Cambio BCCR',
    description: 'Tipo de cambio oficial del Banco Central de Costa Rica (compra/venta).',
    source: 'api',
    sourceDetail: 'API BCCR → Indicadores Económicos → Tipo de cambio compra/venta',
    unit: 'CRC/USD',
    module: 'TMS FX',
    category: 'metric',
  },
};

// ── TMS Debt Management ──────────────────────────────────────────────────
export const TMS_DEBT: Record<string, GlossaryEntry> = {
  totalDebtOutstanding: {
    label: 'Deuda Vigente Total',
    description: 'Saldo total de instrumentos de deuda activos.',
    source: 'supabase',
    sourceDetail: 'tms.debt_instruments WHERE estado = "activo" → SUM(saldo_vigente)',
    formula: 'SUM(saldo_vigente)',
    unit: 'USD',
    module: 'TMS Deuda',
    category: 'kpi',
  },
  debtToEquity: {
    label: 'Ratio Deuda/Capital',
    description: 'Relación entre deuda total y capital contable. Mide apalancamiento financiero.',
    source: 'calculated',
    formula: 'D/E = Deuda Total / Capital Contable',
    unit: 'ratio',
    module: 'TMS Deuda',
    category: 'kpi',
  },
  interestCoverage: {
    label: 'Cobertura de Intereses',
    description: 'Veces que la utilidad operativa cubre los gastos por intereses.',
    source: 'calculated',
    formula: 'ICR = EBIT / Gastos por Intereses',
    unit: 'veces',
    module: 'TMS Deuda',
    category: 'kpi',
  },
  amortizationSchedule: {
    label: 'Calendario de Amortización',
    description: 'Cronograma de pagos de capital e intereses por instrumento de deuda.',
    source: 'supabase',
    sourceDetail: 'tms.debt_schedules → ORDER BY fecha_pago',
    module: 'TMS Deuda',
    category: 'chart',
  },
};

// ── TMS Bank Reconciliation ──────────────────────────────────────────────
export const TMS_RECON: Record<string, GlossaryEntry> = {
  matchRate: {
    label: 'Tasa de Conciliación Automática',
    description: 'Porcentaje de transacciones bancarias conciliadas automáticamente.',
    source: 'calculated',
    formula: '(Transacciones Conciliadas / Total Transacciones) × 100',
    unit: '%',
    module: 'TMS Recon',
    category: 'kpi',
  },
  unmatchedItems: {
    label: 'Partidas Sin Conciliar',
    description: 'Transacciones bancarias que no tienen contrapartida en los registros contables.',
    source: 'supabase',
    sourceDetail: 'tms.bank_transactions WHERE matched = false',
    module: 'TMS Recon',
    category: 'table',
  },
};

// ── TMS MRP ──────────────────────────────────────────────────────────────
export const TMS_MRP: Record<string, GlossaryEntry> = {
  reorderRecommendations: {
    label: 'Recomendaciones de Reorden',
    description: 'Materiales cuyo stock actual está por debajo del punto de reorden calculado.',
    source: 'supabase',
    sourceDetail: 'silver_finance.mrp_master WHERE stock_actual < punto_reorden',
    formula: 'Punto Reorden = (Demanda Diaria × Lead Time) + Stock Seguridad',
    module: 'TMS MRP',
    category: 'table',
  },
  stockValue: {
    label: 'Valor de Inventario',
    description: 'Valor monetario total del inventario actual.',
    source: 'supabase',
    sourceDetail: 'silver_finance.mrp_master → SUM(stock_actual × costo_unitario)',
    formula: 'SUM(stock_actual × costo_unitario)',
    unit: 'USD',
    module: 'TMS MRP',
    category: 'kpi',
  },
  abcClassification: {
    label: 'Clasificación ABC',
    description: 'Clasificación de inventario por valor: A (80% del valor), B (15%), C (5%). Método de Pareto.',
    source: 'calculated',
    formula: 'Clase A: top 20% ítems = 80% valor. Clase B: siguiente 30% = 15%. Clase C: restante 50% = 5%.',
    module: 'TMS MRP',
    category: 'chart',
  },
};

// ── TMS Board Reporting ──────────────────────────────────────────────────
export const TMS_BOARD: Record<string, GlossaryEntry> = {
  executiveSummary: {
    label: 'Resumen Ejecutivo',
    description: 'KPIs consolidados para presentación a junta directiva: liquidez, deuda, rentabilidad.',
    source: 'calculated',
    formula: 'Agregación de métricas de todos los módulos TMS',
    module: 'TMS Board',
    category: 'kpi',
  },
  buComparison: {
    label: 'Comparación entre BUs',
    description: 'Benchmark de desempeño financiero entre unidades de negocio.',
    source: 'supabase',
    sourceDetail: 'Agregación cross-module por empresa/BU',
    module: 'TMS Board',
    category: 'chart',
  },
};

// ── Data Model Dashboard ─────────────────────────────────────────────────
export const DATA_MODEL: Record<string, GlossaryEntry> = {
  erDiagram: {
    label: 'Diagrama ER',
    description: 'Diagrama Entidad-Relación de todas las tablas en Supabase: columnas, PKs, FKs y relaciones.',
    source: 'supabase',
    sourceDetail: 'information_schema.tables + columns + table_constraints + key_column_usage',
    module: 'Data Model',
    category: 'chart',
  },
  cdcMonitor: {
    label: 'CDC Monitor',
    description: 'Estado del pipeline de Change Data Capture: watermarks, eventos recientes, latencia.',
    source: 'kafka',
    sourceDetail: 'tms.cdc_watermarks + tms.cdc_events (alimentado por Kafka CDC pipeline)',
    module: 'Data Model',
    category: 'table',
  },
  kafkaMonitor: {
    label: 'Kafka Monitor',
    description: 'Estado del clúster Kafka: brokers, tópicos, particiones, factor de replicación.',
    source: 'kafka',
    sourceDetail: 'AKS Kafka cluster → 24 tópicos CDC, 3 brokers, KRaft mode',
    module: 'Data Model',
    category: 'table',
  },
  erpPcgraf: {
    label: 'ERP PcGraf Schema',
    description: 'Estructura de tablas del ERP PcGraf SQL Server con columnas, tipos y conteos.',
    source: 'pcgraf',
    sourceDetail: 'pymssql → INFORMATION_SCHEMA.COLUMNS + COUNT(*) por tabla',
    module: 'Data Model',
    category: 'table',
  },
  faissKb: {
    label: 'FAISS Knowledge Base',
    description: 'Estado de la base de conocimiento vectorial: documentos indexados, última sincronización.',
    source: 'faiss',
    sourceDetail: 'agent/knowledge_base.py → /kb/stats',
    module: 'Data Model',
    category: 'table',
  },
  dataCuration: {
    label: 'Curación de Datos',
    description: 'Herramienta para corregir y enriquecer datos en Supabase y/o PcGraf ERP.',
    source: 'supabase',
    sourceDetail: 'PATCH a Supabase + UPDATE a PcGraf + reindex FAISS',
    module: 'Data Model',
    category: 'table',
  },
};

// ── Concepts (cross-module) ──────────────────────────────────────────────
export const CONCEPTS: Record<string, GlossaryEntry> = {
  exchangeRateBCCR: {
    label: 'Tipo de Cambio BCCR',
    description: 'Tipo de cambio oficial del Banco Central de Costa Rica, consultado vía API REST.',
    source: 'api',
    sourceDetail: 'https://gee.bccr.fi.cr/Indicadores/ → compra/venta USD/CRC',
    module: 'Global',
    category: 'concept',
  },
  cdcPipeline: {
    label: 'CDC Pipeline (Change Data Capture)',
    description: 'Pipeline de captura de cambios: detecta INSERTs/UPDATEs/DELETEs en PcGraf SQL Server y replica a Supabase vía Kafka.',
    source: 'kafka',
    sourceDetail: 'AKS → cdc-producer (CronJob */5 min) → Kafka topics → cdc-consumer → Supabase',
    module: 'Global',
    category: 'concept',
  },
  faissKnowledgeBase: {
    label: 'FAISS Knowledge Base',
    description: 'Base de conocimiento vectorial que indexa datos de Supabase, PcGraf, archivos Excel/DOCX y eventos CDC para búsqueda semántica del AI Copilot.',
    source: 'faiss',
    sourceDetail: 'agent/knowledge_base.py → auto-sync cada 4 min + CDC incremental',
    module: 'Global',
    category: 'concept',
  },
  supabaseRLS: {
    label: 'Row-Level Security (RLS)',
    description: 'Políticas de seguridad a nivel de fila en Supabase que controlan acceso por usuario/rol.',
    source: 'supabase',
    sourceDetail: 'Políticas RLS en cada tabla de esquemas silver_finance, tms, bronze_finance',
    module: 'Global',
    category: 'concept',
  },
  semaphoreSystem: {
    label: 'Sistema de Semáforos',
    description: 'Indicadores visuales de estado: Verde (OK), Amarillo (Precaución), Rojo (Alerta). Basados en umbrales configurables.',
    source: 'calculated',
    formula: 'Verde: ratio > 1.2, Amarillo: 0.8-1.2, Rojo: < 0.8',
    module: 'Global',
    category: 'concept',
  },
};

// ── ALL ENTRIES (for Glossary page) ──────────────────────────────────────
export function getAllGlossaryEntries(): GlossaryEntry[] {
  const all: GlossaryEntry[] = [];
  for (const reg of [DASHBOARD, CASHFLOW, CREDIT, COMPRAS, INGRESOS, PROJECTS,
    ERP, TMS_CASH, TMS_CXP, TMS_CXC, TMS_INVOICING, TMS_FX, TMS_DEBT,
    TMS_RECON, TMS_MRP, TMS_BOARD, DATA_MODEL, CONCEPTS]) {
    all.push(...Object.values(reg));
  }
  return all;
}

export function getGlossaryByModule(): Record<string, GlossaryEntry[]> {
  const entries = getAllGlossaryEntries();
  const byModule: Record<string, GlossaryEntry[]> = {};
  for (const e of entries) {
    const mod = e.module || 'Otros';
    if (!byModule[mod]) byModule[mod] = [];
    byModule[mod].push(e);
  }
  return byModule;
}
