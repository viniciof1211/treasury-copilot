import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RefreshCw, Search, Layers } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { getDataModelSchema, type SchemaTable, type ForeignKey } from '../../lib/dataModel';

// ── Schema colors per DB schema ──────────────────────────────────────────
const SCHEMA_COLORS: Record<string, { bg: string; border: string; header: string; badge: string }> = {
  silver_finance: { bg: '#f0fdf4', border: '#16a34a', header: '#15803d', badge: 'bg-green-100 text-green-800' },
  bronze_finance: { bg: '#fefce8', border: '#ca8a04', header: '#a16207', badge: 'bg-yellow-100 text-yellow-800' },
  tms:            { bg: '#eff6ff', border: '#2563eb', header: '#1d4ed8', badge: 'bg-blue-100 text-blue-800' },
  dim:            { bg: '#faf5ff', border: '#9333ea', header: '#7e22ce', badge: 'bg-purple-100 text-purple-800' },
};

const DEFAULT_COLOR = { bg: '#f9fafb', border: '#6b7280', header: '#374151', badge: 'bg-gray-100 text-gray-800' };

// ── Custom table node ────────────────────────────────────────────────────
function TableNode({ data }: { data: { label: string; schema: string; columns: { name: string; type: string; isPk: boolean }[]; rowCount?: number } }) {
  const colors = SCHEMA_COLORS[data.schema] || DEFAULT_COLOR;
  const maxCols = 12;
  const displayCols = data.columns.slice(0, maxCols);
  const remaining = data.columns.length - maxCols;

  return (
    <div
      className="rounded-lg shadow-lg overflow-hidden min-w-[220px] max-w-[280px] text-xs"
      style={{ border: `2px solid ${colors.border}`, background: colors.bg }}
    >
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between" style={{ background: colors.header }}>
        <span className="font-bold text-white truncate">{data.label}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${colors.badge}`}>
          {data.schema}
        </span>
      </div>
      {/* Columns */}
      <div className="divide-y divide-gray-200/60">
        {displayCols.map((col) => (
          <div key={col.name} className="px-3 py-1 flex items-center gap-2">
            {col.isPk && <span className="text-amber-500 font-bold text-[10px]">PK</span>}
            <span className={`truncate ${col.isPk ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
              {col.name}
            </span>
            <span className="ml-auto text-gray-400 text-[10px] shrink-0">{col.type}</span>
          </div>
        ))}
        {remaining > 0 && (
          <div className="px-3 py-1 text-gray-400 italic text-center">+{remaining} more columns</div>
        )}
      </div>
      {/* Footer */}
      {data.rowCount !== undefined && (
        <div className="px-3 py-1.5 text-[10px] text-gray-500 border-t border-gray-200/60 text-right">
          {data.rowCount.toLocaleString()} rows
        </div>
      )}
    </div>
  );
}

const nodeTypes = { tableNode: TableNode };

// ── Layout helper: arrange nodes in a grid per schema ────────────────────
function layoutNodes(tables: SchemaTable[]): Node[] {
  const schemas = [...new Set(tables.map((t) => t.table_schema))].sort();
  const nodes: Node[] = [];
  let yOffset = 0;

  for (const schema of schemas) {
    const schemaTables = tables.filter((t) => t.table_schema === schema);
    const cols = Math.min(4, Math.ceil(Math.sqrt(schemaTables.length)));

    schemaTables.forEach((tbl, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const pks = tbl.primary_keys || [];
      const columns = (tbl.columns || []).map((c) => ({
        name: c.column_name,
        type: c.data_type,
        isPk: pks.includes(c.column_name),
      }));

      nodes.push({
        id: `${tbl.table_schema}.${tbl.table_name}`,
        type: 'tableNode',
        position: { x: col * 320, y: yOffset + row * 340 },
        data: {
          label: tbl.table_name,
          schema: tbl.table_schema,
          columns,
        },
      });
    });

    const rows = Math.ceil(schemaTables.length / cols);
    yOffset += rows * 340 + 80;
  }

  return nodes;
}

function layoutEdges(fks: ForeignKey[]): Edge[] {
  return fks.map((fk, i) => ({
    id: `fk-${i}`,
    source: `${fk.table_schema}.${fk.table_name}`,
    target: `${fk.foreign_table_schema}.${fk.foreign_table_name}`,
    sourceHandle: null,
    targetHandle: null,
    label: `${fk.column_name} → ${fk.foreign_column_name}`,
    labelStyle: { fontSize: 10, fill: '#6b7280' },
    style: { stroke: '#94a3b8', strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 12, height: 12 },
    animated: true,
  }));
}

export function ERDiagramTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tables, setTables] = useState<SchemaTable[]>([]);
  const [fks, setFks] = useState<ForeignKey[]>([]);
  const [filter, setFilter] = useState('');
  const [schemaFilter, setSchemaFilter] = useState<string>('all');

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const fetchSchema = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getDataModelSchema();
      if (data.error) throw new Error(data.error);
      setTables(data.tables || []);
      setFks(data.foreign_keys || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load schema');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSchema(); }, [fetchSchema]);

  const filteredTables = useMemo(() => {
    let result = tables;
    if (schemaFilter !== 'all') {
      result = result.filter((t) => t.table_schema === schemaFilter);
    }
    if (filter) {
      const q = filter.toLowerCase();
      result = result.filter(
        (t) => t.table_name.toLowerCase().includes(q) || t.table_schema.toLowerCase().includes(q)
      );
    }
    return result;
  }, [tables, filter, schemaFilter]);

  useEffect(() => {
    const n = layoutNodes(filteredTables);
    const filteredIds = new Set(n.map((nd) => nd.id));
    const e = layoutEdges(fks).filter(
      (edge) => filteredIds.has(edge.source) && filteredIds.has(edge.target)
    );
    setNodes(n);
    setEdges(e);
  }, [filteredTables, fks, setNodes, setEdges]);

  const schemas = useMemo(() => [...new Set(tables.map((t) => t.table_schema))].sort(), [tables]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[600px]">
        <LoadingSpinner size="lg" />
        <span className="ml-3 text-gray-500">Cargando esquema de datos...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-6 text-center">
          <p className="text-red-700">{error}</p>
          <Button variant="outline" className="mt-3" onClick={fetchSchema}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar tabla..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#1A4A28] focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-gray-500" />
          <select
            value={schemaFilter}
            onChange={(e) => setSchemaFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1A4A28]"
          >
            <option value="all">Todos los esquemas</option>
            {schemas.map((s) => (
              <option key={s} value={s}>{s} ({tables.filter((t) => t.table_schema === s).length})</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span><strong>{filteredTables.length}</strong> tablas</span>
          <span><strong>{edges.length}</strong> relaciones</span>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSchema}>
          <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs">
        {Object.entries(SCHEMA_COLORS).map(([schema, c]) => (
          <div key={schema} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ background: c.header }} />
            <span className="text-gray-600">{schema}</span>
          </div>
        ))}
      </div>

      {/* ReactFlow Canvas */}
      <div className="h-[700px] border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.1}
          maxZoom={2}
          defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
        >
          <Background color="#e5e7eb" gap={20} />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              const schema = (node.data as { schema?: string })?.schema || '';
              return SCHEMA_COLORS[schema]?.header || '#6b7280';
            }}
            maskColor="rgba(0,0,0,0.08)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
