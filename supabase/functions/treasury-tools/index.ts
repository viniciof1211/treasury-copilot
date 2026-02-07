import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

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
    const xlsx = (files || []).find((f: { name?: string }) => f.name?.endsWith(".xlsx"));
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

  const { data: ingestRow, error: insertErr } = await supabase
    .schema("bronze_finance")
    .from("ingest_runs")
    .insert({ source_file: path, status: "processing" })
    .select("id")
    .single();

  if (insertErr) {
    return { ingest_run_id: null, error: `Could not create ingest run: ${insertErr.message}` };
  }
  const ingestRunId = ingestRow?.id;

  const toDate = (v: unknown): string | null => {
    if (v == null || v === "") return null;
    // Excel serial date number
    if (typeof v === "number" && v > 10000) {
      const d = new Date((v - 25569) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    // ISO date string (yyyy-mm-dd)
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      return v.slice(0, 10);
    }
    // Date-like string (dd/mm/yyyy or mm/dd/yyyy)
    if (typeof v === "string" && /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
    // Not a recognizable date — return null instead of raw string
    return null;
  };

  // Check if a row is a sub-header (contains header text repeated in data area)
  const isSubHeader = (row: (string | number)[], headerRow: string[]): boolean => {
    const headerTexts = new Set(headerRow.filter(h => typeof h === "string" && h.length > 2).map(h => String(h).toLowerCase().trim()));
    const rowTexts = row.filter(c => typeof c === "string" && String(c).length > 2).map(c => String(c).toLowerCase().trim());
    const overlap = rowTexts.filter(t => headerTexts.has(t)).length;
    return overlap >= 3; // If 3+ cells match header text, it's a sub-header
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

      // Find header row: look for a row with many text cells (not a title/summary row)
      // A real header has 5+ text labels and >50% of non-empty cells are text
      let headerIdx = -1;
      let header: string[] = [];
      for (let i = 0; i < Math.min(allRows.length, 20); i++) {
        const cells = allRows[i];
        const nonEmpty = cells.filter((c: string | number) => c !== "").length;
        const textCells = cells.filter((c: string | number) => typeof c === "string" && String(c).length > 1);
        if (textCells.length >= 5 && nonEmpty >= 5 && textCells.length / nonEmpty > 0.5) {
          headerIdx = i;
          header = cells.map(String);
          break;
        }
      }
      if (headerIdx < 0 || header.length < 3) continue;
      const dataRows = allRows.slice(headerIdx + 1)
        .filter((r) => r.some((c) => c !== ""))
        .filter((r) => !isSubHeader(r, header));

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
          let batchInserted = 0;
          let lastError: string | null = null;
          for (let b = 0; b < items.length; b += 50) {
            const batch = items.slice(b, b + 50);
            const { error: insErr } = await supabase.schema("silver_finance").from("cxp_items").insert(batch);
            if (insErr) {
              console.error("CxP insert error:", insErr.message, "batch", b);
              lastError = insErr.message;
            } else {
              batchInserted += batch.length;
            }
          }
          if (batchInserted > 0) {
            totalRows += batchInserted;
            sheetsProcessed.push(`${sheetName}(CxP:${batchInserted}${lastError ? ",partial" : ""})`);
          } else if (lastError) {
            sheetsProcessed.push(`${sheetName}(CxP:ERROR:${lastError.slice(0, 100)})`);
          }
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
          // Insert in batches of 50 to avoid payload limits
          let batchInserted = 0;
          let lastError: string | null = null;
          for (let b = 0; b < items.length; b += 50) {
            const batch = items.slice(b, b + 50);
            const { error: insErr } = await supabase.schema("silver_finance").from("flujo_semanal").insert(batch);
            if (insErr) {
              console.error("Flujo insert error:", insErr.message, "batch", b);
              lastError = insErr.message;
            } else {
              batchInserted += batch.length;
            }
          }
          if (batchInserted > 0) {
            totalRows += batchInserted;
            sheetsProcessed.push(`${sheetName}(Flujo:${batchInserted}${lastError ? ",partial" : ""})`);
          } else if (lastError) {
            sheetsProcessed.push(`${sheetName}(Flujo:ERROR:${lastError.slice(0, 100)})`);
          }
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

  const outflows = (cxp || []).reduce((s: number, r: { monto_usd: number }) => s + (Number(r.monto_usd) || 0), 0);
  const inflows = (flujo || []).reduce((s: number, r: { cuota: number }) => s + (Number(r.cuota) || 0), 0);

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

// ─── Web Search (Tavily API) ────────────────────────────────────────────────
async function webSearch(params: Record<string, unknown>) {
  const apiKey = Deno.env.get("TAVILY_API_KEY");
  if (!apiKey) return { error: "TAVILY_API_KEY not configured. Get a free key at https://tavily.com" };

  const query = (params.query as string) || "";
  if (!query) return { error: "Missing query parameter" };

  const searchDepth = (params.search_depth as string) || "basic";
  const maxResults = Number(params.max_results) || 5;
  const includeDomains = (params.include_domains as string[]) || [];

  try {
    const body: Record<string, unknown> = {
      query,
      search_depth: searchDepth,
      max_results: maxResults,
      include_answer: true,
    };
    if (includeDomains.length > 0) body.include_domains = includeDomains;

    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { error: `Tavily API: ${res.status} ${errText}` };
    }

    const data = await res.json();
    return {
      answer: data.answer || null,
      results: (data.results || []).map((r: { title: string; url: string; content: string; score: number }) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      })),
      query,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ─── Costa Rica Economic Indicators (BCCR API) ─────────────────────────────
const BCCR_INDICATOR_CODES: Record<string, { codes: number[]; labels: string[] }> = {
  tipo_cambio: { codes: [317, 318], labels: ["Tipo cambio compra USD/CRC", "Tipo cambio venta USD/CRC"] },
  tasa_basica: { codes: [423], labels: ["Tasa básica pasiva"] },
  ipc: { codes: [462], labels: ["Índice de precios al consumidor"] },
  tpm: { codes: [3541], labels: ["Tasa de política monetaria"] },
};

async function getCRIndicators(params: Record<string, unknown>) {
  const email = Deno.env.get("BCCR_EMAIL") || "";
  const token = Deno.env.get("BCCR_TOKEN") || "";

  if (!email || !token) {
    return { error: "BCCR_EMAIL and BCCR_TOKEN not configured. Register free at https://www.bccr.fi.cr/indicadores-economicos/servicio-web" };
  }

  const indicator = (params.indicator as string) || "tipo_cambio";
  const today = new Date();
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const dateFrom = (params.date_from as string) || fmt(today);
  const dateTo = (params.date_to as string) || fmt(today);

  // Resolve indicator codes
  let codes: number[];
  let labels: string[];
  const preset = BCCR_INDICATOR_CODES[indicator];
  if (preset) {
    codes = preset.codes;
    labels = preset.labels;
  } else {
    // Custom numeric code
    const num = Number(indicator);
    if (isNaN(num)) return { error: `Unknown indicator: "${indicator}". Use: tipo_cambio, tasa_basica, ipc, tpm, or a numeric BCCR code.` };
    codes = [num];
    labels = [`Indicador ${num}`];
  }

  const results: { indicator: string; code: number; date: string; value: number | null }[] = [];

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const label = labels[i] || `Indicador ${code}`;
    try {
      const url = `https://gee.bccr.fi.cr/Indicadores/Suscripciones/WS/wsindicadoreseconomicos.asmx/ObtenerIndicadoresEconomicosXML` +
        `?Indicador=${code}&FechaInicio=${encodeURIComponent(dateFrom)}&FechaFinal=${encodeURIComponent(dateTo)}` +
        `&Nombre=treasury-copilot&SubNiveles=N&CorreoElectronico=${encodeURIComponent(email)}&Token=${encodeURIComponent(token)}`;

      const res = await fetch(url);
      if (!res.ok) {
        results.push({ indicator: label, code, date: dateFrom, value: null });
        continue;
      }
      let xml = await res.text();

      // BCCR returns HTML-encoded XML inside a <string> wrapper — decode entities
      xml = xml.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

      // Parse XML: extract <NUM_VALOR> values and <DES_FECHA> dates
      const valueMatches = [...xml.matchAll(/<NUM_VALOR>([\d.,]+)<\/NUM_VALOR>/g)];
      const dateMatches = [...xml.matchAll(/<DES_FECHA>([^<]+)<\/DES_FECHA>/g)];

      if (valueMatches.length > 0) {
        // Get the latest (last) value
        const lastIdx = valueMatches.length - 1;
        const rawVal = valueMatches[lastIdx][1].replace(/,/g, ".");
        const dateStr = dateMatches[lastIdx]?.[1] || dateTo;
        results.push({ indicator: label, code, date: dateStr.trim(), value: parseFloat(rawVal) });
      } else {
        // Try fetching yesterday if today has no data yet
        if (dateFrom === dateTo) {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          const yFmt = fmt(yesterday);
          const url2 = `https://gee.bccr.fi.cr/Indicadores/Suscripciones/WS/wsindicadoreseconomicos.asmx/ObtenerIndicadoresEconomicosXML` +
            `?Indicador=${code}&FechaInicio=${encodeURIComponent(yFmt)}&FechaFinal=${encodeURIComponent(yFmt)}` +
            `&Nombre=treasury-copilot&SubNiveles=N&CorreoElectronico=${encodeURIComponent(email)}&Token=${encodeURIComponent(token)}`;
          const res2 = await fetch(url2);
          if (res2.ok) {
            let xml2 = await res2.text();
            xml2 = xml2.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
            const vm2 = [...xml2.matchAll(/<NUM_VALOR>([\d.,]+)<\/NUM_VALOR>/g)];
            const dm2 = [...xml2.matchAll(/<DES_FECHA>([^<]+)<\/DES_FECHA>/g)];
            if (vm2.length > 0) {
              const li = vm2.length - 1;
              results.push({ indicator: label, code, date: (dm2[li]?.[1] || yFmt).trim(), value: parseFloat(vm2[li][1].replace(/,/g, ".")) });
              continue;
            }
          }
        }
        results.push({ indicator: label, code, date: dateFrom, value: null });
      }
    } catch (e) {
      results.push({ indicator: label, code, date: dateFrom, value: null });
      console.error(`BCCR error for code ${code}:`, (e as Error).message);
    }
  }

  return {
    indicators: results,
    source: "Banco Central de Costa Rica (BCCR)",
    date_range: { from: dateFrom, to: dateTo },
  };
}

// ─── Gemini Image Generation ────────────────────────────────────────────────
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
      case "web_search": {
        const result = await webSearch(params || {});
        return jsonResponse(result);
      }
      case "get_cr_indicators": {
        const result = await getCRIndicators(params || {});
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
