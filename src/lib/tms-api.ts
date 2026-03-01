/**
 * TMS Engine — Frontend API Client
 * Typed client for the Data Virtualization Layer + Transaction Engine
 */

const BASE = import.meta.env.VITE_AGENT_URL || '';

// ─── Helpers ────────────────────────────────────────────────────────────────

function headers(role = 'admin', userId = 'web-user', userName = ''): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-user-id': userId,
    'x-user-name': userName,
    'x-user-role': role,
  };
}

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, opts);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EntityConfig {
  entity: string;
  table: string;
  module: string;
  writable: boolean;
  approval_required: boolean;
}

export interface QueryResult<T = Record<string, unknown>> {
  entity: string;
  data: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  user_id: string;
  user_name: string;
  user_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  modulo: string;
  metadata: Record<string, unknown>;
}

export interface Notification {
  id: string;
  user_id: string;
  titulo: string;
  mensaje: string;
  tipo: 'info' | 'warning' | 'error' | 'success' | 'approval_required';
  modulo: string;
  entity_type: string;
  entity_id: string;
  action_url: string;
  leido: boolean;
  leido_at: string | null;
  created_at: string;
}

export interface BusinessRule {
  id: string;
  rule_id: string;
  modulo: string;
  nombre: string;
  descripcion: string;
  condicion: Record<string, unknown>;
  accion: Record<string, unknown>;
  es_activo: boolean;
  prioridad: number;
}

// ─── Module-Specific Types ──────────────────────────────────────────────────

export interface Contrato {
  id: string;
  numero_contrato: string;
  nombre: string;
  descripcion?: string;
  codigo_cliente?: string;
  nombre_cliente?: string;
  area_comercial?: string;
  vendedor?: string;
  project_manager?: string;
  monto_contrato: number;
  monto_facturado: number;
  monto_cobrado: number;
  monto_pendiente: number;
  saldo: number;
  moneda: string;
  estado: string;
  fecha_inicio?: string;
  fecha_fin_estimada?: string;
  fecha_firma?: string;
  tipo_proyecto?: string;
  empresa?: string;
  created_at: string;
  updated_at: string;
  version: number;
}

export interface HitoContrato {
  id: string;
  contrato_id: string;
  numero_hito: number;
  nombre: string;
  descripcion?: string;
  monto: number;
  monto_facturado: number;
  monto_cobrado: number;
  pendiente: number;
  saldo: number;
  moneda: string;
  estado: string;
  fecha_programada?: string;
  fecha_facturacion?: string;
  fecha_cobro?: string;
  factura_referencia?: string;
  created_at: string;
}

export interface DebtInstrument {
  id: string;
  numero_operacion: string;
  nombre: string;
  tipo: string;
  banco: string;
  empresa: string;
  moneda: string;
  monto_original: number;
  saldo_actual: number;
  tasa_interes: number;
  tasa_tipo: string;
  fecha_desembolso?: string;
  fecha_vencimiento: string;
  frecuencia_pago: string;
  estado: string;
  created_at: string;
  version: number;
}

export interface DebtSchedule {
  id: string;
  instrumento_id: string;
  numero_cuota: number;
  fecha_pago: string;
  principal: number;
  intereses: number;
  cuota: number;
  saldo_despues: number;
  estado: string;
  fecha_pago_real?: string;
  monto_pagado: number;
}

export interface CashflowForecastEntry {
  id: string;
  scenario_id?: string;
  empresa: string;
  semana_inicio: string;
  semana_fin?: string;
  status: 'ejecutado' | 'proyectado';
  ingresos: number;
  egresos: number;
  flujo_neto: number;
  saldo_acumulado: number;
  moneda: string;
  categoria?: string;
  subcategoria?: string;
  detalle?: string;
}

export interface PaymentBatch {
  id: string;
  nombre: string;
  descripcion?: string;
  fecha_pago: string;
  empresa: string;
  total_items: number;
  total_monto: number;
  moneda: string;
  estado: string;
  aprobado_por?: string;
  aprobado_at?: string;
  created_by: string;
  created_at: string;
  version: number;
}

export interface PaymentInstruction {
  id: string;
  batch_id?: string;
  codigo_proveedor?: string;
  nombre_beneficiario: string;
  documento_cxp?: string;
  monto: number;
  moneda: string;
  metodo_pago: string;
  prioridad: string;
  estado: string;
  empresa?: string;
  negocio?: string;
  clasificacion?: string;
  created_at: string;
}

export interface FxPosition {
  id: string;
  empresa: string;
  fecha_calculo: string;
  cxc_usd: number;
  cxp_usd: number;
  deuda_usd: number;
  efectivo_usd: number;
  exposicion_neta: number;
  tipo_cambio_compra: number;
  tipo_cambio_venta: number;
  exposicion_crc: number;
}

export interface FxHedge {
  id: string;
  empresa: string;
  tipo: string;
  contraparte: string;
  moneda_compra: string;
  moneda_venta: string;
  monto_nocional: number;
  tasa_pactada: number;
  fecha_inicio: string;
  fecha_vencimiento: string;
  tasa_mercado: number;
  valor_mark_to_market: number;
  estado: string;
}

// ─── API Functions ──────────────────────────────────────────────────────────

/** List all registered TMS entities */
export async function fetchEntities(): Promise<EntityConfig[]> {
  const r = await api<{ entities: EntityConfig[] }>('/tms/entities');
  return r.entities;
}

/** Generic query any TMS entity */
export async function queryEntity<T = Record<string, unknown>>(
  entity: string,
  params: Record<string, string | number> = {},
  role = 'admin',
): Promise<QueryResult<T>> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    qs.set(k, String(v));
  }
  return api<QueryResult<T>>(`/tms/${entity}?${qs}`, { headers: headers(role) });
}

/** Get a single entity by ID */
export async function getEntity<T = Record<string, unknown>>(
  entity: string,
  id: string,
  role = 'admin',
): Promise<T> {
  return api<T>(`/tms/${entity}/${id}`, { headers: headers(role) });
}

/** Create a new entity record */
export async function createEntity<T = Record<string, unknown>>(
  entity: string,
  data: Record<string, unknown>,
  role = 'admin',
): Promise<T> {
  return api<T>(`/tms/${entity}`, {
    method: 'POST',
    headers: headers(role),
    body: JSON.stringify(data),
  });
}

/** Update an existing entity record */
export async function updateEntity<T = Record<string, unknown>>(
  entity: string,
  id: string,
  data: Record<string, unknown>,
  role = 'admin',
): Promise<T> {
  return api<T>(`/tms/${entity}/${id}`, {
    method: 'PUT',
    headers: headers(role),
    body: JSON.stringify(data),
  });
}

/** Delete (soft or hard) an entity record */
export async function deleteEntity(
  entity: string,
  id: string,
  role = 'admin',
): Promise<{ deleted: boolean; id: string; soft: boolean }> {
  return api(`/tms/${entity}/${id}`, {
    method: 'DELETE',
    headers: headers(role),
  });
}

/** Approve/reject/return an entity pending approval */
export async function approveEntity(
  entity: string,
  id: string,
  action: 'aprobar' | 'rechazar' | 'devolver',
  comment = '',
  role = 'finance_manager',
): Promise<Record<string, unknown>> {
  return api(`/tms/${entity}/${id}/approve`, {
    method: 'POST',
    headers: headers(role),
    body: JSON.stringify({ action, comment }),
  });
}

/** Fetch audit log */
export async function fetchAuditLog(
  params: Record<string, string | number> = {},
): Promise<{ data: AuditEntry[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  return api(`/tms/audit?${qs}`, { headers: headers('admin') });
}

/** Fetch notifications for current user */
export async function fetchNotifications(unread = false): Promise<{ data: Notification[] }> {
  return api(`/tms/notifications?unread=${unread}`, { headers: headers('admin') });
}

/** Mark notification as read */
export async function markNotificationRead(id: string): Promise<unknown> {
  return api(`/tms/notifications/${id}/read`, {
    method: 'PUT',
    headers: headers('admin'),
  });
}

/** Fetch business rules */
export async function fetchBusinessRules(): Promise<{ data: BusinessRule[] }> {
  return api('/tms/rules', { headers: headers('admin') });
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Core Module Analytics APIs
// ═══════════════════════════════════════════════════════════════════════════

// ── M1: Cash Management ─────────────────────────────────────────────────

export interface CashPosition {
  empresa: string;
  total_ingresos: number;
  total_egresos: number;
  flujo_neto: number;
  saldo_acumulado: number;
  moneda: string;
  semanas: number;
}

export interface ForecastWeek {
  semana: string;
  ingresos_ejecutado: number;
  egresos_ejecutado: number;
  ingresos_proyectado: number;
  egresos_proyectado: number;
  flujo_neto: number;
  saldo_acumulado: number;
}

export interface LiquidityBucket {
  bucket: string;
  max_days: number;
  inflows: number;
  outflows: number;
  gap: number;
  cumulative_gap: number;
}

export async function fetchCashPosition(empresa?: string): Promise<{ positions: CashPosition[]; consolidated: CashPosition }> {
  const qs = empresa ? `?empresa=${empresa}` : '';
  return api(`/tms/cash/position${qs}`, { headers: headers('admin') });
}

export async function fetchCashForecast(weeks = 12, empresa?: string): Promise<{ forecast: ForecastWeek[] }> {
  const qs = new URLSearchParams({ weeks: String(weeks) });
  if (empresa) qs.set('empresa', empresa);
  return api(`/tms/cash/forecast?${qs}`, { headers: headers('admin') });
}

export async function fetchLiquidityGap(): Promise<{ buckets: LiquidityBucket[] }> {
  return api('/tms/cash/liquidity-gap', { headers: headers('admin') });
}

export async function fetchCashScenarios(): Promise<{ scenarios: Record<string, unknown>[] }> {
  return api('/tms/cash/scenarios', { headers: headers('admin') });
}

// ── M2: CxP Payments ────────────────────────────────────────────────────

export interface CxPDashboardData {
  kpis: {
    total_pendiente: number;
    total_pagado: number;
    total_items: number;
    pending_batch_count: number;
    pending_batch_amount: number;
    approved_batch_count: number;
  };
  aging: { bucket: string; monto: number; count: number }[];
  by_priority: { priority: string; monto: number }[];
  by_estado: { estado: string; count: number }[];
  by_metodo: { metodo: string; monto: number }[];
  top_proveedores: { nombre: string; monto: number }[];
  pending_batches: Record<string, unknown>[];
}

export interface PaymentScheduleWeek {
  week: number;
  start: string;
  end: string;
  batches: number;
  total_monto: number;
  items: number;
  approved: number;
  pending: number;
}

export async function fetchCxPDashboard(empresa?: string): Promise<CxPDashboardData> {
  const qs = empresa ? `?empresa=${empresa}` : '';
  return api(`/tms/cxp/dashboard${qs}`, { headers: headers('admin') });
}

export async function fetchPaymentSchedule(weeks = 4): Promise<{ schedule: PaymentScheduleWeek[] }> {
  return api(`/tms/cxp/schedule?weeks=${weeks}`, { headers: headers('admin') });
}

// ── M3: CxC Collections ─────────────────────────────────────────────────

export interface CxCDashboardData {
  kpis: {
    total_pendiente: number;
    total_cobrado: number;
    total_items: number;
    dso: number;
    collection_rate: number;
  };
  aging: { bucket: string; monto: number; count: number }[];
  by_area: { area: string; pendiente: number; cobrado: number; count: number }[];
  by_gestor: { gestor: string; pendiente: number; count: number; dias_mora_avg: number }[];
  by_estado: { estado: string; count: number }[];
  top_clientes: { cliente: string; monto: number }[];
}

export interface WorklistItem {
  cliente: string;
  factura: string;
  monto: number;
  moneda: string;
  dias_mora: number;
  area_comercial: string;
  gestor_cobro: string;
  estado: string;
  priority_score: number;
  vencimiento: string;
  proyecto?: string;
}

export async function fetchCxCDashboard(empresa?: string): Promise<CxCDashboardData> {
  const qs = empresa ? `?empresa=${empresa}` : '';
  return api(`/tms/cxc/dashboard${qs}`, { headers: headers('admin') });
}

export async function fetchCollectionWorklist(gestor?: string, area?: string, limit = 50): Promise<{ worklist: WorklistItem[] }> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (gestor) qs.set('gestor', gestor);
  if (area) qs.set('area', area);
  return api(`/tms/cxc/worklist?${qs}`, { headers: headers('admin') });
}

// ── M6: Invoicing ───────────────────────────────────────────────────────

export interface InvoicingDashboardData {
  kpis: {
    total_contratado: number;
    total_facturado: number;
    total_cobrado: number;
    total_pendiente: number;
    facturacion_ratio: number;
    cobranza_ratio: number;
    contratos_activos: number;
    hitos_pendientes: number;
  };
  contratos_by_estado: { estado: string; count: number }[];
  hitos_by_estado: { estado: string; count: number; monto: number }[];
  by_empresa: { empresa: string; contratado: number; facturado: number; cobrado: number; contratos: number }[];
  upcoming_hitos: Record<string, unknown>[];
}

export async function fetchInvoicingDashboard(): Promise<InvoicingDashboardData> {
  return api('/tms/invoicing/dashboard', { headers: headers('admin') });
}

export async function fetchContractDetail(id: string): Promise<{ contrato: Record<string, unknown>; hitos: Record<string, unknown>[] }> {
  return api(`/tms/invoicing/contract/${id}`, { headers: headers('admin') });
}
