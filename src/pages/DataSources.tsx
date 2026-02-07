import { useState, useEffect, useCallback, useRef } from 'react';
import { Upload, FileSpreadsheet, RefreshCw, CheckCircle, XCircle, Clock, Trash2, AlertCircle, Database } from 'lucide-react';
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

function callTreasuryTool(tool: string, params: Record<string, unknown>) {
  return fetch(`${SUPABASE_URL}/functions/v1/treasury-tools`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ tool, params }),
  }).then((r) => r.json());
}

interface StorageFile {
  name: string;
  created_at: string;
  metadata?: { size?: number; mimetype?: string };
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    setLoadingFiles(true);
    try {
      const { data, error: listErr } = await supabase.storage
        .from('treasury-files')
        .list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
      if (listErr) throw listErr;
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

      if (uploadErr) throw uploadErr;

      setSuccess(`File "${file.name}" uploaded successfully. Click "Ingest" to process it.`);
      await fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleIngest = async (fileName: string) => {
    setIngesting(fileName);
    setError('');
    setSuccess('');

    try {
      const result = await callTreasuryTool('ingest_excel', { file_id: fileName });

      if (result.error) {
        setError(`Ingest failed: ${result.error}`);
      } else {
        setSuccess(
          `Ingested "${fileName}": ${result.rows_inserted} rows processed. ` +
            `Run ID: ${result.ingest_run_id}`
        );
        await fetchIngestRuns();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ingest failed');
    } finally {
      setIngesting(null);
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
                              Processing...
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
