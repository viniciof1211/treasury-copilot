import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchDebtDashboard, fetchDebtInstrumentDetail,
  createEntity,
  type DebtDashboardData,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, PieChart, Pie, Cell, Line,
} from 'recharts';
import {
  Landmark, Building2, CalendarDays, Eye,
  RefreshCw, Plus, BarChart3, Layers,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };
const PIE_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.red, ARA_COLORS.orange, '#8B5CF6', ARA_COLORS.gray];

export function DebtManagementDashboard() {
  const [dashboard, setDashboard] = useState<DebtDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'instruments' | 'schedule'>('overview');
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null);
  const [instrumentDetail, setInstrumentDetail] = useState<{ instrument: Record<string, unknown>; schedule: Record<string, unknown>[] } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetchDebtDashboard();
      setDashboard(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const loadDetail = async (id: string) => {
    setSelectedInstrument(id);
    try {
      const detail = await fetchDebtInstrumentDetail(id);
      setInstrumentDetail(detail);
    } catch (e) { console.error(e); }
  };

  const handleCreate = async () => {
    try {
      await createEntity('debt_instruments', {
        ...createData,
        saldo_original: parseFloat(createData.saldo_original || '0'),
        capital_vigente: parseFloat(createData.saldo_original || '0'),
        tasa_interes: parseFloat(createData.tasa_interes || '0'),
        estado: 'vigente',
        moneda: createData.moneda || 'USD',
      });
      setShowCreate(false);
      setCreateData({});
      load();
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
  };

  const kpis = dashboard?.kpis;

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Landmark className="w-7 h-7 text-[#1A4A28]" />
              M8: Debt & Operations
            </h1>
            <p className="text-sm text-gray-500 mt-1">Préstamos · Amortización · Vencimientos · Calendario de pagos</p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" /> Nuevo Instrumento
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'overview' as const, label: 'Resumen', icon: BarChart3 },
            { id: 'instruments' as const, label: 'Instrumentos', icon: Landmark },
            { id: 'schedule' as const, label: 'Calendario', icon: CalendarDays },
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
              <h4 className="font-semibold text-sm mb-3">Nuevo Instrumento de Deuda</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { key: 'nombre', label: 'Nombre', type: 'text' },
                  { key: 'tipo', label: 'Tipo', type: 'select', opts: ['largo_plazo', 'capital_trabajo', 'linea_credito'] },
                  { key: 'banco', label: 'Banco', type: 'text' },
                  { key: 'empresa', label: 'Empresa', type: 'select', opts: ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'] },
                  { key: 'saldo_original', label: 'Saldo Original', type: 'number' },
                  { key: 'tasa_interes', label: 'Tasa Interés %', type: 'number' },
                  { key: 'moneda', label: 'Moneda', type: 'select', opts: ['USD', 'CRC'] },
                  { key: 'fecha_vencimiento', label: 'Fecha Vencimiento', type: 'date' },
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Capital Vigente', value: kpis?.total_capital_vigente ?? 0, color: 'text-red-600' },
                { label: 'Saldo Original', value: kpis?.total_saldo_original ?? 0, color: 'text-blue-600' },
                { label: 'Intereses Acum.', value: kpis?.total_intereses_acumulados ?? 0, color: 'text-amber-600' },
                { label: 'Próx. Pago', value: kpis?.next_payment_amount ?? 0, color: 'text-purple-600' },
              ].map(k => (
                <Card key={k.label}>
                  <CardContent className="p-4">
                    <p className="text-xs text-gray-500 uppercase">{k.label}</p>
                    <p className={`text-2xl font-bold mt-1 ${k.color}`}>{loading ? '...' : formatCompactCurrency(k.value)}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Instrumentos Activos</p>
                  <p className="text-lg font-bold">{kpis?.active_instruments ?? 0} / {kpis?.total_instruments ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Tasa Promedio Pond.</p>
                  <p className="text-lg font-bold text-blue-600">{((kpis?.weighted_avg_rate ?? 0) * 100).toFixed(2)}%</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-[10px] text-gray-500 uppercase">Monedas</p>
                  <div className="flex gap-2 mt-1">
                    {dashboard.by_moneda.map(m => (
                      <Badge key={m.moneda} variant="info">{m.moneda}: {formatCompactCurrency(m.capital)}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Maturity Profile */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Layers className="w-4 h-4" />Perfil de Vencimiento</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.maturity_profile.some(b => b.capital > 0) ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={dashboard.maturity_profile}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="capital" name="Capital">
                          {dashboard.maturity_profile.map((_, i) => (
                            <Cell key={i} fill={['#4CAF50', '#8BC34A', '#FFCA28', '#FF9800', '#F44336', '#B71C1C'][i] || ARA_COLORS.gray} />
                          ))}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos de vencimiento</p>}
                </CardContent>
              </Card>

              {/* By Banco */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Por Banco</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.by_banco.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={dashboard.by_banco} dataKey="capital" nameKey="banco" cx="50%" cy="50%" outerRadius={95} innerRadius={55}
                          label={({ name, percent }) => `${String(name).slice(0, 12)} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                          {dashboard.by_banco.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Instruments Tab */}
        {activeTab === 'instruments' && dashboard && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base">Instrumentos de Deuda ({dashboard.instruments.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Nombre', 'Tipo', 'Banco', 'Capital Vig.', 'Tasa', 'Moneda', 'Vencimiento', 'Estado', ''].map(h => (
                          <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.instruments.length === 0 ? (
                        <tr><td colSpan={9} className="py-8 text-center text-gray-400">Sin instrumentos</td></tr>
                      ) : dashboard.instruments.map(inst => (
                        <tr key={inst.id} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-2 font-medium">{inst.nombre}</td>
                          <td className="py-2 px-2"><Badge variant="info">{inst.tipo?.replace(/_/g, ' ')}</Badge></td>
                          <td className="py-2 px-2">{inst.banco}</td>
                          <td className="py-2 px-2 font-semibold">{formatCurrency(inst.capital_vigente)}</td>
                          <td className="py-2 px-2">{(inst.tasa_interes * 100).toFixed(2)}%</td>
                          <td className="py-2 px-2"><Badge variant="default">{inst.moneda}</Badge></td>
                          <td className="py-2 px-2 text-gray-500">{inst.fecha_vencimiento ? formatDate(inst.fecha_vencimiento) : '—'}</td>
                          <td className="py-2 px-2"><Badge variant={inst.estado === 'vigente' ? 'success' : 'default'}>{inst.estado}</Badge></td>
                          <td className="py-2 px-2">
                            <button onClick={() => loadDetail(inst.id)} className="p-1 text-gray-400 hover:text-[#1A4A28] hover:bg-green-50 rounded">
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

            {/* Detail Drawer */}
            {selectedInstrument && instrumentDetail && (
              <Card className="border-2 border-[#1A4A28]">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Amortización: {String(instrumentDetail.instrument.nombre || '')}</CardTitle>
                    <button onClick={() => { setSelectedInstrument(null); setInstrumentDetail(null); }} className="text-gray-400 hover:text-gray-600 text-sm">Cerrar ✕</button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div><p className="text-xs text-gray-500">Saldo Original</p><p className="font-bold">{formatCurrency(Number(instrumentDetail.instrument.saldo_original) || 0)}</p></div>
                    <div><p className="text-xs text-gray-500">Capital Vigente</p><p className="font-bold text-red-600">{formatCurrency(Number(instrumentDetail.instrument.capital_vigente) || 0)}</p></div>
                    <div><p className="text-xs text-gray-500">Tasa</p><p className="font-bold">{((Number(instrumentDetail.instrument.tasa_interes) || 0) * 100).toFixed(2)}%</p></div>
                    <div><p className="text-xs text-gray-500">Vencimiento</p><p className="font-bold">{instrumentDetail.instrument.fecha_vencimiento ? formatDate(String(instrumentDetail.instrument.fecha_vencimiento)) : '—'}</p></div>
                  </div>

                  {instrumentDetail.schedule.length > 0 && (
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={instrumentDetail.schedule}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="fecha_pago" tick={{ fontSize: 9 }} tickFormatter={v => v?.slice(5, 10) || ''} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="principal" name="Principal" fill={ARA_COLORS.primary} stackId="a" radius={[0, 0, 0, 0] as [number, number, number, number]} />
                        <Bar dataKey="intereses" name="Intereses" fill={ARA_COLORS.gold} stackId="a" radius={[2, 2, 0, 0] as [number, number, number, number]} />
                        <Line dataKey="capital_restante" name="Capital Rest." stroke={ARA_COLORS.red} strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  )}

                  <div className="overflow-x-auto mt-4">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          {['Fecha', 'Principal', 'Intereses', 'Cuota', 'Capital Rest.'].map(h => (
                            <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {instrumentDetail.schedule.map((s, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-1.5 px-2 text-gray-500">{s.fecha_pago ? formatDate(String(s.fecha_pago)) : ''}</td>
                            <td className="py-1.5 px-2">{formatCurrency(Number(s.principal) || 0)}</td>
                            <td className="py-1.5 px-2 text-amber-700">{formatCurrency(Number(s.intereses) || 0)}</td>
                            <td className="py-1.5 px-2 font-semibold">{formatCurrency((Number(s.principal) || 0) + (Number(s.intereses) || 0))}</td>
                            <td className="py-1.5 px-2 text-red-600">{formatCurrency(Number(s.capital_restante) || 0)}</td>
                          </tr>
                        ))}
                        {instrumentDetail.schedule.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-gray-400">Sin calendario</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Schedule Tab */}
        {activeTab === 'schedule' && dashboard && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4" />Calendario de Pagos (12 semanas)</CardTitle></CardHeader>
            <CardContent>
              {dashboard.payment_schedule.some(w => w.cuota > 0) ? (
                <>
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={dashboard.payment_schedule}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="week" tick={{ fontSize: 10 }} tickFormatter={v => `S${v}`} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                      <Bar dataKey="principal" name="Principal" fill={ARA_COLORS.primary} stackId="a" radius={[0, 0, 0, 0] as [number, number, number, number]} />
                      <Bar dataKey="intereses" name="Intereses" fill={ARA_COLORS.gold} stackId="a" radius={[2, 2, 0, 0] as [number, number, number, number]} />
                    </ComposedChart>
                  </ResponsiveContainer>

                  <div className="space-y-2 mt-4">
                    {dashboard.payment_schedule.map(w => (
                      <div key={w.week} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <span className="font-semibold text-sm">Semana {w.week}</span>
                          <span className="text-xs text-gray-500 ml-2">{formatDate(w.start)} — {formatDate(w.end)}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="text-gray-500">Principal: <strong>{formatCompactCurrency(w.principal)}</strong></span>
                          <span className="text-gray-500">Intereses: <strong className="text-amber-600">{formatCompactCurrency(w.intereses)}</strong></span>
                          <span className="font-mono font-bold">{formatCompactCurrency(w.cuota)}</span>
                          {w.pagos > 0 && <Badge variant="info">{w.pagos} pagos</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : <p className="py-12 text-center text-gray-400">Sin pagos programados en las próximas 12 semanas</p>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
