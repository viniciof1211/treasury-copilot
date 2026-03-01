import { useState, useEffect, useCallback } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate } from '../lib/utils';
import {
  queryEntity, createEntity, updateEntity, deleteEntity, approveEntity,
  fetchEntities, fetchAuditLog, fetchBusinessRules, fetchNotifications,
  type EntityConfig, type QueryResult, type AuditEntry, type BusinessRule,
  type Contrato, type DebtInstrument, type PaymentBatch, type CashflowForecastEntry,
  type Notification,
} from '../lib/tms-api';
import {
  Building2, FileText, DollarSign, TrendingUp, Shield, Bell,
  Plus, Search, ChevronLeft, ChevronRight, RefreshCw, Check,
  X, Clock, AlertTriangle, Database, BookOpen, ArrowUpRight,
  Banknote, Landmark, BarChart3, Settings, Eye, Edit3, Trash2,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type TMSModule = 'overview' | 'contratos' | 'debt' | 'cashflow' | 'payments' | 'audit' | 'rules';

interface ModuleDef {
  id: TMSModule;
  label: string;
  icon: React.ElementType;
  description: string;
}

const MODULES: ModuleDef[] = [
  { id: 'overview',  label: 'Resumen',       icon: BarChart3,  description: 'Vista ejecutiva del TMS' },
  { id: 'contratos', label: 'Contratos',     icon: FileText,   description: 'Contratos e hitos de proyecto' },
  { id: 'debt',      label: 'Deuda',         icon: Landmark,   description: 'Instrumentos y amortización' },
  { id: 'cashflow',  label: 'Flujo de Caja', icon: TrendingUp, description: 'Pronóstico semanal' },
  { id: 'payments',  label: 'Pagos',         icon: Banknote,   description: 'Lotes e instrucciones de pago' },
  { id: 'audit',     label: 'Auditoría',     icon: Shield,     description: 'Log inmutable de transacciones' },
  { id: 'rules',     label: 'Reglas',        icon: Settings,   description: 'Reglas de negocio configurables' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const estadoBadge = (estado: string) => {
  const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
    aprobado: 'success', firmado: 'success', en_ejecucion: 'success', vigente: 'success',
    ejecutado: 'success', cobrado: 'success', pagado: 'success', conciliado: 'success',
    pendiente: 'warning', pendiente_aprobacion: 'warning', proyectado: 'warning',
    propuesta: 'info', borrador: 'info', negociacion: 'info', importado: 'info',
    rechazado: 'error', cancelado: 'error', vencido: 'error', fallido: 'error',
    cerrado: 'default',
  };
  return <Badge variant={map[estado] || 'default'}>{estado.replace(/_/g, ' ')}</Badge>;
};

// ─── Main Component ─────────────────────────────────────────────────────────

export function TMSDashboard() {
  const [activeModule, setActiveModule] = useState<TMSModule>('overview');
  const [entities, setEntities] = useState<EntityConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    fetchEntities().then(setEntities).catch(() => {});
    fetchNotifications(true).then(r => setNotifications(r.data || [])).catch(() => {});
  }, []);

  const unreadCount = notifications.filter(n => !n.leido).length;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Database className="w-7 h-7 text-[#1A4A28]" />
              ARA Treasury Management System
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Transactional R/W · {entities.length} entidades registradas · Data Virtualization Layer
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Bell className="w-5 h-5 text-gray-500" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Module Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200 overflow-x-auto">
          {MODULES.map(m => {
            const Icon = m.icon;
            const active = activeModule === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setActiveModule(m.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-[#1A4A28] text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Module Content */}
        {activeModule === 'overview'  && <OverviewTab entities={entities} />}
        {activeModule === 'contratos' && <ContratosTab />}
        {activeModule === 'debt'      && <DebtTab />}
        {activeModule === 'cashflow'  && <CashflowTab />}
        {activeModule === 'payments'  && <PaymentsTab />}
        {activeModule === 'audit'     && <AuditTab />}
        {activeModule === 'rules'     && <RulesTab />}
      </div>
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────────

function OverviewTab({ entities }: { entities: EntityConfig[] }) {
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const counts: Record<string, number> = {};
      const keyEntities = ['contratos', 'debt_instruments', 'payment_batches', 'cashflow_forecast'];
      for (const e of keyEntities) {
        try {
          const r = await queryEntity(e, { limit: 0 });
          counts[e] = r.total;
        } catch {
          counts[e] = 0;
        }
      }
      setStats(counts);
      setLoading(false);
    };
    load();
  }, []);

  const kpis = [
    { label: 'Contratos', value: stats.contratos ?? 0, icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Instrumentos Deuda', value: stats.debt_instruments ?? 0, icon: Landmark, color: 'text-purple-600', bg: 'bg-purple-50' },
    { label: 'Lotes de Pago', value: stats.payment_batches ?? 0, icon: Banknote, color: 'text-green-600', bg: 'bg-green-50' },
    { label: 'Entradas Flujo', value: stats.cashflow_forecast ?? 0, icon: TrendingUp, color: 'text-orange-600', bg: 'bg-orange-50' },
  ];

  const modulesByCategory = [
    { category: 'Tesorería', items: entities.filter(e => ['cash', 'fx', 'recon', 'debt'].includes(e.module)) },
    { category: 'Operaciones', items: entities.filter(e => ['cxp', 'cxc', 'invoicing', 'projects'].includes(e.module)) },
    { category: 'Inventario', items: entities.filter(e => e.module === 'mrp') },
    { category: 'Sistema', items: entities.filter(e => e.module === 'admin') },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {kpis.map(k => {
          const Icon = k.icon;
          return (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">{k.label}</p>
                    <p className="text-2xl font-bold mt-1">
                      {loading ? '...' : k.value.toLocaleString()}
                    </p>
                  </div>
                  <div className={`w-10 h-10 rounded-lg ${k.bg} flex items-center justify-center`}>
                    <Icon className={`w-5 h-5 ${k.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Entity Registry */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Registro de Entidades TMS ({entities.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {modulesByCategory.map(cat => (
            cat.items.length > 0 && (
              <div key={cat.category} className="mb-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-2">{cat.category}</h4>
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {cat.items.map(e => (
                    <div key={e.entity} className="flex items-center gap-2 p-2 bg-gray-50 rounded text-sm">
                      <span className={`w-2 h-2 rounded-full ${e.writable ? 'bg-green-500' : 'bg-gray-400'}`} />
                      <span className="font-medium text-gray-800">{e.entity}</span>
                      {e.approval_required && (
                        <Shield className="w-3 h-3 text-amber-500 ml-auto" title="Requiere aprobación" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Generic CRUD Table ─────────────────────────────────────────────────────

function CRUDTable<T extends Record<string, unknown>>({
  entity,
  columns,
  renderCell,
  createFields,
  title,
  icon: Icon,
}: {
  entity: string;
  columns: { key: string; label: string; width?: string }[];
  renderCell: (row: T, col: string) => React.ReactNode;
  createFields?: { key: string; label: string; type: string; required?: boolean; options?: string[] }[];
  title: string;
  icon: React.ElementType;
}) {
  const [data, setData] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit, offset: page * limit, order: 'created_at.desc' };
      const r = await queryEntity<T>(entity, params);
      setData(r.data);
      setTotal(r.total);
    } catch (err) {
      console.error(err);
      setData([]);
    }
    setLoading(false);
  }, [entity, page]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await createEntity(entity, createData);
      setShowCreate(false);
      setCreateData({});
      load();
    } catch (err: any) {
      alert(err.message);
    }
    setSaving(false);
  };

  const handleApprove = async (id: string, action: 'aprobar' | 'rechazar') => {
    try {
      await approveEntity(entity, id, action);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este registro?')) return;
    try {
      await deleteEntity(entity, id);
      load();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const filtered = search
    ? data.filter(row =>
        columns.some(c => {
          const v = row[c.key];
          return v != null && String(v).toLowerCase().includes(search.toLowerCase());
        })
      )
    : data;

  const totalPages = Math.ceil(total / limit);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Icon className="w-5 h-5" />
            {title}
            <span className="text-sm font-normal text-gray-500">({total})</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-md w-48 focus:outline-none focus:ring-1 focus:ring-[#1A4A28]"
              />
            </div>
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {createFields && (
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4 mr-1" /> Nuevo
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Create Modal */}
        {showCreate && createFields && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
            <h4 className="font-semibold text-sm mb-3">Crear nuevo registro</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {createFields.map(f => (
                <div key={f.key}>
                  <label className="text-xs font-medium text-gray-600">{f.label}</label>
                  {f.options ? (
                    <select
                      value={createData[f.key] || ''}
                      onChange={e => setCreateData(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md"
                    >
                      <option value="">Seleccionar...</option>
                      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={f.type}
                      value={createData[f.key] || ''}
                      onChange={e => setCreateData(p => ({ ...p, [f.key]: e.target.value }))}
                      className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md"
                      required={f.required}
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={handleCreate} disabled={saving}>
                {saving ? 'Guardando...' : 'Crear'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setCreateData({}); }}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                {columns.map(c => (
                  <th key={c.key} className="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase" style={{ width: c.width }}>
                    {c.label}
                  </th>
                ))}
                <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500 uppercase w-24">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columns.length + 1} className="py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={columns.length + 1} className="py-8 text-center text-gray-400">Sin registros</td></tr>
              ) : (
                filtered.map((row, i) => (
                  <tr key={String(row.id) || i} className="border-b border-gray-100 hover:bg-gray-50">
                    {columns.map(c => (
                      <td key={c.key} className="py-2 px-3">{renderCell(row, c.key)}</td>
                    ))}
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {String(row.estado) === 'pendiente_aprobacion' && (
                          <>
                            <button onClick={() => handleApprove(String(row.id), 'aprobar')} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Aprobar">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleApprove(String(row.id), 'rechazar')} className="p-1 text-red-600 hover:bg-red-50 rounded" title="Rechazar">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <button onClick={() => handleDelete(String(row.id))} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Eliminar">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <span className="text-sm text-gray-500">
              {page * limit + 1}–{Math.min((page + 1) * limit, total)} de {total}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Contratos Tab ──────────────────────────────────────────────────────────

function ContratosTab() {
  return (
    <CRUDTable<Contrato>
      entity="contratos"
      title="Contratos de Proyecto"
      icon={FileText}
      columns={[
        { key: 'numero_contrato', label: '# Contrato', width: '120px' },
        { key: 'nombre', label: 'Nombre' },
        { key: 'nombre_cliente', label: 'Cliente' },
        { key: 'empresa', label: 'Empresa', width: '100px' },
        { key: 'monto_contrato', label: 'Monto', width: '120px' },
        { key: 'monto_cobrado', label: 'Cobrado', width: '120px' },
        { key: 'estado', label: 'Estado', width: '120px' },
      ]}
      renderCell={(row, col) => {
        if (col === 'monto_contrato' || col === 'monto_cobrado') return formatCurrency(Number(row[col]) || 0);
        if (col === 'estado') return estadoBadge(row.estado);
        return String(row[col as keyof Contrato] ?? '');
      }}
      createFields={[
        { key: 'numero_contrato', label: 'Número Contrato', type: 'text', required: true },
        { key: 'nombre', label: 'Nombre', type: 'text', required: true },
        { key: 'nombre_cliente', label: 'Cliente', type: 'text' },
        { key: 'empresa', label: 'Empresa', type: 'text', options: ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'] },
        { key: 'monto_contrato', label: 'Monto Contrato', type: 'number' },
        { key: 'moneda', label: 'Moneda', type: 'text', options: ['USD', 'CRC'] },
        { key: 'estado', label: 'Estado', type: 'text', options: ['propuesta', 'negociacion', 'firmado', 'en_ejecucion'] },
        { key: 'fecha_inicio', label: 'Fecha Inicio', type: 'date' },
        { key: 'fecha_fin_estimada', label: 'Fecha Fin Estimada', type: 'date' },
        { key: 'area_comercial', label: 'Área Comercial', type: 'text' },
        { key: 'project_manager', label: 'Project Manager', type: 'text' },
        { key: 'tipo_proyecto', label: 'Tipo Proyecto', type: 'text' },
      ]}
    />
  );
}

// ─── Debt Tab ───────────────────────────────────────────────────────────────

function DebtTab() {
  return (
    <CRUDTable<DebtInstrument>
      entity="debt_instruments"
      title="Instrumentos de Deuda"
      icon={Landmark}
      columns={[
        { key: 'numero_operacion', label: '# Operación', width: '120px' },
        { key: 'nombre', label: 'Nombre' },
        { key: 'tipo', label: 'Tipo', width: '120px' },
        { key: 'banco', label: 'Banco', width: '120px' },
        { key: 'empresa', label: 'Empresa', width: '100px' },
        { key: 'monto_original', label: 'Monto Original', width: '130px' },
        { key: 'saldo_actual', label: 'Saldo Actual', width: '130px' },
        { key: 'tasa_interes', label: 'Tasa %', width: '80px' },
        { key: 'estado', label: 'Estado', width: '100px' },
      ]}
      renderCell={(row, col) => {
        if (col === 'monto_original' || col === 'saldo_actual') return formatCurrency(Number(row[col]) || 0);
        if (col === 'tasa_interes') return `${Number(row[col] || 0).toFixed(2)}%`;
        if (col === 'estado') return estadoBadge(row.estado);
        if (col === 'tipo') return <Badge variant="info">{String(row.tipo).replace(/_/g, ' ')}</Badge>;
        return String(row[col as keyof DebtInstrument] ?? '');
      }}
      createFields={[
        { key: 'numero_operacion', label: '# Operación', type: 'text', required: true },
        { key: 'nombre', label: 'Nombre', type: 'text', required: true },
        { key: 'tipo', label: 'Tipo', type: 'text', options: ['largo_plazo', 'capital_trabajo', 'linea_credito', 'arrendamiento'] },
        { key: 'banco', label: 'Banco', type: 'text', required: true },
        { key: 'empresa', label: 'Empresa', type: 'text', options: ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'] },
        { key: 'moneda', label: 'Moneda', type: 'text', options: ['USD', 'CRC'] },
        { key: 'monto_original', label: 'Monto Original', type: 'number', required: true },
        { key: 'saldo_actual', label: 'Saldo Actual', type: 'number', required: true },
        { key: 'tasa_interes', label: 'Tasa Interés %', type: 'number' },
        { key: 'tasa_tipo', label: 'Tipo Tasa', type: 'text', options: ['fija', 'variable', 'mixta'] },
        { key: 'fecha_desembolso', label: 'Fecha Desembolso', type: 'date' },
        { key: 'fecha_vencimiento', label: 'Fecha Vencimiento', type: 'date', required: true },
        { key: 'frecuencia_pago', label: 'Frecuencia Pago', type: 'text', options: ['mensual', 'trimestral', 'semestral', 'anual'] },
      ]}
    />
  );
}

// ─── Cashflow Tab ───────────────────────────────────────────────────────────

function CashflowTab() {
  return (
    <CRUDTable<CashflowForecastEntry>
      entity="cashflow_forecast"
      title="Pronóstico de Flujo de Caja"
      icon={TrendingUp}
      columns={[
        { key: 'empresa', label: 'Empresa', width: '120px' },
        { key: 'semana_inicio', label: 'Semana', width: '120px' },
        { key: 'status', label: 'Estado', width: '100px' },
        { key: 'ingresos', label: 'Ingresos', width: '130px' },
        { key: 'egresos', label: 'Egresos', width: '130px' },
        { key: 'flujo_neto', label: 'Flujo Neto', width: '130px' },
        { key: 'saldo_acumulado', label: 'Saldo Acum.', width: '130px' },
        { key: 'categoria', label: 'Categoría' },
      ]}
      renderCell={(row, col) => {
        if (['ingresos', 'egresos', 'flujo_neto', 'saldo_acumulado'].includes(col))
          return formatCurrency(Number(row[col as keyof CashflowForecastEntry]) || 0);
        if (col === 'status') return estadoBadge(row.status);
        if (col === 'semana_inicio') return formatDate(String(row.semana_inicio));
        return String(row[col as keyof CashflowForecastEntry] ?? '');
      }}
      createFields={[
        { key: 'empresa', label: 'Empresa', type: 'text', options: ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'], required: true },
        { key: 'semana_inicio', label: 'Semana Inicio', type: 'date', required: true },
        { key: 'semana_fin', label: 'Semana Fin', type: 'date' },
        { key: 'status', label: 'Estado', type: 'text', options: ['ejecutado', 'proyectado'] },
        { key: 'ingresos', label: 'Ingresos', type: 'number' },
        { key: 'egresos', label: 'Egresos', type: 'number' },
        { key: 'saldo_acumulado', label: 'Saldo Acumulado', type: 'number' },
        { key: 'categoria', label: 'Categoría', type: 'text' },
        { key: 'subcategoria', label: 'Subcategoría', type: 'text' },
        { key: 'detalle', label: 'Detalle', type: 'text' },
      ]}
    />
  );
}

// ─── Payments Tab ───────────────────────────────────────────────────────────

function PaymentsTab() {
  return (
    <CRUDTable<PaymentBatch>
      entity="payment_batches"
      title="Lotes de Pago"
      icon={Banknote}
      columns={[
        { key: 'nombre', label: 'Nombre' },
        { key: 'fecha_pago', label: 'Fecha Pago', width: '120px' },
        { key: 'empresa', label: 'Empresa', width: '120px' },
        { key: 'total_items', label: 'Items', width: '80px' },
        { key: 'total_monto', label: 'Monto Total', width: '130px' },
        { key: 'estado', label: 'Estado', width: '140px' },
        { key: 'aprobado_por', label: 'Aprobado por' },
      ]}
      renderCell={(row, col) => {
        if (col === 'total_monto') return formatCurrency(Number(row.total_monto) || 0);
        if (col === 'fecha_pago') return formatDate(String(row.fecha_pago));
        if (col === 'estado') return estadoBadge(row.estado);
        return String(row[col as keyof PaymentBatch] ?? '');
      }}
      createFields={[
        { key: 'nombre', label: 'Nombre del Lote', type: 'text', required: true },
        { key: 'descripcion', label: 'Descripción', type: 'text' },
        { key: 'fecha_pago', label: 'Fecha de Pago', type: 'date', required: true },
        { key: 'empresa', label: 'Empresa', type: 'text', options: ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'], required: true },
        { key: 'moneda', label: 'Moneda', type: 'text', options: ['USD', 'CRC'] },
      ]}
    />
  );
}

// ─── Audit Tab ──────────────────────────────────────────────────────────────

function AuditTab() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const limit = 30;

  useEffect(() => {
    setLoading(true);
    fetchAuditLog({ limit, offset: page * limit })
      .then(r => { setEntries(r.data || []); setTotal(r.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  const actionColor: Record<string, string> = {
    CREATE: 'text-green-700 bg-green-50',
    UPDATE: 'text-blue-700 bg-blue-50',
    DELETE: 'text-red-700 bg-red-50',
    APPROVE: 'text-emerald-700 bg-emerald-50',
    REJECT: 'text-red-700 bg-red-50',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5" />
          Log de Auditoría
          <span className="text-sm font-normal text-gray-500">({total} registros)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Timestamp</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Acción</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Entidad</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">ID</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Usuario</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Módulo</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="py-8 text-center text-gray-400">Cargando...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-gray-400">Sin registros de auditoría</td></tr>
              ) : (
                entries.map(e => (
                  <tr key={e.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 text-gray-500">{formatDate(e.timestamp)}</td>
                    <td className="py-2 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColor[e.action] || 'text-gray-700 bg-gray-100'}`}>
                        {e.action}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-medium">{e.entity_type}</td>
                    <td className="py-2 px-3 font-mono text-xs text-gray-500">{e.entity_id?.slice(0, 8)}...</td>
                    <td className="py-2 px-3">{e.user_name || e.user_id}</td>
                    <td className="py-2 px-3"><Badge variant="default">{e.modulo}</Badge></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {total > limit && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <span className="text-sm text-gray-500">{page * limit + 1}–{Math.min((page + 1) * limit, total)} de {total}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" disabled={(page + 1) * limit >= total} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Rules Tab ──────────────────────────────────────────────────────────────

function RulesTab() {
  const [rules, setRules] = useState<BusinessRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBusinessRules()
      .then(r => setRules(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5" />
          Reglas de Negocio
          <span className="text-sm font-normal text-gray-500">({rules.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-8 text-center text-gray-400">Cargando...</p>
        ) : (
          <div className="space-y-3">
            {rules.map(rule => (
              <div key={rule.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#1A4A28] bg-green-100 px-2 py-0.5 rounded">{rule.rule_id}</span>
                    <span className="font-semibold text-sm">{rule.nombre}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="info">{rule.modulo}</Badge>
                    <Badge variant={rule.es_activo ? 'success' : 'default'}>{rule.es_activo ? 'Activa' : 'Inactiva'}</Badge>
                  </div>
                </div>
                <p className="text-sm text-gray-600">{rule.descripcion}</p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="font-medium text-gray-500">Condición: </span>
                    <code className="bg-white px-1 py-0.5 rounded">{JSON.stringify(rule.condicion)}</code>
                  </div>
                  <div>
                    <span className="font-medium text-gray-500">Acción: </span>
                    <code className="bg-white px-1 py-0.5 rounded">{JSON.stringify(rule.accion)}</code>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
