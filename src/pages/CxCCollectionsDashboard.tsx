import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, ARA_COLORS } from '../lib/utils';
import {
  fetchCxCDashboard, fetchCollectionWorklist,
  type CxCDashboardData, type WorklistItem,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import {
  Receipt, Users, Clock, Target,
  RefreshCw, AlertTriangle, BarChart3,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };
const AGING_COLORS = ['#4CAF50', '#8BC34A', '#FFCA28', '#FF9800', '#F44336', '#D32F2F', '#B71C1C'];
const PIE_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.red, ARA_COLORS.orange, '#8B5CF6', ARA_COLORS.gray];

export function CxCCollectionsDashboard() {
  const [dashboard, setDashboard] = useState<CxCDashboardData | null>(null);
  const [worklist, setWorklist] = useState<WorklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [empresaFilter, setEmpresaFilter] = useState('');
  const [gestorFilter, setGestorFilter] = useState('');
  const [areaFilter, setAreaFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'worklist' | 'aging'>('overview');

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, wlRes] = await Promise.all([
        fetchCxCDashboard(empresaFilter || undefined),
        fetchCollectionWorklist(gestorFilter || undefined, areaFilter || undefined, 50),
      ]);
      setDashboard(dashRes);
      setWorklist(wlRes.worklist || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [empresaFilter, gestorFilter, areaFilter]);

  const kpis = dashboard?.kpis;
  const gestores = dashboard?.by_gestor?.map(g => g.gestor) || [];
  const areas = dashboard?.by_area?.map(a => a.area) || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Receipt className="w-7 h-7 text-[#1A4A28]" />
              M3: Cobranza / CxC
            </h1>
            <p className="text-sm text-gray-500 mt-1">AR Ledger · Aging · DSO · Worklist por gestor</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <select value={empresaFilter} onChange={e => setEmpresaFilter(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 bg-white">
              <option value="">Todas las BU</option>
              {['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'].map(e => <option key={e} value={e}>{e}</option>)}
            </select>
            {gestores.length > 0 && (
              <select value={gestorFilter} onChange={e => setGestorFilter(e.target.value)}
                className="text-sm border rounded-lg px-3 py-1.5 bg-white">
                <option value="">Todos los gestores</option>
                {gestores.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            )}
            {areas.length > 0 && (
              <select value={areaFilter} onChange={e => setAreaFilter(e.target.value)}
                className="text-sm border rounded-lg px-3 py-1.5 bg-white">
                <option value="">Todas las áreas</option>
                {areas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            )}
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'overview' as const, label: 'Resumen', icon: BarChart3 },
            { id: 'worklist' as const, label: 'Worklist de Cobro', icon: Target },
            { id: 'aging' as const, label: 'Aging Detallado', icon: Clock },
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
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {[
                { label: 'Total Pendiente', value: kpis?.total_pendiente ?? 0, color: 'text-red-600', bg: 'bg-red-50' },
                { label: 'Total Cobrado', value: kpis?.total_cobrado ?? 0, color: 'text-green-600', bg: 'bg-green-50' },
                { label: 'Items', value: kpis?.total_items ?? 0, fmt: 'num', color: 'text-blue-600', bg: 'bg-blue-50' },
                { label: 'DSO', value: kpis?.dso ?? 0, fmt: 'days', color: (kpis?.dso ?? 0) > 45 ? 'text-red-600' : 'text-green-600', bg: (kpis?.dso ?? 0) > 45 ? 'bg-red-50' : 'bg-green-50' },
                { label: 'Tasa Cobro', value: kpis?.collection_rate ?? 0, fmt: 'pct', color: (kpis?.collection_rate ?? 0) > 70 ? 'text-green-600' : 'text-amber-600', bg: (kpis?.collection_rate ?? 0) > 70 ? 'bg-green-50' : 'bg-amber-50' },
              ].map(k => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase">{k.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${k.color}`}>
                      {loading ? '...' : k.fmt === 'num' ? String(k.value) : k.fmt === 'days' ? `${k.value} días` : k.fmt === 'pct' ? `${k.value}%` : formatCompactCurrency(k.value)}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Aging Chart */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" />Aging de Cartera</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.aging.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={dashboard.aging}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="monto" name="Monto">
                          {dashboard.aging.map((_, i) => <Cell key={i} fill={AGING_COLORS[i] || ARA_COLORS.gray} />)}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos de aging</p>}
                </CardContent>
              </Card>

              {/* By Area */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Por Área Comercial</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.by_area.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={dashboard.by_area} dataKey="pendiente" nameKey="area" cx="50%" cy="50%" outerRadius={95} innerRadius={55}
                          label={({ name, percent }) => `${String(name).slice(0, 12)} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                          {dashboard.by_area.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Gestor Performance */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4" />Rendimiento por Gestor</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Gestor</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Pendiente</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Items</th>
                          <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Mora Prom.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.by_gestor.map(g => (
                          <tr key={g.gestor} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-2 px-3 font-medium">{g.gestor}</td>
                            <td className="py-2 px-3 text-right font-semibold">{formatCompactCurrency(g.pendiente)}</td>
                            <td className="py-2 px-3 text-right">{g.count}</td>
                            <td className="py-2 px-3 text-right">
                              <span className={g.dias_mora_avg > 60 ? 'text-red-600 font-bold' : g.dias_mora_avg > 30 ? 'text-amber-600' : 'text-green-600'}>
                                {g.dias_mora_avg} días
                              </span>
                            </td>
                          </tr>
                        ))}
                        {dashboard.by_gestor.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-gray-400">Sin datos</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Top Clientes */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Top 10 Clientes por Monto</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dashboard.top_clientes.map((c, i) => (
                      <div key={c.cliente} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-gray-200 text-xs flex items-center justify-center font-bold">{i + 1}</span>
                          <span className="text-sm truncate max-w-[200px]">{c.cliente}</span>
                        </div>
                        <span className="font-mono text-sm font-semibold">{formatCompactCurrency(c.monto)}</span>
                      </div>
                    ))}
                    {dashboard.top_clientes.length === 0 && <p className="py-4 text-center text-gray-400">Sin datos</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Worklist Tab */}
        {activeTab === 'worklist' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Worklist de Cobro — Priorizado por (Monto × Días Mora)
                <span className="text-sm font-normal text-gray-500">({worklist.length} items)</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {['#', 'Cliente', 'Factura', 'Monto', 'Moneda', 'Días Mora', 'Área', 'Gestor', 'Estado', 'Score'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {worklist.length === 0 ? (
                      <tr><td colSpan={10} className="py-8 text-center text-gray-400">Sin items en la cola de cobro</td></tr>
                    ) : worklist.map((item, i) => (
                      <tr key={`${item.factura}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 text-gray-400">{i + 1}</td>
                        <td className="py-2 px-3 font-medium max-w-[180px] truncate">{item.cliente}</td>
                        <td className="py-2 px-3 font-mono text-xs">{item.factura}</td>
                        <td className="py-2 px-3 font-semibold">{formatCurrency(item.monto || 0)}</td>
                        <td className="py-2 px-3"><Badge variant="info">{item.moneda}</Badge></td>
                        <td className="py-2 px-3">
                          <span className={item.dias_mora > 90 ? 'text-red-600 font-bold' : item.dias_mora > 30 ? 'text-amber-600' : 'text-green-600'}>
                            {item.dias_mora} días
                          </span>
                        </td>
                        <td className="py-2 px-3 text-gray-500 text-xs">{item.area_comercial}</td>
                        <td className="py-2 px-3 text-xs">{item.gestor_cobro}</td>
                        <td className="py-2 px-3"><Badge variant={item.estado === 'Vencida' ? 'error' : 'warning'}>{item.estado}</Badge></td>
                        <td className="py-2 px-3 font-mono text-xs text-gray-500">{formatCompactCurrency(item.priority_score)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Aging Detail Tab */}
        {activeTab === 'aging' && dashboard && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Aging Detallado por Bucket</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                  {dashboard.aging.map((bucket, i) => (
                    <div key={bucket.bucket} className="p-4 rounded-lg border-2" style={{ borderColor: AGING_COLORS[i] || '#ccc' }}>
                      <p className="text-xs font-semibold text-gray-500 uppercase">{bucket.bucket}</p>
                      <p className="text-xl font-bold mt-1">{formatCompactCurrency(bucket.monto)}</p>
                      <p className="text-xs text-gray-500">{bucket.count} items</p>
                      <div className="mt-2 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                        <div className="h-full rounded-full" style={{
                          width: `${dashboard.kpis.total_pendiente > 0 ? Math.min(100, (bucket.monto / dashboard.kpis.total_pendiente) * 100) : 0}%`,
                          backgroundColor: AGING_COLORS[i],
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Status breakdown */}
            <Card>
              <CardHeader><CardTitle className="text-base">Por Estado</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {dashboard.by_estado.map(e => (
                    <div key={e.estado} className="px-4 py-3 bg-gray-50 rounded-lg border">
                      <Badge variant={e.estado === 'Pagada' || e.estado === 'cobrado' ? 'success' : e.estado === 'Vencida' ? 'error' : 'warning'}>{e.estado}</Badge>
                      <p className="text-lg font-bold mt-1">{e.count}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
