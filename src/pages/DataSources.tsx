import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, FileSpreadsheet, RefreshCw, CheckCircle, XCircle, Clock, Trash2, AlertCircle, Database, ShieldAlert } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Layout } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { formatDate } from '../lib/utils';
import { supabase } from '../lib/supabase';
import type { IngestRun } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ── MRP column mapper — maps Excel headers to mrp_master DB columns ─────────
function mapMRPRow(
  row: (string | number | null)[],
  header: string[],
  ingestRunId: string,
) {
  const colIdx = (keys: string[]): number => {
    for (const k of keys) {
      const idx = header.findIndex((h) => String(h).toLowerCase().includes(k.toLowerCase()));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const str = (keys: string[]) => { const i = colIdx(keys); const v = i >= 0 ? row[i] : null; return v != null && v !== '' ? String(v) : null; };
  const num = (keys: string[]) => { const i = colIdx(keys); const v = Number(i >= 0 ? row[i] : 0); return isFinite(v) ? v : 0; };

  return {
    ingest_run_id: ingestRunId,
    codigo: str(['Codigo', 'Código', 'SKU', 'CodigoProducto']),
    descripcion: str(['Descripcion', 'Descripción', 'Descripcion Articulo']),
    abc_class: str(['ABC', 'Clasificacion ABC']),
    tipo_stock: str(['Tipo de Stock', 'Stock Type']),
    comprador: str(['Comprador', 'Buyer']),
    tipo_item: str(['Tipo']),
    proveedor: str(['Proveedor', 'Supplier']),
    lead_time_dias: num(['Lead Time', 'Reabasto Dias']),
    origen: str(['Origen', 'Origin']),
    dificultad_logistica: num(['Dificultad Logistica']),
    compra_minima: num(['Compra Minima', 'Min Order']),
    unidad_medida: str(['U.M', 'Unidad', 'UOM']),
    consumo_m1: num(['Consumo mes 1']),
    consumo_m2: num(['Consumo mes 2']),
    consumo_m3: num(['Consumo mes 3']),
    consumo_m4: num(['Consumo mes 4']),
    consumo_m5: num(['Consumo mes 5']),
    consumo_m6: num(['Consumo mes 6']),
    consumo_m7: num(['Consumo mes 7']),
    consumo_m8: num(['Consumo mes 8']),
    consumo_promedio: num(['Consumo Promedio', 'Consumo Promedio Mensual']),
    consumo_diario: num(['CM x Dia', 'Consumo Diario']),
    desv_estandar: num(['Desv Estandar', 'Desviacion']),
    inventario: num(['Inventario', 'SaldoActual']),
    reserva: num(['Reserva', 'Total Reservas']),
    inventario_disponible: num(['Inventario Disponible']),
    transito: num(['Transito', 'TransitoProceso']),
    inventario_total: num(['Inventario Total']),
    dias_cobertura: num(['Dias de Cobertura']),
    minimo_inventario: num(['Minimo de Inventario', 'Min Inventario']),
    dias_stock: num(['Dias de Stock']),
    stock_seguridad: num(['Stock de Seguridad', 'Safety Stock']),
    punto_reorden: num(['P Reorden', 'Reorder Point']),
    max_inventario: num(['Max Inventario']),
    costo_unitario: num(['Costo Unitario', 'Costo Unitario Articulo', 'ValorDolar']),
    costo_inventario: num(['Costo del Inventario', 'Costo Inventario']),
    costo_inventario_transito: num(['Costo Inventario Transito']),
    costo_total_inventario: num(['Costo Total del Inventario', 'Costo Total']),
    costo_stock_seguridad: num(['Costo Stock de Seguridad']),
    costo_inv_min: num(['Costo Inventario MIN']),
    costo_inv_reorden: num(['Costo Inventario P.Reorden']),
    costo_inv_max: num(['Costo Inventario MAX']),
    alerta_desabasto: str(['Alerta de Desabasto', 'Alerta']),
    hacer_pedido: str(['Hacer Pedido']),
    cantidad_requerida: num(['Cantidad Requerida', 'Cantidad Requerida Redondeada']),
    analisis_parametros: str(['Analisis Parametros']),
    familia: str(['FAMILIAS', 'Familia']),
    infaltable: str(['Infaltable']),
    descontinuado: str(['Descontinuado']),
    subclasificacion: str(['Subclasificacion', 'Subclas']),
  };
}

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
      throw new Error('Edge Function "treasury-tools" not deployed. Run: npx supabase functions deploy treasury-tools');
    }
    throw new Error(`Edge Function error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

interface StorageFile {
  name: string;
  created_at: string;
  metadata?: { size?: number; mimetype?: string };
}

interface InfraStatus {
  bucket: 'ok' | 'missing' | 'checking';
  edgeFunction: 'ok' | 'missing' | 'checking';
  schema: 'ok' | 'missing' | 'checking';
}

export function DataSources() {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [ingestRuns, setIngestRuns] = useState<IngestRun[]>([]);
  const [uploading, setUploading] = useState(false);
  const [ingesting, setIngesting] = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [progress, setProgress] = useState<{ current: number; total: number; stage: string } | null>(null);
  const [infra, setInfra] = useState<InfraStatus>({ bucket: 'checking', edgeFunction: 'checking', schema: 'checking' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check infrastructure on mount
  useEffect(() => {
    (async () => {
      const status: InfraStatus = { bucket: 'checking', edgeFunction: 'checking', schema: 'checking' };

      // Check storage bucket
      try {
        const { error: bucketErr } = await supabase.storage.from('treasury-files').list('', { limit: 1 });
        status.bucket = bucketErr ? 'missing' : 'ok';
      } catch {
        status.bucket = 'missing';
      }

      // Check Edge Function
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/treasury-tools`, {
          method: 'OPTIONS',
          headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        });
        // 404 = not deployed, 200/204 = CORS preflight OK
        status.edgeFunction = res.status === 404 ? 'missing' : 'ok';
      } catch {
        status.edgeFunction = 'missing';
      }

      // Check schema (exec_sql RPC)
      try {
        const { error: rpcErr } = await supabase.rpc('exec_sql', { sql_query: 'SELECT 1 as test' });
        status.schema = rpcErr ? 'missing' : 'ok';
      } catch {
        status.schema = 'missing';
      }

      setInfra(status);
    })();
  }, []);

  const hasInfraIssues = infra.bucket === 'missing' || infra.edgeFunction === 'missing' || infra.schema === 'missing';

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const { data, error: listErr } = await supabase.storage
        .from('treasury-files')
        .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
      if (listErr) {
        if (listErr.message?.includes('not found') || listErr.message?.includes('Bucket')) {
          console.warn('Storage bucket "treasury-files" does not exist. Create it in Supabase Dashboard → Storage.');
        } else {
          throw listErr;
        }
      }
      setFiles((data || []).filter((f) => f.name && !f.name.startsWith('.')));
    } catch (e) {
      console.error('Error listing files:', e);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const fetchIngestRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const result = await callTreasuryTool('query_sql', {
        sql: 'SELECT * FROM bronze_finance.ingest_runs ORDER BY created_at DESC LIMIT 50',
      });
      if (result.rows) {
        setIngestRuns(result.rows);
      }
    } catch (e) {
      console.error('Error fetching ingest runs:', e);
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
    fetchIngestRuns();
  }, [fetchFiles, fetchIngestRuns]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      setError('Only .xlsx, .xls, and .csv files are accepted');
      return;
    }

    setUploading(true);
    setError('');
    setSuccess('');

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `${timestamp}_${file.name}`;

      const { error: uploadErr } = await supabase.storage
        .from('treasury-files')
        .upload(fileName, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadErr) {
        if (uploadErr.message?.includes('not found') || uploadErr.message?.includes('Bucket')) {
          throw new Error('Storage bucket "treasury-files" does not exist. Apply the SQL migration or create the bucket in Supabase Dashboard → Storage.');
        }
        throw uploadErr;
      }

      setSuccess(`File "${file.name}" uploaded successfully. Click "Ingest" to process it.`);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /**
   * Parse XLSX/CSV client-side and ingest data.
   * For MRP files: inserts directly via Supabase JS client in chunks (bypasses Edge Function).
   * For CxP/Flujo files: sends to Edge Function.
   * Handles very large files (30K+ rows) with progress tracking.
   */
  const handleIngest = async (fileName: string) => {
    setIngesting(fileName);
    setError('');
    setSuccess('');
    setProgress(null);

    try {
      // Download the file from Supabase Storage
      setProgress({ current: 0, total: 0, stage: 'Descargando archivo...' });
      const { data: fileBlob, error: dlErr } = await supabase.storage
        .from('treasury-files')
        .download(fileName);

      if (dlErr || !fileBlob) {
        throw new Error(dlErr?.message || 'Failed to download file');
      }

      // For small files (<1MB), use the server-side Edge Function directly
      if (fileBlob.size < 1024 * 1024) {
        setProgress({ current: 0, total: 0, stage: 'Procesando en servidor...' });
        const result = await callTreasuryTool('ingest_excel', { file_id: fileName });
        if (result.error) {
          setError(`Ingest failed: ${result.error}`);
        } else {
          setSuccess(
            `Ingested "${fileName}": ${result.rows_inserted} rows processed. Run ID: ${result.ingest_run_id}`
          );
          await fetchIngestRuns();
        }
        return;
      }

      // Client-side XLSX parsing for larger files
      setProgress({ current: 0, total: 0, stage: 'Parseando Excel en navegador...' });
      const arrayBuffer = await fileBlob.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), {
        type: 'array',
        cellFormula: false,
        cellHTML: false,
        cellStyles: false,
      });

      const colIndex = (header: string[], keys: string[]): number => {
        for (const k of keys) {
          const idx = header.findIndex((h) => String(h).toLowerCase().includes(k.toLowerCase()));
          if (idx >= 0) return idx;
        }
        return -1;
      };

      const isSubHeader = (row: (string | number)[], headerTexts: Set<string>): boolean => {
        const rowTexts = row
          .filter((c) => typeof c === 'string' && String(c).length > 2)
          .map((c) => String(c).toLowerCase().trim());
        return rowTexts.filter((t) => headerTexts.has(t)).length >= 3;
      };

      // ── Find the best MRP sheet (most columns) ───────────────────────────
      // MRP workbooks have 18+ sheets but only the main "MRP" sheet has 80 columns.
      // We process ONLY the main sheet and skip supporting lookup sheets.
      type ParsedSheet = {
        name: string;
        format: string;
        headers: string[];
        rows: (string | number | null)[][];
      };
      const sheets: ParsedSheet[] = [];
      let bestMrpSheet: ParsedSheet | null = null;

      setProgress({ current: 0, total: workbook.SheetNames.length, stage: 'Analizando hojas...' });

      for (let si = 0; si < workbook.SheetNames.length; si++) {
        const sheetName = workbook.SheetNames[si];
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        setProgress({ current: si + 1, total: workbook.SheetNames.length, stage: `Analizando: ${sheetName}` });

        // If we already found a main MRP sheet, skip remaining sheets
        // (they are VLOOKUP lookup tables, already consolidated in the main sheet)
        if (bestMrpSheet && bestMrpSheet.headers.length > 20) {
          delete workbook.Sheets[sheetName];
          continue;
        }

        const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as (
          | string
          | number
        )[][];
        delete workbook.Sheets[sheetName]; // free memory

        if (allRows.length < 2) continue;

        // Find header row — pick the row with the MOST text cells (for MRP's 2-row header)
        let headerIdx = -1;
        let header: string[] = [];
        let bestTextCount = 0;
        for (let i = 0; i < Math.min(allRows.length, 20); i++) {
          const cells = allRows[i];
          const nonEmpty = cells.filter((c) => c !== '').length;
          const textCells = cells.filter(
            (c) => typeof c === 'string' && String(c).length > 1
          );
          if (textCells.length >= 3 && nonEmpty >= 3 && textCells.length / nonEmpty > 0.4) {
            if (textCells.length > bestTextCount) {
              bestTextCount = textCells.length;
              headerIdx = i;
              header = cells.map(String);
            }
          }
        }
        if (headerIdx < 0 || header.length < 2) continue;

        const headerTexts = new Set(
          header.filter((h) => typeof h === 'string' && h.length > 2).map((h) => h.toLowerCase().trim())
        );

        const dataRows = allRows
          .slice(headerIdx + 1)
          .filter((r) => r.some((c) => c !== ''))
          .filter((r) => !isSubHeader(r, headerTexts));

        // Detect format
        const cxpScore = ['Empresa', 'Proveedor', 'Monto', 'Vencimiento', 'Prioridad'].filter(
          (k) => colIndex(header, [k]) >= 0
        ).length;

        const flujoScore = [
          'Compañía', 'Operación', 'Principal', 'Intereses', 'Cuota', 'Capital',
        ].filter((k) => colIndex(header, [k]) >= 0).length;

        const mrpScore = [
          'Codigo', 'Descripcion', 'Proveedor', 'Inventario',
          'Consumo', 'ABC', 'Costo', 'Stock',
        ].filter((k) => colIndex(header, [k]) >= 0).length;

        let format = 'generic';
        if (mrpScore >= 5) format = 'mrp';
        else if (cxpScore >= 3) format = 'cxp';
        else if (flujoScore >= 3) format = 'flujo';

        const parsed: ParsedSheet = { name: sheetName, format, headers: header, rows: dataRows };

        if (format === 'mrp') {
          // Keep only the sheet with the most columns (the main MRP sheet)
          if (!bestMrpSheet || header.length > bestMrpSheet.headers.length) {
            bestMrpSheet = parsed;
          }
        } else if (format !== 'generic' || dataRows.length > 5) {
          sheets.push(parsed);
        }
      }

      // If we found an MRP sheet, ONLY process that sheet.
      // All other sheets in an MRP workbook are VLOOKUP sources already
      // consolidated into the main sheet — no need to ingest them separately.
      if (bestMrpSheet) {
        sheets.length = 0; // clear all non-MRP sheets
        sheets.push(bestMrpSheet);
      }

      if (sheets.length === 0) {
        setError('No recognizable sheet data found in the file.');
        return;
      }

      // ── Split MRP (direct browser insert) vs others (Edge Function) ───────
      const mrpSheets = sheets.filter(s => s.format === 'mrp');
      const nonMrpSheets = sheets.filter(s => s.format !== 'mrp');

      let totalInserted = 0;
      const sheetsProcessed: string[] = [];

      // Create ingest run record
      const { data: ingestRow, error: insErr } = await supabase
        .schema('bronze_finance' as 'public')
        .from('ingest_runs')
        .insert({ source_file: fileName, status: 'processing' })
        .select('id')
        .single();

      if (insErr) {
        throw new Error(`Could not create ingest run: ${insErr.message}`);
      }
      const ingestRunId = ingestRow?.id as string;

      // ── MRP: Direct chunked inserts from browser ──────────────────────────
      for (const mrpSheet of mrpSheets) {
        const { name: sheetName, headers: header, rows: dataRows } = mrpSheet;
        const CHUNK = 100;
        const totalChunks = Math.ceil(dataRows.length / CHUNK);
        let sheetInserted = 0;
        let lastError: string | null = null;

        setProgress({ current: 0, total: dataRows.length, stage: `Ingresando MRP: ${sheetName} (${dataRows.length.toLocaleString()} filas)...` });

        for (let c = 0; c < totalChunks; c++) {
          const chunk = dataRows.slice(c * CHUNK, (c + 1) * CHUNK);
          const mapped = chunk
            .map(row => mapMRPRow(row, header, ingestRunId))
            .filter(r => r.codigo || r.descripcion);

          if (mapped.length > 0) {
            const { error: batchErr } = await supabase
              .schema('silver_finance' as 'public')
              .from('mrp_master')
              .insert(mapped);

            if (batchErr) {
              console.error(`MRP batch ${c} error:`, batchErr.message);
              lastError = batchErr.message;
            } else {
              sheetInserted += mapped.length;
            }
          }

          setProgress({
            current: Math.min((c + 1) * CHUNK, dataRows.length),
            total: dataRows.length,
            stage: `Ingresando MRP: ${sheetName} — ${sheetInserted.toLocaleString()} filas insertadas...`,
          });

          // Yield to UI thread every 10 chunks
          if (c % 10 === 0) await new Promise(r => setTimeout(r, 0));
        }

        if (sheetInserted > 0) {
          totalInserted += sheetInserted;
          sheetsProcessed.push(`${sheetName}(MRP:${sheetInserted}${lastError ? ',partial' : ''})`);
        } else if (lastError) {
          sheetsProcessed.push(`${sheetName}(MRP:ERROR:${lastError.slice(0, 120)})`);
        }
      }

      // ── Non-MRP sheets: send to Edge Function in chunks too ───────────────
      if (nonMrpSheets.length > 0) {
        const SHEET_CHUNK_ROWS = 500; // max rows per Edge Function call

        for (const sheet of nonMrpSheets) {
          const totalRows = sheet.rows.length;
          const chunks = Math.ceil(totalRows / SHEET_CHUNK_ROWS);

          for (let c = 0; c < chunks; c++) {
            const chunkRows = sheet.rows.slice(c * SHEET_CHUNK_ROWS, (c + 1) * SHEET_CHUNK_ROWS);
            setProgress({
              current: Math.min((c + 1) * SHEET_CHUNK_ROWS, totalRows),
              total: totalRows,
              stage: `Ingresando ${sheet.format}: ${sheet.name}...`,
            });

            try {
              const result = await callTreasuryTool('ingest_parsed_data', {
                source_file: fileName,
                sheets: [{
                  name: sheet.name,
                  format: sheet.format,
                  headers: sheet.headers,
                  rows: chunkRows,
                }],
              });
              if (result.rows_inserted > 0) {
                totalInserted += result.rows_inserted;
              }
              if (result.sheets_processed) {
                sheetsProcessed.push(...result.sheets_processed);
              }
            } catch (e) {
              console.error(`Non-MRP sheet ${sheet.name} chunk ${c} error:`, e);
              sheetsProcessed.push(`${sheet.name}(${sheet.format}:ERROR:${(e as Error).message?.slice(0, 80)})`);
            }
          }
        }
      }

      // ── Finalize ingest run ───────────────────────────────────────────────
      await supabase
        .schema('bronze_finance' as 'public')
        .from('ingest_runs')
        .update({
          status: totalInserted > 0 ? 'completed' : 'failed',
          rows_inserted: totalInserted,
          completed_at: new Date().toISOString(),
          metadata: { sheets_processed: sheetsProcessed, parsing: 'client-side-chunked' },
          error_message: totalInserted === 0 ? 'No rows matched known formats' : null,
        })
        .eq('id', ingestRunId);

      if (totalInserted > 0) {
        setSuccess(
          `Ingested "${fileName}": ${totalInserted.toLocaleString()} rows from ${sheetsProcessed.length} sheet(s). Run ID: ${ingestRunId.slice(0, 8)}...`
        );
      } else {
        setError(`Ingest completed but 0 rows inserted. Sheets: ${sheetsProcessed.join(', ')}`);
      }
      await fetchIngestRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
    } finally {
      setIngesting(null);
      setProgress(null);
    }
  };

  const handleDelete = async (fileName: string) => {
    if (!confirm(`Delete "${fileName}" from storage?`)) return;
    try {
      const { error: delErr } = await supabase.storage
        .from('treasury-files')
        .remove([fileName]);
      if (delErr) throw delErr;
      await fetchFiles();
      setSuccess(`Deleted "${fileName}"`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-600" />;
      case 'processing':
        return <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'success' | 'error' | 'warning'> = {
      completed: 'success',
      failed: 'error',
      processing: 'warning',
      pending: 'default',
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Data Sources</h1>
            <p className="text-gray-600 mt-1">
              Upload Excel/CSV files to feed the Treasury Cashflow Agent with fresh data
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                fetchFiles();
                fetchIngestRuns();
              }}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? (
                <LoadingSpinner size="sm" className="mr-2" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              {uploading ? 'Uploading...' : 'Upload File'}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={handleUpload}
            />
          </div>
        </div>

        {/* Infrastructure status banner */}
        {hasInfraIssues && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <p className="font-medium text-amber-800">Infrastructure Setup Required</p>
                  <p className="text-sm text-amber-700">The following components need to be configured in your Supabase project:</p>
                  <ul className="text-sm text-amber-700 space-y-1 list-disc list-inside">
                    {infra.schema === 'missing' && (
                      <li>
                        <strong>Database migration</strong> — Run the SQL in{' '}
                        <code className="bg-amber-100 px-1 rounded text-xs">supabase/migrations/20260206120000_treasury_finance_schema.sql</code>{' '}
                        via <strong>Supabase Dashboard → SQL Editor</strong>
                      </li>
                    )}
                    {infra.bucket === 'missing' && (
                      <li>
                        <strong>Storage bucket "treasury-files"</strong> — Created by the migration above, or manually via{' '}
                        <strong>Supabase Dashboard → Storage → New Bucket</strong>
                      </li>
                    )}
                    {infra.edgeFunction === 'missing' && (
                      <li>
                        <strong>Edge Function "treasury-tools"</strong> — Deploy with:{' '}
                        <code className="bg-amber-100 px-1 rounded text-xs">npx supabase login && npx supabase link --project-ref aanhzgezgyawitpvwrcw && npx supabase functions deploy treasury-tools</code>
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status messages */}
        {error && (
          <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{error}</p>
            <button onClick={() => setError('')} className="ml-auto text-red-500 hover:text-red-700">
              &times;
            </button>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
            <CheckCircle className="w-5 h-5 flex-shrink-0" />
            <p className="text-sm">{success}</p>
            <button onClick={() => setSuccess('')} className="ml-auto text-green-500 hover:text-green-700">
              &times;
            </button>
          </div>
        )}

        {/* Progress indicator */}
        {progress && (
          <Card className="border-blue-200 bg-blue-50/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <LoadingSpinner size="sm" />
                <span className="text-sm font-medium text-blue-800">{progress.stage}</span>
              </div>
              {progress.total > 0 && (
                <div className="space-y-1">
                  <div className="w-full bg-blue-100 rounded-full h-2.5">
                    <div
                      className="bg-[#1A4A28] h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${Math.min(100, (progress.current / progress.total) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-blue-600 text-right">
                    {progress.current.toLocaleString()} / {progress.total.toLocaleString()}
                    {' '}({Math.round((progress.current / progress.total) * 100)}%)
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Upload drop zone */}
        <Card>
          <CardContent className="p-8">
            <div
              className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-[#1A4A28] hover:bg-green-50/30 transition-colors cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const dt = e.dataTransfer;
                if (dt.files.length > 0) {
                  const input = fileInputRef.current;
                  if (input) {
                    const dataTransfer = new DataTransfer();
                    dataTransfer.items.add(dt.files[0]);
                    input.files = dataTransfer.files;
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }
              }}
            >
              <FileSpreadsheet className="w-12 h-12 text-[#1A4A28] mx-auto mb-4" />
              <p className="text-lg font-medium text-gray-900 mb-1">
                Drop Excel or CSV files here
              </p>
              <p className="text-sm text-gray-600">
                Supports GV CXP Totales, Flujo Semanal Operaciones, Flujo por Unidad de Negocio, and other treasury formats
              </p>
              <p className="text-xs text-gray-500 mt-2">.xlsx, .xls, .csv — Max 50MB</p>
            </div>
          </CardContent>
        </Card>

        {/* Files in storage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="w-5 h-5" />
              Files in Storage ({files.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingFiles ? (
              <div className="py-8 flex justify-center">
                <LoadingSpinner size="md" />
              </div>
            ) : files.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No files uploaded yet. Upload an Excel or CSV file above to get started.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {files.map((file) => {
                  const isIngesting = ingesting === file.name;
                  const wasIngested = ingestRuns.some(
                    (r) => r.source_file === file.name && r.status === 'completed'
                  );
                  return (
                    <div
                      key={file.name}
                      className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileSpreadsheet className="w-8 h-8 text-[#1A4A28] flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                          <p className="text-xs text-gray-500">
                            {formatDate(file.created_at)}
                            {file.metadata?.size ? ` · ${formatBytes(file.metadata.size)}` : ''}
                            {wasIngested && (
                              <span className="ml-2 text-green-600 font-medium">Ingested</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => handleIngest(file.name)}
                          disabled={isIngesting}
                        >
                          {isIngesting ? (
                            <>
                              <LoadingSpinner size="sm" className="mr-1" />
                              {progress ? `${Math.round((progress.current / Math.max(1, progress.total)) * 100)}%` : 'Processing...'}
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3 h-3 mr-1" />
                              {wasIngested ? 'Re-ingest' : 'Ingest'}
                            </>
                          )}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(file.name)}>
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Ingest history */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Ingest History
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRuns ? (
              <div className="py-8 flex justify-center">
                <LoadingSpinner size="md" />
              </div>
            ) : ingestRuns.length === 0 ? (
              <p className="text-gray-500 text-center py-8">
                No ingest runs yet. Upload and ingest a file to see history here.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left">
                      <th className="pb-3 font-medium text-gray-600">Status</th>
                      <th className="pb-3 font-medium text-gray-600">Source File</th>
                      <th className="pb-3 font-medium text-gray-600">Rows</th>
                      <th className="pb-3 font-medium text-gray-600">Run ID</th>
                      <th className="pb-3 font-medium text-gray-600">Started</th>
                      <th className="pb-3 font-medium text-gray-600">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {ingestRuns.map((run) => (
                      <tr key={run.id} className="hover:bg-gray-50">
                        <td className="py-3 pr-4">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(run.status)}
                            {getStatusBadge(run.status)}
                          </div>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="font-mono text-xs">{run.source_file}</span>
                        </td>
                        <td className="py-3 pr-4 font-medium">
                          {run.rows_inserted > 0 ? run.rows_inserted.toLocaleString() : '—'}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="font-mono text-xs text-gray-500">
                            {run.id?.slice(0, 8)}...
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-gray-600">{formatDate(run.created_at)}</td>
                        <td className="py-3 text-gray-600">
                          {run.completed_at ? formatDate(run.completed_at) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
