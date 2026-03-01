// ---------------------------------------------------------------------------
// ERP Modules API client — Facturas, Contratos, Hitos
// ---------------------------------------------------------------------------
import type {
  Factura, FacturaHeader, FacturaLinea, FacturasKPIsResponse,
  NegocioBreakdown, MonthlyTrend, TopCliente,
  ContratosResponse, HitosResponse, TableSchemaResponse,
} from '../types/erp-modules';

const API = import.meta.env.VITE_AGENT_URL || '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`ERP API ${path}: ${res.status}`);
  return res.json();
}

// ── Facturas ────────────────────────────────────────────────────────────────

export async function fetchFacturas(params?: {
  limit?: number; offset?: number; cliente?: string;
  desde?: string; hasta?: string; negocio?: string; tipo?: string;
}): Promise<{ facturas: Factura[]; total: number; kpis: Record<string, unknown>; offset: number; limit: number }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.cliente) qs.set('cliente', params.cliente);
  if (params?.desde) qs.set('desde', params.desde);
  if (params?.hasta) qs.set('hasta', params.hasta);
  if (params?.negocio) qs.set('negocio', params.negocio);
  if (params?.tipo) qs.set('tipo', params.tipo);
  const q = qs.toString();
  return get(`/erp/facturas${q ? `?${q}` : ''}`);
}

export async function fetchFacturaDetalle(pedido: string): Promise<{
  header: FacturaHeader | null;
  lines: FacturaLinea[];
  line_count: number;
}> {
  return get(`/erp/factura-detalle?pedido=${encodeURIComponent(pedido)}`);
}

export async function fetchFacturasKPIs(): Promise<FacturasKPIsResponse> {
  return get('/erp/facturas-kpis');
}

export async function fetchFacturasPorNegocio(): Promise<{ breakdown: NegocioBreakdown[] }> {
  return get('/erp/facturas-negocio');
}

export async function fetchFacturasMensual(): Promise<{ monthly: MonthlyTrend[] }> {
  return get('/erp/facturas-mensual');
}

export async function fetchTopClientes(limit?: number): Promise<{ clientes: TopCliente[] }> {
  const qs = limit ? `?limit=${limit}` : '';
  return get(`/erp/top-clientes${qs}`);
}

// ── Contratos ───────────────────────────────────────────────────────────────

export async function fetchContratos(params?: {
  limit?: number; offset?: number; proyecto?: string;
}): Promise<ContratosResponse> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  if (params?.proyecto) qs.set('proyecto', params.proyecto);
  const q = qs.toString();
  return get(`/erp/contratos${q ? `?${q}` : ''}`);
}

export async function fetchContratoDetalle(id: string): Promise<Record<string, unknown>> {
  return get(`/erp/contrato-detalle?id=${encodeURIComponent(id)}`);
}

// ── Hitos ───────────────────────────────────────────────────────────────────

export async function fetchHitos(contrato?: string): Promise<HitosResponse> {
  const qs = contrato ? `?contrato=${encodeURIComponent(contrato)}` : '';
  return get(`/erp/hitos${qs}`);
}

// ── Schema Discovery ────────────────────────────────────────────────────────

export async function fetchTableSchema(table: string): Promise<TableSchemaResponse> {
  return get(`/erp/table-schema?table=${encodeURIComponent(table)}`);
}
