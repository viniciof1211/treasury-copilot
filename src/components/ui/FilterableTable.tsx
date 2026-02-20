import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { Search, ChevronUp, ChevronDown, X, Filter } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
export interface ColumnDef<T> {
  key: string;
  header: string;
  /** Render cell content. Receives the row item. */
  render: (item: T, idx: number) => ReactNode;
  /** Extract a raw sortable/filterable value from the row. Defaults to item[key]. */
  accessor?: (item: T) => string | number | null | undefined;
  /** Right-align (for numbers/currency) */
  align?: 'left' | 'right' | 'center';
  /** Fixed width class e.g. 'max-w-[180px]' */
  className?: string;
  /** If true, this column gets a dropdown filter instead of text search */
  filterType?: 'text' | 'select';
  /** Whether column is sortable (default true) */
  sortable?: boolean;
}

interface FilterableTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  /** Max rows to display (default 50) */
  maxRows?: number;
  /** Row click handler */
  onRowClick?: (item: T, idx: number) => void;
  /** Row double-click handler */
  onRowDoubleClick?: (item: T, idx: number) => void;
  /** Row hover class */
  hoverClass?: string;
  /** Empty state message */
  emptyText?: string;
  /** Sticky header */
  stickyHeader?: boolean;
  /** Max height for scroll */
  maxHeight?: string;
}

type SortDir = 'asc' | 'desc' | null;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export function FilterableTable<T extends Record<string, unknown>>({
  data,
  columns,
  maxRows = 50,
  onRowClick,
  onRowDoubleClick,
  hoverClass = 'hover:bg-gray-50/50',
  emptyText = 'Sin datos.',
  stickyHeader = true,
  maxHeight = '540px',
}: FilterableTableProps<T>) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>(null);
  const [showFilters, setShowFilters] = useState(false);

  const activeFilterCount = Object.values(filters).filter(v => v).length;

  const getVal = useCallback((item: T, col: ColumnDef<T>): string => {
    if (col.accessor) {
      const v = col.accessor(item);
      return v == null ? '' : String(v);
    }
    const v = item[col.key];
    return v == null ? '' : String(v);
  }, []);

  // Unique values for select filters
  const selectOptions = useMemo(() => {
    const opts: Record<string, string[]> = {};
    columns.forEach(col => {
      if (col.filterType === 'select') {
        const s = new Set<string>();
        data.forEach(item => {
          const v = getVal(item, col);
          if (v) s.add(v);
        });
        opts[col.key] = Array.from(s).sort();
      }
    });
    return opts;
  }, [data, columns, getVal]);

  // Filter + sort
  const processed = useMemo(() => {
    let result = data;

    // Apply filters
    const activeFilters = Object.entries(filters).filter(([, v]) => v);
    if (activeFilters.length > 0) {
      result = result.filter(item => {
        return activeFilters.every(([key, filterVal]) => {
          const col = columns.find(c => c.key === key);
          if (!col) return true;
          const val = getVal(item, col).toLowerCase();
          if (col.filterType === 'select') return val === filterVal.toLowerCase();
          return val.includes(filterVal.toLowerCase());
        });
      });
    }

    // Apply sort
    if (sortKey && sortDir) {
      const col = columns.find(c => c.key === sortKey);
      if (col) {
        result = [...result].sort((a, b) => {
          const va = getVal(a, col);
          const vb = getVal(b, col);
          const na = parseFloat(va);
          const nb = parseFloat(vb);
          let cmp: number;
          if (!isNaN(na) && !isNaN(nb)) {
            cmp = na - nb;
          } else {
            cmp = va.localeCompare(vb, 'es', { numeric: true });
          }
          return sortDir === 'desc' ? -cmp : cmp;
        });
      }
    }

    return result;
  }, [data, filters, sortKey, sortDir, columns, getVal]);

  const displayed = processed.slice(0, maxRows);

  const handleSort = (key: string) => {
    const col = columns.find(c => c.key === key);
    if (col?.sortable === false) return;
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else if (sortDir === 'desc') { setSortKey(null); setSortDir(null); }
      else setSortDir('asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const clearFilters = () => {
    setFilters({});
  };

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-gray-400">
        <Filter className="w-6 h-6 mb-2 opacity-30" />
        <p className="text-xs text-center max-w-xs">{emptyText}</p>
      </div>
    );
  }

  return (
    <div>
      {/* Filter toggle bar */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
            showFilters || activeFilterCount > 0
              ? 'bg-[#1A4A28]/10 border-[#1A4A28]/30 text-[#1A4A28]'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50'
          }`}
        >
          <Filter className="w-3 h-3" />
          Filtros
          {activeFilterCount > 0 && (
            <span className="bg-[#1A4A28] text-white text-[9px] px-1.5 py-0.5 rounded-full ml-0.5">
              {activeFilterCount}
            </span>
          )}
        </button>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-red-500 hover:text-red-700">
              <X className="w-3 h-3" /> Limpiar filtros
            </button>
          )}
          <span>{processed.length} de {data.length} registros</span>
        </div>
      </div>

      {/* Filter row */}
      {showFilters && (
        <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: `repeat(${Math.min(columns.length, 6)}, 1fr)` }}>
          {columns.slice(0, 6).map(col => (
            <div key={col.key} className="relative">
              {col.filterType === 'select' ? (
                <select
                  value={filters[col.key] || ''}
                  onChange={e => setFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                  className="w-full text-[10px] border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28]"
                >
                  <option value="">{col.header}: Todos</option>
                  {(selectOptions[col.key] || []).map(opt => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-300" />
                  <input
                    type="text"
                    value={filters[col.key] || ''}
                    onChange={e => setFilters(prev => ({ ...prev, [col.key]: e.target.value }))}
                    placeholder={col.header}
                    className="w-full text-[10px] border border-gray-200 rounded-lg pl-6 pr-2 py-1.5 bg-white text-gray-700 focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28] placeholder:text-gray-300"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight }}>
        <table className="w-full text-sm">
          <thead className={stickyHeader ? 'sticky top-0 bg-white z-10' : ''}>
            <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`pb-2 pr-3 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'} ${
                    col.sortable !== false ? 'cursor-pointer select-none hover:text-gray-700' : ''
                  } ${col.className || ''}`}
                  onClick={() => handleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {sortKey === col.key && sortDir === 'asc' && <ChevronUp className="w-3 h-3" />}
                    {sortKey === col.key && sortDir === 'desc' && <ChevronDown className="w-3 h-3" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {displayed.map((item, idx) => (
              <tr
                key={idx}
                className={`${hoverClass} ${onRowClick || onRowDoubleClick ? 'cursor-pointer' : ''}`}
                onClick={() => onRowClick?.(item, idx)}
                onDoubleClick={() => onRowDoubleClick?.(item, idx)}
                title={onRowDoubleClick ? 'Doble clic para ver/editar detalle' : undefined}
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    className={`py-2 pr-3 text-xs ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''} ${col.className || ''}`}
                  >
                    {col.render(item, idx)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      {processed.length > maxRows && (
        <p className="text-xs text-gray-400 mt-2 text-center">
          Mostrando {maxRows} de {processed.length} registros.
        </p>
      )}
      {onRowDoubleClick && (
        <p className="text-xs text-gray-400 mt-1 text-center italic">
          Doble clic en una fila para ver/editar detalle completo
        </p>
      )}
    </div>
  );
}
