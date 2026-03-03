import { useState, useEffect, useCallback } from 'react';
import {
  fetchContractDocuments, getContractDocUrl, fetchContractExtraction,
  type ContractDocument, type ContractExtraction,
} from '../lib/tms-api';
import {
  FileText, X, Search, Download, ExternalLink, FileWarning, Loader2,
  Image, FileSpreadsheet, File, ChevronLeft, Sparkles, ClipboardList,
  DollarSign, Calendar, Users, Package, ScrollText, AlertCircle,
} from 'lucide-react';

interface ContractPdfViewerProps {
  docId?: number | null;
  proyecto?: number | string;
  onClose?: () => void;
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

// ── AI Extraction Detail Panel ──
function ExtractionPanel({ extraction, loading, error }: {
  extraction: ContractExtraction | null;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 text-gray-400">
        <Loader2 className="w-8 h-8 animate-spin mb-3 text-[#1A4A28]" />
        <p className="text-sm font-medium">Analizando contrato con IA...</p>
        <p className="text-xs mt-1">Extrayendo términos, productos y desglose</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0" />{error}
        </div>
      </div>
    );
  }

  if (!extraction) return null;

  const a = extraction.analysis;

  return (
    <div className="overflow-y-auto h-full">
      {/* Header info */}
      <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-[#1A4A28]/5 to-transparent">
        <h3 className="font-bold text-gray-900 text-sm">{extraction.nombre}</h3>
        {extraction.proyecto && <p className="text-xs text-gray-500 mt-0.5">Proyecto: {extraction.proyecto}</p>}
        {extraction.cliente && <p className="text-xs text-gray-500">Cliente: {extraction.cliente}</p>}
        <p className="text-xs text-gray-400 mt-1">{extraction.pages} págs · {(extraction.text_length / 1000).toFixed(1)}K caracteres</p>
      </div>

      {extraction.llm_error && (
        <div className="mx-4 mt-3 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
          ⚠️ {extraction.llm_error}
        </div>
      )}

      {!a ? (
        <div className="p-4 text-sm text-gray-500">
          <p className="mb-2">No se pudo realizar el análisis AI. Texto extraído:</p>
          <pre className="text-xs bg-gray-50 p-3 rounded-lg border overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto">{extraction.raw_text}</pre>
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {/* Resumen */}
          {a.resumen && (
            <Section icon={ScrollText} title="Resumen" color="text-[#1A4A28]">
              <p className="text-sm text-gray-700">{a.resumen}</p>
              {a.tipo_contrato && (
                <span className="inline-block mt-1.5 px-2 py-0.5 text-xs font-medium bg-[#1A4A28]/10 text-[#1A4A28] rounded-full">
                  {a.tipo_contrato}
                </span>
              )}
            </Section>
          )}

          {/* Partes */}
          {a.partes && (a.partes.contratante || a.partes.contratista) && (
            <Section icon={Users} title="Partes del Contrato" color="text-blue-600">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {a.partes.contratante && <div><span className="text-gray-400">Contratante:</span><br /><span className="font-medium text-gray-800">{a.partes.contratante}</span></div>}
                {a.partes.contratista && <div><span className="text-gray-400">Contratista:</span><br /><span className="font-medium text-gray-800">{a.partes.contratista}</span></div>}
                {a.partes.contacto && <div className="col-span-2"><span className="text-gray-400">Contacto:</span> {a.partes.contacto}</div>}
              </div>
            </Section>
          )}

          {/* Montos */}
          {a.montos && (a.montos.total || a.montos.subtotal) && (
            <Section icon={DollarSign} title="Montos" color="text-green-600">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {a.montos.subtotal && <div><span className="text-gray-400">Subtotal:</span> <span className="font-bold">{a.montos.subtotal}</span></div>}
                {a.montos.impuestos && <div><span className="text-gray-400">Impuestos:</span> <span className="font-bold">{a.montos.impuestos}</span></div>}
                {a.montos.total && <div><span className="text-gray-400">Total:</span> <span className="font-bold text-green-700 text-sm">{a.montos.total}</span></div>}
                {a.montos.moneda && <div><span className="text-gray-400">Moneda:</span> {a.montos.moneda}</div>}
                {a.montos.forma_pago && <div className="col-span-2"><span className="text-gray-400">Forma de pago:</span> {a.montos.forma_pago}</div>}
              </div>
            </Section>
          )}

          {/* Fechas */}
          {a.fechas && (a.fechas.emision || a.fechas.vigencia || a.fechas.entrega) && (
            <Section icon={Calendar} title="Fechas" color="text-purple-600">
              <div className="flex flex-wrap gap-3 text-xs">
                {a.fechas.emision && <div><span className="text-gray-400">Emisión:</span> <span className="font-medium">{a.fechas.emision}</span></div>}
                {a.fechas.vigencia && <div><span className="text-gray-400">Vigencia:</span> <span className="font-medium">{a.fechas.vigencia}</span></div>}
                {a.fechas.entrega && <div><span className="text-gray-400">Entrega:</span> <span className="font-medium">{a.fechas.entrega}</span></div>}
              </div>
            </Section>
          )}

          {/* Términos */}
          {a.terminos && a.terminos.length > 0 && (
            <Section icon={ClipboardList} title={`Términos y Acuerdos (${a.terminos.length})`} color="text-amber-600">
              <div className="space-y-2">
                {a.terminos.map((t, i) => (
                  <div key={i} className="text-xs border-l-2 border-amber-200 pl-2">
                    <span className="font-semibold text-gray-800">{t.titulo}</span>
                    <p className="text-gray-600 mt-0.5">{t.descripcion}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Productos / Servicios — Itemization */}
          {a.productos_servicios && a.productos_servicios.length > 0 && (
            <Section icon={Package} title={`Desglose de Artículos (${a.productos_servicios.length})`} color="text-red-600">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-1.5 px-2 font-semibold text-gray-500">#</th>
                      <th className="text-left py-1.5 px-2 font-semibold text-gray-500">Artículo</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-gray-500">Cant</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-gray-500">P. Unit</th>
                      <th className="text-right py-1.5 px-2 font-semibold text-gray-500">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.productos_servicios.map((p, i) => (
                      <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-1.5 px-2 text-gray-400">{i + 1}</td>
                        <td className="py-1.5 px-2 max-w-[180px]">
                          <div className="font-medium text-gray-800">{p.item}</div>
                          {p.descripcion && p.descripcion !== p.item && (
                            <div className="text-gray-400 truncate">{p.descripcion}</div>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right text-gray-700">
                          {p.cantidad || '—'}{p.unidad ? ` ${p.unidad}` : ''}
                        </td>
                        <td className="py-1.5 px-2 text-right text-gray-700">{p.precio_unitario || '—'}</td>
                        <td className="py-1.5 px-2 text-right font-medium text-gray-900">{p.subtotal || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Observaciones */}
          {a.observaciones && a.observaciones.filter(Boolean).length > 0 && (
            <Section icon={AlertCircle} title="Observaciones" color="text-gray-600">
              <ul className="space-y-1">
                {a.observaciones.filter(Boolean).map((o, i) => (
                  <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                    <span className="text-gray-300">•</span>{o}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, color, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">{title}</span>
      </div>
      {children}
    </div>
  );
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
  const [selectedExt, setSelectedExt] = useState('');
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [extraction, setExtraction] = useState<ContractExtraction | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
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

  const handleAnalyze = useCallback(async (id: number) => {
    setShowAnalysis(true);
    setExtracting(true);
    setExtractError('');
    setExtraction(null);
    try {
      const result = await fetchContractExtraction(id);
      setExtraction(result);
    } catch (e: unknown) {
      setExtractError(e instanceof Error ? e.message : 'Error analizando documento');
    }
    setExtracting(false);
  }, []);

  const fileUrl = selectedDoc != null ? getContractDocUrl(selectedDoc) : null;
  const isPdf = selectedExt.toLowerCase().trim() === '.pdf';

  // ── File Viewer with Analysis Panel ──
  if (selectedDoc != null && fileUrl) {
    return (
      <div className={inline ? '' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm'}>
        <div className={inline
          ? 'w-full bg-white rounded-xl border border-gray-200 shadow-lg overflow-hidden'
          : 'w-[96vw] max-w-7xl h-[90vh] bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden'
        }>
          {/* Top bar */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => { setSelectedDoc(null); setSelectedName(''); setSelectedExt(''); setShowAnalysis(false); setExtraction(null); onClose?.(); }}
                className="p-1 text-gray-500 hover:text-[#1A4A28] hover:bg-green-50 rounded-md" title="Volver a la lista">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <FileText className="w-4 h-4 text-[#1A4A28] shrink-0" />
              <span className="font-semibold text-sm text-gray-900 truncate">
                {selectedName || `Documento #${selectedDoc}`}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isPdf && (
                <button onClick={() => showAnalysis ? setShowAnalysis(false) : handleAnalyze(selectedDoc)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    showAnalysis
                      ? 'bg-[#1A4A28] text-white'
                      : 'text-[#1A4A28] bg-green-50 border border-green-200 hover:bg-green-100'
                  }`}>
                  <Sparkles className="w-3.5 h-3.5" />
                  {showAnalysis ? 'Ocultar Análisis' : 'Analizar Contrato'}
                </button>
              )}
              <a href={fileUrl} target="_blank" rel="noopener noreferrer"
                className="p-1.5 text-gray-500 hover:text-[#1A4A28] hover:bg-green-50 rounded-md" title="Abrir en nueva pestaña">
                <ExternalLink className="w-4 h-4" />
              </a>
              <a href={fileUrl} download
                className="p-1.5 text-gray-500 hover:text-[#1A4A28] hover:bg-green-50 rounded-md" title="Descargar">
                <Download className="w-4 h-4" />
              </a>
              <button onClick={() => { setSelectedDoc(null); setSelectedName(''); setSelectedExt(''); setShowAnalysis(false); setExtraction(null); onClose?.(); }}
                className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-md" title="Cerrar">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Content: PDF + optional Analysis panel */}
          <div className={`${inline ? 'h-[650px]' : 'flex-1'} flex overflow-hidden`}>
            <div className={`${showAnalysis ? 'w-[55%]' : 'w-full'} transition-all duration-300`}>
              <iframe src={fileUrl} className="w-full h-full border-0" title={`Doc ${selectedDoc}`} />
            </div>
            {showAnalysis && (
              <div className="w-[45%] border-l border-gray-200 bg-gray-50 overflow-hidden flex flex-col">
                <div className="px-4 py-2 bg-white border-b border-gray-100 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#1A4A28]" />
                  <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Análisis AI del Contrato</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <ExtractionPanel extraction={extraction} loading={extracting} error={extractError} />
                </div>
              </div>
            )}
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
                      <div className="flex items-center gap-1">
                        {d.has_file ? (
                          <button onClick={() => { setSelectedDoc(d.IDLinea); setSelectedName(d.nombre_documento); setSelectedExt(d.extension); }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#1A4A28] bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors"
                            title="Ver documento">
                            <FileText className="w-3 h-3" />Ver
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">Sin archivo</span>
                        )}
                        {d.has_file && d.extension.toLowerCase().trim() === '.pdf' && (
                          <button onClick={() => { setSelectedDoc(d.IDLinea); setSelectedName(d.nombre_documento); setSelectedExt(d.extension); setTimeout(() => handleAnalyze(d.IDLinea), 100); }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-md hover:bg-purple-100 transition-colors"
                            title="Analizar con IA">
                            <Sparkles className="w-3 h-3" />AI
                          </button>
                        )}
                      </div>
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
