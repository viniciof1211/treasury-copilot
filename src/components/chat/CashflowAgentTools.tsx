import { useEffect, useState, useCallback } from 'react';
import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function callTreasuryTool(tool: string, params: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/treasury-tools`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ tool, params }),
  });
  if (!res.ok) {
    if (res.status === 404) {
      return { error: 'Edge Function "treasury-tools" not deployed. Deploy with: npx supabase functions deploy treasury-tools', rows: [] };
    }
    return { error: `Edge Function error: ${res.status} ${res.statusText}`, rows: [] };
  }
  return res.json();
}

export function CashflowAgentTools() {
  const [dataInventory, setDataInventory] = useState<string>('Loading data inventory...');

  const refreshInventory = useCallback(async () => {
    try {
      const [ingestResult, cxpResult, flujoResult, projResult] = await Promise.all([
        callTreasuryTool('query_sql', {
          sql: `SELECT id, source_file, status, rows_inserted, created_at
                FROM bronze_finance.ingest_runs
                ORDER BY created_at DESC LIMIT 10`,
        }),
        callTreasuryTool('query_sql', {
          sql: `SELECT COUNT(*) as total,
                  COUNT(DISTINCT empresa) as empresas,
                  COUNT(DISTINCT proveedor) as proveedores,
                  SUM(monto_usd) as total_usd,
                  MIN(vencimiento_fecha) as min_fecha,
                  MAX(vencimiento_fecha) as max_fecha
                FROM silver_finance.cxp_items`,
        }),
        callTreasuryTool('query_sql', {
          sql: `SELECT COUNT(*) as total,
                  COUNT(DISTINCT compania) as companias,
                  SUM(cuota) as total_cuotas,
                  MIN(vencimiento) as min_venc,
                  MAX(vencimiento) as max_venc
                FROM silver_finance.flujo_semanal`,
        }),
        callTreasuryTool('query_sql', {
          sql: `SELECT COUNT(*) as total,
                  MIN(projection_month) as desde,
                  MAX(projection_month) as hasta
                FROM silver_finance.projection_12m`,
        }),
      ]);

      const runs = ingestResult.rows || [];
      const cxp = cxpResult.rows?.[0] || {};
      const flujo = flujoResult.rows?.[0] || {};
      const proj = projResult.rows?.[0] || {};

      const summary = [
        `=== DATA INVENTORY (auto-refreshed) ===`,
        ``,
        `Ingest Runs (últimos 10):`,
        runs.length > 0
          ? runs.map((r: Record<string, unknown>) =>
              `  - ${r.source_file} | ${r.status} | ${r.rows_inserted} rows | ${r.created_at}`
            ).join('\n')
          : '  (ninguno)',
        ``,
        `CxP Items: ${cxp.total || 0} registros, ${cxp.empresas || 0} empresas, ${cxp.proveedores || 0} proveedores`,
        cxp.total_usd ? `  Total USD: $${Number(cxp.total_usd).toLocaleString()}` : '',
        cxp.min_fecha ? `  Rango fechas: ${cxp.min_fecha} a ${cxp.max_fecha}` : '',
        ``,
        `Flujo Semanal: ${flujo.total || 0} operaciones, ${flujo.companias || 0} compañías`,
        flujo.total_cuotas ? `  Total cuotas: $${Number(flujo.total_cuotas).toLocaleString()}` : '',
        flujo.min_venc ? `  Rango: ${flujo.min_venc} a ${flujo.max_venc}` : '',
        ``,
        `Proyección 12M: ${proj.total || 0} registros`,
        proj.desde ? `  Desde: ${proj.desde} hasta: ${proj.hasta}` : '',
        ``,
        `Tablas disponibles para query_sql:`,
        `  - silver_finance.cxp_items (CxP: proveedor, monto_usd, vencimiento_fecha, prioridad, empresa, negocio)`,
        `  - silver_finance.flujo_semanal (operaciones bancarias: compania, cuota, principal, intereses, vencimiento)`,
        `  - silver_finance.projection_12m (proyección mensual: projected_inflows, projected_outflows, projected_balance)`,
        `  - bronze_finance.ingest_runs (historial de ingestas)`,
        `  - dim.business_units (BUs: Euromobilia, Paneltech, Multiclamp)`,
        `  - dim.allocation_rules (reglas de distribución)`,
      ].filter(Boolean).join('\n');

      setDataInventory(summary);
    } catch {
      setDataInventory('Data inventory unavailable — run query_sql to discover available data.');
    }
  }, []);

  useEffect(() => {
    refreshInventory();
    const interval = setInterval(refreshInventory, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [refreshInventory]);

  useCopilotReadable({
    description: 'Current treasury data inventory — tables, row counts, date ranges, and recent ingest runs. Use this to know what data is available before querying.',
    value: dataInventory,
  });
  useCopilotAction({
    name: 'query_sql',
    description: 'Execute a read-only SELECT query on bronze_finance, silver_finance, or dim schemas. Use for: cxp_items, flujo_semanal, projection_12m, ingest_runs, business_units, allocation_rules. Never invent data - only use results from this tool.',
    parameters: [
      {
        name: 'sql',
        type: 'string',
        description: 'Valid SELECT SQL (e.g. SELECT * FROM silver_finance.cxp_items LIMIT 50)',
        required: true,
      },
    ],
    handler: async ({ sql }) => {
      const result = await callTreasuryTool('query_sql', { sql });
      if (result.error) return JSON.stringify({ error: result.error, rows: [] });
      return JSON.stringify({ rows: result.rows, count: result.rows?.length ?? 0 });
    },
  });

  useCopilotAction({
    name: 'ingest_excel',
    description: 'Process an Excel file from Supabase Storage (treasury-files bucket). Use file_id path or "latest" for most recent XLSX. Returns ingest_run_id for trazabilidad. Only files processed here are valid data sources.',
    parameters: [
      {
        name: 'file_id',
        type: 'string',
        description: 'Storage path or "latest" for most recent XLSX',
        required: false,
      },
    ],
    handler: async ({ file_id }) => {
      const result = await callTreasuryTool('ingest_excel', { file_id: file_id || 'latest' });
      return JSON.stringify(result);
    },
  });

  useCopilotAction({
    name: 'recalc_projection',
    description: 'Recalculate 12-month cashflow projection from Flujo Semanal and CxP data. Applies 25% allocation per BU. Updates silver_finance.projection_12m.',
    parameters: [],
    handler: async () => {
      const result = await callTreasuryTool('recalc_projection', {});
      return JSON.stringify(result);
    },
  });

  useCopilotAction({
    name: 'list_storage_files',
    description: 'List Excel/CSV files available in the treasury-files storage bucket. Use this to see what files can be ingested.',
    parameters: [],
    handler: async () => {
      const result = await callTreasuryTool('query_sql', {
        sql: `SELECT source_file, status, rows_inserted, created_at
              FROM bronze_finance.ingest_runs
              ORDER BY created_at DESC LIMIT 20`,
      });
      return JSON.stringify({
        ingest_history: result.rows || [],
        message: 'Use ingest_excel with file_id to process a specific file.',
      });
    },
  });

  useCopilotAction({
    name: 'refresh_data_context',
    description: 'Refresh the data inventory context after a new ingest. Call this after ingest_excel to update what data is available.',
    parameters: [],
    handler: async () => {
      await refreshInventory();
      return JSON.stringify({ message: 'Data inventory refreshed. Check context for updated counts.' });
    },
  });

  useCopilotAction({
    name: 'generate_gemini_image',
    description: 'Generate an executive visualization image using Gemini. Always call when presenting numeric data. Use ARA palette: verde #1A4A28, blanco, gris claro, dorado. chart_type: linea|barras|waterfall|gantt|heatmap. Prompt must be ≤2000 chars.',
    parameters: [
      { name: 'chart_type', type: 'string', description: 'linea, barras, waterfall, gantt, heatmap', required: true },
      { name: 'data_summary', type: 'string', description: 'Essential values and ranges', required: true },
      { name: 'axes_labels', type: 'string', description: 'Axis labels', required: false },
      { name: 'time_range', type: 'string', description: 'Time period', required: false },
      { name: 'units', type: 'string', description: 'CRC (default), USD, etc', required: false },
    ],
    handler: async ({ chart_type, data_summary, axes_labels, time_range, units }) => {
      const result = await callTreasuryTool('generate_gemini_image', {
        chart_type,
        data_summary,
        axes_labels,
        time_range,
        units,
      });
      return JSON.stringify(result);
    },
  });

  // ─── Web Search (Tavily) ──────────────────────────────────────────────────
  useCopilotAction({
    name: 'web_search',
    description:
      'Search the web for real-time information: exchange rates (CRC/USD), tax rules (IVA, cargas sociales, DUA), bank interest rates (Davivienda, BCR, Nacional), Hacienda regulations, import/nationalization costs, CCSS rates, fiscal calendar, and any ambiguous or current-event data. Returns an AI-summarized answer plus source URLs.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'Search query in natural language, e.g. "tipo de cambio CRC USD hoy" or "cargas sociales patronales Costa Rica 2026"',
        required: true,
      },
      {
        name: 'search_depth',
        type: 'string',
        description: '"basic" (fast, default) or "advanced" (deeper, slower)',
        required: false,
      },
      {
        name: 'include_domains',
        type: 'string',
        description: 'Comma-separated domains to restrict search, e.g. "hacienda.go.cr,bccr.fi.cr,ccss.sa.cr"',
        required: false,
      },
    ],
    handler: async ({ query, search_depth, include_domains }) => {
      const params: Record<string, unknown> = { query };
      if (search_depth) params.search_depth = search_depth;
      if (include_domains) {
        params.include_domains = include_domains.split(',').map((d: string) => d.trim());
      }
      const result = await callTreasuryTool('web_search', params);
      return JSON.stringify(result);
    },
  });

  // ─── Costa Rica Economic Indicators (BCCR) ───────────────────────────────
  useCopilotAction({
    name: 'get_cr_indicators',
    description:
      'Get official Costa Rican economic indicators from BCCR (Banco Central). Use for: tipo de cambio compra/venta USD-CRC, tasa básica pasiva, IPC, tasa de política monetaria. ALWAYS prefer this over web_search for exchange rates — returns the official BCCR rate.',
    parameters: [
      {
        name: 'indicator',
        type: 'string',
        description: '"tipo_cambio" (USD/CRC buy+sell), "tasa_basica", "ipc", "tpm", or a numeric BCCR indicator code',
        required: true,
      },
      {
        name: 'date_from',
        type: 'string',
        description: 'Start date DD/MM/YYYY (defaults to today)',
        required: false,
      },
      {
        name: 'date_to',
        type: 'string',
        description: 'End date DD/MM/YYYY (defaults to today)',
        required: false,
      },
    ],
    handler: async ({ indicator, date_from, date_to }) => {
      const params: Record<string, unknown> = { indicator };
      if (date_from) params.date_from = date_from;
      if (date_to) params.date_to = date_to;
      const result = await callTreasuryTool('get_cr_indicators', params);
      return JSON.stringify(result);
    },
  });

  return null;
}
