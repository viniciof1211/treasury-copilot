import { useState, useEffect, useCallback } from 'react';
import { Server, Key, Search, RefreshCw, Database, ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { getERPSchema, getTableRegistry, type ERPTable, type ERPColumn, type TableRegistryEntry } from '../../lib/dataModel';

// Tech → Business name mapping for common PcGraf columns
const COLUMN_BUSINESS_NAMES: Record<string, string> = {
  sCodigo: 'Código Producto', sDescripcion: 'Descripción', sCodigo_Barras: 'Código de Barras',
  nPrecio: 'Precio', nCosto: 'Costo', nExistencia: 'Existencia', sBodega: 'Bodega',
  sProveedor: 'Proveedor', sCliente: 'Cliente', sPedido: 'Pedido', sOrden: 'Orden de Compra',
  sFactura: 'Factura', sRecibo: 'Recibo', sDocumento: 'Documento', dFecha: 'Fecha',
  dFecha_Ingreso: 'Fecha Ingreso', dFecha_Documento: 'Fecha Documento', nMonto: 'Monto',
  nSaldo: 'Saldo', nTotal: 'Total', sCuenta: 'Cuenta Contable', sConsecutivo: 'Consecutivo',
  sLlave: 'Llave', iLinea: 'Línea', sRecepcion: 'Recepción', cAnio: 'Año', bMes: 'Mes',
  sTipo_Documento: 'Tipo Documento', sNumero_Documento: 'Número Documento',
};

function getBusinessColName(colName: string): string {
  return COLUMN_BUSINESS_NAMES[colName] || colName;
}

// Module grouping for ERP tables
const MODULE_MAP: Record<string, { name: string; color: string; bg: string }> = {
  IN: { name: 'Inventario', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  FA: { name: 'Facturación', color: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  CP: { name: 'Compras / CxP', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  CC: { name: 'Cuentas por Cobrar', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  CO: { name: 'Contabilidad', color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
  BA: { name: 'Bancos', color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200' },
  TC: { name: 'Tipos de Cambio', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  GE: { name: 'General', color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' },
};

function getModule(tableName: string) {
  const prefix = tableName.replace(/[0-9]/g, '');
  return MODULE_MAP[prefix] || MODULE_MAP.GE;
}

export function ERPModelTab() {
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<ERPTable[]>([]);
  const [registry, setRegistry] = useState<TableRegistryEntry[]>([]);
  const [database, setDatabase] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showMapping, setShowMapping] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [erpData, regData] = await Promise.all([getERPSchema(), getTableRegistry()]);
      if (erpData.error) throw new Error(erpData.error);
      setTables(erpData.tables || []);
      setDatabase(erpData.database || '');
      setRegistry(regData.tables || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ERP schema');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleExpand = (table: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(table) ? next.delete(table) : next.add(table);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(tables.map((t) => t.sql_table)));
  const collapseAll = () => setExpanded(new Set());

  const getBusinessName = (sqlTable: string) => {
    const entry = registry.find((r) => r.sql_table_name === sqlTable);
    return entry?.entity_name || entry?.business_name || '';
  };

  const filtered = tables.filter((t) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return t.sql_table.toLowerCase().includes(q) ||
      t.entity.toLowerCase().includes(q) ||
      getBusinessName(t.sql_table).toLowerCase().includes(q);
  });

  // Group by module
  const grouped = filtered.reduce<Record<string, ERPTable[]>>((acc, t) => {
    const mod = getModule(t.sql_table);
    const key = mod.name;
    (acc[key] = acc[key] || []).push(t);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <LoadingSpinner size="lg" />
        <span className="ml-3 text-gray-500">Conectando a PcGraf ERP...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-6 text-center">
          <p className="text-red-700 mb-2">{error}</p>
          <p className="text-sm text-red-500">Asegúrese de que el servidor PcGraf (192.168.1.3) sea accesible.</p>
          <Button variant="outline" className="mt-3" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-blue-600" />
          <span className="text-sm text-gray-600">
            Base de datos: <strong className="font-mono">{database}</strong> — {tables.length} tablas CDC
          </span>
          <span className="text-sm text-gray-400">|</span>
          <span className="text-sm text-gray-600">
            {tables.reduce((sum, t) => sum + t.row_count, 0).toLocaleString()} filas totales
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={showMapping}
              onChange={(e) => setShowMapping(e.target.checked)}
              className="rounded border-gray-300"
            />
            Mostrar mapping Tech → Business
          </label>
          <Button variant="outline" size="sm" onClick={expandAll}>Expandir todo</Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>Colapsar</Button>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar tabla, entidad..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#1A4A28]"
        />
      </div>

      {/* Module groups */}
      {Object.entries(grouped).map(([moduleName, moduleTables]) => {
        const firstTable = moduleTables[0];
        const mod = getModule(firstTable.sql_table);
        return (
          <Card key={moduleName} className={`border ${mod.bg}`}>
            <CardHeader className="py-3">
              <CardTitle className={`text-base ${mod.color} flex items-center gap-2`}>
                <Server className="w-4 h-4" />
                {moduleName}
                <Badge variant="default">{moduleTables.length} tablas</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y divide-gray-200/60">
                {moduleTables.map((tbl) => {
                  const isExpanded = expanded.has(tbl.sql_table);
                  const businessName = getBusinessName(tbl.sql_table);
                  return (
                    <div key={tbl.sql_table}>
                      {/* Table header row */}
                      <button
                        onClick={() => toggleExpand(tbl.sql_table)}
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/60 transition text-left"
                      >
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                        <span className="font-mono font-semibold text-sm text-gray-900">{tbl.sql_table}</span>
                        {businessName && (
                          <>
                            <ArrowRight className="w-3 h-3 text-gray-400" />
                            <span className="text-sm text-gray-600">{businessName}</span>
                          </>
                        )}
                        <span className="text-xs text-gray-400 ml-auto">
                          {tbl.entity}
                        </span>
                        <Badge variant="default">{tbl.row_count.toLocaleString()} rows</Badge>
                        <Badge variant={tbl.strategy === 'timestamp' ? 'success' : tbl.strategy === 'pk_max' ? 'warning' : 'default'}>
                          {tbl.strategy}
                        </Badge>
                        {tbl.pk_columns.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-amber-600">
                            <Key className="w-3 h-3" />
                            {tbl.pk_columns.join(', ')}
                          </span>
                        )}
                      </button>

                      {/* Expanded columns */}
                      {isExpanded && (
                        <div className="px-4 pb-3 bg-white/40">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-gray-200 text-left">
                                <th className="pb-1.5 font-medium text-gray-500 w-8">#</th>
                                <th className="pb-1.5 font-medium text-gray-500">Columna (Tech)</th>
                                {showMapping && <th className="pb-1.5 font-medium text-gray-500">Nombre Business</th>}
                                <th className="pb-1.5 font-medium text-gray-500">Tipo</th>
                                <th className="pb-1.5 font-medium text-gray-500 text-center">PK</th>
                                <th className="pb-1.5 font-medium text-gray-500 text-center">Nullable</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {tbl.columns.map((col) => (
                                <tr key={col.name} className={`${col.is_pk ? 'bg-amber-50/50' : 'hover:bg-gray-50'}`}>
                                  <td className="py-1.5 text-gray-400">{col.ordinal}</td>
                                  <td className="py-1.5">
                                    <span className={`font-mono ${col.is_pk ? 'font-bold text-amber-700' : 'text-gray-800'}`}>
                                      {col.name}
                                    </span>
                                  </td>
                                  {showMapping && (
                                    <td className="py-1.5 text-gray-600">
                                      {getBusinessColName(col.name) !== col.name ? (
                                        <span className="flex items-center gap-1">
                                          <ArrowRight className="w-3 h-3 text-gray-300" />
                                          {getBusinessColName(col.name)}
                                        </span>
                                      ) : (
                                        <span className="text-gray-300">—</span>
                                      )}
                                    </td>
                                  )}
                                  <td className="py-1.5 font-mono text-gray-500">
                                    {col.type}{col.max_length ? `(${col.max_length})` : ''}
                                  </td>
                                  <td className="py-1.5 text-center">
                                    {col.is_pk && <Key className="w-3 h-3 text-amber-500 mx-auto" />}
                                  </td>
                                  <td className="py-1.5 text-center text-gray-400">
                                    {col.nullable ? 'Yes' : '—'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {tbl.error && (
                            <p className="text-xs text-red-500 mt-2">Error: {tbl.error}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
