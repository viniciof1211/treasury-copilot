import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchInvoicingDashboard, fetchContractDetail,
  queryEntity, createEntity,
  type InvoicingDashboardData, type Contrato,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import {
  FileText, Building2, Target, Calendar, AlertTriangle,
  RefreshCw, Plus, Eye,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };
const PIE_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.red, ARA_COLORS.orange, '#8B5CF6', ARA_COLORS.gray];

export function InvoicingModuleDashboard() {
  const [dashboard, setDashboard] = useState<InvoicingDashboardData | null>(null);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'contratos' | 'hitos'>('overview');
  const [selectedContract, setSelectedContract] = useState<string | null>(null);
  const [contractDetail, setContractDetail] = useState<{ contrato: Record<string, unknown>; hitos: Record<string, unknown>[] } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, contRes] = await Promise.all([
        fetchInvoicingDashboard(),
        queryEntity<Contrato>('contratos', { limit: 50, order: 'created_at.desc' }),
      ]);
      setDashboard(dashRes);
      setContratos(contRes.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadContractDetail = async (id: string) => {
    setSelectedContract(id);
    try {
      const detail = await fetchContractDetail(id);
      setContractDetail(detail);
    } catch (e) { console.error(e); }
  };

  const handleCreate = async () => {
    try {
      await createEntity('contratos', {
        ...createData,
        monto_contrato: parseFloat(createData.monto_contrato || '0'),
        monto_facturado: 0, monto_cobrado: 0,
        estado: createData.estado || 'propuesta',
        moneda: createData.moneda || 'USD',
      });
      setShowCreate(false);
      setCreateData({});
      load();
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
  };

  const kpis = dashboard?.kpis;

  const estadoBadge = (estado: string) => {
    const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
      en_ejecucion: 'success', firmado: 'success', cobrado: 'success', facturado: 'info',
      propuesta: 'info', negociacion: 'warning', pendiente: 'warning',
      cerrado: 'default', cancelado: 'error',
    };
    return <Badge variant={map[estado] || 'default'}>{estado.replace(/_/g, ' ')}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FileText className="w-7 h-7 text-[#1A4A28]" />
              M6: Facturación & Contratos
            </h1>
            <p className="text-sm text-gray-500 mt-1">Contratos · Hitos · Revenue Recognition · Pipeline</p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" /> Nuevo Contrato
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'overview' as const, label: 'Resumen', icon: Target },
            { id: 'contratos' as const, label: 'Contratos', icon: FileText },
            { id: 'hitos' as const, label: 'Hitos Próximos', icon: Calendar },
          ]).map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium ${activeTab === t.id ? 'bg-[#1A4A28] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>

        {/* Create Modal */}
        {showCreate && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-3">Nuevo Contrato</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { key: 'numero_contrato', label: '# Contrato', type: 'text' },
                  { key: 'nombre', label: 'Nombre', type: 'text' },
                  { key: 'nombre_cliente', label: 'Cliente', type: 'text' },
                  { key: 'empresa', label: 'Empresa', type: 'select', opts: ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'] },
                  { key: 'monto_contrato', label: 'Monto Contrato', type: 'number' },
                  { key: 'moneda', label: 'Moneda', type: 'select', opts: ['USD', 'CRC'] },
                  { key: 'estado', label: 'Estado', type: 'select', opts: ['propuesta', 'negociacion', 'firmado', 'en_ejecucion'] },
                  { key: 'area_comercial', label: 'Área Comercial', type: 'text' },
                  { key: 'project_manager', label: 'Project Manager', type: 'text' },
                  { key: 'fecha_inicio', label: 'Fecha Inicio', type: 'date' },
                  { key: 'fecha_fin_estimada', label: 'Fecha Fin', type: 'date' },
                  { key: 'tipo_proyecto', label: 'Tipo Proyecto', type: 'text' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="text-xs font-medium text-gray-600">{f.label}</label>
                    {f.opts ? (
                      <select value={createData[f.key] || ''} onChange={e => setCreateData(p => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md">
                        <option value="">Seleccionar...</option>
                        {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input type={f.type} value={createData[f.key] || ''} onChange={e => setCreateData(p => ({ ...p, [f.key]: e.target.value }))}
                        className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md" />
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={handleCreate}>Crear</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setCreateData({}); }}>Cancelar</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && dashboard && (
          <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Contratado', value: kpis?.total_contratado ?? 0, color: 'text-blue-600' },
                { label: 'Total Facturado', value: kpis?.total_facturado ?? 0, color: 'text-purple-600' },
                { label: 'Total Cobrado', value: kpis?.total_cobrado ?? 0, color: 'text-green-600' },
                { label: 'Pendiente Facturar', value: kpis?.total_pendiente ?? 0, color: 'text-amber-600' },
              ].map(k => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase">{k.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${k.color}`}>
                      {loading ? '...' : formatCompactCurrency(k.value)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Ratios */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Tasa Facturación</p>
                  <p className="text-2xl font-bold text-purple-600">{kpis?.facturacion_ratio ?? 0}%</p>
                  <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-600 rounded-full" style={{ width: `${kpis?.facturacion_ratio ?? 0}%` }} />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Tasa Cobranza</p>
                  <p className="text-2xl font-bold text-green-600">{kpis?.cobranza_ratio ?? 0}%</p>
                  <div className="mt-2 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-green-600 rounded-full" style={{ width: `${kpis?.cobranza_ratio ?? 0}%` }} />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Contratos Activos</p>
                  <p className="text-2xl font-bold text-blue-600">{kpis?.contratos_activos ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Hitos Pendientes</p>
                  <p className="text-2xl font-bold text-amber-600">{kpis?.hitos_pendientes ?? 0}</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By Empresa */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Por Empresa</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.by_empresa.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={dashboard.by_empresa}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="empresa" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="contratado" name="Contratado" fill={ARA_COLORS.blue} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                        <Bar dataKey="facturado" name="Facturado" fill={ARA_COLORS.primary} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                        <Bar dataKey="cobrado" name="Cobrado" fill={ARA_COLORS.gold} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
                </CardContent>
              </Card>

              {/* Contratos by Estado */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" />Pipeline de Contratos</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.contratos_by_estado.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={dashboard.contratos_by_estado} dataKey="count" nameKey="estado" cx="50%" cy="50%" outerRadius={95} innerRadius={55}
                          label={({ name, value }) => `${String(name).replace(/_/g, ' ')} (${value})`} labelLine={false} fontSize={10}>
                          {dashboard.contratos_by_estado.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Contratos Tab */}
        {activeTab === 'contratos' && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Contratos ({contratos.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['# Contrato', 'Nombre', 'Cliente', 'Empresa', 'Monto', 'Facturado', 'Cobrado', 'Estado', ''].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {contratos.length === 0 ? (
                        <tr><td colSpan={9} className="py-8 text-center text-gray-400">Sin contratos</td></tr>
                      ) : contratos.map(c => (
                        <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-mono text-xs">{c.numero_contrato}</td>
                          <td className="py-2 px-3 font-medium max-w-[200px] truncate">{c.nombre}</td>
                          <td className="py-2 px-3 text-gray-500">{c.nombre_cliente}</td>
                          <td className="py-2 px-3">{c.empresa}</td>
                          <td className="py-2 px-3 font-semibold">{formatCurrency(c.monto_contrato || 0)}</td>
                          <td className="py-2 px-3 text-purple-700">{formatCurrency(c.monto_facturado || 0)}</td>
                          <td className="py-2 px-3 text-green-700">{formatCurrency(c.monto_cobrado || 0)}</td>
                          <td className="py-2 px-3">{estadoBadge(c.estado)}</td>
                          <td className="py-2 px-3">
                            <button onClick={() => loadContractDetail(c.id)} className="p-1 text-gray-400 hover:text-[#1A4A28] hover:bg-green-50 rounded">
                              <Eye className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Contract Detail Drawer */}
            {selectedContract && contractDetail && (
              <Card className="border-2 border-[#1A4A28]">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">
                      Detalle: {String(contractDetail.contrato.nombre || '')} — {String(contractDetail.contrato.numero_contrato || '')}
                    </CardTitle>
                    <button onClick={() => { setSelectedContract(null); setContractDetail(null); }} className="text-gray-400 hover:text-gray-600 text-sm">Cerrar ✕</button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <p className="text-xs text-gray-500">Monto Contrato</p>
                      <p className="font-bold">{formatCurrency(Number(contractDetail.contrato.monto_contrato) || 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Facturado</p>
                      <p className="font-bold text-purple-700">{formatCurrency(Number(contractDetail.contrato.monto_facturado) || 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Cobrado</p>
                      <p className="font-bold text-green-700">{formatCurrency(Number(contractDetail.contrato.monto_cobrado) || 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Saldo</p>
                      <p className="font-bold text-amber-700">{formatCurrency(Number(contractDetail.contrato.saldo) || 0)}</p>
                    </div>
                  </div>
                  <h4 className="text-sm font-semibold mb-2">Hitos ({contractDetail.hitos.length})</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          {['#', 'Nombre', 'Monto', 'Facturado', 'Cobrado', 'Fecha Prog.', 'Estado'].map(h => (
                            <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {contractDetail.hitos.map((h, i) => (
                          <tr key={String(h.id) || i} className="border-b border-gray-100">
                            <td className="py-1.5 px-2">{String(h.numero_hito)}</td>
                            <td className="py-1.5 px-2 font-medium">{String(h.nombre || '')}</td>
                            <td className="py-1.5 px-2">{formatCurrency(Number(h.monto) || 0)}</td>
                            <td className="py-1.5 px-2 text-purple-700">{formatCurrency(Number(h.monto_facturado) || 0)}</td>
                            <td className="py-1.5 px-2 text-green-700">{formatCurrency(Number(h.monto_cobrado) || 0)}</td>
                            <td className="py-1.5 px-2 text-gray-500">{h.fecha_programada ? formatDate(String(h.fecha_programada)) : '—'}</td>
                            <td className="py-1.5 px-2">{estadoBadge(String(h.estado || 'pendiente'))}</td>
                          </tr>
                        ))}
                        {contractDetail.hitos.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-gray-400">Sin hitos</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Upcoming Hitos Tab */}
        {activeTab === 'hitos' && dashboard && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Hitos Próximos (30 días)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.upcoming_hitos.length > 0 ? (
                <div className="space-y-3">
                  {dashboard.upcoming_hitos.map((h, i) => (
                    <div key={String(h.id) || i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div>
                        <span className="font-semibold text-sm">{String(h.nombre || 'Hito')}</span>
                        <span className="text-xs text-gray-500 ml-2">Contrato: {String(h.contrato_id || '').slice(0, 8)}...</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-mono font-bold">{formatCurrency(Number(h.monto) || 0)}</span>
                        <span className="text-xs text-gray-500">{h.fecha_programada ? formatDate(String(h.fecha_programada)) : '—'}</span>
                        <Badge variant={Number(h.days_until) <= 7 ? 'error' : 'warning'}>
                          {Number(h.days_until)} días
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-gray-400">No hay hitos próximos en los siguientes 30 días</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
