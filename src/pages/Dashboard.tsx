import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, Clock, ShieldCheck,
  Lightbulb, RefreshCw, BarChart3, Wallet, CreditCard, Landmark,
  Target, History, Layers, Activity, DollarSign, Receipt, Presentation,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { semaphore, ARA_COLORS, formatMonthYear, formatShortDate } from '../lib/utils';
import {
  querySQL, type CxPItem, type FlujoItem, type Projection, type IngestRun,
  tooltipStyle,
} from '../lib/queries';
import {
  useExchangeRate, toUSD, fmtCur, fmtCompact, normalizeCurrency,
} from '../hooks/useExchangeRate';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, Area, ReferenceLine,
  PieChart, Pie, Cell, AreaChart,
} from 'recharts';

// ── All formatting for this module is in USD ──────────────────────────────────
const fmtUSD = (v: number) => fmtCur(v, 'USD');
const fmtCompactUSD = (v: number) => fmtCompact(v, 'USD');

export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [cxp, setCxp] = useState<CxPItem[]>([]);
  const [flujo, setFlujo] = useState<FlujoItem[]>([]);
  const [projection, setProjection] = useState<Projection[]>([]);
  const [ingestRuns, setIngestRuns] = useState<IngestRun[]>([]);

  const { rate, loading: rateLoading, date: rateDate } = useExchangeRate();

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

  // ── Convert helpers (everything → USD) ────────────────────────────────────
  /** CxP amounts: field is named monto_usd — treat as already USD */
  const cxpUSD = (item: CxPItem) => Number(item.monto_usd) || 0;

  /** Flujo amounts: use moneda field to decide conversion */
  const flujoUSD = useCallback((item: FlujoItem, field: 'cuota' | 'principal' | 'intereses' | 'saldo_original' | 'capital' | 'capital_actualizado') => {
    return toUSD(Number(item[field]) || 0, item.moneda, rate);
  }, [rate]);

  // ── Metrics (all USD) ──────────────────────────────────────────────────────
  const totalCxP = cxp.reduce((s, r) => s + cxpUSD(r), 0);
  const totalInflows = flujo.reduce((s, r) => s + flujoUSD(r, 'cuota'), 0);
  const totalPrincipal = flujo.reduce((s, r) => s + flujoUSD(r, 'principal'), 0);
  const totalIntereses = flujo.reduce((s, r) => s + flujoUSD(r, 'intereses'), 0);
  const totalSaldo = flujo.reduce((s, r) => s + flujoUSD(r, 'saldo_original'), 0);
  const netCashflow = totalInflows - totalCxP;
  const ratio = totalCxP > 0 ? totalInflows / totalCxP : totalInflows > 0 ? 99 : 0;
  const runwayMonths = projection.filter(p => Number(p.projected_balance) > 0).length;
  const uniqueOps = useMemo(() => { const m = new Set<string>(); flujo.forEach(r => m.add(`${r.compania}|${r.operacion}|${r.banco}`)); return m.size; }, [flujo]);
  const uniqueBanks = useMemo(() => new Set(flujo.map(r => r.banco).filter(Boolean)).size, [flujo]);

  // ── Debt breakdown: LP vs CP ───────────────────────────────────────────
  const debtLP = useMemo(() => flujo.filter(r => r.tipo === 'Largo Plazo').reduce((s, r) => s + flujoUSD(r, 'saldo_original'), 0), [flujo, flujoUSD]);
  const debtCP = useMemo(() => flujo.filter(r => r.tipo !== 'Largo Plazo').reduce((s, r) => s + flujoUSD(r, 'saldo_original'), 0), [flujo, flujoUSD]);
  const now = new Date();
  const overdueCxP = cxp.filter(r => r.vencimiento_fecha && new Date(r.vencimiento_fecha) < now);

  // ── Monthly trends (USD) ──────────────────────────────────────────────────
  const monthlyTrends = useMemo(() => {
    const m: Record<string, { month: string; ingresos: number; egresos: number; neto: number }> = {};
    flujo.forEach(r => {
      const k = (r.vencimiento || r.created_at || '').slice(0, 7);
      if (!k) return;
      if (!m[k]) m[k] = { month: k, ingresos: 0, egresos: 0, neto: 0 };
      m[k].ingresos += flujoUSD(r, 'cuota');
    });
    cxp.forEach(r => {
      const k = (r.vencimiento_fecha || r.created_at || '').slice(0, 7);
      if (!k) return;
      if (!m[k]) m[k] = { month: k, ingresos: 0, egresos: 0, neto: 0 };
      m[k].egresos += cxpUSD(r);
    });
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)).map(x => ({ ...x, neto: x.ingresos - x.egresos, label: formatMonthYear(x.month + '-01') }));
  }, [cxp, flujo, flujoUSD]);

  // Combined projection (projection table amounts → treat as CRC, convert)
  const projChart = useMemo(() => {
    const all: { month: string; label: string; ingresos: number; egresos: number; balance: number }[] = [];
    let cum = 0;
    monthlyTrends.forEach(m => { cum += m.neto; all.push({ month: m.month, label: m.label, ingresos: m.ingresos, egresos: m.egresos, balance: cum }); });
    projection.forEach(p => {
      const k = p.projection_month.slice(0, 7);
      if (all.some(a => a.month === k)) return;
      // Projection amounts likely stored in CRC — convert
      all.push({
        month: k,
        label: formatMonthYear(p.projection_month),
        ingresos: toUSD(Number(p.projected_inflows), 'CRC', rate),
        egresos: toUSD(Number(p.projected_outflows), 'CRC', rate),
        balance: toUSD(Number(p.projected_balance), 'CRC', rate),
      });
    });
    return all.sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyTrends, projection, rate]);

  // BU breakdown (USD)
  const buData = useMemo(() => {
    const m: Record<string, { bu: string; ingresos: number; egresos: number }> = {};
    flujo.forEach(r => { const b = r.compania || 'Sin BU'; if (!m[b]) m[b] = { bu: b, ingresos: 0, egresos: 0 }; m[b].ingresos += flujoUSD(r, 'cuota'); });
    cxp.forEach(r => { const b = r.empresa || 'Sin BU'; if (!m[b]) m[b] = { bu: b, ingresos: 0, egresos: 0 }; m[b].egresos += cxpUSD(r); });
    return Object.values(m).map(v => ({ ...v, neto: v.ingresos - v.egresos })).sort((a, b) => b.neto - a.neto);
  }, [cxp, flujo, flujoUSD]);

  // ── Predictive Analytics Data ─────────────────────────────────────────────

  // 1. Cashflow Forecast — 3-month SMA extrapolation
  const cashflowForecast = useMemo(() => {
    if (monthlyTrends.length < 2) return [];
    const hist = monthlyTrends.map(m => ({ ...m, type: 'real' as const }));
    const window = Math.min(3, hist.length);
    const lastN = hist.slice(-window);
    const avgIn = lastN.reduce((s, m) => s + m.ingresos, 0) / window;
    const avgOut = lastN.reduce((s, m) => s + m.egresos, 0) / window;
    const lastMonth = hist[hist.length - 1].month;
    const forecast: typeof hist = [];
    for (let i = 1; i <= 6; i++) {
      const d = new Date(lastMonth + '-01');
      d.setMonth(d.getMonth() + i);
      const mo = d.toISOString().slice(0, 7);
      const drift = 1 + (i * 0.01); // slight growth assumption
      forecast.push({
        month: mo, label: formatMonthYear(mo + '-01'),
        ingresos: avgIn * drift, egresos: avgOut * (1 + i * 0.005),
        neto: avgIn * drift - avgOut * (1 + i * 0.005), type: 'forecast' as const,
      });
    }
    return [...hist, ...forecast];
  }, [monthlyTrends]);

  // 2. CxP Concentration — Top providers Pareto
  const cxpConcentration = useMemo(() => {
    const m: Record<string, number> = {};
    cxp.forEach(r => { m[r.proveedor || 'Desconocido'] = (m[r.proveedor || 'Desconocido'] || 0) + cxpUSD(r); });
    const sorted = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8);
    let cum = 0;
    return sorted.map(([name, value]) => {
      cum += value;
      return { name: name.length > 18 ? name.slice(0, 15) + '...' : name, value, cumPct: totalCxP > 0 ? (cum / totalCxP) * 100 : 0 };
    });
  }, [cxp, totalCxP]);

  // 3. Liquidity Runway — projected balance with risk zones
  const runwayProjection = useMemo(() => {
    if (projChart.length === 0) return [];
    return projChart.map(p => ({
      ...p,
      riskZone: p.balance < 0 ? p.balance : 0,
      safeZone: p.balance >= 0 ? p.balance : 0,
      criticalLine: 0,
    }));
  }, [projChart]);

  // 4. Debt Maturity Profile — upcoming maturities by month
  const debtMaturity = useMemo(() => {
    const m: Record<string, { month: string; label: string; lp: number; cp: number; total: number }> = {};
    flujo.forEach(r => {
      const k = (r.vencimiento || r.created_at || '').slice(0, 7);
      if (!k) return;
      if (!m[k]) m[k] = { month: k, label: formatMonthYear(k + '-01'), lp: 0, cp: 0, total: 0 };
      const amt = flujoUSD(r, 'cuota');
      if (r.tipo === 'Largo Plazo') m[k].lp += amt;
      else m[k].cp += amt;
      m[k].total += amt;
    });
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month));
  }, [flujo, flujoUSD]);

  // 5. CxP Aging Risk Distribution (pie)
  const agingRisk = useMemo(() => {
    const buckets = { 'Vigente (0-30d)': 0, 'Atención (31-60d)': 0, 'Riesgo (61-90d)': 0, 'Crítico (90d+)': 0 };
    const now = new Date();
    cxp.forEach(r => {
      if (!r.vencimiento_fecha) return;
      const days = Math.max(0, (now.getTime() - new Date(r.vencimiento_fecha).getTime()) / 86400000);
      const amt = cxpUSD(r);
      if (days <= 30) buckets['Vigente (0-30d)'] += amt;
      else if (days <= 60) buckets['Atención (31-60d)'] += amt;
      else if (days <= 90) buckets['Riesgo (61-90d)'] += amt;
      else buckets['Crítico (90d+)'] += amt;
    });
    return Object.entries(buckets).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [cxp]);
  const AGING_PIE_COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444'];

  // ── Language toggle ─────────────────────────────────────────────────────
  const [lang, setLang] = useState<'es' | 'en'>(() => (localStorage.getItem('narrative_lang') as 'es' | 'en') || 'es');
  const toggleLang = useCallback(() => { const next = lang === 'es' ? 'en' : 'es'; setLang(next); localStorage.setItem('narrative_lang', next); }, [lang]);

  // ── Insights (USD) ─────────────────────────────────────────────────────────
  const insights: { type: 'insight' | 'risk' | 'action'; text: string; textEn: string }[] = [];
  if (totalCxP > 0 && totalInflows > 0) {
    if (ratio >= 1.5) insights.push({ type: 'insight', text: `Liquidez saludable: ingresos (${fmtCompactUSD(totalInflows)}) cubren ${ratio.toFixed(1)}x las CxP (${fmtCompactUSD(totalCxP)}).`, textEn: `Healthy liquidity: income (${fmtCompactUSD(totalInflows)}) covers ${ratio.toFixed(1)}x AP (${fmtCompactUSD(totalCxP)}).` });
    else if (ratio >= 1) insights.push({ type: 'risk', text: `Cobertura ajustada (${ratio.toFixed(1)}x). Margen limitado.`, textEn: `Tight coverage (${ratio.toFixed(1)}x). Limited margin.` });
    else insights.push({ type: 'risk', text: `Alerta: CxP > Ingresos. Gap: ${fmtCompactUSD(totalCxP - totalInflows)}.`, textEn: `Alert: AP > Income. Gap: ${fmtCompactUSD(totalCxP - totalInflows)}.` });
  }
  if (overdueCxP.length > 0) { const amt = overdueCxP.reduce((s, r) => s + cxpUSD(r), 0); insights.push({ type: 'action', text: `${overdueCxP.length} CxP vencidas (${fmtCompactUSD(amt)}). Gestionar cobro/priorización.`, textEn: `${overdueCxP.length} overdue AP (${fmtCompactUSD(amt)}). Manage collection/prioritization.` }); }
  if (totalIntereses > 0) insights.push({ type: 'insight', text: `Carga financiera: ${fmtCompactUSD(totalIntereses)} intereses + ${fmtCompactUSD(totalPrincipal)} principal.`, textEn: `Financial burden: ${fmtCompactUSD(totalIntereses)} interest + ${fmtCompactUSD(totalPrincipal)} principal.` });
  if (uniqueOps > 0) insights.push({ type: 'insight', text: `${uniqueOps} líneas de crédito en ${uniqueBanks} bancos. Saldo total: ${fmtCompactUSD(totalSaldo)}.`, textEn: `${uniqueOps} credit lines across ${uniqueBanks} banks. Total balance: ${fmtCompactUSD(totalSaldo)}.` });
  if (ingestRuns.length > 0) insights.push({ type: 'insight', text: `${ingestRuns.length} ingestas. Última: ${ingestRuns[0]?.source_file?.split('_').pop() || 'N/A'}.`, textEn: `${ingestRuns.length} ingestions. Latest: ${ingestRuns[0]?.source_file?.split('_').pop() || 'N/A'}.` });
  if (cxp.length === 0 && flujo.length === 0) insights.push({ type: 'action', text: 'Sin datos. Sube archivos en "Fuentes de Datos" para activar el dashboard.', textEn: 'No data. Upload files in "Data Sources" to activate the dashboard.' });

  const hasData = cxp.length > 0 || flujo.length > 0 || projection.length > 0;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Panel Ejecutivo de Tesorería</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Resumen consolidado — Cashflow, CxP, Crédito, Proyección <strong>($ USD — Dolarizado)</strong> &middot; ARA Group
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Exchange rate badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-blue-50 border border-blue-200 rounded-lg text-xs">
              <DollarSign className="w-3.5 h-3.5 text-blue-600" />
              <span className="font-medium text-blue-700">
                {rateLoading ? '...' : `₡${rate.toFixed(2)} / $1`}
              </span>
              {rateDate && rateDate !== 'fallback' && (
                <span className="text-blue-400 text-[9px]">BCCR {formatShortDate(rateDate)}</span>
              )}
              {rateDate === 'fallback' && (
                <span className="text-amber-500 text-[9px]">est.</span>
              )}
            </div>
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
            {/* KPIs — all USD */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <KPICard title="Total CxP" value={totalCxP} icon={CreditCard} currency="USD" semaphore={semaphore(totalCxP, 100000, 500000, true)} subtitle={`${cxp.length} facturas`} />
              <KPICard title="Ingresos Operativos" value={totalInflows} icon={Wallet} currency="USD" semaphore={totalInflows > 0 ? 'green' : 'red'} subtitle={`${flujo.length} operaciones`} />
              <KPICard title="Cashflow Neto" value={netCashflow} icon={netCashflow >= 0 ? TrendingUp : TrendingDown} currency="USD" semaphore={semaphore(netCashflow, 0, -50000)} subtitle={netCashflow >= 0 ? 'Superávit' : 'Déficit'} />
              <KPICard title="Deuda Largo Plazo" value={debtLP} icon={Landmark} currency="USD" semaphore={debtLP > 0 ? 'yellow' : 'green'} subtitle="USD — Largo Plazo" />
              <KPICard title="Deuda Corto Plazo" value={debtCP} icon={Activity} currency="USD" semaphore={debtCP > 0 ? 'yellow' : 'green'} subtitle="Capital Trabajo" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-4">
              <KPICard title="Ratio Cobertura" value={ratio} icon={ShieldCheck} format="number" semaphore={semaphore(ratio, 1.5, 1.0)} subtitle="Ingresos / CxP" />
              <KPICard title="Runway" value={runwayMonths} icon={Clock} format="months" semaphore={semaphore(runwayMonths, 6, 3)} subtitle="Balance positivo" />
              <KPICard title="Deuda Total" value={totalSaldo} icon={Landmark} currency="USD" semaphore={totalSaldo > 0 ? 'yellow' : 'green'} subtitle={`${uniqueOps} líneas · ${uniqueBanks} bancos`} />
            </div>

            {/* Quick-access cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Link to="/ingresos" className="group">
                <Card className="hover:shadow-md transition-shadow border-l-4 border-l-purple-400 h-full">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center"><Receipt className="w-5 h-5 text-purple-600" /></div>
                      <div>
                        <p className="font-semibold text-gray-900 group-hover:text-purple-600 transition-colors">Ingresos / CxC</p>
                        <p className="text-xs text-gray-500">CxC · Presupuesto · Aging · Cobro</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
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
              <Link to="/board" className="group">
                <Card className="hover:shadow-md transition-shadow border-l-4 border-l-amber-400 h-full">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center"><Presentation className="w-5 h-5 text-amber-600" /></div>
                      <div>
                        <p className="font-semibold text-gray-900 group-hover:text-amber-600 transition-colors">Junta Directiva</p>
                        <p className="text-xs text-gray-500">KPIs · Notas · Exportar PDF</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </div>

            {/* Main chart: cashflow + projection (USD) */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="w-4 h-4 text-[#1A4A28]" />Flujo de Caja: Histórico + Proyección 12M ($)</CardTitle></CardHeader>
              <CardContent>
                {projChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={projChart}>
                      <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ARA_COLORS.primary} stopOpacity={0.15} /><stop offset="95%" stopColor={ARA_COLORS.primary} stopOpacity={0} /></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fmtCompactUSD(v)} />
                      <Tooltip formatter={(v: number) => fmtUSD(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" label={{ value: '$0', fill: ARA_COLORS.red, fontSize: 10 }} />
                      <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos $" radius={[2, 2, 0, 0]} opacity={0.7} />
                      <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos $" radius={[2, 2, 0, 0]} opacity={0.5} />
                      <Area type="monotone" dataKey="balance" stroke={ARA_COLORS.gold} strokeWidth={2.5} fill="url(#bg)" name="Balance Acum. $" />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : monthlyTrends.length > 0 ? (
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={monthlyTrends}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fmtCompactUSD(v)} />
                      <Tooltip formatter={(v: number) => fmtUSD(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" />
                      <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos $" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos $" radius={[2, 2, 0, 0]} opacity={0.6} />
                      <Line type="monotone" dataKey="neto" stroke={ARA_COLORS.gold} strokeWidth={2} name="Neto $" dot={{ r: 3 }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <EmptyState text="Ingesta datos o ejecuta recalc_projection en AI Chat." />}
              </CardContent>
            </Card>

            {/* BU summary (USD) */}
            {buData.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4 text-[#1A4A28]" />Cashflow por Unidad de Negocio ($)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={buData.map(b => ({ ...b, bu: b.bu.length > 18 ? b.bu.slice(0, 15) + '...' : b.bu }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="bu" stroke="#9ca3af" fontSize={9} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fmtCompactUSD(v)} />
                      <Tooltip formatter={(v: number) => fmtUSD(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" />
                      <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos $" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos $" radius={[3, 3, 0, 0]} opacity={0.6} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* ── Predictive Financial Treasury Analytics ─────────────── */}
            <div className="border-t border-gray-200 pt-6 mt-2">
              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#1A4A28]" />
                Predictive Financial Treasury Analytics
              </h2>
            </div>

            {/* Forecast + Concentration */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 1: Cashflow Forecast */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="w-4 h-4 text-[#1A4A28]" />Pronóstico Cashflow 6M (SMA)</CardTitle></CardHeader>
                <CardContent>
                  {cashflowForecast.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <ComposedChart data={cashflowForecast}>
                        <defs>
                          <linearGradient id="fcGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fmtCompactUSD(v)} />
                        <Tooltip formatter={(v: number) => fmtUSD(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" />
                        <Area type="monotone" dataKey="neto" stroke="#22c55e" strokeWidth={2} fill="url(#fcGrad)" name="Neto $" />
                        <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos $" radius={[2, 2, 0, 0]} opacity={0.5} />
                        <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos $" radius={[2, 2, 0, 0]} opacity={0.35} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Se requieren al menos 2 meses de datos para generar pronóstico." />}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Proyección basada en promedio móvil simple (SMA-3) con drift de crecimiento</p>
                </CardContent>
              </Card>

              {/* Chart 2: CxP Concentration Risk — Pareto */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-orange-500" />Riesgo de Concentración CxP — Pareto</CardTitle></CardHeader>
                <CardContent>
                  {cxpConcentration.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <ComposedChart data={cxpConcentration}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" stroke="#9ca3af" fontSize={8} angle={-20} textAnchor="end" height={50} />
                        <YAxis yAxisId="left" stroke="#9ca3af" fontSize={10} tickFormatter={v => fmtCompactUSD(v)} />
                        <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" fontSize={10} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                        <Tooltip formatter={(v: number, name: string) => name.includes('%') ? `${v.toFixed(1)}%` : fmtUSD(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine yAxisId="right" y={80} stroke={ARA_COLORS.red} strokeDasharray="4 4" label={{ value: '80%', position: 'right', fontSize: 9, fill: ARA_COLORS.red }} />
                        <Bar yAxisId="left" dataKey="value" fill={ARA_COLORS.primary} name="Monto CxP $" radius={[3, 3, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="cumPct" stroke={ARA_COLORS.gold} strokeWidth={2.5} dot={{ r: 3 }} name="% Acumulado" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos de CxP para análisis de concentración." />}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Análisis Pareto: identifica proveedores que concentran el mayor riesgo de pago</p>
                </CardContent>
              </Card>
            </div>

            {/* Runway + Maturity + Aging */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Chart 3: Liquidity Runway */}
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="w-4 h-4 text-[#1A4A28]" />Runway de Liquidez — Zonas de Riesgo</CardTitle></CardHeader>
                <CardContent>
                  {runwayProjection.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <AreaChart data={runwayProjection}>
                        <defs>
                          <linearGradient id="safeG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                          <linearGradient id="riskG" x1="0" y1="1" x2="0" y2="0"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fmtCompactUSD(v)} />
                        <Tooltip formatter={(v: number) => fmtUSD(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeWidth={2} strokeDasharray="6 3" label={{ value: 'Zona Crítica', fill: ARA_COLORS.red, fontSize: 9 }} />
                        <Area type="monotone" dataKey="safeZone" stroke="#22c55e" strokeWidth={2} fill="url(#safeG)" name="Balance Positivo $" />
                        <Area type="monotone" dataKey="riskZone" stroke="#ef4444" strokeWidth={2} fill="url(#riskG)" name="Déficit $" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos de proyección para runway." />}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Meses con balance positivo = runway operativo. Zona roja = riesgo de iliquidez.</p>
                </CardContent>
              </Card>

              {/* Chart 4: Aging Risk Pie */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock className="w-4 h-4 text-orange-500" />Distribución Riesgo Aging</CardTitle></CardHeader>
                <CardContent>
                  {agingRisk.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={agingRisk} cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={3} dataKey="value"
                            label={({ name, percent }) => `${name.split('(')[0].trim()} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 8 }}>
                            {agingRisk.map((_, i) => <Cell key={i} fill={AGING_PIE_COLORS[i % AGING_PIE_COLORS.length]} />)}
                          </Pie>
                          <Tooltip formatter={(v: number) => fmtUSD(v)} contentStyle={tooltipStyle} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1 mt-2">
                        {agingRisk.map((b, i) => (
                          <div key={b.name} className="flex items-center justify-between text-[10px]">
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: AGING_PIE_COLORS[i] }} />{b.name}</span>
                            <span className="font-semibold tabular-nums">{fmtCompactUSD(b.value)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <EmptyState text="Sin datos de aging." />}
                </CardContent>
              </Card>
            </div>

            {/* Chart 5: Debt Maturity Profile */}
            {debtMaturity.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Landmark className="w-4 h-4 text-[#1A4A28]" />Perfil de Vencimiento de Deuda ($)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={debtMaturity}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fmtCompactUSD(v)} />
                      <Tooltip formatter={(v: number) => fmtUSD(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="lp" stackId="a" fill={ARA_COLORS.primary} name="Largo Plazo $" />
                      <Bar dataKey="cp" stackId="a" fill={ARA_COLORS.gold} name="Corto Plazo $" radius={[3, 3, 0, 0]} />
                      <Line type="monotone" dataKey="total" stroke={ARA_COLORS.red} strokeWidth={2} dot={{ r: 3 }} name="Total Cuotas $" />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="text-[9px] text-gray-400 text-center mt-1">Perfil de vencimientos: concentración de pagos por mes y tipo de deuda</p>
                </CardContent>
              </Card>
            )}

            {/* Narrative with Lang Toggle */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="w-4 h-4 text-[#C9A84C]" />{lang === 'es' ? 'Narrativa Ejecutiva' : 'Executive Narrative'}</CardTitle>
                  <button onClick={toggleLang} className="px-2.5 py-1 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">{lang === 'es' ? 'EN' : 'ES'}</button>
                </div>
              </CardHeader>
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
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            {lang === 'es'
                              ? (item.type === 'risk' ? 'Riesgo' : item.type === 'action' ? 'Acción' : 'Hallazgo')
                              : (item.type === 'risk' ? 'Risk' : item.type === 'action' ? 'Action' : 'Finding')}
                          </span>
                          <p className="text-sm text-gray-800 mt-0.5">{lang === 'es' ? item.text : item.textEn}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-400 text-center py-6">{lang === 'es' ? 'Los insights se generan al cargar datos.' : 'Insights are generated when data is loaded.'}</p>}
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-4 flex-wrap">
                <span>{cxp.length} CxP</span><span>{flujo.length} operaciones</span><span>{uniqueOps} líneas crédito</span><span>{projection.length} meses proy.</span>
                <span className="font-medium text-blue-500">Divisa: $ USD (dolarizado)</span>
                <span>TC: ₡{rate.toFixed(2)}/$1</span>
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
