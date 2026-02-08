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
