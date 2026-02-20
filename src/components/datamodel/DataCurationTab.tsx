import { useState, useEffect, useCallback } from 'react';
import { PenTool, Search, RefreshCw, Save, Database, Server, Brain, Check, AlertCircle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import {
  getTableRegistry, getERPSchema, saveCuration,
  type TableRegistryEntry, type ERPTable,
} from '../../lib/dataModel';
import { supabase } from '../../lib/supabase';

// ── Target checkboxes ────────────────────────────────────────────────────
interface TargetSelection {
  supabase: boolean;
  faiss: boolean;
  erp: boolean;
}

export function DataCurationTab() {
  const [loading, setLoading] = useState(true);
  const [registry, setRegistry] = useState<TableRegistryEntry[]>([]);
  const [erpTables, setErpTables] = useState<ERPTable[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState('');

  // Selected table state
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableRows, setTableRows] = useState<Record<string, unknown>[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [targets, setTargets] = useState<TargetSelection>({ supabase: true, faiss: true, erp: false });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [regData, erpData] = await Promise.all([getTableRegistry(), getERPSchema().catch(() => ({ tables: [] as ERPTable[], database: '' }))]);
      setRegistry(regData.tables || []);
      setErpTables(erpData.tables || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Load rows for selected table from Supabase
  const loadTableRows = useCallback(async (tableName: string) => {
    setLoadingRows(true);
    setTableRows([]);
    setEditingRow(null);
    try {
      // Try tms schema first, then silver_finance
      const entry = registry.find((r) => r.sql_table_name === tableName);
      const supabaseTable = entry?.supabase_table || tableName;

      let rows: Record<string, unknown>[] = [];
      // Try tms schema
      const { data: tmsData, error: tmsErr } = await supabase
        .schema('tms' as 'public')
        .from(supabaseTable)
        .select('*')
        .limit(50)
        .order('id', { ascending: false });

      if (!tmsErr && tmsData) {
        rows = tmsData;
      } else {
        // Try silver_finance
        const { data: sfData } = await supabase
          .schema('silver_finance' as 'public')
          .from(supabaseTable)
          .select('*')
          .limit(50)
          .order('id', { ascending: false });
        if (sfData) rows = sfData;
      }

      setTableRows(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load rows');
    } finally {
      setLoadingRows(false);
    }
  }, [registry]);

  const handleSelectTable = (tableName: string) => {
    setSelectedTable(tableName);
    setSuccess('');
    setError('');
    loadTableRows(tableName);
  };

  const handleStartEdit = (row: Record<string, unknown>) => {
    const id = String(row.id || row.sql_table_name || '');
    setEditingRow(id);
    setEditValues({ ...row });
  };

  const handleCancelEdit = () => {
    setEditingRow(null);
    setEditValues({});
  };

  const handleSave = async () => {
    if (!selectedTable || !editingRow) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const entry = registry.find((r) => r.sql_table_name === selectedTable);
      const supabaseTable = entry?.supabase_table || selectedTable;
      const activeTargets = Object.entries(targets).filter(([, v]) => v).map(([k]) => k);

      // Find changed fields
      const originalRow = tableRows.find((r) => String(r.id || r.sql_table_name) === editingRow);
      const changes: Record<string, unknown> = {};
      if (originalRow) {
        for (const [key, val] of Object.entries(editValues)) {
          if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
          if (JSON.stringify(val) !== JSON.stringify(originalRow[key])) {
            changes[key] = val;
          }
        }
      }

      if (Object.keys(changes).length === 0) {
        setSuccess('No hay cambios para guardar.');
        setSaving(false);
        return;
      }

      const result = await saveCuration({
        table: supabaseTable,
        schema: 'tms',
        row_id: editingRow,
        changes,
        targets: activeTargets,
        pk_col: 'id',
      });

      const statuses = Object.entries(result.results)
        .map(([target, r]) => `${target}: ${r.status}`)
        .join(', ');
      setSuccess(`Guardado exitoso — ${statuses}`);
      setEditingRow(null);
      setEditValues({});
      // Reload rows
      loadTableRows(selectedTable);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const getErpTable = (sqlTable: string) => erpTables.find((t) => t.sql_table === sqlTable);

  const filtered = registry.filter((r) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return r.sql_table_name?.toLowerCase().includes(q) ||
      r.entity_name?.toLowerCase().includes(q) ||
      r.business_name?.toLowerCase().includes(q) ||
      r.erp_module?.toLowerCase().includes(q);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <LoadingSpinner size="lg" />
        <span className="ml-3 text-gray-500">Cargando registro de tablas...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Messages */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto text-red-500">&times;</button>
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          <Check className="w-4 h-4 shrink-0" />
          {success}
          <button onClick={() => setSuccess('')} className="ml-auto text-green-500">&times;</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Table list */}
        <div className="lg:col-span-1 space-y-3">
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <PenTool className="w-4 h-4 text-rose-600" />
                Tablas para Curación
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="relative mb-3">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Buscar tabla..."
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-[#1A4A28]"
                />
              </div>
              <div className="space-y-1 max-h-[500px] overflow-y-auto">
                {filtered.map((entry) => {
                  const isSelected = selectedTable === entry.sql_table_name;
                  const erpTable = getErpTable(entry.sql_table_name);
                  return (
                    <button
                      key={entry.sql_table_name}
                      onClick={() => handleSelectTable(entry.sql_table_name)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition ${
                        isSelected
                          ? 'bg-[#1A4A28] text-white'
                          : 'hover:bg-gray-100 text-gray-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-semibold">{entry.sql_table_name}</span>
                        {erpTable && (
                          <span className={`text-[10px] ${isSelected ? 'text-green-200' : 'text-gray-400'}`}>
                            {erpTable.row_count.toLocaleString()} rows
                          </span>
                        )}
                      </div>
                      <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-green-200' : 'text-gray-500'}`}>
                        {entry.entity_name || entry.business_name || entry.erp_module}
                      </p>
                    </button>
                  );
                })}
                {filtered.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-4">No hay tablas registradas.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Target selection */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Destino de Cambios</CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={targets.supabase}
                  onChange={(e) => setTargets((p) => ({ ...p, supabase: e.target.checked }))}
                  className="rounded border-gray-300 text-[#1A4A28]"
                />
                <Database className="w-3.5 h-3.5 text-green-600" />
                <span>Supabase (Modelo)</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={targets.faiss}
                  onChange={(e) => setTargets((p) => ({ ...p, faiss: e.target.checked }))}
                  className="rounded border-gray-300 text-[#1A4A28]"
                />
                <Brain className="w-3.5 h-3.5 text-purple-600" />
                <span>FAISS Knowledge Base</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={targets.erp}
                  onChange={(e) => setTargets((p) => ({ ...p, erp: e.target.checked }))}
                  className="rounded border-gray-300 text-[#1A4A28]"
                />
                <Server className="w-3.5 h-3.5 text-blue-600" />
                <span>PcGraf SQL ERP DB</span>
              </label>
              {targets.erp && (
                <p className="text-[10px] text-amber-600 bg-amber-50 p-2 rounded">
                  ⚠️ Escribir en PcGraf ERP modifica datos de producción. Use con precaución.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Table data editor */}
        <div className="lg:col-span-2">
          {!selectedTable ? (
            <Card>
              <CardContent className="p-12 text-center">
                <PenTool className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500">Seleccione una tabla para ver y editar datos.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Los cambios se pueden reflejar en Supabase, FAISS KB y/o PcGraf ERP.
                </p>
              </CardContent>
            </Card>
          ) : loadingRows ? (
            <Card>
              <CardContent className="p-12 text-center">
                <LoadingSpinner size="lg" />
                <p className="text-gray-500 mt-3">Cargando datos de {selectedTable}...</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Database className="w-4 h-4 text-green-600" />
                    {selectedTable}
                    <Badge variant="default">{tableRows.length} filas</Badge>
                  </CardTitle>
                  <div className="flex gap-2">
                    {editingRow && (
                      <>
                        <Button variant="outline" size="sm" onClick={handleCancelEdit}>Cancelar</Button>
                        <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
                          {saving ? <LoadingSpinner size="sm" className="mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
                          Guardar
                        </Button>
                      </>
                    )}
                    <Button variant="outline" size="sm" onClick={() => loadTableRows(selectedTable)}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {tableRows.length === 0 ? (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    No se encontraron filas en Supabase para esta tabla.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-gray-50 z-10">
                        <tr className="border-b border-gray-200">
                          <th className="px-3 py-2 text-left font-medium text-gray-500 w-16">Acción</th>
                          {tableRows[0] && Object.keys(tableRows[0]).slice(0, 10).map((col) => (
                            <th key={col} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                          {tableRows[0] && Object.keys(tableRows[0]).length > 10 && (
                            <th className="px-3 py-2 text-left font-medium text-gray-400">
                              +{Object.keys(tableRows[0]).length - 10} cols
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {tableRows.map((row, idx) => {
                          const rowId = String(row.id || row.sql_table_name || idx);
                          const isEditing = editingRow === rowId;
                          const cols = Object.keys(row).slice(0, 10);
                          return (
                            <tr key={rowId} className={`${isEditing ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                              <td className="px-3 py-2">
                                {isEditing ? (
                                  <span className="text-blue-600 font-medium">Editando</span>
                                ) : (
                                  <button
                                    onClick={() => handleStartEdit(row)}
                                    className="text-[#1A4A28] hover:underline font-medium"
                                  >
                                    Editar
                                  </button>
                                )}
                              </td>
                              {cols.map((col) => (
                                <td key={col} className="px-3 py-2">
                                  {isEditing && col !== 'id' && col !== 'created_at' && col !== 'updated_at' ? (
                                    <input
                                      type="text"
                                      value={String(editValues[col] ?? '')}
                                      onChange={(e) => setEditValues((prev) => ({ ...prev, [col]: e.target.value }))}
                                      className="w-full px-1.5 py-0.5 border border-blue-300 rounded text-xs focus:ring-1 focus:ring-blue-500 bg-white"
                                    />
                                  ) : (
                                    <span className="text-gray-700 truncate block max-w-[150px]" title={String(row[col] ?? '')}>
                                      {String(row[col] ?? '—')}
                                    </span>
                                  )}
                                </td>
                              ))}
                              {Object.keys(row).length > 10 && (
                                <td className="px-3 py-2 text-gray-400">...</td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
