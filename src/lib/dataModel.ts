/**
 * Data Model Dashboard API client — proxied through the backend agent server.
 * Endpoints: /data-model/schema, /data-model/kafka, /data-model/erp-schema,
 *            /data-model/curation, /cdc/status, /cdc/registry, /kb/stats
 */

const AGENT_BASE = import.meta.env.VITE_AGENT_URL || '';

// ── Types ────────────────────────────────────────────────────────────────

export interface SchemaColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
}

export interface SchemaTable {
  table_schema: string;
  table_name: string;
  columns: SchemaColumn[] | null;
  primary_keys: string[] | null;
}

export interface ForeignKey {
  table_schema: string;
  table_name: string;
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

export interface DataModelSchema {
  tables: SchemaTable[];
  foreign_keys: ForeignKey[];
  error?: string;
}

export interface KafkaTopic {
  name: string;
  table: string;
  entity: string;
  partitions: number;
  replication_factor: number;
}

export interface KafkaCluster {
  brokers: number;
  controllers: number;
  version: string;
  mode: string;
  strimzi_version: string;
}

export interface KafkaStatus {
  bootstrap: string;
  topic_prefix: string;
  topics: KafkaTopic[];
  cluster: KafkaCluster;
  error?: string;
}

export interface ERPColumn {
  name: string;
  type: string;
  max_length: number | null;
  nullable: boolean;
  is_pk: boolean;
  ordinal: number;
}

export interface ERPTable {
  sql_table: string;
  entity: string;
  strategy: string;
  date_col: string | null;
  pk_columns: string[];
  row_count: number;
  columns: ERPColumn[];
  error?: string;
}

export interface ERPSchema {
  database: string;
  tables: ERPTable[];
  error?: string;
}

export interface CDCWatermark {
  id?: string;
  sql_table_name: string;
  last_checksum?: string;
  last_pk_value?: string;
  last_timestamp?: string;
  rows_at_last_poll?: number;
  last_poll_at?: string;
  changes_detected?: number;
}

export interface CDCStatus {
  watermarks: CDCWatermark[];
  recent_event_counts: Record<string, number>;
  total_recent_events: number;
  error?: string;
}

export interface TableRegistryEntry {
  id?: string;
  sql_table_name: string;
  entity_name: string;
  erp_module: string;
  business_name?: string;
  description?: string;
  supabase_table?: string;
  sync_enabled?: boolean;
}

export interface KBStats {
  total_documents: number;
  total_tables: number;
  last_sync: string | null;
  sync_interval_seconds: number;
  tables_indexed: string[];
  error?: string;
}

export interface CurationResult {
  results: Record<string, { status: string; message?: string; code?: number; rows_affected?: number }>;
}

// ── API Functions ────────────────────────────────────────────────────────

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${AGENT_BASE}${url}`, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function getDataModelSchema(): Promise<DataModelSchema> {
  return fetchJSON<DataModelSchema>('/data-model/schema');
}

export async function getKafkaStatus(): Promise<KafkaStatus> {
  return fetchJSON<KafkaStatus>('/data-model/kafka');
}

export async function getERPSchema(): Promise<ERPSchema> {
  return fetchJSON<ERPSchema>('/data-model/erp-schema');
}

export async function getCDCStatus(): Promise<CDCStatus> {
  return fetchJSON<CDCStatus>('/cdc/status');
}

export async function getTableRegistry(): Promise<{ tables: TableRegistryEntry[] }> {
  return fetchJSON<{ tables: TableRegistryEntry[] }>('/cdc/registry');
}

export async function getKBStats(): Promise<KBStats> {
  return fetchJSON<KBStats>('/kb/stats');
}

export async function triggerCDCPoll(table?: string): Promise<{ results: unknown[] }> {
  return fetchJSON<{ results: unknown[] }>('/cdc/poll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ table }),
  });
}

export async function saveCuration(params: {
  table: string;
  schema: string;
  row_id: string;
  changes: Record<string, unknown>;
  targets: string[];
  pk_col?: string;
}): Promise<CurationResult> {
  return fetchJSON<CurationResult>('/data-model/curation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export async function triggerKBSync(): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>('/kb/sync', { method: 'POST' });
}

export async function triggerKBCDCRefresh(): Promise<{ status: string }> {
  return fetchJSON<{ status: string }>('/kb/cdc_refresh', { method: 'POST' });
}
