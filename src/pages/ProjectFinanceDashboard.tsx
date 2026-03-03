import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchProjectFinanceDashboard, fetchBudgetVsActual,
  type ProjectFinanceDashboardData, type BudgetVsActualItem,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, PieChart, Pie, Cell, Line,
} from 'recharts';
import {
  FolderKanban, Building2, Target, AlertTriangle, CalendarDays,
  RefreshCw, BarChart3, TrendingUp, FileImage,
} from 'lucide-react';
import { ContractPdfViewer } from '../components/ContractPdfViewer';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };
const PIE_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.red, ARA_COLORS.orange, '#8B5CF6', ARA_COLORS.gray];

export function ProjectFinanceDashboard() {
  const [dashboard, setDashboard] = useState<ProjectFinanceDashboardData | null>(null);
  const [budgetData, setBudgetData] = useState<BudgetVsActualItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [empresaFilter, setEmpresaFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'budget' | 'alerts' | 'documentos'>('overview');
  const [pdfViewDocId, setPdfViewDocId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, budgetRes] = await Promise.all([
        fetchProjectFinanceDashboard(empresaFilter || undefined),
        fetchBudgetVsActual(),
      ]);
      setDashboard(dashRes);
      setBudgetData(budgetRes.contracts || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [empresaFilter]);

  const kpis = dashboard?.kpis;
  const empresas = ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'];

  const severityBadge = (s: string) => {
    const map: Record<string, 'error' | 'warning' | 'info'> = { critical: 'error', warning: 'warning', info: 'info' };
    return <Badge variant={map[s] || 'default'}>{s === 'critical' ? '≤7d' : s === 'warning' ? '≤14d' : '≤30d'}</Badge>;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <FolderKanban className="w-7 h-7 text-[#1A4A28]" />
              M5: Project Finance
            </h1>
            <p className="text-sm text-gray-500 mt-1">Portfolio · Lifecycle · P&L por área · Alertas de hitos</p>
          </div>
          <div className="flex items-center gap-3">
            <select value={empresaFilter} onChange={e => setEmpresaFilter(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 bg-white">
              <option value="">Todas las BU</option>
              {empresas.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'overview' as const, label: 'Resumen', icon: BarChart3 },
            { id: 'budget' as const, label: 'Budget vs Actual', icon: TrendingUp },
            { id: 'alerts' as const, label: 'Alertas Hitos', icon: AlertTriangle },
            { id: 'documentos' as const, label: 'Documentos PDF', icon: FileImage },
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

        {/* Overview Tab */}
        {activeTab === 'overview' && dashboard && (
          <div className="space-y-6">
            {/* KPIs Row 1 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Contratado', value: kpis?.total_contratado ?? 0, color: 'text-blue-600' },
                { label: 'Total Facturado', value: kpis?.total_facturado ?? 0, color: 'text-purple-600' },
                { label: 'Total Cobrado', value: kpis?.total_cobrado ?? 0, color: 'text-green-600' },
                { label: 'Saldo Pendiente', value: kpis?.total_saldo ?? 0, color: 'text-amber-600' },
              ].map(k => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase">{k.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${k.color}`}>{loading ? '...' : formatCompactCurrency(k.value)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* KPIs Row 2 */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: 'Contratos Activos', value: `${kpis?.contratos_activos ?? 0} / ${kpis?.contratos_total ?? 0}` },
                { label: 'Facturación %', value: `${kpis?.facturacion_ratio ?? 0}%` },
                { label: 'Cobranza %', value: `${kpis?.cobranza_ratio ?? 0}%` },
                { label: 'Hitos Pendientes', value: `${kpis?.hitos_pendientes ?? 0}` },
                { label: 'Alertas', value: `${kpis?.milestone_alerts_count ?? 0}`, color: (kpis?.milestone_alerts_count ?? 0) > 0 ? 'text-red-600' : 'text-green-600' },
              ].map(k => (
                <Card key={k.label}>
                  <CardContent className="p-3">
                    <p className="text-[10px] text-gray-500 uppercase">{k.label}</p>
                    <p className={`text-lg font-bold mt-0.5 ${k.color || 'text-gray-900'}`}>{loading ? '...' : k.value}</p>
                  </CardContent>
                </Card>
              ))}
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

              {/* Lifecycle Pipeline */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" />Pipeline de Contratos</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.lifecycle.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={dashboard.lifecycle} dataKey="count" nameKey="estado" cx="50%" cy="50%" outerRadius={95} innerRadius={55}
                          label={({ name, value }) => `${String(name).replace(/_/g, ' ')} (${value})`} labelLine={false} fontSize={10}>
                          {dashboard.lifecycle.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By Area */}
              <Card>
                <CardHeader><CardTitle className="text-base">P&L por Área Comercial</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          {['Área', 'Contratado', 'Facturado', 'Cobrado', 'Contratos', 'Margen %'].map(h => (
                            <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.by_area.map(a => (
                          <tr key={a.area} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-2 px-3 font-medium">{a.area}</td>
                            <td className="py-2 px-3">{formatCompactCurrency(a.contratado)}</td>
                            <td className="py-2 px-3 text-purple-700">{formatCompactCurrency(a.facturado)}</td>
                            <td className="py-2 px-3 text-green-700">{formatCompactCurrency(a.cobrado)}</td>
                            <td className="py-2 px-3 text-center">{a.count}</td>
                            <td className="py-2 px-3">
                              <span className={a.margin_pct > 60 ? 'text-green-600 font-bold' : a.margin_pct > 30 ? 'text-amber-600' : 'text-red-600'}>
                                {a.margin_pct}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Collection Forecast */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4" />Pronóstico de Cobro (12 semanas)</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.collection_forecast.some(w => w.monto > 0) ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <ComposedChart data={dashboard.collection_forecast}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={v => `S${v}`} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="monto" name="Monto Esperado" fill={ARA_COLORS.primary} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                        <Line dataKey="hitos" name="# Hitos" stroke={ARA_COLORS.gold} strokeWidth={2} yAxisId={0} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin hitos pendientes para proyectar</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Budget vs Actual Tab */}
        {activeTab === 'budget' && (
          <Card>
            <CardHeader><CardTitle className="text-base">Budget vs Actual — Contratos Activos ({budgetData.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {['Contrato', 'Nombre', 'Empresa', 'Contratado', 'Facturado', 'Cobrado', 'Pend.', 'Fact.%', 'Cobro%'].map(h => (
                        <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {budgetData.length === 0 ? (
                      <tr><td colSpan={9} className="py-8 text-center text-gray-400">Sin contratos activos</td></tr>
                    ) : budgetData.map(c => (
                      <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-2 font-mono text-xs">{c.numero_contrato}</td>
                        <td className="py-2 px-2 font-medium max-w-[180px] truncate">{c.nombre}</td>
                        <td className="py-2 px-2">{c.empresa}</td>
                        <td className="py-2 px-2">{formatCompactCurrency(c.contratado)}</td>
                        <td className="py-2 px-2 text-purple-700">{formatCompactCurrency(c.facturado)}</td>
                        <td className="py-2 px-2 text-green-700">{formatCompactCurrency(c.cobrado)}</td>
                        <td className="py-2 px-2 text-amber-700">{formatCompactCurrency(c.pendiente)}</td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-purple-600 rounded-full" style={{ width: `${Math.min(100, c.facturacion_pct)}%` }} />
                            </div>
                            <span className="text-xs">{c.facturacion_pct}%</span>
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1">
                            <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div className="h-full bg-green-600 rounded-full" style={{ width: `${Math.min(100, c.cobranza_pct)}%` }} />
                            </div>
                            <span className="text-xs">{c.cobranza_pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && dashboard && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Alertas de Hitos ({dashboard.milestone_alerts.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.milestone_alerts.length > 0 ? (
                <div className="space-y-3">
                  {dashboard.milestone_alerts.map((a, i) => (
                    <div key={a.hito_id || i}
                      className={`flex items-center justify-between p-3 rounded-lg border-l-4 ${
                        a.severity === 'critical' ? 'border-l-red-500 bg-red-50' :
                        a.severity === 'warning' ? 'border-l-amber-500 bg-amber-50' : 'border-l-blue-500 bg-blue-50'
                      }`}>
                      <div>
                        <span className="font-semibold text-sm">{a.nombre || 'Hito sin nombre'}</span>
                        <span className="text-xs text-gray-500 ml-2">Contrato: {(a.contrato_id || '').slice(0, 8)}...</span>
                        <span className="text-xs text-gray-500 ml-2">{a.fecha_programada ? formatDate(a.fecha_programada) : ''}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold">{formatCurrency(a.monto)}</span>
                        {severityBadge(a.severity)}
                        <Badge variant={a.severity === 'critical' ? 'error' : 'warning'}>{a.days_until}d</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="py-8 text-center text-gray-400">Sin alertas de hitos próximos</p>}
            </CardContent>
          </Card>
        )}

        {/* Documentos PDF Tab */}
        {activeTab === 'documentos' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileImage className="w-4 h-4 text-[#1A4A28]" />
                Documentos de Contratos por Proyecto (CEM0.IM00)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ContractPdfViewer inline />
            </CardContent>
          </Card>
        )}

        {/* PDF Viewer Modal (triggered from Budget vs Actual row) */}
        {pdfViewDocId != null && (
          <ContractPdfViewer docId={pdfViewDocId} onClose={() => setPdfViewDocId(null)} />
        )}
      </div>
    </div>
  );
}
