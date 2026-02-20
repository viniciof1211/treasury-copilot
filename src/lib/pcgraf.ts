/**
 * PcGraf ERP SQL Server client — proxied through the backend agent server.
 * All queries go through /pcgraf/query which connects to the legacy SQL Server (192.168.1.3).
 * Credentials are stored server-side only (never exposed to the browser).
 */

const AGENT_BASE = import.meta.env.VITE_AGENT_URL || '';

interface PcGrafQueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
  row_count: number;
  total_rows: number;
  query: string;
  error?: string;
}

interface PcGrafHealthResult {
  status: 'connected' | 'error' | 'not_configured';
  server: string;
  version?: string;
  server_name?: string;
  current_db?: string;
  error?: string;
}

interface PcGrafTablesResult {
  database: string;
  tables: { schema: string; table: string; type: string }[];
  error?: string;
}

/**
 * Execute a read-only SQL query against PcGraf ERP.
 * Only SELECT and EXEC statements are allowed (enforced server-side).
 */
export async function pcgrafQuery(sql: string, database?: string): Promise<PcGrafQueryResult> {
  try {
    const res = await fetch(`${AGENT_BASE}/pcgraf/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, database: database || '' }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { rows: [], columns: [], row_count: 0, total_rows: 0, query: sql, error: data.error || `HTTP ${res.status}` };
    }
    return data as PcGrafQueryResult;
  } catch (e) {
    return { rows: [], columns: [], row_count: 0, total_rows: 0, query: sql, error: String(e) };
  }
}

/**
 * Check PcGraf SQL Server connectivity.
 */
export async function pcgrafHealth(): Promise<PcGrafHealthResult> {
  try {
    const res = await fetch(`${AGENT_BASE}/pcgraf/health`);
    return await res.json();
  } catch (e) {
    return { status: 'error', server: '', error: String(e) };
  }
}

/**
 * List available databases on PcGraf SQL Server.
 */
export async function pcgrafDatabases(): Promise<string[]> {
  try {
    const res = await fetch(`${AGENT_BASE}/pcgraf/databases`);
    const data = await res.json();
    return data.databases || [];
  } catch {
    return [];
  }
}

/**
 * List tables in a PcGraf database.
 */
export async function pcgrafTables(database?: string): Promise<PcGrafTablesResult> {
  try {
    const url = database
      ? `${AGENT_BASE}/pcgraf/tables?database=${encodeURIComponent(database)}`
      : `${AGENT_BASE}/pcgraf/tables`;
    const res = await fetch(url);
    return await res.json();
  } catch (e) {
    return { database: database || '', tables: [], error: String(e) };
  }
}

/**
 * Create an immutable backup of PcGraf data before curation/sync.
 */
export async function pcgrafBackup(params: {
  database?: string;
  table?: string;
  sql?: string;
  backup_type?: string;
  user?: string;
}): Promise<{ status?: string; backup_id?: string; row_count?: number; checksum?: string; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/pcgraf/backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * List existing PcGraf backups.
 */
export async function pcgrafBackupList(): Promise<{ backups: Array<{
  id: string; backup_type: string; source_database: string; source_table: string;
  row_count: number; checksum: string; created_by: string; created_at: string;
}> }> {
  try {
    const res = await fetch(`${AGENT_BASE}/pcgraf/backups`);
    return await res.json();
  } catch {
    return { backups: [] };
  }
}

export type { PcGrafQueryResult, PcGrafHealthResult, PcGrafTablesResult };
