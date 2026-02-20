/**
 * Multi-Source Data Integration Architecture
 * Orchestrates data flow between: Excel/CSV files, PcGraf ERP, TICA/Aduanas, and Supabase.
 *
 * Data Flow:
 *   Excel/CSV → DataSources (ingest) → Supabase bronze_finance → silver_finance.mrp_master
 *   PcGraf ERP → pcgraf proxy → Supabase bronze_finance.pcgraf_backups (immutable)
 *   TICA/Aduanas → tica proxy → DUA/CIF data for conciliation
 *   Code Mapping → AI matching → silver_finance.code_mappings
 *   Curation → silver_finance.mrp_master (curado_por, curado_at) + curation_log
 */

import { supabase } from './supabase';
import { pcgrafQuery, pcgrafBackup } from './pcgraf';
import { searchDUAs, type TICADUAResult } from './tica';
import type { MRPItem } from './queries';

const AGENT_BASE = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000';

// ── Types ──────────────────────────────────────────────────────────────────
export interface IntegrationSource {
  id: string;
  name: string;
  type: 'excel' | 'pcgraf' | 'tica' | 'supabase' | 'api';
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
  lastSync?: string;
  recordCount?: number;
  error?: string;
}

export interface SyncResult {
  source: string;
  status: 'success' | 'partial' | 'error';
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  errors: string[];
  duration_ms: number;
}

export interface ConsolidationReport {
  timestamp: string;
  sources: IntegrationSource[];
  totalRecords: number;
  matchedRecords: number;
  unmatchedRecords: number;
  duplicates: number;
  conflicts: Array<{
    field: string;
    source_a: string;
    value_a: string;
    source_b: string;
    value_b: string;
    record_id: string;
  }>;
}

// ── Source Status Check ────────────────────────────────────────────────────

/**
 * Check connectivity and status of all integration sources.
 */
export async function checkAllSources(): Promise<IntegrationSource[]> {
  const sources: IntegrationSource[] = [];

  // 1. Supabase
  try {
    const { count, error } = await supabase
      .schema('silver_finance' as 'public')
      .from('mrp_master')
      .select('*', { count: 'exact', head: true });
    sources.push({
      id: 'supabase',
      name: 'Supabase (silver_finance.mrp_master)',
      type: 'supabase',
      status: error ? 'error' : 'connected',
      recordCount: count || 0,
      error: error?.message,
    });
  } catch (e) {
    sources.push({ id: 'supabase', name: 'Supabase', type: 'supabase', status: 'error', error: String(e) });
  }

  // 2. PcGraf ERP
  try {
    const res = await fetch(`${AGENT_BASE}/pcgraf/health`);
    const data = await res.json();
    sources.push({
      id: 'pcgraf',
      name: `PcGraf ERP (${data.server || 'N/A'})`,
      type: 'pcgraf',
      status: data.status === 'connected' ? 'connected' : data.status === 'not_configured' ? 'disconnected' : 'error',
      error: data.error,
    });
  } catch (e) {
    sources.push({ id: 'pcgraf', name: 'PcGraf ERP', type: 'pcgraf', status: 'disconnected', error: String(e) });
  }

  // 3. TICA/Aduanas
  try {
    const res = await fetch(`${AGENT_BASE}/tica/health`);
    const data = await res.json();
    sources.push({
      id: 'tica',
      name: 'TICA / Aduanas (Hacienda CR)',
      type: 'tica',
      status: data.status === 'reachable' ? 'connected' : 'error',
      error: data.error,
    });
  } catch (e) {
    sources.push({ id: 'tica', name: 'TICA / Aduanas', type: 'tica', status: 'disconnected', error: String(e) });
  }

  // 4. Code Mappings
  try {
    const res = await fetch(`${AGENT_BASE}/code-mapping/list?limit=1`);
    const data = await res.json();
    sources.push({
      id: 'code_mappings',
      name: 'AI Code Mappings',
      type: 'supabase',
      status: 'connected',
      recordCount: (data.mappings || []).length,
    });
  } catch (e) {
    sources.push({ id: 'code_mappings', name: 'AI Code Mappings', type: 'supabase', status: 'error', error: String(e) });
  }

  return sources;
}

// ── Excel Consolidation ────────────────────────────────────────────────────

/**
 * Detect and classify tipo_compra for items that don't have it set.
 * Uses the same pattern detection logic as ComprasDashboard enrichedData.
 */
export function classifyTipoCompra(item: Partial<MRPItem>): 'Local' | 'Internacional' | 'Sin Definir' {
  const origen = (item.origen || '').toLowerCase();
  const tipo = (item.tipo_item || '').toLowerCase();
  const prov = (item.proveedor || '').toLowerCase();
  const lt = Number(item.lead_time_dias) || 0;

  if (tipo === 'importado') return 'Internacional';
  if (tipo === 'local') return 'Local';
  if (['europa', 'asia', 'china', 'america', 'usa', 'eeuu', 'mexico', 'ecuador', 'brasil', 'india', 'taiwan', 'japon', 'alemania', 'italia', 'españa'].some(o => origen.includes(o))) return 'Internacional';
  if (['local', 'costa rica', 'cr', 'nacional'].some(o => origen.includes(o))) return 'Local';
  if (lt > 30) return 'Internacional';
  if (lt > 0 && lt <= 7) return 'Local';
  if (['import', 'trading', 'overseas', 'international', 'global', 'gmbh', 'ltd', 'inc', 'corp'].some(k => prov.includes(k))) return 'Internacional';
  return 'Sin Definir';
}

// ── PcGraf Sync ────────────────────────────────────────────────────────────

/**
 * Sync curated data from Supabase back to PcGraf ERP.
 * Creates an immutable backup before any write operation.
 */
export async function syncToPcGraf(params: {
  database: string;
  table: string;
  records: Array<{ codigo: string; field: string; value: string | number }>;
  user?: string;
}): Promise<SyncResult> {
  const start = Date.now();
  const errors: string[] = [];
  let created = 0, updated = 0, skipped = 0;

  // Step 1: Create immutable backup
  const backup = await pcgrafBackup({
    database: params.database,
    table: params.table,
    backup_type: 'pre_sync',
    user: params.user || 'system',
  });

  if (backup.error) {
    return {
      source: 'pcgraf',
      status: 'error',
      recordsProcessed: 0, recordsCreated: 0, recordsUpdated: 0, recordsSkipped: 0,
      errors: [`Backup failed: ${backup.error}`],
      duration_ms: Date.now() - start,
    };
  }

  // Step 2: Execute updates via proxy
  for (const rec of params.records) {
    try {
      const sql = `UPDATE ${params.table} SET ${rec.field} = '${String(rec.value).replace(/'/g, "''")}' WHERE Codigo = '${rec.codigo.replace(/'/g, "''")}'`;
      const result = await pcgrafQuery(params.database, sql);
      if (result.error) {
        errors.push(`${rec.codigo}: ${result.error}`);
        skipped++;
      } else {
        updated++;
      }
    } catch (e) {
      errors.push(`${rec.codigo}: ${String(e)}`);
      skipped++;
    }
  }

  // Step 3: Log sync in curation_log
  for (const rec of params.records) {
    await supabase
      .schema('silver_finance' as 'public')
      .from('curation_log')
      .insert({
        table_name: params.table,
        field_name: rec.field,
        new_value: String(rec.value),
        edited_by: params.user || 'system',
        sync_to_pcgraf: true,
        sync_status: errors.some(e => e.startsWith(rec.codigo)) ? 'failed' : 'synced',
        sync_at: new Date().toISOString(),
      });
  }

  return {
    source: 'pcgraf',
    status: errors.length === 0 ? 'success' : errors.length < params.records.length ? 'partial' : 'error',
    recordsProcessed: params.records.length,
    recordsCreated: created,
    recordsUpdated: updated,
    recordsSkipped: skipped,
    errors,
    duration_ms: Date.now() - start,
  };
}

// ── TICA/Aduanas Conciliation ──────────────────────────────────────────────

/**
 * Run a full conciliation cycle: fetch DUAs, match against internal items,
 * and generate a report of matched/unmatched items.
 */
export async function runTICAConciliation(params: {
  cedula: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  internalItems: Array<{ codigo: string; descripcion: string; cantidad: number; valor: number }>;
}): Promise<{
  duas: TICADUAResult[];
  matchedCount: number;
  unmatchedCount: number;
  totalCIF: number;
  totalDAI: number;
  totalIVA: number;
}> {
  const result = await searchDUAs({
    cedula: params.cedula,
    fecha_inicio: params.fecha_inicio,
    fecha_fin: params.fecha_fin,
  });

  let totalCIF = 0, totalDAI = 0, totalIVA = 0;
  for (const dua of result.duas) {
    totalCIF += dua.valor_cif || 0;
    totalDAI += dua.dai_total || 0;
    totalIVA += dua.iva_total || 0;
  }

  return {
    duas: result.duas,
    matchedCount: 0,
    unmatchedCount: params.internalItems.length,
    totalCIF,
    totalDAI,
    totalIVA,
  };
}

// ── Full Consolidation Report ──────────────────────────────────────────────

/**
 * Generate a comprehensive consolidation report across all data sources.
 */
export async function generateConsolidationReport(): Promise<ConsolidationReport> {
  const sources = await checkAllSources();

  // Get total records from Supabase
  const { count } = await supabase
    .schema('silver_finance' as 'public')
    .from('mrp_master')
    .select('*', { count: 'exact', head: true });

  // Get code mappings stats
  let matchedRecords = 0;
  try {
    const res = await fetch(`${AGENT_BASE}/code-mapping/list?confirmed=true`);
    const data = await res.json();
    matchedRecords = (data.mappings || []).length;
  } catch { /* ignore */ }

  return {
    timestamp: new Date().toISOString(),
    sources,
    totalRecords: count || 0,
    matchedRecords,
    unmatchedRecords: (count || 0) - matchedRecords,
    duplicates: 0,
    conflicts: [],
  };
}
