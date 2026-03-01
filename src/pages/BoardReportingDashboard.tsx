import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { formatCurrency, formatCompactCurrency, ARA_COLORS } from '../lib/utils';
import {
  fetchBoardExecutive, fetchBuComparison,
  type BoardExecutiveData, type BuComparisonItem,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart, Line, RadarChart, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import {
  Presentation, Building2, TrendingUp, DollarSign,
  RefreshCw, Maximize2, BarChart3,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };

export function BoardReportingDashboard() {
  const [executive, setExecutive] = useState<BoardExecutiveData | null>(null);
  const [buData, setBuData] = useState<BuComparisonItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'executive' | 'bu_compare' | 'presentation'>('executive');
  const [fullscreen, setFullscreen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [execRes, buRes] = await Promise.all([
        fetchBoardExecutive(),
        fetchBuComparison(),
      ]);
      setExecutive(execRes);
      setBuData(buRes.business_units || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  const exec = executive;

  return (
    <div className={`min-h-screen bg-gray-50 ${fullscreen ? 'bg-white' : ''}`}>
      {!fullscreen && <Navbar />}
      <div className={`max-w-7xl mx-auto px-4 py-6 ${fullscreen ? 'max-w-full px-8' : ''}`}>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Presentation className="w-7 h-7 text-[#1A4A28]" />
              M10: Board Reporting
            </h1>
            <p className="text-sm text-gray-500 mt-1">Resumen ejecutivo · Comparativo BU · Modo presentación</p>
          </div>
          <div className="flex items-center gap-3">
            <Button size="sm" variant="ghost" onClick={load}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button size="sm" variant="outline" onClick={toggleFullscreen}>
              <Maximize2 className="w-4 h-4 mr-1" />{fullscreen ? 'Salir' : 'Presentación'}
            </Button>
          </div>
        </div>

        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'executive' as const, label: 'Ejecutivo', icon: DollarSign },
            { id: 'bu_compare' as const, label: 'Comparativo BU', icon: Building2 },
            { id: 'presentation' as const, label: 'Slides', icon: Presentation },
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

        {activeTab === 'executive' && exec && (
          <div className="space-y-6">
            {/* Module Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card className="border-l-4 border-l-green-500">
                <CardContent className="p-4">
                  <p className="text-[10px] text-gray-500 uppercase flex items-center gap-1"><TrendingUp className="w-3 h-3" />Cash Flow</p>
                  <p className={`text-xl font-bold mt-1 ${exec.cash.flujo_neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCompactCurrency(exec.cash.flujo_neto)}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Ing: {formatCompactCurrency(exec.cash.total_ingresos)} / Egr: {formatCompactCurrency(exec.cash.total_egresos)}
                  </p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-blue-500">
                <CardContent className="p-4">
                  <p className="text-[10px] text-gray-500 uppercase">Proyectos</p>
                  <p className="text-xl font-bold mt-1 text-blue-600">{formatCompactCurrency(exec.projects.total_contratado)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {exec.projects.contratos_activos} activos / {exec.projects.total_contratos} total
                  </p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-red-500">
                <CardContent className="p-4">
                  <p className="text-[10px] text-gray-500 uppercase">Deuda</p>
                  <p className="text-xl font-bold mt-1 text-red-600">{formatCompactCurrency(exec.debt.total_capital)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{exec.debt.active_loans} préstamos activos</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-amber-500">
                <CardContent className="p-4">
                  <p className="text-[10px] text-gray-500 uppercase">CxP Pendiente</p>
                  <p className="text-xl font-bold mt-1 text-amber-600">{formatCompactCurrency(exec.cxp.pending_amount)}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{exec.cxp.pending_batches} lotes pendientes</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-purple-500">
                <CardContent className="p-4">
                  <p className="text-[10px] text-gray-500 uppercase">Tipo Cambio</p>
                  <p className="text-xl font-bold mt-1 text-purple-600">₡{exec.fx.rate_venta?.toFixed(2) || '—'}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Compra: ₡{exec.fx.rate_compra?.toFixed(2) || '—'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* BU Cash Flow Chart */}
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><BarChart3 className="w-4 h-4" />Flujo de Caja por Unidad de Negocio</CardTitle></CardHeader>
              <CardContent>
                {exec.by_bu.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <ComposedChart data={exec.by_bu}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="empresa" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1e6).toFixed(1)}M`} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                      <Bar dataKey="ingresos" name="Ingresos" fill={ARA_COLORS.primary} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                      <Bar dataKey="egresos" name="Egresos" fill={ARA_COLORS.red} radius={[2, 2, 0, 0] as [number, number, number, number]} />
                      <Line dataKey="flujo_neto" name="Flujo Neto" stroke={ARA_COLORS.gold} strokeWidth={2} dot={{ r: 4 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <p className="py-8 text-center text-gray-400">Sin datos</p>}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'bu_compare' && (
          <div className="space-y-6">
            {buData.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Radar — Desempeño por BU</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <RadarChart data={buData}>
                      <PolarGrid stroke="#e5e7eb" />
                      <PolarAngleAxis dataKey="empresa" tick={{ fontSize: 10 }} />
                      <PolarRadiusAxis tick={{ fontSize: 8 }} />
                      <Radar name="Ingresos" dataKey="ingresos" stroke={ARA_COLORS.primary} fill={ARA_COLORS.primary} fillOpacity={0.2} />
                      <Radar name="Contratado" dataKey="contratado" stroke={ARA_COLORS.blue} fill={ARA_COLORS.blue} fillOpacity={0.2} />
                      <Radar name="Cobrado" dataKey="cobrado" stroke={ARA_COLORS.gold} fill={ARA_COLORS.gold} fillOpacity={0.2} />
                      <Tooltip formatter={(v: unknown) => formatCurrency(Number(v ?? 0))} />
                    </RadarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="w-4 h-4" />Tabla Comparativa BU</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Empresa', 'Ingresos', 'Egresos', 'Flujo Neto', 'Contratado', 'Facturado', 'Cobrado', 'Contratos'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {buData.length === 0 ? (
                        <tr><td colSpan={8} className="py-8 text-center text-gray-400">Sin datos</td></tr>
                      ) : buData.map(bu => (
                        <tr key={bu.empresa} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-semibold">{bu.empresa}</td>
                          <td className="py-2 px-3 text-green-700">{formatCompactCurrency(bu.ingresos)}</td>
                          <td className="py-2 px-3 text-red-700">{formatCompactCurrency(bu.egresos)}</td>
                          <td className={`py-2 px-3 font-bold ${bu.flujo_neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCompactCurrency(bu.flujo_neto)}</td>
                          <td className="py-2 px-3">{formatCompactCurrency(bu.contratado)}</td>
                          <td className="py-2 px-3 text-purple-700">{formatCompactCurrency(bu.facturado)}</td>
                          <td className="py-2 px-3 text-green-700">{formatCompactCurrency(bu.cobrado)}</td>
                          <td className="py-2 px-3 text-center">{bu.contratos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === 'presentation' && exec && (
          <div className="space-y-8">
            <div className="text-center py-8">
              <h2 className="text-3xl font-bold text-[#1A4A28]">ARA Group — Reporte Tesorería</h2>
              <p className="text-gray-500 mt-2">{new Date().toLocaleDateString('es-CR', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
              <Button size="sm" variant="outline" className="mt-4" onClick={toggleFullscreen}>
                <Maximize2 className="w-4 h-4 mr-1" />Modo Pantalla Completa
              </Button>
            </div>

            {/* Slide 1: Cash */}
            <Card className="p-8">
              <h3 className="text-xl font-bold text-[#1A4A28] mb-4">1. Flujo de Caja Consolidado</h3>
              <div className="grid grid-cols-3 gap-8 text-center">
                <div>
                  <p className="text-sm text-gray-500">Ingresos</p>
                  <p className="text-3xl font-bold text-green-600">{formatCompactCurrency(exec.cash.total_ingresos)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Egresos</p>
                  <p className="text-3xl font-bold text-red-600">{formatCompactCurrency(exec.cash.total_egresos)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Flujo Neto</p>
                  <p className={`text-3xl font-bold ${exec.cash.flujo_neto >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCompactCurrency(exec.cash.flujo_neto)}
                  </p>
                </div>
              </div>
            </Card>

            {/* Slide 2: Projects */}
            <Card className="p-8">
              <h3 className="text-xl font-bold text-[#1A4A28] mb-4">2. Portafolio de Proyectos</h3>
              <div className="grid grid-cols-4 gap-6 text-center">
                <div>
                  <p className="text-sm text-gray-500">Contratado</p>
                  <p className="text-2xl font-bold text-blue-600">{formatCompactCurrency(exec.projects.total_contratado)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Cobrado</p>
                  <p className="text-2xl font-bold text-green-600">{formatCompactCurrency(exec.projects.total_cobrado)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Activos</p>
                  <p className="text-2xl font-bold">{exec.projects.contratos_activos}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="text-2xl font-bold text-gray-600">{exec.projects.total_contratos}</p>
                </div>
              </div>
            </Card>

            {/* Slide 3: Debt + FX */}
            <Card className="p-8">
              <h3 className="text-xl font-bold text-[#1A4A28] mb-4">3. Deuda & Tipo de Cambio</h3>
              <div className="grid grid-cols-2 gap-8">
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-2">Deuda Total</p>
                  <p className="text-3xl font-bold text-red-600">{formatCompactCurrency(exec.debt.total_capital)}</p>
                  <p className="text-sm text-gray-400 mt-1">{exec.debt.active_loans} préstamos activos</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-gray-500 mb-2">Tipo de Cambio USD/CRC</p>
                  <p className="text-3xl font-bold text-purple-600">₡{exec.fx.rate_venta?.toFixed(2) || '—'}</p>
                  <p className="text-sm text-gray-400 mt-1">Compra: ₡{exec.fx.rate_compra?.toFixed(2) || '—'}</p>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
