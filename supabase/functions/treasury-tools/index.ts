import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function querySql(supabase: ReturnType<typeof createClient>, sql: string) {
  const { data, error } = await supabase.rpc("exec_sql", { sql_query: sql });
  if (error) return { rows: [], error: error.message };
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  return { rows };
}

async function ingestExcel(supabase: ReturnType<typeof createClient>, fileId: string) {
  const bucket = "treasury-files";
  let path = "";

  if (fileId === "latest") {
    const { data: files } = await supabase.storage.from(bucket).list("", { limit: 10, sortBy: { column: "created_at", order: "desc" } });
    const xlsx = (files || []).find((f) => f.name?.endsWith(".xlsx"));
    if (!xlsx) return { ingest_run_id: null, error: "No XLSX files in storage. Upload to treasury-files bucket." };
    path = xlsx.name;
  } else {
    path = fileId;
  }

  const { data: fileData, error: downloadError } = await supabase.storage.from(bucket).download(path);
  if (downloadError || !fileData) {
    return { ingest_run_id: null, error: downloadError?.message || "File not found" };
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs");

  const run = {
    source_file: path,
    source_sheet: null as string | null,
    status: "processing",
    rows_inserted: 0,
  };

  const { data: ingestRow, error: insertErr } = await supabase
    .schema("bronze_finance")
    .from("ingest_runs")
    .insert({ source_file: path, status: "processing" })
    .select("id")
    .single();

  if (insertErr) {
    return { ingest_run_id: null, error: `Could not create ingest run: ${insertErr.message}. Ensure bronze_finance schema is exposed in Supabase.` };
  }
  const ingestRunId = ingestRow?.id;

  const toDate = (v: unknown): string | null => {
    if (typeof v === "number" && v > 10000) {
      const d = new Date((v - 25569) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    return v ? String(v) : null;
  };

  const colIndex = (header: string[], keys: string[]): number => {
    for (const k of keys) {
      const idx = header.findIndex((h) => String(h).toLowerCase().includes(k.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };

  try {
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
    let totalRows = 0;
    const sheetsProcessed: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as (string | number)[][];

      if (allRows.length < 2) continue;

      // Find header row (first row with 3+ non-empty cells)
      let headerIdx = -1;
      let header: string[] = [];
      for (let i = 0; i < Math.min(allRows.length, 10); i++) {
        const nonEmpty = allRows[i].filter((c) => c !== "").length;
        if (nonEmpty >= 3) {
          const hasText = allRows[i].some((c) => typeof c === "string" && c.length > 1);
          if (hasText) { headerIdx = i; header = allRows[i].map(String); break; }
        }
      }
      if (headerIdx < 0 || header.length < 3) continue;
      const dataRows = allRows.slice(headerIdx + 1).filter((r) => r.some((c) => c !== ""));

      // Detect CxP format
      const cxpScore = ["Empresa", "Proveedor", "Monto", "Vencimiento", "Prioridad"]
        .filter((k) => colIndex(header, [k]) >= 0).length;

      // Detect Flujo Semanal format
      const flujoScore = ["Compañía", "Operación", "Principal", "Intereses", "Cuota", "Capital"]
        .filter((k) => colIndex(header, [k]) >= 0).length;

      if (cxpScore >= 3) {
        const items = dataRows.map((row) => {
          const get = (keys: string[]) => {
            const i = colIndex(header, keys);
            return i >= 0 ? row[i] : null;
          };
          return {
            ingest_run_id: ingestRunId,
            empresa: get(["Empresa"]),
            negocio: get(["Negocio"]),
            responsable: get(["Responsable"]),
            vencimiento_fecha: toDate(get(["Vencimiento Fecha", "Vencimiento"])),
            fecha_max_pago: toDate(get(["Fecha Max", "Fecha Máx"])),
            vencidos_dias: Number(get(["Vencidos Días", "Vencidos"])) || null,
            prioridad: get(["Prioridad"]) ? String(get(["Prioridad"])) : null,
            monto_usd: Number(get(["Monto en $", "Monto"])) || null,
            original_moneda: get(["Original Moneda", "Moneda"]) ? String(get(["Original Moneda", "Moneda"])) : null,
            monto_original: Number(get(["Monto en Original", "Monto Original"])) || null,
            tipo_proveedor: get(["Tipo de Proveedor", "Tipo Proveedor"]) ? String(get(["Tipo de Proveedor", "Tipo Proveedor"])) : null,
            proveedor: get(["Proveedor"]) ? String(get(["Proveedor"])) : null,
            detalle: get(["Detalle"]) ? String(get(["Detalle"])) : null,
            clasificacion: get(["Clasificación", "Clasificacion"]) ? String(get(["Clasificación", "Clasificacion"])) : null,
            observacion: get(["Observación", "Observacion"]) ? String(get(["Observación", "Observacion"])) : null,
          };
        }).filter((x) => x.proveedor || x.monto_usd);

        if (items.length > 0) {
          const { error: insErr } = await supabase.schema("silver_finance").from("cxp_items").insert(items);
          if (!insErr) { totalRows += items.length; sheetsProcessed.push(`${sheetName}(CxP:${items.length})`); }
        }
      } else if (flujoScore >= 3) {
        const items = dataRows.map((row) => {
          const get = (keys: string[]) => {
            const i = colIndex(header, keys);
            return i >= 0 ? row[i] : null;
          };
          return {
            ingest_run_id: ingestRunId,
            compania: get(["Compañía", "Compania", "Empresa"]) ? String(get(["Compañía", "Compania", "Empresa"])) : null,
            tipo: get(["Tipo"]) ? String(get(["Tipo"])) : null,
            operacion: get(["Operación", "Operacion"]) ? String(get(["Operación", "Operacion"])) : null,
            vencimiento: toDate(get(["Vencimiento"])),
            saldo_original: Number(get(["Saldo original", "Saldo"])) || null,
            principal: Number(get(["Principal"])) || null,
            intereses: Number(get(["Intereses"])) || null,
            cuota: Number(get(["Cuota"])) || null,
            capital: Number(get(["Capital"])) || null,
            capital_actualizado: Number(get(["Capital actualizado"])) || null,
            moneda: get(["Moneda"]) ? String(get(["Moneda"])) : null,
            banco: get(["Banco"]) ? String(get(["Banco"])) : null,
            observaciones: get(["Observaciones"]) ? String(get(["Observaciones"])) : null,
          };
        }).filter((x) => x.operacion || x.cuota || x.principal);

        if (items.length > 0) {
          const { error: insErr } = await supabase.schema("silver_finance").from("flujo_semanal").insert(items);
          if (!insErr) { totalRows += items.length; sheetsProcessed.push(`${sheetName}(Flujo:${items.length})`); }
        }
      }
      // If neither CxP nor Flujo, skip — we don't ingest unknown formats
    }

    await supabase.schema("bronze_finance").from("ingest_runs").update({
      status: "completed",
      rows_inserted: totalRows,
      completed_at: new Date().toISOString(),
      metadata: { sheets_processed: sheetsProcessed },
    }).eq("id", ingestRunId);

    return {
      ingest_run_id: ingestRunId,
      rows_inserted: totalRows,
      source_file: path,
      sheets_processed: sheetsProcessed,
      message: totalRows > 0
        ? `Ingested ${totalRows} rows from ${sheetsProcessed.length} sheet(s).`
        : "No recognizable treasury data found. Expected CxP (Empresa/Proveedor/Monto) or Flujo Semanal (Compañía/Operación/Cuota) columns.",
    };
  } catch (e) {
    await supabase.schema("bronze_finance").from("ingest_runs").update({
      status: "failed",
      error_message: (e as Error).message,
      completed_at: new Date().toISOString(),
    }).eq("id", ingestRunId);
    return { ingest_run_id: ingestRunId, error: (e as Error).message };
  }
}

async function recalcProjection(supabase: ReturnType<typeof createClient>, _params: Record<string, unknown>) {
  const { data: cxp } = await supabase.schema("silver_finance").from("cxp_items").select("monto_usd, vencimiento_fecha, empresa");
  const { data: flujo } = await supabase.schema("silver_finance").from("flujo_semanal").select("cuota, vencimiento, compania");

  const outflows = (cxp || []).reduce((s, r) => s + (Number(r.monto_usd) || 0), 0);
  const inflows = (flujo || []).reduce((s, r) => s + (Number(r.cuota) || 0), 0);

  const months: { month: string; inflows: number; outflows: number; balance: number }[] = [];
  const now = new Date();
  let balance = 0;
  for (let i = 0; i < 12; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const monthStr = m.toISOString().slice(0, 7) + "-01";
    const out = i === 0 ? outflows * 0.25 : outflows * 0.05;
    const in_ = inflows * 0.08;
    balance += in_ - out;
    months.push({
      month: monthStr,
      inflows: Math.round(in_ * 100) / 100,
      outflows: Math.round(out * 100) / 100,
      balance: Math.round(balance * 100) / 100,
    });
  }

  const { data: bu } = await supabase.schema("dim").from("business_units").select("id").limit(1).single();
  if (bu?.id) {
    for (const row of months) {
      await supabase.schema("silver_finance").from("projection_12m").upsert({
        bu_id: bu.id,
        projection_month: row.month,
        projected_inflows: row.inflows,
        projected_outflows: row.outflows,
        projected_balance: row.balance,
        confidence_score: 0.85,
      }, { onConflict: "bu_id,projection_month" });
    }
  }

  return {
    summary: months,
    message: `Proyección 12M recalculada. Inflows base: ${inflows.toFixed(2)}, Outflows base: ${outflows.toFixed(2)}. Desembolso 25% por BU aplicado.`,
  };
}

async function generateGeminiImage(spec: Record<string, unknown>) {
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_IMAGE_MODEL") || "imagen-3.0-generate-002";

  if (!geminiKey) return { imageUrl: null, error: "GEMINI_API_KEY not configured" };

  const chartType = (spec.chart_type as string) || "barras";
  const dataSummary = (spec.data_summary as string) || "métricas financieras";
  const axesLabels = (spec.axes_labels as string) || "";
  const timeRange = (spec.time_range as string) || "";
  const units = (spec.units as string) || "USD";

  let prompt = `Visualización ejecutiva tipo ${chartType}: ${dataSummary}.`;
  if (axesLabels) prompt += ` Ejes: ${axesLabels}.`;
  if (timeRange) prompt += ` Período: ${timeRange}.`;
  prompt += ` Unidades: ${units}. Paleta ARA: verde #1A4A28, blanco, gris claro, dorado. Look ejecutivo, etiquetas en español.`;
  if (prompt.length > 2000) prompt = prompt.slice(0, 1997) + "...";

  try {
    const spanishPrompt = `Visualización ejecutiva: ${prompt}. Paleta ARA: verde #1A4A28, blanco, gris claro, dorado. Estilo consultoría, etiquetas en español.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateImage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        prompt: spanishPrompt.slice(0, 2000),
        numberOfImages: 1,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return { imageUrl: null, error: `Gemini API: ${res.status} ${err}`, retry_prompt: prompt };
    }

    const data = await res.json();
    const b64 = data?.images?.[0]?.imageBase64 || data?.generatedImages?.[0]?.image?.imageBytes;
    if (!b64) return { imageUrl: null, error: "No image in response", retry_prompt: prompt };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey);

    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const fileName = `gemini-${crypto.randomUUID()}.png`;

    const { error: uploadErr } = await sb.storage.from("ai-images").upload(fileName, bytes, {
      contentType: "image/png",
      upsert: true,
    });

    if (uploadErr) return { imageUrl: null, error: uploadErr.message, retry_prompt: prompt };

    const imageUrl = `${supabaseUrl}/storage/v1/object/public/ai-images/${fileName}`;
    return { imageUrl, prompt_used: prompt };
  } catch (e) {
    return { imageUrl: null, error: (e as Error).message, retry_prompt: prompt };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { tool, params } = body as { tool: string; params?: Record<string, unknown> };

    if (!tool) return jsonResponse({ error: "Missing tool name" }, 400);

    switch (tool) {
      case "query_sql": {
        const sql = (params?.sql as string) || "";
        if (!sql) return jsonResponse({ error: "Missing sql parameter" }, 400);
        const result = await querySql(supabase, sql);
        return jsonResponse(result);
      }
      case "ingest_excel": {
        const fileId = (params?.file_id as string) || "latest";
        const result = await ingestExcel(supabase, fileId);
        return jsonResponse(result);
      }
      case "recalc_projection": {
        const result = await recalcProjection(supabase, params || {});
        return jsonResponse(result);
      }
      case "generate_gemini_image": {
        const result = await generateGeminiImage((params || {}) as Record<string, unknown>);
        return jsonResponse(result);
      }
      default:
        return jsonResponse({ error: `Unknown tool: ${tool}` }, 400);
    }
  } catch (err) {
    console.error("treasury-tools error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});
