import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface SyncRequest {
  dataSourceId: string;
  companyBuId: string;
}

interface DatabricksConfig {
  endpoint: string;
  token?: string;
}

async function syncFromDatabricks(config: DatabricksConfig, dataSourceId: string, companyBuId: string, supabase: any) {
  const views = [
    'v_bank_movements',
    'v_payables',
    'v_receivables',
    'v_cashflow_snapshot',
    'v_projection_12m',
  ];

  const results = {
    synced: 0,
    errors: [] as string[],
  };

  for (const view of views) {
    try {
      const response = await fetch(`${config.endpoint}/sql/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.token || ''}`,
        },
        body: JSON.stringify({
          query: `SELECT * FROM ${view}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${view}: ${response.statusText}`);
      }

      const data = await response.json();

      if (view === 'v_cashflow_snapshot' && data.rows) {
        const snapshots = data.rows.map((row: any) => ({
          company_bu_id: companyBuId,
          data_source_id: dataSourceId,
          snapshot_date: row.snapshot_date,
          total_cash: row.total_cash,
          total_payables: row.total_payables,
          total_receivables: row.total_receivables,
          net_position: row.net_position,
          currency_code: row.currency_code || 'USD',
        }));

        await supabase.from('cashflow_snapshots').upsert(snapshots);
        results.synced += snapshots.length;
      }

      if (view === 'v_payables' && data.rows) {
        const payables = data.rows.map((row: any) => ({
          company_bu_id: companyBuId,
          data_source_id: dataSourceId,
          vendor_name: row.vendor_name,
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          due_date: row.due_date,
          amount: row.amount,
          currency_code: row.currency_code || 'USD',
          status: row.status || 'pending',
          priority: row.priority || 3,
        }));

        await supabase.from('payables_items').upsert(payables);
        results.synced += payables.length;
      }

      if (view === 'v_receivables' && data.rows) {
        const receivables = data.rows.map((row: any) => ({
          company_bu_id: companyBuId,
          data_source_id: dataSourceId,
          customer_name: row.customer_name,
          invoice_number: row.invoice_number,
          invoice_date: row.invoice_date,
          due_date: row.due_date,
          amount: row.amount,
          currency_code: row.currency_code || 'USD',
          status: row.status || 'outstanding',
          days_overdue: row.days_overdue || 0,
        }));

        await supabase.from('receivables_items').upsert(receivables);
        results.synced += receivables.length;
      }

    } catch (error) {
      results.errors.push(`${view}: ${error.message}`);
    }
  }

  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { dataSourceId, companyBuId }: SyncRequest = await req.json();

    if (!dataSourceId || !companyBuId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: dataSource, error: dsError } = await supabase
      .from('data_sources')
      .select('*')
      .eq('id', dataSourceId)
      .maybeSingle();

    if (dsError || !dataSource) {
      return new Response(
        JSON.stringify({ error: "Data source not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    await supabase
      .from('data_sources')
      .update({ status: 'syncing' })
      .eq('id', dataSourceId);

    let results;
    if (dataSource.type === 'databricks') {
      results = await syncFromDatabricks(dataSource.config as DatabricksConfig, dataSourceId, companyBuId, supabase);
    } else {
      throw new Error(`Unsupported data source type: ${dataSource.type}`);
    }

    await supabase
      .from('data_sources')
      .update({
        status: results.errors.length > 0 ? 'error' : 'active',
        last_sync_at: new Date().toISOString(),
        last_sync_status: results.errors.length > 0 ? results.errors.join(', ') : 'success',
      })
      .eq('id', dataSourceId);

    await supabase.from('audit_logs').insert({
      action: 'Data sync completed',
      entity_type: 'data_source',
      entity_id: dataSourceId,
      company_bu_id: companyBuId,
      changes: { results },
    });

    return new Response(
      JSON.stringify({
        success: true,
        synced: results.synced,
        errors: results.errors,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Sync error:", error);

    return new Response(
      JSON.stringify({
        error: error.message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
