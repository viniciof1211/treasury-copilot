import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchFxDashboard, fetchFxScenarios,
  type FxDashboardData, type FxScenarioData,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line, AreaChart, Area, Cell,
  ReferenceLine,
} from 'recharts';
import {
  ArrowLeftRight, TrendingUp, Shield, AlertTriangle,
  RefreshCw, BarChart3, Activity,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };

export function FxRiskDashboard() {
  const [dashboard, setDashboard] = useState<FxDashboardData | null>(null);
  const [scenarios, setScenarios] = useState<FxScenarioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'rates' | 'scenarios'>('overview');

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, scenRes] = await Promise.all([
        fetchFxDashboard(),
        fetchFxScenarios(),
      ]);
      setDashboard(dashRes);
      setScenarios(scenRes);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const kpis = dashboard?.kpis;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ArrowLeftRight className="w-7 h-7 text-[#1A4A28]" />
              M4: FX & Risk Management
            </h1>
            <p className="text-sm text-gray-500 mt-1">Exposición cambiaria · Tipo de cambio BCCR · Coberturas · VaR · Escenarios</p>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'overview' as const, label: 'Exposición', icon: BarChart3 },
            { id: 'rates' as const, label: 'Tipo de Cambio', icon: TrendingUp },
            { id: 'scenarios' as const, label: 'Stress Test', icon: Activity },
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Exposición Neta USD', value: kpis?.net_exposure_usd ?? 0, color: (kpis?.net_exposure_usd ?? 0) >= 0 ? 'text-green-600' : 'text-red-600' },
                { label: 'CxC en USD', value: kpis?.usd_receivables ?? 0, color: 'text-green-600' },
                { label: 'CxP en USD', value: kpis?.usd_payables ?? 0, color: 'text-red-600' },
                { label: 'Deuda en USD', value: kpis?.usd_debt ?? 0, color: 'text-amber-600' },
              ].map(k => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase">{k.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${k.color}`}>{loading ? '...' : formatCompactCurrency(k.value)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">TC Compra</p>
                  <p className="text-2xl font-bold text-blue-600">₡{kpis?.rate_compra?.toFixed(2) ?? '—'}</p>
                  <p className="text-[10px] text-gray-400 mt-1">{kpis?.rate_fecha ? formatDate(kpis.rate_fecha) : ''}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">TC Venta</p>
                  <p className="text-2xl font-bold text-blue-600">₡{kpis?.rate_venta?.toFixed(2) ?? '—'}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">VaR 95% 1-día</p>
                  <p className="text-2xl font-bold text-red-600">{formatCompactCurrency(kpis?.var_95_1d ?? 0)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Hedge Ratio</p>
                  <p className={`text-2xl font-bold ${(kpis?.hedge_ratio ?? 0) > 50 ? 'text-green-600' : 'text-amber-600'}`}>{kpis?.hedge_ratio ?? 0}%</p>
                  <p className="text-[10px] text-gray-400 mt-1">{kpis?.active_hedges_count ?? 0} coberturas activas</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Exposure by BU */}
              <Card>
                <CardHeader><CardTitle className="text-base">Exposición por Unidad de Negocio</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.by_bu.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={dashboard.by_bu}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="empresa" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="receivables" name="CxC" fill={ARA_COLORS.primary} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                        <Bar dataKey="payables" name="CxP" fill={ARA_COLORS.red} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                        <Bar dataKey="debt" name="Deuda" fill={ARA_COLORS.gold} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                        <Line dataKey="net" name="Neto" stroke={ARA_COLORS.blue} strokeWidth={2} dot={{ r: 3 }} />
                        <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin posiciones FX</p>}
                </CardContent>
              </Card>

              {/* Active Hedges */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" />Coberturas Activas</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.hedges.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            {['Tipo', 'Nocional', 'Tasa', 'Vencimiento', 'Contraparte'].map(h => (
                              <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.hedges.map(h => (
                            <tr key={h.id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-2 px-2"><Badge variant="info">{h.tipo}</Badge></td>
                              <td className="py-2 px-2 font-semibold">{formatCurrency(h.monto_nocional)}</td>
                              <td className="py-2 px-2">₡{h.tasa_pactada?.toFixed(2)}</td>
                              <td className="py-2 px-2 text-gray-500">{h.fecha_vencimiento ? formatDate(h.fecha_vencimiento) : '—'}</td>
                              <td className="py-2 px-2 text-gray-500">{h.contraparte}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="py-8 text-center text-gray-400">Sin coberturas activas</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Rates Tab */}
        {activeTab === 'rates' && dashboard && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" />Tendencia Tipo de Cambio CRC/USD</CardTitle></CardHeader>
            <CardContent>
              {dashboard.rate_trend.length > 0 ? (
                <ResponsiveContainer width="100%" height={400}>
                  <AreaChart data={dashboard.rate_trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="fecha" tick={{ fontSize: 9 }} tickFormatter={v => v?.slice(5) || ''} interval={Math.max(0, Math.floor(dashboard.rate_trend.length / 15))} />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10 }} tickFormatter={v => `₡${v}`} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => `₡${Number(v ?? 0).toFixed(2)}`} labelFormatter={l => `Fecha: ${l}`} />
                    <Area type="monotone" dataKey="compra" name="Compra" stroke={ARA_COLORS.primary} fill={ARA_COLORS.primaryLight} fillOpacity={0.3} strokeWidth={2} />
                    <Area type="monotone" dataKey="venta" name="Venta" stroke={ARA_COLORS.red} fill="#FCA5A5" fillOpacity={0.2} strokeWidth={2} />
                    <Line type="monotone" dataKey="promedio" name="Promedio" stroke={ARA_COLORS.gold} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="py-12 text-center text-gray-400">Sin datos de tipo de cambio</p>}
            </CardContent>
          </Card>
        )}

        {/* Scenarios Tab */}
        {activeTab === 'scenarios' && scenarios && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Tasa Base (Venta)</p>
                  <p className="text-2xl font-bold text-blue-600">₡{scenarios.base_rate?.toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Exposición Neta</p>
                  <p className="text-2xl font-bold">{formatCompactCurrency(scenarios.net_exposure)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Escenarios</p>
                  <p className="text-2xl font-bold text-gray-600">{scenarios.scenarios.length}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Stress Test — Impacto de Movimiento Cambiario</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={350}>
                  <ComposedChart data={scenarios.scenarios}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 10 }} tickFormatter={v => `₡${(v / 1000).toFixed(0)}K`} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} tickFormatter={v => `₡${v}`} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <ReferenceLine y={0} yAxisId="left" stroke="#666" strokeDasharray="3 3" />
                    <Bar dataKey="impact_crc" name="Impacto CRC" yAxisId="left">
                      {scenarios.scenarios.map((s, i) => (
                        <Cell key={i} fill={s.impact_crc >= 0 ? ARA_COLORS.primary : ARA_COLORS.red} />
                      ))}
                    </Bar>
                    <Line dataKey="new_rate" name="Nuevo TC" yAxisId="right" stroke={ARA_COLORS.gold} strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Shock', 'Nuevo TC', 'Impacto CRC', 'Impacto USD'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.scenarios.map(s => (
                        <tr key={s.shock_pct} className={`border-b border-gray-100 ${s.shock_pct === 0 ? 'bg-blue-50 font-bold' : 'hover:bg-gray-50'}`}>
                          <td className="py-1.5 px-3">{s.label}</td>
                          <td className="py-1.5 px-3">₡{s.new_rate.toFixed(2)}</td>
                          <td className={`py-1.5 px-3 font-semibold ${s.impact_crc >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(s.impact_crc)}</td>
                          <td className={`py-1.5 px-3 ${s.impact_usd >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(s.impact_usd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
