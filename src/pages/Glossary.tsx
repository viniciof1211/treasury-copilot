import { useState, useMemo } from 'react';
import { Search, BookOpen, Database, Calculator, FileSpreadsheet, Server, Filter, X } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { getGlossaryByModule, getAllGlossaryEntries, type GlossaryEntry } from '../lib/glossary';

const SOURCE_BADGE: Record<string, { bg: string; text: string; icon: typeof Database }> = {
  pcgraf:     { bg: 'bg-purple-100', text: 'text-purple-700', icon: Server },
  supabase:   { bg: 'bg-blue-100',   text: 'text-blue-700',   icon: Database },
  xlsx:       { bg: 'bg-green-100',  text: 'text-green-700',  icon: FileSpreadsheet },
  api:        { bg: 'bg-orange-100', text: 'text-orange-700', icon: Server },
  calculated: { bg: 'bg-cyan-100',   text: 'text-cyan-700',   icon: Calculator },
  kafka:      { bg: 'bg-red-100',    text: 'text-red-700',    icon: Server },
  faiss:      { bg: 'bg-indigo-100', text: 'text-indigo-700', icon: Database },
};

const CATEGORY_LABEL: Record<string, string> = {
  kpi: 'KPI',
  chart: 'Gráfico',
  table: 'Tabla',
  metric: 'Métrica',
  concept: 'Concepto',
};

function EntryCard({ entry }: { entry: GlossaryEntry }) {
  const src = SOURCE_BADGE[entry.source] || SOURCE_BADGE.calculated;
  const SrcIcon = src.icon;
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-900 leading-tight">{entry.label}</h4>
          <div className="flex items-center gap-1 flex-shrink-0">
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              {CATEGORY_LABEL[entry.category] || entry.category}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-gray-600 leading-relaxed">{entry.description}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${src.bg} ${src.text}`}>
            <SrcIcon className="w-3 h-3" />
            {entry.source}
          </span>
          {entry.unit && (
            <span className="text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
              {entry.unit}
            </span>
          )}
        </div>
        {entry.sourceDetail && (
          <div className="bg-gray-50 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">Fuente</span>
            <p className="text-[11px] font-mono text-gray-700 mt-0.5 break-all">{entry.sourceDetail}</p>
          </div>
        )}
        {entry.formula && (
          <div className="bg-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-100">
            <span className="text-[10px] font-medium text-amber-700 uppercase tracking-wide flex items-center gap-1">
              <Calculator className="w-3 h-3" /> Fórmula
            </span>
            <p className="text-[11px] font-mono text-amber-900 mt-0.5 break-all">{entry.formula}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function Glossary() {
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');

  const byModule = useMemo(() => getGlossaryByModule(), []);
  const allEntries = useMemo(() => getAllGlossaryEntries(), []);
  const modules = useMemo(() => Object.keys(byModule).sort(), [byModule]);
  const sources = useMemo(() => [...new Set(allEntries.map(e => e.source))].sort(), [allEntries]);
  const categories = useMemo(() => [...new Set(allEntries.map(e => e.category))].sort(), [allEntries]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let entries = moduleFilter ? (byModule[moduleFilter] || []) : allEntries;
    if (categoryFilter) entries = entries.filter(e => e.category === categoryFilter);
    if (sourceFilter) entries = entries.filter(e => e.source === sourceFilter);
    if (q) {
      entries = entries.filter(e =>
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.formula || '').toLowerCase().includes(q) ||
        (e.sourceDetail || '').toLowerCase().includes(q)
      );
    }
    return entries;
  }, [search, moduleFilter, categoryFilter, sourceFilter, byModule, allEntries]);

  const grouped = useMemo(() => {
    const g: Record<string, GlossaryEntry[]> = {};
    for (const e of filtered) {
      const mod = e.module || 'Otros';
      if (!g[mod]) g[mod] = [];
      g[mod].push(e);
    }
    return g;
  }, [filtered]);

  const hasFilters = search || moduleFilter || categoryFilter || sourceFilter;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#1A4A28] rounded-xl flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Glosario Treasury-Finance</h1>
              <p className="text-sm text-gray-500">
                {allEntries.length} métricas, fórmulas y conceptos en {modules.length} módulos
              </p>
            </div>
          </div>
        </div>

        {/* Search & Filters */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar métrica, fórmula, fuente..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#1A4A28]/20 focus:border-[#1A4A28] outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={moduleFilter}
                onChange={e => setModuleFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-1 focus:ring-[#1A4A28]/20"
              >
                <option value="">Todos los módulos</option>
                {modules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-1 focus:ring-[#1A4A28]/20"
              >
                <option value="">Todas las categorías</option>
                {categories.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c] || c}</option>)}
              </select>
              <select
                value={sourceFilter}
                onChange={e => setSourceFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:ring-1 focus:ring-[#1A4A28]/20"
              >
                <option value="">Todas las fuentes</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {hasFilters && (
                <button
                  onClick={() => { setSearch(''); setModuleFilter(''); setCategoryFilter(''); setSourceFilter(''); }}
                  className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> Limpiar
                </button>
              )}
              <span className="text-xs text-gray-400 ml-auto">{filtered.length} resultados</span>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([mod, entries]) => (
          <div key={mod} className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-800 border-b border-gray-200 pb-1">{mod}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {entries.map((e, i) => <EntryCard key={`${mod}-${i}`} entry={e} />)}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No se encontraron resultados para tu búsqueda.</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
