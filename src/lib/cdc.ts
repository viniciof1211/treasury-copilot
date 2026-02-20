/**
 * CDC (Change Data Capture) frontend client.
 * Monitors PcGraf → Supabase sync status, triggers polls, views table registry.
 */

const AGENT_BASE = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000';

// ── Types ──────────────────────────────────────────────────────────────────
export interface CDCWatermark {
  id: number;
  sql_table_name: string;
  last_poll_at: string;
  last_row_hash: string | null;
  last_max_pk: string | null;
  last_max_date: string | null;
  rows_synced: number;
  rows_pending: number;
  poll_interval_s: number;
  status: string;
  error_message: string | null;
}

export interface TableRegistryEntry {
  id: number;
  sql_table_name: string;
  entity_name: string;
  display_name: string;
  erp_module: string;
  description: string;
  row_count_erp: number;
  col_count_erp: number;
  pk_columns_erp: string[];
  supabase_table: string;
  kafka_topic: string;
  cdc_enabled: boolean;
  last_cdc_at: string | null;
}

export interface CDCPollResult {
  table: string;
  changes: number;
  committed_supabase?: number;
  published_kafka?: number;
  error?: string;
}

export interface CDCStatus {
  watermarks: CDCWatermark[];
  recent_event_counts: Record<string, number>;
  total_recent_events: number;
}

// ── API Calls ──────────────────────────────────────────────────────────────

/**
 * Get CDC status: watermarks and recent event counts.
 */
export async function getCDCStatus(): Promise<CDCStatus & { error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/cdc/status`);
    return await res.json();
  } catch (e) {
    return { watermarks: [], recent_event_counts: {}, total_recent_events: 0, error: String(e) };
  }
}

/**
 * Trigger an immediate CDC poll for one or all tables.
 */
export async function triggerCDCPoll(table?: string): Promise<{ results: CDCPollResult[]; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/cdc/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: table || null }),
    });
    return await res.json();
  } catch (e) {
    return { results: [], error: String(e) };
  }
}

/**
 * Get the table registry mapping SQL tech names to business-readable names.
 */
export async function getTableRegistry(): Promise<{ tables: TableRegistryEntry[]; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/cdc/registry`);
    return await res.json();
  } catch (e) {
    return { tables: [], error: String(e) };
  }
}
