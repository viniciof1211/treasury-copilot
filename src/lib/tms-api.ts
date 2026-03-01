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
