import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchReconDashboard, triggerAutoMatch,
  type ReconDashboardData,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import {
  Building2, CheckCircle, AlertTriangle, Zap,
  RefreshCw, BarChart3, ListChecks,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };
const PIE_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.red, ARA_COLORS.orange, '#8B5CF6'];

export function BankReconDashboard() {
  const [dashboard, setDashboard] = useState<ReconDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<{ matches_found: number; matches_inserted: number; match_rate: number } | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'exceptions' | 'balances'>('overview');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchReconDashboard();
      setDashboard(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleAutoMatch = async () => {
    setMatching(true);
    setMatchResult(null);
    try {
      const result = await triggerAutoMatch();
      setMatchResult(result);
      load();
    } catch (e) { console.error(e); }
    setMatching(false);
  };

  const kpis = dashboard?.kpis;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <CheckCircle className="w-7 h-7 text-[#1A4A28]" />
              M7: Bank Reconciliation
            </h1>
            <p className="text-sm text-gray-500 mt-1">Conciliación bancaria · Auto-matching · Excepciones · Saldos</p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={handleAutoMatch} disabled={matching}>
              <Zap className={`w-4 h-4 mr-1 ${matching ? 'animate-pulse' : ''}`} />
              {matching ? 'Matching...' : 'Auto-Match'}
            </Button>
          </div>
        </div>

        {/* Match Result Banner */}
        {matchResult && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
            <span className="text-sm text-green-800">
              Auto-match completado: <strong>{matchResult.matches_inserted}</strong> de <strong>{matchResult.matches_found}</strong> coincidencias insertadas ({matchResult.match_rate}% tasa de match)
            </span>
            <button onClick={() => setMatchResult(null)} className="text-green-600 hover:text-green-800 text-sm">✕</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'overview' as const, label: 'Resumen', icon: BarChart3 },
            { id: 'exceptions' as const, label: 'Excepciones', icon: AlertTriangle },
            { id: 'balances' as const, label: 'Saldos Bancarios', icon: Building2 },
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
                { label: 'Total Líneas', value: String(kpis?.total_lines ?? 0), color: 'text-blue-600' },
                { label: 'Conciliadas', value: String(kpis?.matched_count ?? 0), color: 'text-green-600' },
                { label: 'Sin Conciliar', value: String(kpis?.unmatched_count ?? 0), color: (kpis?.unmatched_count ?? 0) > 0 ? 'text-red-600' : 'text-green-600' },
                { label: 'Tasa Conciliación', value: `${kpis?.match_rate ?? 0}%`, color: (kpis?.match_rate ?? 0) > 80 ? 'text-green-600' : 'text-amber-600' },
              ].map(k => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase">{k.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${k.color}`}>{loading ? '...' : k.value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Total Créditos</p>
                  <p className="text-lg font-bold text-green-600">{formatCompactCurrency(kpis?.total_credits ?? 0)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Total Débitos</p>
                  <p className="text-lg font-bold text-red-600">{formatCompactCurrency(kpis?.total_debits ?? 0)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Estados de Cuenta</p>
                  <p className="text-lg font-bold">{kpis?.total_statements ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Mov. Bancarios ERP</p>
                  <p className="text-lg font-bold">{kpis?.bank_movements_count ?? 0}</p>
                </CardContent>
              </Card>
            </div>

            {/* Match Rate Visualization */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><ListChecks className="w-4 h-4" />Conciliación por Tipo</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.by_match_type.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={dashboard.by_match_type} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={90} innerRadius={50}
                          label={({ name, value }) => `${name} (${value})`} labelLine={false} fontSize={11}>
                          {dashboard.by_match_type.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos de conciliación</p>}
                </CardContent>
              </Card>

              {/* By Bank */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Diferencia por Banco</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.by_banco.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <ComposedChart data={dashboard.by_banco}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="banco" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="saldo_banco" name="Saldo Banco" fill={ARA_COLORS.primary} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                        <Bar dataKey="saldo_libros" name="Saldo Libros" fill={ARA_COLORS.gold} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos bancarios</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Exceptions Tab */}
        {activeTab === 'exceptions' && dashboard && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Cola de Excepciones ({dashboard.exception_queue.length} items sin conciliar)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {['#', 'Fecha', 'Descripción', 'Referencia', 'Monto', 'Banco', 'Cuenta', 'Tipo'].map(h => (
                        <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.exception_queue.length === 0 ? (
                      <tr><td colSpan={8} className="py-8 text-center text-gray-400">Sin excepciones pendientes — todo conciliado</td></tr>
                    ) : dashboard.exception_queue.map((item, i) => (
                      <tr key={item.id || i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-2 text-gray-400">{i + 1}</td>
                        <td className="py-2 px-2 text-gray-500">{item.fecha ? formatDate(item.fecha) : '—'}</td>
                        <td className="py-2 px-2 max-w-[200px] truncate">{item.descripcion || '—'}</td>
                        <td className="py-2 px-2 font-mono text-xs">{item.referencia || '—'}</td>
                        <td className={`py-2 px-2 font-semibold ${item.monto >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatCurrency(item.monto)}
                        </td>
                        <td className="py-2 px-2">{item.banco}</td>
                        <td className="py-2 px-2 text-gray-500 text-xs">{item.cuenta}</td>
                        <td className="py-2 px-2">
                          <Badge variant={item.tipo === 'crédito' ? 'success' : 'error'}>{item.tipo}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Balances Tab */}
        {activeTab === 'balances' && dashboard && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Monitor de Saldos Bancarios</CardTitle></CardHeader>
            <CardContent>
              {dashboard.balances.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Banco', 'Cuenta', 'Moneda', 'Saldo Banco', 'Saldo Libros', 'Diferencia', 'Fecha Estado'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.balances.map((b, i) => (
                        <tr key={`${b.banco}-${b.cuenta}-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium">{b.banco}</td>
                          <td className="py-2 px-3 font-mono text-xs">{b.cuenta}</td>
                          <td className="py-2 px-3"><Badge variant="info">{b.moneda}</Badge></td>
                          <td className="py-2 px-3 font-semibold">{formatCurrency(b.saldo_banco)}</td>
                          <td className="py-2 px-3">{formatCurrency(b.saldo_libros)}</td>
                          <td className={`py-2 px-3 font-bold ${Math.abs(b.diferencia) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(b.diferencia)}
                            {Math.abs(b.diferencia) < 0.01 && <span className="ml-1 text-green-500">✓</span>}
                          </td>
                          <td className="py-2 px-3 text-gray-500">{b.fecha_estado ? formatDate(b.fecha_estado) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="py-8 text-center text-gray-400">Sin estados de cuenta importados</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
