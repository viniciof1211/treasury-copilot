import { useState, useRef, useEffect } from 'react';
import { Info, X, Database, Calculator, FileSpreadsheet, Server } from 'lucide-react';

export interface TooltipMeta {
  label: string;
  description: string;
  source: 'pcgraf' | 'supabase' | 'xlsx' | 'api' | 'calculated' | 'kafka' | 'faiss';
  sourceDetail?: string;
  formula?: string;
  unit?: string;
  module?: string;
  glossaryKey?: string;
}

const SOURCE_CONFIG: Record<string, { icon: typeof Info; color: string; label: string }> = {
  pcgraf:     { icon: Server,          color: 'text-purple-600 bg-purple-50', label: 'PcGraf ERP (SQL Server)' },
  supabase:   { icon: Database,        color: 'text-blue-600 bg-blue-50',    label: 'Supabase (PostgreSQL)' },
  xlsx:       { icon: FileSpreadsheet, color: 'text-green-600 bg-green-50',  label: 'Excel / XLSX Upload' },
  api:        { icon: Server,          color: 'text-orange-600 bg-orange-50', label: 'External API' },
  calculated: { icon: Calculator,      color: 'text-cyan-600 bg-cyan-50',    label: 'Calculated (frontend)' },
  kafka:      { icon: Server,          color: 'text-red-600 bg-red-50',      label: 'Kafka CDC Pipeline' },
  faiss:      { icon: Database,        color: 'text-indigo-600 bg-indigo-50', label: 'FAISS Knowledge Base' },
};

export function InfoTooltip({ meta, size = 'sm' }: { meta: TooltipMeta; size?: 'sm' | 'md' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const src = SOURCE_CONFIG[meta.source] || SOURCE_CONFIG.calculated;
  const SrcIcon = src.icon;
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
        aria-label={`Info: ${meta.label}`}
        type="button"
      >
        <Info className={iconSize} />
      </button>
      {open && (
        <div
          className="absolute z-[100] w-72 sm:w-80 bg-white border border-gray-200 rounded-xl shadow-xl p-0 animate-in fade-in slide-in-from-top-1 duration-150"
          style={{ top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 }}
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50 rounded-t-xl">
            <span className="text-xs font-semibold text-gray-700 truncate">{meta.label}</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-3 py-2.5 space-y-2 text-xs">
            <p className="text-gray-600 leading-relaxed">{meta.description}</p>

            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${src.color}`}>
                <SrcIcon className="w-3 h-3" />
                {src.label}
              </span>
            </div>

            {meta.sourceDetail && (
              <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
                <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Detalle de fuente</span>
                <p className="text-gray-700 mt-0.5 font-mono text-[11px] break-all">{meta.sourceDetail}</p>
              </div>
            )}

            {meta.formula && (
              <div className="bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">
                <span className="text-[10px] font-medium text-amber-700 uppercase tracking-wide flex items-center gap-1">
                  <Calculator className="w-3 h-3" /> Fórmula
                </span>
                <p className="text-amber-900 mt-0.5 font-mono text-[11px] break-all">{meta.formula}</p>
              </div>
            )}

            {meta.unit && (
              <p className="text-gray-500"><span className="font-medium">Unidad:</span> {meta.unit}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function CardTitleWithInfo({ children, meta, className = '' }: {
  children: React.ReactNode;
  meta: TooltipMeta;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <span>{children}</span>
      <InfoTooltip meta={meta} />
    </div>
  );
}
