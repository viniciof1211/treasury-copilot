import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, Clock, ShieldCheck,
  Lightbulb, RefreshCw, BarChart3, Wallet, CreditCard, Landmark,
  Target, History, Layers, Activity,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  formatCurrency, formatCompactCurrency, formatMonthYear,
  semaphore, ARA_COLORS, formatShortDate,
} from '../lib/utils';
import {
  querySQL, type CxPItem, type FlujoItem, type Projection, type IngestRun,
  tooltipStyle,
} from '../lib/queries';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, Area, ReferenceLine,
} from 'recharts';

export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [cxp, setCxp] = useState<CxPItem[]>([]);
  const [flujo, setFlujo] = useState<FlujoItem[]>([]);
  const [projection, setProjection] = useState<Projection[]>([]);
  const [ingestRuns, setIngestRuns] = useState<IngestRun[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [c, f, p, i] = await Promise.all([
        querySQL(`SELECT empresa, proveedor, monto_usd, vencimiento_fecha, prioridad, clasificacion, created_at, ingest_run_id FROM silver_finance.cxp_items ORDER BY vencimiento_fecha`),
        querySQL(`SELECT compania, cuota, principal, intereses, vencimiento, banco, tipo, operacion, saldo_original, capital, capital_actualizado, moneda, created_at, ingest_run_id FROM silver_finance.flujo_semanal ORDER BY vencimiento`),
        querySQL(`SELECT projection_month, projected_inflows, projected_outflows, projected_balance FROM silver_finance.projection_12m ORDER BY projection_month`),
        querySQL(`SELECT id, source_file, status, rows_inserted, created_at FROM bronze_finance.ingest_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 50`),
      ]);
      setCxp(c); setFlujo(f); setProjection(p); setIngestRuns(i);
      setLastRefresh(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Metrics ────────────────────────────────────────────────────────────────
  const totalCxP = cxp.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0);
  const totalInflows = flujo.reduce((s, r) => s + (Number(r.cuota) || 0), 0);
  const totalPrincipal = flujo.reduce((s, r) => s + (Number(r.principal) || 0), 0);
  const totalIntereses = flujo.reduce((s, r) => s + (Number(r.intereses) || 0), 0);
  const totalSaldo = flujo.reduce((s, r) => s + (Number(r.saldo_original) || 0), 0);
  const netCashflow = totalInflows - totalCxP;
  const ratio = totalCxP > 0 ? totalInflows / totalCxP : totalInflows > 0 ? 99 : 0;
  const runwayMonths = projection.filter(p => Number(p.projected_balance) > 0).length;
  const uniqueOps = useMemo(() => { const m = new Set<string>(); flujo.forEach(r => m.add(`${r.compania}|${r.operacion}|${r.banco}`)); return m.size; }, [flujo]);
  const uniqueBanks = useMemo(() => new Set(flujo.map(r => r.banco).filter(Boolean)).size, [flujo]);
  const now = new Date();
  const overdueCxP = cxp.filter(r => r.vencimiento_fecha && new Date(r.vencimiento_fecha) < now);

  // ── Monthly trends ─────────────────────────────────────────────────────────
  const monthlyTrends = useMemo(() => {
    const m: Record<string, { month: string; ingresos: number; egresos: number; neto: number }> = {};
    flujo.forEach(r => { const k = (r.vencimiento || r.created_at || '').slice(0, 7); if (!k) return; if (!m[k]) m[k] = { month: k, ingresos: 0, egresos: 0, neto: 0 }; m[k].ingresos += Number(r.cuota) || 0; });
    cxp.forEach(r => { const k = (r.vencimiento_fecha || r.created_at || '').slice(0, 7); if (!k) return; if (!m[k]) m[k] = { month: k, ingresos: 0, egresos: 0, neto: 0 }; m[k].egresos += Number(r.monto_usd) || 0; });
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)).map(x => ({ ...x, neto: x.ingresos - x.egresos, label: formatMonthYear(x.month + '-01') }));
  }, [cxp, flujo]);

  // Combined projection
  const projChart = useMemo(() => {
    const all: { month: string; label: string; ingresos: number; egresos: number; balance: number }[] = [];
    let cum = 0;
    monthlyTrends.forEach(m => { cum += m.neto; all.push({ month: m.month, label: m.label, ingresos: m.ingresos, egresos: m.egresos, balance: cum }); });
    projection.forEach(p => { const k = p.projection_month.slice(0, 7); if (all.some(a => a.month === k)) return; all.push({ month: k, label: formatMonthYear(p.projection_month), ingresos: Number(p.projected_inflows), egresos: Number(p.projected_outflows), balance: Number(p.projected_balance) }); });
    return all.sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyTrends, projection]);

  // BU breakdown
  const buData = useMemo(() => {
    const m: Record<string, { bu: string; ingresos: number; egresos: number }> = {};
    flujo.forEach(r => { const b = r.compania || 'Sin BU'; if (!m[b]) m[b] = { bu: b, ingresos: 0, egresos: 0 }; m[b].ingresos += Number(r.cuota) || 0; });
    cxp.forEach(r => { const b = r.empresa || 'Sin BU'; if (!m[b]) m[b] = { bu: b, ingresos: 0, egresos: 0 }; m[b].egresos += Number(r.monto_usd) || 0; });
    return Object.values(m).map(v => ({ ...v, neto: v.ingresos - v.egresos })).sort((a, b) => b.neto - a.neto);
  }, [cxp, flujo]);

  // ── Insights ───────────────────────────────────────────────────────────────
  const insights: { type: 'insight' | 'risk' | 'action'; text: string }[] = [];
  if (totalCxP > 0 && totalInflows > 0) {
    if (ratio >= 1.5) insights.push({ type: 'insight', text: `Liquidez saludable: ingresos (${formatCompactCurrency(totalInflows)}) cubren ${ratio.toFixed(1)}x las CxP (${formatCompactCurrency(totalCxP)}).` });
    else if (ratio >= 1) insights.push({ type: 'risk', text: `Cobertura ajustada (${ratio.toFixed(1)}x). Margen limitado.` });
    else insights.push({ type: 'risk', text: `Alerta: CxP > Ingresos. Gap: ${formatCompactCurrency(totalCxP - totalInflows)}.` });
  }
  if (overdueCxP.length > 0) { const amt = overdueCxP.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0); insights.push({ type: 'action', text: `${overdueCxP.length} CxP vencidas (${formatCompactCurrency(amt)}). Gestionar cobro/priorización.` }); }
  if (totalIntereses > 0) insights.push({ type: 'insight', text: `Carga financiera: ${formatCompactCurrency(totalIntereses)} intereses + ${formatCompactCurrency(totalPrincipal)} principal.` });
  if (uniqueOps > 0) insights.push({ type: 'insight', text: `${uniqueOps} líneas de crédito en ${uniqueBanks} bancos. Saldo total: ${formatCompactCurrency(totalSaldo)}.` });
  if (ingestRuns.length > 0) insights.push({ type: 'insight', text: `${ingestRuns.length} ingestas. Última: ${ingestRuns[0]?.source_file?.split('_').pop() || 'N/A'}.` });
  if (cxp.length === 0 && flujo.length === 0) insights.push({ type: 'action', text: 'Sin datos. Sube archivos en "Fuentes de Datos" para activar el dashboard.' });

  const hasData = cxp.length > 0 || flujo.length > 0 || projection.length > 0;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Panel Ejecutivo de Tesorería</h1>
            <p className="text-gray-500 mt-1 text-sm">Resumen consolidado — Cashflow, CxP, Crédito, Proyección (₡ CRC) &middot; ARA Group</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400 hidden lg:block">{lastRefresh.toLocaleTimeString('es-CR')}</span>
            <button onClick={fetchData} disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#1A4A28] bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading && !hasData ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400"><LoadingSpinner size="lg" /><p className="mt-4 text-sm">Cargando datos de tesorería...</p></div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <KPICard title="Total CxP" value={totalCxP} icon={CreditCard} semaphore={semaphore(totalCxP, 100000, 500000, true)} subtitle={`${cxp.length} facturas`} />
              <KPICard title="Ingresos Operativos" value={totalInflows} icon={Wallet} semaphore={totalInflows > 0 ? 'green' : 'red'} subtitle={`${flujo.length} operaciones`} />
              <KPICard title="Cashflow Neto" value={netCashflow} icon={netCashflow >= 0 ? TrendingUp : TrendingDown} semaphore={semaphore(netCashflow, 0, -50000)} subtitle={netCashflow >= 0 ? 'Superávit' : 'Déficit'} />
              <KPICard title="Ratio Cobertura" value={ratio} icon={ShieldCheck} format="number" semaphore={semaphore(ratio, 1.5, 1.0)} subtitle="Ingresos / CxP" />
              <KPICard title="Runway" value={runwayMonths} icon={Clock} format="months" semaphore={semaphore(runwayMonths, 6, 3)} subtitle="Balance positivo" />
            </div>

            {/* Quick-access cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Link to="/cashflow" className="group">
                <Card className="hover:shadow-md transition-shadow border-l-4 border-l-blue-400 h-full">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center"><Target className="w-5 h-5 text-blue-600" /></div>
                      <div>
                        <p className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">Cashflow Detallado</p>
                        <p className="text-xs text-gray-500">Real vs Proyectado · BU · Aging · KPIs</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <Link to="/credito" className="group">
                <Card className="hover:shadow-md transition-shadow border-l-4 border-l-emerald-400 h-full">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center"><Landmark className="w-5 h-5 text-emerald-600" /></div>
                      <div>
                        <p className="font-semibold text-gray-900 group-hover:text-emerald-600 transition-colors">Operaciones de Crédito</p>
                        <p className="text-xs text-gray-500">{uniqueOps} líneas · {uniqueBanks} bancos · Gantt</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
              <Link to="/data" className="group">
                <Card className="hover:shadow-md transition-shadow border-l-4 border-l-amber-400 h-full">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center"><History className="w-5 h-5 text-amber-600" /></div>
                      <div>
                        <p className="font-semibold text-gray-900 group-hover:text-amber-600 transition-colors">Fuentes de Datos</p>
                        <p className="text-xs text-gray-500">{ingestRuns.length} ingestas · Subir Excel</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>

            {/* Main chart: cashflow + projection */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="w-4 h-4 text-[#1A4A28]" />Flujo de Caja: Histórico + Proyección 12M</CardTitle></CardHeader>
              <CardContent>
                {projChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={projChart}>
                      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ARA_COLORS.primary} stopOpacity={0.15} /><stop offset="95%" stopColor={ARA_COLORS.primary} stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" label={{ value: 'Equilibrio ₡0', fill: ARA_COLORS.red, fontSize: 10 }} />
                      <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos ₡" radius={[2, 2, 0, 0]} opacity={0.7} />
                      <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos ₡" radius={[2, 2, 0, 0]} opacity={0.5} />
                      <Area type="monotone" dataKey="balance" stroke={ARA_COLORS.gold} strokeWidth={2.5} fill="url(#bg)" name="Balance Acum. ₡" />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : monthlyTrends.length > 0 ? (
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={monthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" />
                      <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos ₡" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos ₡" radius={[2, 2, 0, 0]} opacity={0.6} />
                      <Line type="monotone" dataKey="neto" stroke={ARA_COLORS.gold} strokeWidth={2} name="Neto ₡" dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <EmptyState text="Ingesta datos o ejecuta recalc_projection en AI Chat." />}
              </CardContent>
            </Card>

            {/* BU summary */}
            {buData.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4 text-[#1A4A28]" />Cashflow por Unidad de Negocio (₡)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={buData.map(b => ({ ...b, bu: b.bu.length > 18 ? b.bu.slice(0, 15) + '...' : b.bu }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="bu" stroke="#9ca3af" fontSize={9} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" />
                      <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos ₡" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos ₡" radius={[3, 3, 0, 0]} opacity={0.6} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* Narrative */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="w-4 h-4 text-[#C9A84C]" />Narrativa Ejecutiva</CardTitle></CardHeader>
              <CardContent>
                {insights.length > 0 ? (
                  <div className="space-y-2.5">
                    {insights.map((item, idx) => (
                      <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg ${item.type === 'risk' ? 'bg-red-50 border border-red-100' : item.type === 'action' ? 'bg-amber-50 border border-amber-100' : 'bg-emerald-50 border border-emerald-100'}`}>
                        <span className="flex-shrink-0 mt-0.5">
                          {item.type === 'risk' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                          {item.type === 'action' && <Lightbulb className="w-4 h-4 text-amber-600" />}
                          {item.type === 'insight' && <TrendingUp className="w-4 h-4 text-emerald-600" />}
                        </span>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{item.type === 'risk' ? 'Riesgo' : item.type === 'action' ? 'Acción' : 'Hallazgo'}</span>
                          <p className="text-sm text-gray-800 mt-0.5">{item.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-400 text-center py-6">Los insights se generan al cargar datos.</p>}
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-4 flex-wrap">
                <span>{cxp.length} CxP</span><span>{flujo.length} operaciones</span><span>{uniqueOps} líneas crédito</span><span>{projection.length} meses proy.</span><span>Divisa: ₡ CRC</span>
              </div>
              <span>CVE Treasury Copilot — ARA Group</span>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex flex-col items-center justify-center py-10 text-gray-400"><BarChart3 className="w-8 h-8 mb-2 opacity-30" /><p className="text-xs text-center max-w-xs">{text}</p></div>;
}
