// ---------------------------------------------------------------------------
// Projects & Contracts BI — TypeScript types
// ---------------------------------------------------------------------------

export interface Contract {
  id: string;
  eurosat: string;
  consecutivo: number | null;
  fecha_inicial: string;
  fecha_cierre: string;
  fecha_adelanto: string;
  nombre_proyecto: string;
  proyecto_code: string;
  codigo_cliente: string;
  nombre_cliente: string;
  area: string;
  asesores: string;
  monto_contrato: number;
  monto_cancelado: number;
  pendiente_cobrar: number;
  monto_facturado: number;
  pendiente_facturar: number;
  adelantos: number;
  empresa: string;
  observaciones: string;
  pct_cobrado: number;
  pct_facturado: number;
}

export interface ProjectPortfolio {
  nombre_cliente: string;
  contract_count: number;
  total_monto_contrato: number;
  total_cancelado: number;
  total_pendiente_cobrar: number;
  total_facturado: number;
  total_pendiente_facturar: number;
  total_adelantos: number;
  pct_cobrado: number;
  pct_facturado: number;
  areas: string[];
  empresas: string[];
  fecha_inicio: string | null;
  fecha_fin: string | null;
  contracts: Contract[];
}

export interface MilestoneAlert {
  contract_id: string;
  nombre_proyecto: string;
  nombre_cliente: string;
  fecha_cierre: string;
  days_until: number;
  urgency: 'overdue' | 'critical' | 'warning' | 'attention';
  pendiente_cobrar: number;
  pendiente_facturar: number;
  monto_contrato: number;
  area: string;
  asesores: string;
}

export interface GanttItem {
  id: string;
  nombre_proyecto: string;
  nombre_cliente: string;
  start: string;
  end: string;
  progress: number;
  status: 'active' | 'completed' | 'overdue';
  monto_contrato: number;
  pendiente_cobrar: number;
  pendiente_facturar: number;
  pct_cobrado: number;
  area: string;
  asesores: string;
}

export interface AreaBreakdown {
  area: string;
  count: number;
  monto_contrato: number;
  cancelado: number;
  pendiente_cobrar: number;
  facturado: number;
  pendiente_facturar: number;
  pct_cobrado: number;
}

export interface CollectionRecord {
  id: string;
  empresa: string;
  unidad_negocio: string;
  tipo: string;
  recibo_pcgraf: number | null;
  estado: string;
  semana: string;
  fecha_flujo: string;
  moneda: string;
  monto: number;
  cliente: string;
  mes: string;
  cobrado: string;
  comentarios: string;
}

export interface WeeklyForecast {
  mes: string;
  semana: string;
  total: number;
  confirmado: number;
  pendiente: number;
  count: number;
}

export interface AgingSummary {
  sin_vencer: number;
  de_30_dias: number;
  de_60_dias: number;
  de_90_dias: number;
  mas_90_dias: number;
  total: number;
  record_count: number;
  by_negocio: Record<string, { total: number; count: number }>;
  by_status: Record<string, { total: number; count: number }>;
}

export interface ProjectKPIs {
  total_contracts: number;
  unique_clients: number;
  unique_areas: number;
  total_monto_contrato: number;
  total_cancelado: number;
  total_pendiente_cobrar: number;
  total_facturado: number;
  total_pendiente_facturar: number;
  total_adelantos: number;
  pct_cobrado_global: number;
  pct_facturado_global: number;
  critical_alert_count: number;
  warning_alert_count: number;
  total_alert_count: number;
  critical_alert_value: number;
}
