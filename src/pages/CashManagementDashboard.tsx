import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchCashPosition, fetchCashForecast, fetchLiquidityGap,
  queryEntity, createEntity,
  type CashPosition, type ForecastWeek, type LiquidityBucket,
  type CashflowForecastEntry,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, ReferenceLine,
} from 'recharts';
import {
  Building2, Wallet, Target,
  RefreshCw, Plus, ArrowUpRight, ArrowDownRight,
  BarChart3, Activity, Layers,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };

export function CashManagementDashboard() {
  const [positions, setPositions] = useState<CashPosition[]>([]);
  const [consolidated, setConsolidated] = useState<CashPosition | null>(null);
  const [forecast, setForecast] = useState<ForecastWeek[]>([]);
  const [liquidityGap, setLiquidityGap] = useState<LiquidityBucket[]>([]);
  const [recentEntries, setRecentEntries] = useState<CashflowForecastEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [empresaFilter, setEmpresaFilter] = useState<string>('');
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [posRes, fcRes, lgRes, recRes] = await Promise.all([
        fetchCashPosition(empresaFilter || undefined),
        fetchCashForecast(12, empresaFilter || undefined),
        fetchLiquidityGap(),
        queryEntity<CashflowForecastEntry>('cashflow_forecast', { limit: 20, order: 'semana_inicio.desc' }),
      ]);
      setPositions(posRes.positions || []);
      setConsolidated(posRes.consolidated || null);
      setForecast(fcRes.forecast || []);
      setLiquidityGap(lgRes.buckets || []);
      setRecentEntries(recRes.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [empresaFilter]);

  const handleCreate = async () => {
    try {
      const ing = parseFloat(createData.ingresos || '0');
      const egr = parseFloat(createData.egresos || '0');
      await createEntity('cashflow_forecast', {
        ...createData,
        ingresos: ing, egresos: egr,
        flujo_neto: ing - egr,
        status: createData.status || 'proyectado',
        moneda: createData.moneda || 'USD',
      });
      setShowCreate(false);
      setCreateData({});
      load();
    } catch (err: any) { alert(err.message); }
  };

  const empresas = ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Wallet className="w-7 h-7 text-[#1A4A28]" />
              M1: Cash Management
            </h1>
            <p className="text-sm text-gray-500 mt-1">Posición de caja global · Pronóstico semanal · Gap de liquidez</p>
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
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" /> Nueva Entrada
            </Button>
          </div>
        </div>

        {/* Create Modal */}
        {showCreate && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-3">Nueva Entrada de Flujo de Caja</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">Empresa</label>
                  <select value={createData.empresa || ''} onChange={e => setCreateData(p => ({ ...p, empresa: e.target.value }))}
                    className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md">
                    <option value="">Seleccionar...</option>
                    {empresas.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Semana Inicio</label>
                  <input type="date" value={createData.semana_inicio || ''} onChange={e => setCreateData(p => ({ ...p, semana_inicio: e.target.value }))}
                    className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Ingresos</label>
                  <input type="number" value={createData.ingresos || ''} onChange={e => setCreateData(p => ({ ...p, ingresos: e.target.value }))}
                    className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Egresos</label>
                  <input type="number" value={createData.egresos || ''} onChange={e => setCreateData(p => ({ ...p, egresos: e.target.value }))}
                    className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Estado</label>
                  <select value={createData.status || 'proyectado'} onChange={e => setCreateData(p => ({ ...p, status: e.target.value }))}
                    className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md">
                    <option value="proyectado">Proyectado</option>
                    <option value="ejecutado">Ejecutado</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Categoría</label>
                  <input type="text" value={createData.categoria || ''} onChange={e => setCreateData(p => ({ ...p, categoria: e.target.value }))}
                    className="w-full mt-1 px-2 py-1.5 text-sm border rounded-md" placeholder="Ej: Operaciones" />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={handleCreate}>Crear</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setCreateData({}); }}>Cancelar</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI Row — Cash Position */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: 'Ingresos Totales', value: consolidated?.total_ingresos ?? 0, icon: ArrowUpRight, color: 'text-green-600', bg: 'bg-green-50' },
            { label: 'Egresos Totales', value: consolidated?.total_egresos ?? 0, icon: ArrowDownRight, color: 'text-red-600', bg: 'bg-red-50' },
            { label: 'Flujo Neto', value: consolidated?.flujo_neto ?? 0, icon: Activity, color: (consolidated?.flujo_neto ?? 0) >= 0 ? 'text-green-600' : 'text-red-600', bg: (consolidated?.flujo_neto ?? 0) >= 0 ? 'bg-green-50' : 'bg-red-50' },
            { label: 'Saldo Acumulado', value: consolidated?.saldo_acumulado ?? 0, icon: Wallet, color: 'text-blue-600', bg: 'bg-blue-50' },
          ].map(k => {
            const Icon = k.icon;
            return (
              <Card key={k.label}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-500">{k.label}</p>
                      <p className="text-xl font-bold mt-1">{loading ? '...' : formatCompactCurrency(k.value)}</p>
                    </div>
                    <div className={`w-9 h-9 rounded-lg ${k.bg} flex items-center justify-center`}>
                      <Icon className={`w-4 h-4 ${k.color}`} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Position by BU */}
        {positions.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="w-4 h-4" />Posición por Unidad de Negocio</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Empresa</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Ingresos</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Egresos</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Flujo Neto</th>
                      <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Saldo</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500">Semanas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(p => (
                      <tr key={p.empresa} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{p.empresa}</td>
                        <td className="py-2 px-3 text-right text-green-700">{formatCurrency(p.total_ingresos)}</td>
                        <td className="py-2 px-3 text-right text-red-700">{formatCurrency(p.total_egresos)}</td>
                        <td className={`py-2 px-3 text-right font-semibold ${p.flujo_neto >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(p.flujo_neto)}</td>
                        <td className="py-2 px-3 text-right">{formatCurrency(p.saldo_acumulado)}</td>
                        <td className="py-2 px-3 text-center"><Badge variant="default">{p.semanas}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Forecast Chart */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="w-4 h-4" />Pronóstico Semanal (Ejecutado vs Proyectado)</CardTitle></CardHeader>
            <CardContent>
              {forecast.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="semana" tick={{ fontSize: 10 }} tickFormatter={v => v?.slice(5) || ''} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                    <Legend />
                    <Bar dataKey="ingresos_ejecutado" name="Ingreso Real" fill={ARA_COLORS.primary} radius={[2,2,0,0] as [number,number,number,number]} />
                    <Bar dataKey="ingresos_proyectado" name="Ingreso Proy." fill={ARA_COLORS.primaryLight} opacity={0.5} radius={[2,2,0,0] as [number,number,number,number]} />
                    <Bar dataKey="egresos_ejecutado" name="Egreso Real" fill={ARA_COLORS.red} radius={[2,2,0,0] as [number,number,number,number]} />
                    <Bar dataKey="egresos_proyectado" name="Egreso Proy." fill="#FCA5A5" radius={[2,2,0,0] as [number,number,number,number]} />
                    <Line dataKey="saldo_acumulado" name="Saldo Acum." stroke={ARA_COLORS.blue} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-12 text-center text-gray-400">Sin datos de pronóstico. Cree entradas de flujo de caja.</p>
              )}
            </CardContent>
          </Card>

          {/* Liquidity Gap */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4" />Gap de Liquidez (Maturity Ladder)</CardTitle></CardHeader>
            <CardContent>
              {liquidityGap.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={liquidityGap}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                    <Legend />
                    <Bar dataKey="inflows" name="Inflows" fill={ARA_COLORS.primary} radius={[2,2,0,0] as [number,number,number,number]} />
                    <Bar dataKey="outflows" name="Outflows" fill={ARA_COLORS.red} radius={[2,2,0,0] as [number,number,number,number]} />
                    <Line dataKey="cumulative_gap" name="Gap Acumulado" stroke={ARA_COLORS.gold} strokeWidth={2} dot={{ r: 3 }} />
                    <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="py-12 text-center text-gray-400">Sin datos de liquidez.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Entries */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BarChart3 className="w-4 h-4" />Últimas Entradas de Flujo</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Empresa</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Semana</th>
                    <th className="text-center py-2 px-3 text-xs font-semibold text-gray-500">Estado</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Ingresos</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Egresos</th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-gray-500">Flujo Neto</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-gray-500">Categoría</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEntries.length === 0 ? (
                    <tr><td colSpan={7} className="py-8 text-center text-gray-400">Sin entradas aún</td></tr>
                  ) : recentEntries.map((e, i) => (
                    <tr key={e.id || i} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 font-medium">{e.empresa}</td>
                      <td className="py-2 px-3">{e.semana_inicio ? formatDate(e.semana_inicio) : '—'}</td>
                      <td className="py-2 px-3 text-center">
                        <Badge variant={e.status === 'ejecutado' ? 'success' : 'warning'}>{e.status}</Badge>
                      </td>
                      <td className="py-2 px-3 text-right text-green-700">{formatCurrency(e.ingresos || 0)}</td>
                      <td className="py-2 px-3 text-right text-red-700">{formatCurrency(e.egresos || 0)}</td>
                      <td className={`py-2 px-3 text-right font-semibold ${(e.flujo_neto || 0) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(e.flujo_neto || 0)}</td>
                      <td className="py-2 px-3 text-gray-500">{e.categoria || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
