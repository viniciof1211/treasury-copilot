import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, ARA_COLORS } from '../lib/utils';
import {
  fetchMrpDashboard, fetchReorderRecommendations,
  type MrpDashboardData, type ReorderRecommendation,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import {
  Package, AlertTriangle, ShoppingCart,
  RefreshCw, BarChart3, ListChecks,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };
const ABC_COLORS: Record<string, string> = { A: ARA_COLORS.primary, B: ARA_COLORS.gold, C: ARA_COLORS.blue };

export function MrpDashboard() {
  const [dashboard, setDashboard] = useState<MrpDashboardData | null>(null);
  const [reorder, setReorder] = useState<{ recommendations: ReorderRecommendation[]; total_items: number; total_investment: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'alerts' | 'reorder'>('overview');

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, reorderRes] = await Promise.all([
        fetchMrpDashboard(),
        fetchReorderRecommendations(),
      ]);
      setDashboard(dashRes);
      setReorder(reorderRes);
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
              <Package className="w-7 h-7 text-[#1A4A28]" />
              M9: MRP / Procurement
            </h1>
            <p className="text-sm text-gray-500 mt-1">Inventario · ABC · Alertas desabasto · Recomendaciones EOQ</p>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'overview' as const, label: 'Resumen', icon: BarChart3 },
            { id: 'alerts' as const, label: 'Alertas Desabasto', icon: AlertTriangle },
            { id: 'reorder' as const, label: 'Recomendaciones', icon: ShoppingCart },
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

        {activeTab === 'overview' && dashboard && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total SKUs', value: String(kpis?.total_items ?? 0), color: 'text-blue-600' },
                { label: 'Valor Inventario', value: formatCompactCurrency(kpis?.total_value ?? 0), color: 'text-green-600' },
                { label: 'Requieren Pedido', value: String(kpis?.reorder_needed ?? 0), color: (kpis?.reorder_needed ?? 0) > 0 ? 'text-red-600' : 'text-green-600' },
                { label: 'Tasa Desabasto', value: `${kpis?.stockout_rate ?? 0}%`, color: (kpis?.stockout_rate ?? 0) > 10 ? 'text-red-600' : 'text-green-600' },
              ].map(k => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase">{k.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${k.color}`}>{loading ? '...' : k.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base">Clasificación ABC</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.abc_summary.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={dashboard.abc_summary} dataKey="value" nameKey="class" cx="50%" cy="50%" outerRadius={85} innerRadius={50}
                            label={({ name, percent }) => `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`} labelLine={false} fontSize={12}>
                            {dashboard.abc_summary.map(d => <Cell key={d.class} fill={ABC_COLORS[d.class] || ARA_COLORS.gray} />)}
                          </Pie>
                          <Tooltip formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex justify-center gap-6 mt-2">
                        {dashboard.abc_summary.map(d => (
                          <div key={d.class} className="text-center">
                            <div className="w-3 h-3 rounded-full mx-auto mb-1" style={{ backgroundColor: ABC_COLORS[d.class] || ARA_COLORS.gray }} />
                            <p className="text-xs font-bold">Clase {d.class}</p>
                            <p className="text-xs text-gray-500">{d.count} items</p>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos ABC</p>}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">Top Categorías (Valor)</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.by_category.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={dashboard.by_category.slice(0, 10)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <YAxis type="category" dataKey="categoria" tick={{ fontSize: 9 }} width={100} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="value" name="Valor" fill={ARA_COLORS.primary} radius={[0, 4, 4, 0] as [number, number, number, number]} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && dashboard && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Alertas de Desabasto ({dashboard.stockout_alerts.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.stockout_alerts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Código', 'Descripción', 'Stock', 'P.Reorden', 'Días Cob.', 'Lead Time', 'Consumo/M', 'ABC', 'Urgencia'].map(h => (
                          <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.stockout_alerts.map((a, i) => (
                        <tr key={a.codigo || i} className={`border-b border-gray-100 ${a.urgency === 'critical' ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                          <td className="py-2 px-2 font-mono text-xs">{a.codigo}</td>
                          <td className="py-2 px-2 max-w-[180px] truncate">{a.descripcion}</td>
                          <td className="py-2 px-2 font-semibold">{a.stock.toLocaleString()}</td>
                          <td className="py-2 px-2">{a.punto_reorden.toLocaleString()}</td>
                          <td className={`py-2 px-2 font-bold ${a.dias_cobertura < a.lead_time * 0.5 ? 'text-red-600' : 'text-amber-600'}`}>{a.dias_cobertura}d</td>
                          <td className="py-2 px-2 text-gray-500">{a.lead_time}d</td>
                          <td className="py-2 px-2">{a.consumo_mensual.toLocaleString()}</td>
                          <td className="py-2 px-2"><Badge variant={a.abc === 'A' ? 'error' : a.abc === 'B' ? 'warning' : 'info'}>{a.abc}</Badge></td>
                          <td className="py-2 px-2"><Badge variant={a.urgency === 'critical' ? 'error' : 'warning'}>{a.urgency}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="py-8 text-center text-gray-400">Sin alertas de desabasto</p>}
            </CardContent>
          </Card>
        )}

        {activeTab === 'reorder' && reorder && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Items Recomendados</p>
                  <p className="text-2xl font-bold text-blue-600">{reorder.total_items}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Inversión Total Estimada</p>
                  <p className="text-2xl font-bold text-red-600">{formatCompactCurrency(reorder.total_investment)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-gray-500">Modelo</p>
                  <p className="text-lg font-bold text-gray-600">EOQ Wilson + Safety Stock</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <ListChecks className="w-4 h-4" />
                  Recomendaciones de Reorden ({reorder.recommendations.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Código', 'Descripción', 'Stock', 'Consumo/M', 'Días Cob.', 'EOQ', 'Safety', 'Cant. Sug.', 'Costo Est.', 'ABC', 'Proveedor'].map(h => (
                          <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reorder.recommendations.length === 0 ? (
                        <tr><td colSpan={11} className="py-8 text-center text-gray-400">Sin recomendaciones — todo en stock</td></tr>
                      ) : reorder.recommendations.map((r, i) => (
                        <tr key={r.codigo || i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-2 font-mono text-xs">{r.codigo}</td>
                          <td className="py-2 px-2 max-w-[150px] truncate">{r.descripcion}</td>
                          <td className="py-2 px-2">{r.stock_actual.toLocaleString()}</td>
                          <td className="py-2 px-2">{r.consumo_mensual.toLocaleString()}</td>
                          <td className="py-2 px-2">{r.dias_cobertura}d</td>
                          <td className="py-2 px-2 text-blue-600 font-semibold">{r.eoq.toLocaleString()}</td>
                          <td className="py-2 px-2">{r.safety_stock.toLocaleString()}</td>
                          <td className="py-2 px-2 font-bold text-green-700">{r.cantidad_sugerida.toLocaleString()}</td>
                          <td className="py-2 px-2 font-semibold">{formatCurrency(r.costo_estimado)}</td>
                          <td className="py-2 px-2"><Badge variant={r.abc === 'A' ? 'error' : r.abc === 'B' ? 'warning' : 'info'}>{r.abc}</Badge></td>
                          <td className="py-2 px-2 text-gray-500 text-xs">{r.proveedor}</td>
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
