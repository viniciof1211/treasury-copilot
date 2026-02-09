/** Shared data-fetching helper for dashboard pages */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export async function querySQL(sql: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/treasury-tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ tool: 'query_sql', params: { sql } }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.rows || [];
}

// ── Shared types ─────────────────────────────────────────────────────────────
export interface CxPItem {
  empresa: string; proveedor: string; monto_usd: number;
  vencimiento_fecha: string; prioridad: string; clasificacion: string;
  negocio: string; responsable: string; detalle: string;
  created_at: string; ingest_run_id: string;
}

export interface FlujoItem {
  compania: string; cuota: number; principal: number; intereses: number;
  vencimiento: string; banco: string; tipo: string; operacion: string;
  saldo_original: number; capital: number; capital_actualizado: number;
  moneda: string; semana_inicio: string; semana_fin: string;
  created_at: string; ingest_run_id: string;
}

export interface Projection {
  projection_month: string; projected_inflows: number;
  projected_outflows: number; projected_balance: number;
}

export interface IngestRun {
  id: string; source_file: string; status: string;
  rows_inserted: number; created_at: string;
}

export interface MRPItem {
  codigo: string; descripcion: string; abc_class: string; tipo_stock: string;
  comprador: string; tipo_item: string; proveedor: string;
  lead_time_dias: number; origen: string; dificultad_logistica: number;
  compra_minima: number; unidad_medida: string;
  consumo_m1: number; consumo_m2: number; consumo_m3: number; consumo_m4: number;
  consumo_m5: number; consumo_m6: number; consumo_m7: number; consumo_m8: number;
  consumo_promedio: number; consumo_diario: number; desv_estandar: number;
  inventario: number; reserva: number; inventario_disponible: number;
  transito: number; inventario_total: number; dias_cobertura: number;
  minimo_inventario: number; dias_stock: number; stock_seguridad: number;
  punto_reorden: number; max_inventario: number;
  costo_unitario: number; costo_inventario: number;
  costo_inventario_transito: number; costo_total_inventario: number;
  costo_stock_seguridad: number; costo_inv_min: number;
  costo_inv_reorden: number; costo_inv_max: number;
  alerta_desabasto: string | null; hacer_pedido: string | null;
  cantidad_requerida: number; analisis_parametros: string | null;
  familia: string; infaltable: string; descontinuado: string;
  subclasificacion: string;
  created_at: string; ingest_run_id: string;
}

export type TimePeriod = '1m' | '3m' | '6m' | '12m' | 'all';

export function getDateCutoff(period: TimePeriod): string | null {
  if (period === 'all') return null;
  const d = new Date();
  const months = period === '1m' ? 1 : period === '3m' ? 3 : period === '6m' ? 6 : 12;
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

export const PERIOD_LABELS: Record<TimePeriod, string> = {
  '1m': 'Último mes', '3m': '3 meses', '6m': '6 meses', '12m': '12 meses', all: 'Todo',
};

// Shared chart tooltip style
export const tooltipStyle = {
  backgroundColor: 'white', border: '1px solid #e5e7eb',
  borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px',
};
