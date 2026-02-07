import { useCopilotAction } from '@copilotkit/react-core';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function callTreasuryTool(tool: string, params: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/functions/v1/treasury-tools`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ tool, params }),
  }).then((r) => r.json());
}

export function CashflowAgentTools() {
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
    name: 'generate_gemini_image',
    description: 'Generate an executive visualization image using Gemini. Always call when presenting numeric data. Use ARA palette: verde #1A4A28, blanco, gris claro, dorado. chart_type: linea|barras|waterfall|gantt|heatmap. Prompt must be ≤2000 chars.',
    parameters: [
      { name: 'chart_type', type: 'string', description: 'linea, barras, waterfall, gantt, heatmap', required: true },
      { name: 'data_summary', type: 'string', description: 'Essential values and ranges', required: true },
      { name: 'axes_labels', type: 'string', description: 'Axis labels', required: false },
      { name: 'time_range', type: 'string', description: 'Time period', required: false },
      { name: 'units', type: 'string', description: 'USD, CRC, etc', required: false },
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

  return null;
}
