import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchCxPDashboard, fetchPaymentSchedule,
  queryEntity, createEntity, approveEntity,
  type CxPDashboardData, type PaymentScheduleWeek,
  type PaymentBatch, type PaymentInstruction,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, PieChart, Pie, Cell,
} from 'recharts';
import {
  Banknote, CreditCard, Users, ShieldCheck, Clock,
  RefreshCw, Plus, Check, X, CalendarDays,
  TrendingDown,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };
const PIE_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.red, ARA_COLORS.orange, '#8B5CF6', ARA_COLORS.gray];

export function CxPPaymentsDashboard() {
  const [dashboard, setDashboard] = useState<CxPDashboardData | null>(null);
  const [schedule, setSchedule] = useState<PaymentScheduleWeek[]>([]);
  const [batches, setBatches] = useState<PaymentBatch[]>([]);
  const [instructions, setInstructions] = useState<PaymentInstruction[]>([]);
  const [loading, setLoading] = useState(true);
  const [empresaFilter, setEmpresaFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'batches' | 'instructions'>('overview');
  const [showCreate, setShowCreate] = useState(false);
  const [createData, setCreateData] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [dashRes, schedRes, batchRes, instrRes] = await Promise.all([
        fetchCxPDashboard(empresaFilter || undefined),
        fetchPaymentSchedule(4),
        queryEntity<PaymentBatch>('payment_batches', { limit: 30, order: 'fecha_pago.desc' }),
        queryEntity<PaymentInstruction>('payment_instructions', { limit: 50, order: 'created_at.desc' }),
      ]);
      setDashboard(dashRes);
      setSchedule(schedRes.schedule || []);
      setBatches(batchRes.data || []);
      setInstructions(instrRes.data || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [empresaFilter]);

  const handleCreateBatch = async () => {
    try {
      await createEntity('payment_batches', {
        nombre: createData.nombre,
        descripcion: createData.descripcion,
        fecha_pago: createData.fecha_pago,
        empresa: createData.empresa,
        moneda: createData.moneda || 'USD',
        total_items: 0,
        total_monto: 0,
        estado: 'borrador',
      });
      setShowCreate(false);
      setCreateData({});
      load();
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
  };

  const handleApprove = async (id: string, action: 'aprobar' | 'rechazar') => {
    try {
      await approveEntity('payment_batches', id, action);
      load();
    } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Error'); }
  };

  const kpis = dashboard?.kpis;
  const empresas = ['EUROMOBILIA', 'PANELTECH', 'MULTICLAMP'];

  const estadoBadge = (estado: string) => {
    const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
      pagado: 'success', aprobado: 'success', pendiente: 'warning',
      pendiente_aprobacion: 'warning', borrador: 'info',
      rechazado: 'error', cancelado: 'error',
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
              <Banknote className="w-7 h-7 text-[#1A4A28]" />
              M2: Pagos / CxP
            </h1>
            <p className="text-sm text-gray-500 mt-1">AP Ledger · Lotes de pago · Aprobaciones · Aging</p>
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
              <Plus className="w-4 h-4 mr-1" /> Nuevo Lote
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'overview' as const, label: 'Resumen', icon: TrendingDown },
            { id: 'batches' as const, label: 'Lotes de Pago', icon: Banknote },
            { id: 'instructions' as const, label: 'Instrucciones', icon: CreditCard },
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

        {/* Create Batch Modal */}
        {showCreate && (
          <Card className="mb-6">
            <CardContent className="p-4">
              <h4 className="font-semibold text-sm mb-3">Crear Nuevo Lote de Pago</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { key: 'nombre', label: 'Nombre del Lote', type: 'text' },
                  { key: 'descripcion', label: 'Descripción', type: 'text' },
                  { key: 'fecha_pago', label: 'Fecha de Pago', type: 'date' },
                  { key: 'empresa', label: 'Empresa', type: 'select', opts: empresas },
                  { key: 'moneda', label: 'Moneda', type: 'select', opts: ['USD', 'CRC'] },
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
                <Button size="sm" onClick={handleCreateBatch}>Crear</Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowCreate(false); setCreateData({}); }}>Cancelar</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && dashboard && (
          <div className="space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: 'Total Pendiente', value: kpis?.total_pendiente ?? 0, color: 'text-red-600', bg: 'bg-red-50', icon: CreditCard },
                { label: 'Total Pagado', value: kpis?.total_pagado ?? 0, color: 'text-green-600', bg: 'bg-green-50', icon: Check },
                { label: 'Items Totales', value: kpis?.total_items ?? 0, fmt: 'num', color: 'text-blue-600', bg: 'bg-blue-50', icon: Users },
                { label: 'Lotes Pendientes', value: kpis?.pending_batch_count ?? 0, fmt: 'num', color: 'text-amber-600', bg: 'bg-amber-50', icon: Clock },
                { label: 'Monto Pend. Aprob.', value: kpis?.pending_batch_amount ?? 0, color: 'text-purple-600', bg: 'bg-purple-50', icon: ShieldCheck },
                { label: 'Lotes Aprobados', value: kpis?.approved_batch_count ?? 0, fmt: 'num', color: 'text-green-600', bg: 'bg-green-50', icon: ShieldCheck },
              ].map(k => {
                const Icon = k.icon;
                return (
                  <Card key={k.label}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase">{k.label}</p>
                          <p className="text-lg font-bold mt-0.5">
                            {loading ? '...' : k.fmt === 'num' ? String(k.value) : formatCompactCurrency(k.value)}
                          </p>
                        </div>
                        <div className={`w-8 h-8 rounded-lg ${k.bg} flex items-center justify-center`}>
                          <Icon className={`w-4 h-4 ${k.color}`} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Aging Chart */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4" />Aging de CxP</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.aging.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <ComposedChart data={dashboard.aging}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}K`} />
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                        <Bar dataKey="monto" fill={ARA_COLORS.primary}>
                          {dashboard.aging.map((_, i) => (
                            <Cell key={i} fill={['#4CAF50', '#FFCA28', '#FF9800', '#F44336', '#B71C1C'][i] || ARA_COLORS.gray} />
                          ))}
                        </Bar>
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
                </CardContent>
              </Card>

              {/* Payment Method Breakdown */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4" />Por Método de Pago</CardTitle></CardHeader>
                <CardContent>
                  {dashboard.by_metodo.length > 0 ? (
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={dashboard.by_metodo} dataKey="monto" nameKey="metodo" cx="50%" cy="50%" outerRadius={90} innerRadius={50} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                          {dashboard.by_metodo.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Payment Schedule */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><CalendarDays className="w-4 h-4" />Calendario de Pagos (4 semanas)</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {schedule.map(w => (
                      <div key={w.week} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                        <div>
                          <span className="font-semibold text-sm">Semana {w.week}</span>
                          <span className="text-xs text-gray-500 ml-2">{formatDate(w.start)} — {formatDate(w.end)}</span>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <span className="font-mono font-bold">{formatCompactCurrency(w.total_monto)}</span>
                          <span className="text-gray-500">{w.batches} lotes</span>
                          {w.pending > 0 && <Badge variant="warning">{w.pending} pend.</Badge>}
                          {w.approved > 0 && <Badge variant="success">{w.approved} aprob.</Badge>}
                        </div>
                      </div>
                    ))}
                    {schedule.length === 0 && <p className="py-4 text-center text-gray-400">Sin lotes programados</p>}
                  </div>
                </CardContent>
              </Card>

              {/* Top Proveedores */}
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Top 10 Proveedores</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dashboard.top_proveedores.map((p, i) => (
                      <div key={p.nombre} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-gray-200 text-xs flex items-center justify-center font-bold">{i + 1}</span>
                          <span className="text-sm truncate max-w-[200px]">{p.nombre}</span>
                        </div>
                        <span className="font-mono text-sm font-semibold">{formatCompactCurrency(p.monto)}</span>
                      </div>
                    ))}
                    {dashboard.top_proveedores.length === 0 && <p className="py-4 text-center text-gray-400">Sin datos</p>}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* Batches Tab */}
        {activeTab === 'batches' && (
          <Card>
            <CardHeader><CardTitle className="text-base">Lotes de Pago ({batches.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {['Nombre', 'Fecha Pago', 'Empresa', 'Items', 'Monto Total', 'Estado', 'Aprobado por', 'Acciones'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {batches.length === 0 ? (
                      <tr><td colSpan={8} className="py-8 text-center text-gray-400">Sin lotes</td></tr>
                    ) : batches.map(b => (
                      <tr key={b.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{b.nombre}</td>
                        <td className="py-2 px-3">{b.fecha_pago ? formatDate(b.fecha_pago) : '—'}</td>
                        <td className="py-2 px-3">{b.empresa}</td>
                        <td className="py-2 px-3">{b.total_items}</td>
                        <td className="py-2 px-3 font-semibold">{formatCurrency(b.total_monto || 0)}</td>
                        <td className="py-2 px-3">{estadoBadge(b.estado)}</td>
                        <td className="py-2 px-3 text-gray-500">{b.aprobado_por || '—'}</td>
                        <td className="py-2 px-3">
                          {b.estado === 'pendiente_aprobacion' && (
                            <div className="flex gap-1">
                              <button onClick={() => handleApprove(b.id, 'aprobar')} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="w-4 h-4" /></button>
                              <button onClick={() => handleApprove(b.id, 'rechazar')} className="p-1 text-red-600 hover:bg-red-50 rounded"><X className="w-4 h-4" /></button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Instructions Tab */}
        {activeTab === 'instructions' && (
          <Card>
            <CardHeader><CardTitle className="text-base">Instrucciones de Pago ({instructions.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {['Beneficiario', 'Monto', 'Moneda', 'Método', 'Prioridad', 'Estado', 'Empresa'].map(h => (
                        <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {instructions.length === 0 ? (
                      <tr><td colSpan={7} className="py-8 text-center text-gray-400">Sin instrucciones</td></tr>
                    ) : instructions.map(ins => (
                      <tr key={ins.id} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{ins.nombre_beneficiario}</td>
                        <td className="py-2 px-3 font-semibold">{formatCurrency(ins.monto || 0)}</td>
                        <td className="py-2 px-3"><Badge variant="info">{ins.moneda}</Badge></td>
                        <td className="py-2 px-3">{ins.metodo_pago}</td>
                        <td className="py-2 px-3">{estadoBadge(ins.prioridad)}</td>
                        <td className="py-2 px-3">{estadoBadge(ins.estado)}</td>
                        <td className="py-2 px-3 text-gray-500">{ins.empresa || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
