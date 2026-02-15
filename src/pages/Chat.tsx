import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { useAgentChat } from '../hooks/useAgentChat';
import type { AgentMessage, ToolCallInfo, ChatSession } from '../hooks/useAgentChat';
import {
  Send,
  StopCircle,
  Trash2,
  Bot,
  User,
  Loader2,
  Wrench,
  ChevronDown,
  ChevronUp,
  Database,
  Search,
  Globe,
  BarChart3,
  Plus,
  MessageSquare,
  Upload,
  RefreshCw,
  X,
  Pencil,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
  BrainCircuit,
  LineChart,
  Lightbulb,
  Shuffle,
  GripVertical,
  ImageIcon,
  Maximize2,
  Download,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Drag-to-resize hook                                                 */
/* ------------------------------------------------------------------ */
function useDragResize(
  initialWidth: number,
  minWidth: number,
  maxWidth: number,
  direction: 'left' | 'right' = 'right',
) {
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = direction === 'right'
        ? ev.clientX - startX.current
        : startX.current - ev.clientX;
      const newW = Math.min(maxWidth, Math.max(minWidth, startW.current + delta));
      setWidth(newW);
    };

    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [width, minWidth, maxWidth, direction]);

  return { width, onMouseDown, setWidth };
}

const TOOL_ICONS: Record<string, typeof Wrench> = {
  query_sql: Database,
  search_treasury_kb: Search,
  web_search: Globe,
  get_cr_indicators: BarChart3,
  ingest_excel: Database,
  recalc_projection: BarChart3,
  call_data_service: BrainCircuit,
  call_analytics_agent: LineChart,
  db_query: Database,
  db_list_tables: Database,
  db_describe_table: Database,
  db_aggregate: Database,
  execute_python_analysis: LineChart,
  generate_chart: LineChart,
  compute_statistics: BarChart3,
};

/* ------------------------------------------------------------------ */
/* Recommended Prompts Pool                                            */
/* ------------------------------------------------------------------ */
const ALL_PROMPTS: { category: string; text: string }[] = [
  { category: 'CxP', text: 'Resumen de cuentas por pagar vencidas esta semana por empresa y prioridad' },
  { category: 'CxP', text: '¿Cuáles son los 10 proveedores con mayor monto pendiente de pago?' },
  { category: 'CxP', text: 'Gráfico de barras con el total de CxP por empresa ordenado de mayor a menor' },
  { category: 'Flujo', text: 'Gráfico de flujo de caja (ingresos vs egresos) de los últimos 6 meses' },
  { category: 'Flujo', text: 'Análisis de tendencia del flujo semanal con línea de regresión' },
  { category: 'Flujo', text: '¿Cuál es la cuota total de deuda por banco y tipo de operación?' },
  { category: 'Proyección', text: 'Proyección de cash-flow a 12 meses con gráfico de líneas' },
  { category: 'Proyección', text: 'Recalcular la proyección 12M y mostrar resumen con gráfico' },
  { category: 'Indicadores', text: 'Tipo de cambio USD/CRC de compra y venta de hoy' },
  { category: 'Indicadores', text: 'Tasa básica pasiva y tasa de política monetaria actuales' },
  { category: 'Análisis', text: 'Dashboard visual: distribución de CxP por clasificación con gráfico de pastel' },
  { category: 'Análisis', text: 'Análisis estadístico de montos de CxP: media, mediana, desviación estándar' },
  { category: 'Análisis', text: 'Heatmap de vencimientos de CxP por semana y empresa' },
  { category: 'Análisis', text: 'Top 5 operaciones de flujo semanal por monto con gráfico comparativo' },
  { category: 'MRP', text: '¿Cuántos artículos tienen alerta de desabasto activa?' },
  { category: 'MRP', text: 'Resumen de inventario: artículos bajo punto de reorden por familia' },
  { category: 'General', text: 'Buscar en la base de conocimiento: políticas de tesorería para pagos internacionales' },
  { category: 'General', text: '¿Cuáles tablas de datos están disponibles y qué contienen?' },
  { category: 'General', text: 'Comparar ingresos vs egresos del mes actual con gráfico de barras apiladas' },
  { category: 'General', text: 'Generar un reporte ejecutivo de la posición de tesorería actual' },
];

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------------------------------------------ */
/* Tool Call Badge                                                     */
/* ------------------------------------------------------------------ */
function ToolCallBadge({ tc }: { tc: ToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[tc.name] || Wrench;

  return (
    <div className="my-2 border border-gray-200 rounded-lg bg-gray-50 text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
      >
        <Icon className="w-4 h-4 text-[#1A4A28]" />
        <span className="font-medium text-gray-700">{tc.name}</span>
        {tc.status === 'running' && <Loader2 className="w-3 h-3 animate-spin text-blue-500 ml-auto" />}
        {tc.status === 'done' && <span className="ml-auto text-xs text-green-600">done</span>}
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {expanded && (
        <div className="px-3 pb-2 space-y-1">
          <div className="text-xs text-gray-500">
            <strong>Args:</strong>
            <pre className="mt-1 bg-white p-2 rounded border text-xs overflow-x-auto max-h-32 overflow-y-auto">
              {JSON.stringify(tc.args, null, 2)}
            </pre>
          </div>
          {tc.result && (
            <div className="text-xs text-gray-500">
              <strong>Result:</strong>
              <pre className="mt-1 bg-white p-2 rounded border text-xs overflow-x-auto max-h-40 overflow-y-auto">
                {tc.result.length > 500 ? tc.result.slice(0, 500) + '...' : tc.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Markdown Renderer                                                   */
/* ------------------------------------------------------------------ */
function renderMarkdown(text: string) {
  const cleaned = text
    .replace(/\[IMAGE:[^\]]*\]/g, '')
    .replace(/\[IMAGE:[^\n]*?(?:truncated|truncado)\)?\]?/gi, '')
    .replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=\s]+/g, '')
    .replace(/iVBORw0KGgo[A-Za-z0-9+/=\s]{20,}/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const lines = cleaned.split('\n');
  const elements: JSX.Element[] = [];
  let tableLines: string[] = [];
  let inTable = false;

  const flushTable = () => {
    if (tableLines.length < 2) {
      tableLines.forEach((l, i) => elements.push(<p key={`tl-${elements.length}-${i}`} className="mb-1">{l}</p>));
      tableLines = [];
      return;
    }
    const headers = tableLines[0].split('|').filter(c => c.trim());
    const dataRows = tableLines.slice(2).map(r => r.split('|').filter(c => c.trim()));
    elements.push(
      <div key={`table-${elements.length}`} className="overflow-x-auto my-3">
        <table className="min-w-full divide-y divide-gray-300 text-sm">
          <thead className="bg-gray-100">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-gray-900 uppercase">
                  {h.trim()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {dataRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-gray-700 whitespace-nowrap">{cell.trim()}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTableLine = line.trim().startsWith('|') && line.trim().endsWith('|');
    const isSeparator = /^\|[\s\-:|]+\|$/.test(line.trim());

    if (isTableLine || isSeparator) {
      inTable = true;
      tableLines.push(line);
    } else {
      if (inTable) { flushTable(); inTable = false; }
      if (line.trim() === '') {
        elements.push(<div key={`br-${i}`} className="h-2" />);
      } else if (line.startsWith('### ')) {
        elements.push(<h3 key={`h3-${i}`} className="text-base font-bold text-gray-900 mt-3 mb-1">{line.slice(4)}</h3>);
      } else if (line.startsWith('## ')) {
        elements.push(<h2 key={`h2-${i}`} className="text-lg font-bold text-gray-900 mt-4 mb-1">{line.slice(3)}</h2>);
      } else if (line.startsWith('# ')) {
        elements.push(<h1 key={`h1-${i}`} className="text-xl font-bold text-gray-900 mt-4 mb-2">{line.slice(2)}</h1>);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        elements.push(
          <div key={`li-${i}`} className="flex gap-2 ml-2 mb-1">
            <span className="text-[#1A4A28] font-bold">•</span>
            <span>{applyInlineFormatting(line.slice(2))}</span>
          </div>
        );
      } else if (/^\d+\.\s/.test(line)) {
        const match = line.match(/^(\d+)\.\s(.*)$/);
        if (match) {
          elements.push(
            <div key={`ol-${i}`} className="flex gap-2 ml-2 mb-1">
              <span className="text-[#1A4A28] font-bold min-w-[1.5rem]">{match[1]}.</span>
              <span>{applyInlineFormatting(match[2])}</span>
            </div>
          );
        }
      } else {
        elements.push(<p key={`p-${i}`} className="mb-1">{applyInlineFormatting(line)}</p>);
      }
    }
  }
  if (inTable) flushTable();

  return <>{elements}</>;
}

function applyInlineFormatting(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    const codeMatch = remaining.match(/`(.+?)`/);

    let firstMatch: { index: number; length: number; type: 'bold' | 'code'; content: string } | null = null;

    if (boldMatch && boldMatch.index !== undefined) {
      firstMatch = { index: boldMatch.index, length: boldMatch[0].length, type: 'bold', content: boldMatch[1] };
    }
    if (codeMatch && codeMatch.index !== undefined) {
      if (!firstMatch || codeMatch.index < firstMatch.index) {
        firstMatch = { index: codeMatch.index, length: codeMatch[0].length, type: 'code', content: codeMatch[1] };
      }
    }

    if (!firstMatch) { parts.push(remaining); break; }
    if (firstMatch.index > 0) parts.push(remaining.slice(0, firstMatch.index));

    if (firstMatch.type === 'bold') {
      parts.push(<strong key={key++}>{firstMatch.content}</strong>);
    } else {
      parts.push(
        <code key={key++} className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-[#1A4A28]">
          {firstMatch.content}
        </code>
      );
    }
    remaining = remaining.slice(firstMatch.index + firstMatch.length);
  }
  return <>{parts}</>;
}

/* ------------------------------------------------------------------ */
/* Inline Image Gallery                                                */
/* ------------------------------------------------------------------ */
function InlineImages({ images }: { images: string[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!images || images.length === 0) return null;

  return (
    <div className="mt-3 space-y-2">
      {images.map((img, idx) => {
        const src = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
        return (
          <div key={idx} className="relative">
            <img
              src={src}
              alt={`Gráfico ${idx + 1}`}
              className="rounded-lg border border-gray-200 max-w-full cursor-pointer hover:shadow-lg transition-shadow"
              onClick={() => setExpanded(img)}
            />
          </div>
        );
      })}
      {expanded && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setExpanded(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh]">
            <button
              onClick={() => setExpanded(null)}
              className="absolute -top-3 -right-3 bg-white rounded-full p-1 shadow-lg hover:bg-gray-100"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={expanded.startsWith('data:') ? expanded : `data:image/png;base64,${expanded}`}
              alt="Gráfico ampliado"
              className="rounded-lg max-w-full max-h-[85vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Message Bubble                                                      */
/* ------------------------------------------------------------------ */
function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? 'bg-blue-600' : 'bg-[#1A4A28]'
        }`}
      >
        {isUser ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-white" />}
      </div>

      <div className={`flex-1 min-w-0 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`rounded-2xl px-4 py-3 max-w-full ${
            isUser ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-900'
          }`}
        >
          <div className="prose prose-sm max-w-none break-words">
            {isUser ? (
              message.content.split('\n').map((line, idx) => (
                <p key={idx} className="text-white mb-1 last:mb-0">{line}</p>
              ))
            ) : (
              renderMarkdown(message.content)
            )}
            {message.isStreaming && !message.content && (
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Pensando...</span>
              </div>
            )}
          </div>

          {!isUser && message.images && message.images.length > 0 && (
            <InlineImages images={message.images} />
          )}

          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-2">
              {message.toolCalls.map((tc) => (
                <ToolCallBadge key={tc.id} tc={tc} />
              ))}
            </div>
          )}
        </div>

        <span className="text-xs text-gray-400 mt-1 px-2">
          {new Date(message.createdAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Session Sidebar Item                                                */
/* ------------------------------------------------------------------ */
function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
  onRename,
}: {
  session: ChatSession;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors text-sm ${
        isActive ? 'bg-[#1A4A28] text-white' : 'hover:bg-gray-100 text-gray-700'
      }`}
      onClick={() => !editing && onSelect()}
    >
      <MessageSquare className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-white' : 'text-gray-400'}`} />
      {editing ? (
        <input
          className="flex-1 bg-white text-gray-900 text-sm rounded px-1 py-0.5 border"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onRename(title); setEditing(false); }
            if (e.key === 'Escape') { setTitle(session.title); setEditing(false); }
          }}
          onBlur={() => { onRename(title); setEditing(false); }}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate">{session.title}</span>
      )}
      <div className={`flex gap-1 ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
        <button
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          className={`p-0.5 rounded ${isActive ? 'hover:bg-white/20' : 'hover:bg-gray-200'}`}
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className={`p-0.5 rounded ${isActive ? 'hover:bg-white/20' : 'hover:bg-gray-200'}`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Recommended Prompts Panel                                           */
/* ------------------------------------------------------------------ */
function RecommendedPrompts({ onSelect, onClose }: { onSelect: (text: string) => void; onClose?: () => void }) {
  const [prompts, setPrompts] = useState(() => shuffleArray(ALL_PROMPTS).slice(0, 10));

  const refresh = () => setPrompts(shuffleArray(ALL_PROMPTS).slice(0, 10));

  const grouped = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const p of prompts) {
      (map[p.category] ??= []).push(p.text);
    }
    return map;
  }, [prompts]);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-3 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-700">Sugerencias</span>
        </div>
        <div className="flex gap-1">
          <button
            onClick={refresh}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
            title="Nuevas sugerencias"
          >
            <Shuffle className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              title="Cerrar sugerencias"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {Object.entries(grouped).map(([cat, texts]) => (
          <div key={cat}>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">{cat}</p>
            <div className="space-y-1.5">
              {texts.map((t) => (
                <button
                  key={t}
                  onClick={() => onSelect(t)}
                  className="w-full text-left text-xs px-2.5 py-2 bg-gray-50 border border-gray-100 rounded-lg hover:border-[#1A4A28] hover:bg-green-50 transition-colors leading-snug"
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Visualization Panel                                                 */
/* ------------------------------------------------------------------ */
function VisualizationPanel({
  images,
  onClose,
}: {
  images: string[];
  onClose?: () => void;
}) {
  const [selectedIdx, setSelectedIdx] = useState(images.length - 1);
  const [fullscreen, setFullscreen] = useState(false);

  // Always show the latest image when new ones arrive
  useEffect(() => {
    if (images.length > 0) setSelectedIdx(images.length - 1);
  }, [images.length]);

  const currentImg = images[selectedIdx] || null;
  const src = currentImg
    ? currentImg.startsWith('data:') ? currentImg : `data:image/png;base64,${currentImg}`
    : null;

  const handleDownload = () => {
    if (!src) return;
    const a = document.createElement('a');
    a.href = src;
    a.download = `chart-${selectedIdx + 1}.png`;
    a.click();
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="px-3 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <LineChart className="w-4 h-4 text-[#1A4A28]" />
          <span className="text-sm font-semibold text-gray-700">Visualización</span>
          {images.length > 0 && (
            <span className="text-[10px] bg-[#1A4A28] text-white px-1.5 py-0.5 rounded-full">
              {images.length}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {src && (
            <>
              <button
                onClick={handleDownload}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                title="Descargar imagen"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setFullscreen(true)}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                title="Pantalla completa"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
              title="Cerrar panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-4 bg-gray-50 overflow-hidden">
        {src ? (
          <img
            src={src}
            alt={`Gráfico ${selectedIdx + 1}`}
            className="max-w-full max-h-full object-contain rounded-lg shadow-sm border border-gray-200"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-gray-300">
            <ImageIcon className="w-16 h-16" />
            <p className="text-sm text-gray-400 text-center">
              Los gráficos generados por el agente aparecerán aquí
            </p>
          </div>
        )}
      </div>

      {images.length > 1 && (
        <div className="px-3 py-2 border-t border-gray-100 flex items-center gap-2 overflow-x-auto flex-shrink-0 scrollbar-thin" style={{ scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent' }}>
          {images.map((img, idx) => {
            const thumbSrc = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
            return (
              <button
                key={idx}
                onClick={() => setSelectedIdx(idx)}
                className={`flex-shrink-0 w-14 h-10 rounded border-2 overflow-hidden transition-colors ${
                  idx === selectedIdx ? 'border-[#1A4A28]' : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                <img src={thumbSrc} alt={`Thumb ${idx + 1}`} className="w-full h-full object-cover" />
              </button>
            );
          })}
        </div>
      )}

      {/* Fullscreen overlay */}
      {fullscreen && src && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
          onClick={() => setFullscreen(false)}
        >
          <div className="relative max-w-6xl max-h-[90vh]">
            <button
              onClick={() => setFullscreen(false)}
              className="absolute -top-3 -right-3 bg-white rounded-full p-1.5 shadow-lg hover:bg-gray-100 z-10"
            >
              <X className="w-5 h-5" />
            </button>
            <img
              src={src}
              alt="Gráfico ampliado"
              className="rounded-lg max-w-full max-h-[85vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drag Handle                                                         */
/* ------------------------------------------------------------------ */
function DragHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-2 flex-shrink-0 cursor-col-resize flex items-center justify-center hover:bg-green-50 transition-colors group"
    >
      <GripVertical className="w-3 h-3 text-gray-300 group-hover:text-[#1A4A28] transition-colors" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Chat Page                                                      */
/* ------------------------------------------------------------------ */
export function Chat() {
  const {
    messages, isLoading, error, sendMessage, stopGeneration, clearMessages,
    sessions, activeSessionId, deleteSession, renameSession, loadSession,
    syncKB, kbSyncing, uploadFileToKB, uploadingFile,
  } = useAgentChat();

  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [vizOpen, setVizOpen] = useState(true);
  const [promptsDropdown, setPromptsDropdown] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sidebar = useDragResize(260, 180, 400, 'right');
  const vizPanel = useDragResize(420, 280, 700, 'left');

  // Collect all images from all messages for the visualization panel
  const allImages = useMemo(() => {
    const imgs: string[] = [];
    for (const msg of messages) {
      if (msg.images) imgs.push(...msg.images);
    }
    return imgs;
  }, [messages]);

  // Auto-open viz panel when a new image arrives
  useEffect(() => {
    if (allImages.length > 0) setVizOpen(true);
  }, [allImages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadResult(null);
    const result = await uploadFileToKB(file);
    if (result) {
      setUploadResult(`${result.source}: ${result.indexed_chunks} chunks indexados`);
      setTimeout(() => setUploadResult(null), 5000);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSyncKB = async () => {
    const result = await syncKB();
    if (result) {
      setUploadResult(`KB sincronizada: ${result.synced_chunks} chunks`);
      setTimeout(() => setUploadResult(null), 5000);
    }
  };

  const handlePromptSelect = (text: string) => {
    sendMessage(text);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 overflow-hidden">
      <Navbar />
      <div className="flex-1 flex overflow-hidden">
        {/* ── Left: Session Sidebar ── */}
        {sidebarOpen && (
          <>
            <div className="h-full flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden" style={{ width: sidebar.width }}>
              <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-700">Conversaciones</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => clearMessages()}
                    className="p-1.5 rounded-lg hover:bg-green-50 text-[#1A4A28] transition-colors"
                    title="Nueva conversación"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setSidebarOpen(false)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                  >
                    <PanelLeftClose className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {sessions.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">Sin conversaciones</p>
                )}
                {sessions.map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    isActive={s.id === activeSessionId}
                    onSelect={() => loadSession(s.id)}
                    onDelete={() => deleteSession(s.id)}
                    onRename={(t) => renameSession(s.id, t)}
                  />
                ))}
              </div>

              <div className="p-3 border-t border-gray-100 space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.docx"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingFile}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-gray-200 hover:bg-green-50 hover:border-[#1A4A28] transition-colors disabled:opacity-50"
                >
                  {uploadingFile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-[#1A4A28]" />}
                  <span>{uploadingFile ? 'Indexando...' : 'Subir archivo a KB'}</span>
                </button>
                <button
                  onClick={handleSyncKB}
                  disabled={kbSyncing}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs rounded-lg border border-gray-200 hover:bg-blue-50 hover:border-blue-400 transition-colors disabled:opacity-50"
                >
                  {kbSyncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-blue-500" />}
                  <span>{kbSyncing ? 'Sincronizando...' : 'Sincronizar KB'}</span>
                </button>
                {uploadResult && (
                  <div className="flex items-center gap-1 text-xs text-green-700 bg-green-50 rounded px-2 py-1">
                    <Check className="w-3 h-3" />
                    {uploadResult}
                  </div>
                )}
              </div>
            </div>
            <DragHandle onMouseDown={sidebar.onMouseDown} />
          </>
        )}

        {/* ── Center: Chat Area ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Header */}
          <div className="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              {!sidebarOpen && (
                <button
                  onClick={() => setSidebarOpen(true)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              )}
              <div>
                <h1 className="text-base font-bold text-gray-900">Agente de Tesorería AI</h1>
                <p className="text-[11px] text-gray-500">
                  Cashflow · CxP · CxC · Proyecciones · Análisis visual
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 text-xs text-gray-400">
                <BrainCircuit className="w-3.5 h-3.5" />
                <span>3 agentes</span>
              </div>
              {!vizOpen && (
                <button
                  onClick={() => setVizOpen(true)}
                  className="p-1.5 rounded-lg hover:bg-green-50 text-[#1A4A28] transition-colors"
                  title="Mostrar visualización"
                >
                  <LineChart className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-gray-50 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent hover:scrollbar-thumb-gray-400" style={{ scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent' }}>
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-3">
                <Bot className="w-14 h-14 text-[#1A4A28] opacity-30" />
                <div className="text-center">
                  <p className="text-base font-medium text-gray-500">CVE Treasury Copilot</p>
                  <p className="text-xs mt-1">
                    Consultar Cash-In, Cash-Out, Proyección 12M, CxP, CxC, gráficos...
                  </p>
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Error banner */}
          {error && (
            <div className="mx-4 mb-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex-shrink-0">
              {error}
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t border-gray-200 bg-white px-4 py-3 flex-shrink-0">
            <div className="flex items-end gap-2">
              {/* Prompts dropdown trigger */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPromptsDropdown(!promptsDropdown)}
                  className="flex-shrink-0 p-2.5 rounded-xl border border-gray-300 hover:bg-amber-50 hover:border-amber-400 text-amber-500 transition-colors"
                  title="Sugerencias de consulta"
                >
                  <Lightbulb className="w-5 h-5" />
                </button>
                {promptsDropdown && (
                  <div className="absolute bottom-full left-0 mb-2 w-80 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-xl z-30 scrollbar-thin" style={{ scrollbarWidth: 'thin', scrollbarColor: '#d1d5db transparent' }}>
                    <div className="p-2 space-y-1">
                      {ALL_PROMPTS.map((p) => (
                        <button
                          key={p.text}
                          onClick={() => { handlePromptSelect(p.text); setPromptsDropdown(false); }}
                          className="w-full text-left text-xs px-3 py-2 rounded-lg hover:bg-green-50 hover:text-[#1A4A28] transition-colors leading-snug"
                        >
                          <span className="text-[10px] font-bold text-gray-400 uppercase">{p.category}</span>
                          <span className="mx-1.5 text-gray-300">·</span>
                          {p.text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="Escribe tu consulta de tesorería..."
                rows={1}
                className="flex-1 resize-none border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1A4A28] focus:border-transparent"
                disabled={isLoading}
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopGeneration}
                  className="flex-shrink-0 p-2.5 bg-red-500 text-white rounded-xl hover:bg-red-600 transition-colors"
                  title="Detener generación"
                >
                  <StopCircle className="w-5 h-5" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="flex-shrink-0 p-2.5 bg-[#1A4A28] text-white rounded-xl hover:bg-[#153d21] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Enviar"
                >
                  <Send className="w-5 h-5" />
                </button>
              )}
            </div>
          </form>
        </div>

        {/* ── Right: Visualization Panel ── */}
        {vizOpen && (
          <>
            <DragHandle onMouseDown={vizPanel.onMouseDown} />
            <div className="h-full flex-shrink-0 border-l border-gray-200 overflow-hidden" style={{ width: vizPanel.width }}>
              <VisualizationPanel images={allImages} onClose={() => setVizOpen(false)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
