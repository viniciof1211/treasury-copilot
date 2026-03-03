import { useState, useEffect, useCallback } from 'react';
import { fetchContractDocuments, getContractDocUrl, type ContractDocument } from '../lib/tms-api';
import { FileText, X, Search, Download, ExternalLink, FileWarning, Loader2, Image, FileSpreadsheet, File } from 'lucide-react';

interface ContractPdfViewerProps {
  /** If provided, opens the viewer directly for this document IDLinea */
  docId?: number | null;
  /** Filter by CodProyecto */
  proyecto?: number | string;
  /** Called when the viewer modal is closed */
  onClose?: () => void;
  /** Whether to show as inline panel (true) or full-screen modal (false) */
  inline?: boolean;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extIcon(ext: string) {
  const e = ext.toLowerCase().trim();
  if (e === '.pdf') return <FileText className="w-4 h-4 text-red-500" />;
  if (['.jpg', '.jpeg', '.png', '.gif', '.tif', '.jfif'].includes(e)) return <Image className="w-4 h-4 text-blue-500" />;
  if (['.xlsx', '.xls', '.xlsm'].includes(e)) return <FileSpreadsheet className="w-4 h-4 text-green-600" />;
  return <File className="w-4 h-4 text-gray-400" />;
}

export function ContractPdfViewer({ docId, proyecto, onClose, inline }: ContractPdfViewerProps) {
  const [documents, setDocuments] = useState<ContractDocument[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [extFilter, setExtFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedDoc, setSelectedDoc] = useState<number | null>(docId ?? null);
  const [selectedName, setSelectedName] = useState('');
  const limit = 50;

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetchContractDocuments(search, String(proyecto || ''), extFilter, limit, offset);
      setDocuments(res.documents);
      setTotal(res.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando documentos');
      setDocuments([]);
    }
    setLoading(false);
  }, [search, extFilter, offset, proyecto]);

  useEffect(() => {
    if (docId == null) loadList();
  }, [loadList, docId]);

  useEffect(() => {
    if (docId != null) setSelectedDoc(docId);
  }, [docId]);

  const fileUrl = selectedDoc != null ? getContractDocUrl(selectedDoc) : null;

  // ── File Viewer Modal ──
  if (selectedDoc != null && fileUrl) {
    return (
      <div className={inline ? '' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm'}>
        <div className={inline
          ? 'w-full bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden'
          : 'w-[92vw] max-w-6xl h-[88vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden'
        }>
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-5 h-5 text-[#1A4A28] shrink-0" />
              <span className="font-semibold text-sm text-gray-900 truncate">
                {selectedName || `Documento #${selectedDoc}`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                className="p-1.5 text-gray-500 hover:text-[#1A4A28] hover:bg-green-50 rounded-md" title="Abrir en nueva pestaña">
                <ExternalLink className="w-4 h-4" />
              </a>
              <a href={fileUrl} download
                className="p-1.5 text-gray-500 hover:text-[#1A4A28] hover:bg-green-50 rounded-md" title="Descargar">
                <Download className="w-4 h-4" />
              </a>
              <button onClick={() => { setSelectedDoc(null); setSelectedName(''); onClose?.(); }}
                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md" title="Cerrar">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className={inline ? 'h-[600px]' : 'flex-1'}>
            <iframe src={fileUrl} className="w-full h-full border-0" title={`Doc ${selectedDoc}`} />
          </div>
        </div>
      </div>
    );
  }

  // ── Document Browser ──
  return (
    <div className="space-y-4">
      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Buscar documento, proyecto, observaciones..."
            value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }}
            onKeyDown={e => e.key === 'Enter' && loadList()}
            className="w-full pl-10 pr-4 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1A4A28]/20 focus:border-[#1A4A28]" />
        </div>
        <select value={extFilter} onChange={e => { setExtFilter(e.target.value); setOffset(0); }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white">
          <option value="">Todos los tipos</option>
          <option value=".pdf">PDF</option>
          <option value=".jpg">JPG</option>
          <option value=".png">PNG</option>
          <option value=".xlsx">Excel</option>
          <option value=".docx">Word</option>
        </select>
        <button onClick={loadList} disabled={loading}
          className="px-4 py-2 text-sm font-medium text-white bg-[#1A4A28] rounded-lg hover:bg-[#153d21] disabled:opacity-50 flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Buscar
        </button>
        <span className="text-xs text-gray-500">{total.toLocaleString()} documentos</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <FileWarning className="w-4 h-4" />{error}
        </div>
      )}

      {/* Document table */}
      {documents.length > 0 && (
        <>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  {['', 'Documento', 'Proyecto', 'Cliente', 'Subido por', 'Fecha', 'Tamaño', ''].map(h => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.IDLinea} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3">{extIcon(d.extension)}</td>
                    <td className="py-2 px-3 max-w-[220px]">
                      <div className="font-medium truncate" title={d.nombre_documento}>{d.nombre_documento}</div>
                      {d.observaciones && <div className="text-xs text-gray-400 truncate" title={d.observaciones}>{d.observaciones}</div>}
                    </td>
                    <td className="py-2 px-3 max-w-[180px]">
                      <div className="truncate text-gray-700" title={d.proyecto_nombre || `#${d.CodProyecto}`}>
                        {d.proyecto_nombre || <span className="text-gray-400">#{d.CodProyecto}</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-gray-500 text-xs">{d.proyecto_cliente || '—'}</td>
                    <td className="py-2 px-3 text-gray-500 text-xs">{d.quien_ingreso}</td>
                    <td className="py-2 px-3 text-gray-500 text-xs whitespace-nowrap">
                      {d.fecha_ingreso ? new Date(d.fecha_ingreso).toLocaleDateString('es-CR') : '—'}
                    </td>
                    <td className="py-2 px-3 text-gray-500 text-xs whitespace-nowrap">{formatBytes(d.data_size)}</td>
                    <td className="py-2 px-3">
                      {d.has_file ? (
                        <button onClick={() => { setSelectedDoc(d.IDLinea); setSelectedName(d.nombre_documento); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#1A4A28] bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors"
                          title="Ver documento">
                          <FileText className="w-3.5 h-3.5" />Ver
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Sin archivo</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                Mostrando {offset + 1}–{Math.min(offset + limit, total)} de {total.toLocaleString()}
              </span>
              <div className="flex gap-2">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}
                  className="px-3 py-1 text-xs border rounded-md disabled:opacity-40 hover:bg-gray-50">Anterior</button>
                <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}
                  className="px-3 py-1 text-xs border rounded-md disabled:opacity-40 hover:bg-gray-50">Siguiente</button>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !error && documents.length === 0 && (
        <div className="py-12 text-center text-gray-400">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>No se encontraron documentos</p>
          <p className="text-xs mt-1">Documentos de contratos cargados en CEM0.IM00 del ERP PcGraf</p>
        </div>
      )}
    </div>
  );
}
