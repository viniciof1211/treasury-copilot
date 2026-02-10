import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, Lightbulb, RefreshCw, BarChart3,
  Wallet, CreditCard, Building2, CalendarDays, Target, ShieldCheck, Clock,
  Filter, CheckCircle2, XCircle, AlertOctagon, Banknote,
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { RecordDetailModal, type FieldDef } from '../components/ui/RecordDetailModal';
import {
  formatCurrency, formatCompactCurrency, formatMonthYear, formatShortDate,
  semaphore, ARA_COLORS, getPriorityLabel, formatDate,
} from '../lib/utils';
import { normalizeCurrency } from '../hooks/useExchangeRate';
import {
  querySQL, type CxPItem, type FlujoItem, type Projection,
  type TimePeriod, getDateCutoff, PERIOD_LABELS, tooltipStyle,
} from '../lib/queries';

const CXP_FIELDS: FieldDef[] = [
  { key: 'proveedor', label: 'Proveedor', type: 'text', group: 'Información General' },
  { key: 'empresa', label: 'Empresa / BU', type: 'text' },
  { key: 'negocio', label: 'Negocio', type: 'text' },
  { key: 'responsable', label: 'Responsable', type: 'text' },
  { key: 'monto_usd', label: 'Monto', type: 'currency', group: 'Financiero', highlight: true },
  { key: 'vencimiento_fecha', label: 'Fecha de Vencimiento', type: 'date' },
  { key: 'prioridad', label: 'Prioridad', type: 'select', options: ['P1 - Crítico', 'P2 - Importante', 'P3 - Normal', 'P4 - Diferible'] },
  { key: 'clasificacion', label: 'Clasificación', type: 'text' },
  { key: 'detalle', label: 'Detalle / Notas', type: 'text', group: 'Detalle', highlight: true },
  { key: 'ingest_run_id', label: 'Run de Ingesta', type: 'readonly', group: 'Metadata' },
  { key: 'created_at', label: 'Fecha de Creación', type: 'readonly' },
];

const FLUJO_FIELDS: FieldDef[] = [
  { key: 'operacion', label: 'Operación', type: 'text', group: 'Identificación' },
  { key: 'compania', label: 'Compañía / BU', type: 'text' },
  { key: 'banco', label: 'Banco', type: 'text' },
  { key: 'tipo', label: 'Tipo de Crédito', type: 'select', options: ['Largo Plazo', 'Capital Trabajo', 'Leasing', 'Línea Revolving', 'Tarjeta'] },
  { key: 'moneda', label: 'Moneda', type: 'select', options: ['CRC', 'USD'], group: 'Financiero' },
  { key: 'cuota', label: 'Cuota (Ingreso)', type: 'currency', highlight: true },
  { key: 'principal', label: 'Principal', type: 'currency' },
  { key: 'intereses', label: 'Intereses', type: 'currency' },
  { key: 'saldo_original', label: 'Saldo Original', type: 'currency' },
  { key: 'capital', label: 'Capital', type: 'currency' },
  { key: 'capital_actualizado', label: 'Capital Actualizado', type: 'currency' },
  { key: 'vencimiento', label: 'Vencimiento', type: 'date', group: 'Plazos' },
  { key: 'semana_inicio', label: 'Semana Inicio', type: 'date' },
  { key: 'semana_fin', label: 'Semana Fin', type: 'date' },
  { key: 'ingest_run_id', label: 'Run de Ingesta', type: 'readonly', group: 'Metadata' },
  { key: 'created_at', label: 'Fecha de Creación', type: 'readonly' },
];
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, ReferenceLine, PieChart, Pie, Cell,
} from 'recharts';

export function CashflowDashboard() {
  const [loading, setLoading] = useState(true);
  const [cxpAll, setCxpAll] = useState<CxPItem[]>([]);
  const [flujoAll, setFlujoAll] = useState<FlujoItem[]>([]);
  const [projection, setProjection] = useState<Projection[]>([]);
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [detailRecord, setDetailRecord] = useState<Record<string, unknown> | null>(null);
  const [detailType, setDetailType] = useState<'cxp' | 'flujo'>('cxp');
  const [buFilter, setBuFilter] = useState<string>('all');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [c, f, p] = await Promise.all([
        querySQL(`SELECT empresa, proveedor, monto_usd, vencimiento_fecha, prioridad, clasificacion, negocio, responsable, detalle, created_at, ingest_run_id FROM silver_finance.cxp_items ORDER BY vencimiento_fecha`),
        querySQL(`SELECT compania, cuota, principal, intereses, vencimiento, banco, tipo, operacion, saldo_original, capital, capital_actualizado, moneda, semana_inicio, semana_fin, created_at, ingest_run_id FROM silver_finance.flujo_semanal ORDER BY vencimiento`),
        querySQL(`SELECT projection_month, projected_inflows, projected_outflows, projected_balance FROM silver_finance.projection_12m ORDER BY projection_month`),
      ]);
      setCxpAll(c); setFlujoAll(f); setProjection(p);
      setLastRefresh(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── BU list ────────────────────────────────────────────────────────────────
  const allBUs = useMemo(() => {
    const s = new Set<string>();
    cxpAll.forEach(r => { if (r.empresa) s.add(r.empresa); });
    flujoAll.forEach(r => { if (r.compania) s.add(r.compania); });
    return Array.from(s).sort();
  }, [cxpAll, flujoAll]);

  // ── Filter ─────────────────────────────────────────────────────────────────
  const cutoff = getDateCutoff(period);
  const cxp = useMemo(() => {
    let d = cxpAll;
    if (cutoff) d = d.filter(r => (r.vencimiento_fecha || r.created_at) >= cutoff);
    if (buFilter !== 'all') d = d.filter(r => r.empresa === buFilter);
    return d;
  }, [cxpAll, cutoff, buFilter]);
  const flujo = useMemo(() => {
    let d = flujoAll;
    if (cutoff) d = d.filter(r => (r.vencimiento || r.created_at) >= cutoff);
    if (buFilter !== 'all') d = d.filter(r => r.compania === buFilter);
    return d;
  }, [flujoAll, cutoff, buFilter]);

  const now = new Date();

  // ── Core Metrics ───────────────────────────────────────────────────────────
  const totalCxP = cxp.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0);
  const totalInflows = flujo.reduce((s, r) => s + (Number(r.cuota) || 0), 0);
  const netCashflow = totalInflows - totalCxP;
  const ratio = totalCxP > 0 ? totalInflows / totalCxP : totalInflows > 0 ? 99 : 0;

  // ── Process KPIs (from documentation gaps) ─────────────────────────────────
  // KPI-01: DSO proxy (avg days vencimiento_fecha - created_at for CxP)
  const dsoProxy = useMemo(() => {
    const items = cxp.filter(r => r.vencimiento_fecha && r.created_at);
    if (!items.length) return 0;
    const total = items.reduce((s, r) => {
      const diff = (new Date(r.vencimiento_fecha).getTime() - new Date(r.created_at).getTime()) / 86400000;
      return s + Math.abs(diff);
    }, 0);
    return total / items.length;
  }, [cxp]);

  // KPI-03: % CxP blocked = overdue CxP items / total (proxy for gate issues)
  const overdueCxP = cxp.filter(r => r.vencimiento_fecha && new Date(r.vencimiento_fecha) < now);
  const overdueRate = cxp.length > 0 ? (overdueCxP.length / cxp.length) * 100 : 0;
  const overdueAmount = overdueCxP.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0);

  // KPI-05: Aging buckets
  const agingBuckets = useMemo(() => {
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '181+': 0 };
    const counts = { '0-30': 0, '31-60': 0, '61-90': 0, '91-180': 0, '181+': 0 };
    cxp.forEach(r => {
      if (!r.vencimiento_fecha) return;
      const days = Math.max(0, (now.getTime() - new Date(r.vencimiento_fecha).getTime()) / 86400000);
      const amt = Number(r.monto_usd) || 0;
      if (days <= 30) { buckets['0-30'] += amt; counts['0-30']++; }
      else if (days <= 60) { buckets['31-60'] += amt; counts['31-60']++; }
      else if (days <= 90) { buckets['61-90'] += amt; counts['61-90']++; }
      else if (days <= 180) { buckets['91-180'] += amt; counts['91-180']++; }
      else { buckets['181+'] += amt; counts['181+']++; }
    });
    return Object.entries(buckets).map(([label, monto]) => ({ label, monto, count: counts[label as keyof typeof counts] }));
  }, [cxp]);

  // CxP by priority with amounts
  const cxpByPriorityDetail = useMemo(() => {
    const map: Record<string, { label: string; monto: number; count: number }> = {};
    cxp.forEach(r => {
      const p = String(r.prioridad || '').replace(/[^0-9]/g, '') || '0';
      const lbl = p === '1' ? 'P1 Urgente' : p === '2' ? 'P2 Esta semana' : p === '3' ? 'P3 Próximo' : 'Sin prioridad';
      if (!map[lbl]) map[lbl] = { label: lbl, monto: 0, count: 0 };
      map[lbl].monto += Number(r.monto_usd) || 0;
      map[lbl].count++;
    });
    return Object.values(map).sort((a, b) => b.monto - a.monto);
  }, [cxp]);

  // ── Monthly cashflow (real vs projected) ───────────────────────────────────
  const monthlyReal = useMemo(() => {
    const m: Record<string, { month: string; ingresos: number; egresos: number }> = {};
    flujo.forEach(r => { const k = (r.vencimiento || r.created_at || '').slice(0, 7); if (!k) return; if (!m[k]) m[k] = { month: k, ingresos: 0, egresos: 0 }; m[k].ingresos += Number(r.cuota) || 0; });
    cxp.forEach(r => { const k = (r.vencimiento_fecha || r.created_at || '').slice(0, 7); if (!k) return; if (!m[k]) m[k] = { month: k, ingresos: 0, egresos: 0 }; m[k].egresos += Number(r.monto_usd) || 0; });
    return m;
  }, [cxp, flujo]);

  const combinedChart = useMemo(() => {
    const all: { month: string; label: string; real_in: number; real_out: number; real_net: number; proj_in: number; proj_out: number; proj_bal: number }[] = [];
    const keys = new Set([...Object.keys(monthlyReal), ...projection.map(p => p.projection_month.slice(0, 7))]);
    keys.forEach(k => {
      const real = monthlyReal[k];
      const proj = projection.find(p => p.projection_month.slice(0, 7) === k);
      all.push({
        month: k, label: formatMonthYear(k + '-01'),
        real_in: real?.ingresos || 0, real_out: real?.egresos || 0,
        real_net: (real?.ingresos || 0) - (real?.egresos || 0),
        proj_in: Number(proj?.projected_inflows) || 0, proj_out: Number(proj?.projected_outflows) || 0,
        proj_bal: Number(proj?.projected_balance) || 0,
      });
    });
    return all.sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyReal, projection]);

  // ── BU breakdown ───────────────────────────────────────────────────────────
  const buBreakdown = useMemo(() => {
    const m: Record<string, { bu: string; ingresos: number; egresos: number; neto: number; cxpCount: number; flujoCount: number }> = {};
    flujo.forEach(r => { const b = r.compania || 'Sin BU'; if (!m[b]) m[b] = { bu: b, ingresos: 0, egresos: 0, neto: 0, cxpCount: 0, flujoCount: 0 }; m[b].ingresos += Number(r.cuota) || 0; m[b].flujoCount++; });
    cxp.forEach(r => { const b = r.empresa || 'Sin BU'; if (!m[b]) m[b] = { bu: b, ingresos: 0, egresos: 0, neto: 0, cxpCount: 0, flujoCount: 0 }; m[b].egresos += Number(r.monto_usd) || 0; m[b].cxpCount++; });
    return Object.values(m).map(v => ({ ...v, neto: v.ingresos - v.egresos })).sort((a, b) => b.neto - a.neto);
  }, [cxp, flujo]);

  // CxP by classification (donut)
  const clasifData = useMemo(() => {
    const m: Record<string, number> = {};
    cxp.forEach(r => { const c = r.clasificacion || 'Sin clasificación'; m[c] = (m[c] || 0) + (Number(r.monto_usd) || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([name, value]) => ({ name: name.length > 18 ? name.slice(0, 15) + '...' : name, value }));
  }, [cxp]);
  const DONUT_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.orange, ARA_COLORS.red, ARA_COLORS.gray, '#8B5CF6'];

  // Top proveedores
  const topProv = useMemo(() => {
    const m: Record<string, number> = {};
    cxp.forEach(r => { const p = r.proveedor || 'Desconocido'; m[p] = (m[p] || 0) + (Number(r.monto_usd) || 0); });
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, total]) => ({ name: name.length > 25 ? name.slice(0, 22) + '...' : name, total }));
  }, [cxp]);

  // CxP next 4 weeks
  const weekBuckets = useMemo(() => {
    const weeks: { label: string; p1: number; p2: number; p3: number; other: number }[] = [];
    for (let w = 0; w < 4; w++) {
      const start = new Date(now); start.setDate(start.getDate() + w * 7);
      const end = new Date(start); end.setDate(end.getDate() + 6);
      const b = { label: `Sem ${w + 1}`, p1: 0, p2: 0, p3: 0, other: 0 };
      cxp.forEach(r => {
        const d = new Date(r.vencimiento_fecha);
        if (d >= start && d <= end) {
          const p = String(r.prioridad || '').replace(/[^0-9]/g, '');
          const amt = Number(r.monto_usd) || 0;
          if (p === '1') b.p1 += amt; else if (p === '2') b.p2 += amt; else if (p === '3') b.p3 += amt; else b.other += amt;
        }
      });
      weeks.push(b);
    }
    return weeks;
  }, [cxp]);

  // ── Insights (process gap-driven) ──────────────────────────────────────────
  const insights: { type: 'insight' | 'risk' | 'action'; text: string }[] = [];
  if (overdueRate > 30) insights.push({ type: 'risk', text: `KPI-06 Mora: ${overdueRate.toFixed(0)}% de CxP vencidas (${overdueCxP.length} items = ${formatCompactCurrency(overdueAmount)}). R4: Reacción tardía — activar micro-ciclo diario.` });
  else if (overdueRate > 10) insights.push({ type: 'risk', text: `${overdueRate.toFixed(0)}% CxP vencidas. ${formatCompactCurrency(overdueAmount)} en mora. Revisar aging y gestión de cobro.` });
  if (dsoProxy > 45) insights.push({ type: 'risk', text: `KPI-01 DSO proxy: ${dsoProxy.toFixed(0)} días. R7: Conciliación manual lenta — considerar matching semi-automático (FR-04).` });
  else if (dsoProxy > 0) insights.push({ type: 'insight', text: `KPI-01 DSO proxy: ${dsoProxy.toFixed(0)} días promedio de vencimiento.` });
  if (ratio < 1) insights.push({ type: 'risk', text: `Déficit de cashflow: CxP (${formatCompactCurrency(totalCxP)}) > Ingresos (${formatCompactCurrency(totalInflows)}). Gap: ${formatCompactCurrency(totalCxP - totalInflows)}.` });
  else if (ratio < 1.5) insights.push({ type: 'risk', text: `Ratio cobertura ajustado: ${ratio.toFixed(2)}x. Margen limitado para imprevistos.` });
  else insights.push({ type: 'insight', text: `Cobertura saludable: ${ratio.toFixed(2)}x (Ingresos / CxP).` });
  const agingHigh = agingBuckets.filter(b => b.label !== '0-30').reduce((s, b) => s + b.monto, 0);
  if (agingHigh > totalCxP * 0.3 && totalCxP > 0) insights.push({ type: 'risk', text: `KPI-05 Aging: ${((agingHigh / totalCxP) * 100).toFixed(0)}% de CxP con >30 días. R4/R6: Degradación de cartera — escalar top morosos.` });
  if (topProv.length >= 3 && totalCxP > 0) {
    const top3 = topProv.slice(0, 3).reduce((s, p) => s + p.total, 0) / totalCxP * 100;
    if (top3 > 50) insights.push({ type: 'risk', text: `Concentración CxP: Top 3 proveedores = ${top3.toFixed(0)}%. R10: Dependencia.` });
  }
  if (buBreakdown.some(b => b.neto < 0)) {
    const neg = buBreakdown.filter(b => b.neto < 0);
    insights.push({ type: 'action', text: `${neg.length} BU(s) con cashflow negativo: ${neg.map(b => `${b.bu} (${formatCompactCurrency(b.neto)})`).join(', ')}.` });
  }
  if (cxpAll.length === 0 && flujoAll.length === 0) insights.push({ type: 'action', text: 'Sin datos. Ingesta archivos Excel en Fuentes de Datos.' });

  const hasData = cxpAll.length > 0 || flujoAll.length > 0;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Cashflow — Vista Detallada</h1>
            <p className="text-gray-500 mt-1 text-sm">Real vs Proyectado · Aging · CxP · KPIs de Proceso · Filtro por BU ($ USD)</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* BU Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-gray-400" />
              <select value={buFilter} onChange={e => setBuFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28]">
                <option value="all">Todas las BU</option>
                {allBUs.map(bu => <option key={bu} value={bu}>{bu}</option>)}
              </select>
            </div>
            {/* Period */}
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${period === p ? 'bg-[#1A4A28] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-gray-400 hidden lg:block">{lastRefresh.toLocaleTimeString('es-CR')}</span>
            <button onClick={fetchData} disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#1A4A28] bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading && !hasData ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400"><LoadingSpinner size="lg" /><p className="mt-4 text-sm">Cargando cashflow...</p></div>
        ) : (
          <>
            {/* KPIs Row 1: Cashflow */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KPICard title="Total CxP" value={totalCxP} icon={CreditCard} semaphore={semaphore(totalCxP, 100000, 500000, true)} subtitle={`${cxp.length} facturas`} />
              <KPICard title="Ingresos (Cuotas)" value={totalInflows} icon={Wallet} semaphore={totalInflows > 0 ? 'green' : 'red'} subtitle={`${flujo.length} operaciones`} />
              <KPICard title="Cashflow Neto" value={netCashflow} icon={netCashflow >= 0 ? TrendingUp : TrendingDown} semaphore={semaphore(netCashflow, 0, -50000)} subtitle={netCashflow >= 0 ? 'Superávit' : 'Déficit'} />
              <KPICard title="Ratio Cobertura" value={ratio} icon={ShieldCheck} format="number" semaphore={semaphore(ratio, 1.5, 1.0)} subtitle="Ingresos / CxP" />
              <KPICard title="DSO Proxy" value={dsoProxy} icon={Clock} format="number" semaphore={semaphore(dsoProxy, 30, 45, true)} subtitle="Días promedio" />
              <KPICard title="% Mora" value={overdueRate} icon={AlertOctagon} format="number" semaphore={semaphore(overdueRate, 10, 30, true)} subtitle={`${overdueCxP.length} vencidas`} />
            </div>

            {/* Real vs Projected */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="w-4 h-4 text-[#1A4A28]" />Cashflow Real vs Proyectado ($){buFilter !== 'all' && <Badge variant="info">{buFilter}</Badge>}</CardTitle></CardHeader>
              <CardContent>
                {combinedChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height={360}>
                    <ComposedChart data={combinedChart}>
                      <defs>
                        <linearGradient id="cfBal" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={ARA_COLORS.primary} stopOpacity={0.15} /><stop offset="95%" stopColor={ARA_COLORS.primary} stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" label={{ value: '$0', fill: ARA_COLORS.red, fontSize: 10 }} />
                      <Bar dataKey="real_in" fill={ARA_COLORS.primary} name="Ingresos Real $" radius={[2, 2, 0, 0]} opacity={0.7} />
                      <Bar dataKey="real_out" fill={ARA_COLORS.red} name="Egresos Real $" radius={[2, 2, 0, 0]} opacity={0.5} />
                      <Line type="monotone" dataKey="proj_bal" stroke={ARA_COLORS.gold} strokeWidth={2} strokeDasharray="6 3" name="Balance Proyectado $" dot={{ r: 3 }} />
                      <Area type="monotone" dataKey="real_net" stroke={ARA_COLORS.blue} strokeWidth={1.5} fill="url(#cfBal)" name="Neto Real $" />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <EmptyState text="Sin datos de cashflow." />}
              </CardContent>
            </Card>

            {/* Aging + Priority */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock className="w-4 h-4 text-[#1A4A28]" />KPI-05: Aging de CxP ($) — Salud de Cartera</CardTitle></CardHeader>
                <CardContent>
                  {agingBuckets.some(b => b.monto > 0) ? (
                    <>
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={agingBuckets}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                          <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                          <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                          <Bar dataKey="monto" name="Monto $" radius={[4, 4, 0, 0]}>
                            {agingBuckets.map((b, i) => <Cell key={i} fill={i === 0 ? ARA_COLORS.primary : i === 1 ? ARA_COLORS.gold : i === 2 ? ARA_COLORS.orange : ARA_COLORS.red} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="grid grid-cols-5 gap-2 mt-3">
                        {agingBuckets.map((b, i) => (
                          <div key={b.label} className={`text-center p-2 rounded-lg ${i <= 1 ? 'bg-emerald-50' : i === 2 ? 'bg-amber-50' : 'bg-red-50'}`}>
                            <p className="text-[10px] text-gray-500 font-medium">{b.label} días</p>
                            <p className="text-xs font-bold">{formatCompactCurrency(b.monto)}</p>
                            <p className="text-[9px] text-gray-400">{b.count} items</p>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <EmptyState text="Sin datos de aging." />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CreditCard className="w-4 h-4 text-red-600" />CxP Próximas 4 Semanas por Prioridad ($)</CardTitle></CardHeader>
                <CardContent>
                  {weekBuckets.some(w => w.p1 + w.p2 + w.p3 + w.other > 0) ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={weekBuckets}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="p1" stackId="a" fill={ARA_COLORS.red} name="P1 Urgente" />
                        <Bar dataKey="p2" stackId="a" fill={ARA_COLORS.orange} name="P2 Esta semana" />
                        <Bar dataKey="p3" stackId="a" fill={ARA_COLORS.gold} name="P3 Próximo" />
                        <Bar dataKey="other" stackId="a" fill={ARA_COLORS.gray} name="Sin prioridad" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin CxP en las próximas 4 semanas." />}
                </CardContent>
              </Card>
            </div>

            {/* BU Breakdown + Clasificación */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="w-4 h-4 text-[#1A4A28]" />Cashflow Neto por Unidad de Negocio ($)</CardTitle></CardHeader>
                <CardContent>
                  {buBreakdown.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={buBreakdown.map(b => ({ ...b, bu: b.bu.length > 18 ? b.bu.slice(0, 15) + '...' : b.bu }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="bu" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" />
                        <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos $" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos $" radius={[3, 3, 0, 0]} opacity={0.6} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos por BU." />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Wallet className="w-4 h-4 text-[#1A4A28]" />CxP por Clasificación</CardTitle></CardHeader>
                <CardContent>
                  {clasifData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={clasifData} cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={3} dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 9 }}>
                          {clasifData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin clasificaciones." />}
                </CardContent>
              </Card>
            </div>

            {/* Top Proveedores + Priority summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="w-4 h-4 text-[#1A4A28]" />Top Proveedores CxP — Pareto ($)</CardTitle></CardHeader>
                <CardContent>
                  {topProv.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={topProv} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={9} width={130} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Bar dataKey="total" fill={ARA_COLORS.primary} name="Monto $" radius={[0, 4, 4, 0]} barSize={16} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin proveedores." />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-orange-500" />Distribución por Prioridad de Pago ($)</CardTitle></CardHeader>
                <CardContent>
                  {cxpByPriorityDetail.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={cxpByPriorityDetail}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                          <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                          <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                          <Bar dataKey="monto" name="Monto $" radius={[4, 4, 0, 0]}>
                            {cxpByPriorityDetail.map((_, i) => <Cell key={i} fill={[ARA_COLORS.red, ARA_COLORS.orange, ARA_COLORS.gold, ARA_COLORS.gray][i] || ARA_COLORS.gray} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        {cxpByPriorityDetail.map((p, i) => (
                          <div key={p.label} className={`flex items-center justify-between text-xs p-2 rounded-lg ${i === 0 ? 'bg-red-50' : i === 1 ? 'bg-orange-50' : i === 2 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                            <span className="font-medium">{p.label}</span>
                            <span className="tabular-nums font-semibold">{formatCompactCurrency(p.monto)} ({p.count})</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <EmptyState text="Sin datos de prioridad." />}
                </CardContent>
              </Card>
            </div>

            {/* CxP detail table */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-orange-500" />Detalle CxP — Pagos Prioritarios ($){buFilter !== 'all' && <Badge variant="info">{buFilter}</Badge>}</CardTitle></CardHeader>
              <CardContent>
                {cxp.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                        <th className="pb-2 pr-3">Proveedor</th><th className="pb-2 pr-3">Empresa</th><th className="pb-2 pr-3 text-right">Monto $</th>
                        <th className="pb-2 pr-3">Vencimiento</th><th className="pb-2 pr-3">Prioridad</th><th className="pb-2 pr-3">Clasificación</th><th className="pb-2">Negocio</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {cxp.slice(0, 20).map((item, idx) => {
                          const isOverdue = new Date(item.vencimiento_fecha) < now;
                          return (
                            <tr key={idx} className="hover:bg-gray-50/50 cursor-pointer" onDoubleClick={() => { setDetailType('cxp'); setDetailRecord(item as unknown as Record<string, unknown>); }} title="Doble clic para ver/editar detalle">
                              <td className="py-2 pr-3 font-medium text-gray-900 max-w-[180px] truncate text-xs">{item.proveedor || '—'}</td>
                              <td className="py-2 pr-3 text-gray-600 text-xs">{item.empresa || '—'}</td>
                              <td className="py-2 pr-3 text-right font-semibold tabular-nums text-xs">{formatCurrency(Number(item.monto_usd) || 0)}</td>
                              <td className={`py-2 pr-3 text-xs ${isOverdue ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                                {item.vencimiento_fecha ? formatShortDate(item.vencimiento_fecha) : '—'}
                                {isOverdue && <span className="ml-1 text-[8px] bg-red-100 text-red-700 px-1 rounded">VENCIDO</span>}
                              </td>
                              <td className="py-2 pr-3"><Badge variant={String(item.prioridad).includes('1') ? 'error' : String(item.prioridad).includes('2') ? 'warning' : 'default'}>{getPriorityLabel(item.prioridad)}</Badge></td>
                              <td className="py-2 pr-3 text-gray-500 text-xs">{item.clasificacion || '—'}</td>
                              <td className="py-2 text-gray-500 text-xs">{item.negocio || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {cxp.length > 20 && <p className="text-xs text-gray-400 mt-2 text-center">Mostrando 20 de {cxp.length}.</p>}
                    <p className="text-xs text-gray-400 mt-1 text-center italic">Doble clic en una fila para ver/editar detalle completo</p>
                  </div>
                ) : <EmptyState text="Sin CxP." />}
              </CardContent>
            </Card>

            {/* Ingresos (Flujo) detail table */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Banknote className="w-4 h-4 text-emerald-600" />Detalle de Ingresos — Cuotas y Operaciones{buFilter !== 'all' && <Badge variant="info">{buFilter}</Badge>}</CardTitle></CardHeader>
              <CardContent>
                {flujo.length > 0 ? (
                  <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white z-10"><tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                        <th className="pb-2 pr-3">Operación</th><th className="pb-2 pr-3">Compañía</th><th className="pb-2 pr-3">Banco</th>
                        <th className="pb-2 pr-3">Tipo</th><th className="pb-2 pr-3 text-right">Cuota</th><th className="pb-2 pr-3 text-right">Principal</th>
                        <th className="pb-2 pr-3 text-right">Intereses</th><th className="pb-2 pr-3">Vencimiento</th><th className="pb-2">Moneda</th>
                      </tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {flujo.slice(0, 50).map((item, idx) => {
                          const cuota = Number(item.cuota) || 0;
                          const cur = normalizeCurrency(item.moneda);
                          const isLarge = cuota >= (cur === 'CRC' ? 50000000 : 100000);
                          return (
                            <tr key={idx} className="hover:bg-emerald-50/40 cursor-pointer" onDoubleClick={() => { setDetailType('flujo'); setDetailRecord(item as unknown as Record<string, unknown>); }} title="Doble clic para ver/editar detalle">
                              <td className="py-2 pr-3 font-medium text-gray-900 max-w-[200px] truncate text-xs" title={item.operacion || ''}>{item.operacion || '—'}</td>
                              <td className="py-2 pr-3 text-gray-600 text-xs max-w-[140px] truncate" title={item.compania || ''}>{item.compania || '—'}</td>
                              <td className="py-2 pr-3 text-gray-600 text-xs">{item.banco || '—'}</td>
                              <td className="py-2 pr-3"><Badge variant={item.tipo === 'Largo Plazo' ? 'success' : item.tipo === 'Capital Trabajo' ? 'warning' : 'default'}>{item.tipo || '—'}</Badge></td>
                              <td className={`py-2 pr-3 text-right font-semibold tabular-nums text-xs ${isLarge ? 'text-emerald-700' : ''}`}>{formatCurrency(cuota, cur)}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-xs text-gray-600">{formatCurrency(Number(item.principal) || 0, cur)}</td>
                              <td className="py-2 pr-3 text-right tabular-nums text-xs text-gray-500">{formatCurrency(Number(item.intereses) || 0, cur)}</td>
                              <td className="py-2 pr-3 text-xs text-gray-600">{item.vencimiento ? formatShortDate(item.vencimiento) : '—'}</td>
                              <td className="py-2 text-xs"><Badge variant={cur === 'USD' ? 'info' : 'default'}>{cur}</Badge></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {flujo.length > 50 && <p className="text-xs text-gray-400 mt-2 text-center">Mostrando 50 de {flujo.length} registros.</p>}
                    <p className="text-xs text-gray-400 mt-1 text-center italic">Doble clic en una fila para ver/editar detalle completo</p>
                  </div>
                ) : <EmptyState text='Sin ingresos. Ingesta "Flujo Semanal" o "Control de Operaciones" en Fuentes de Datos.' />}
              </CardContent>
            </Card>

            {/* Process-Gap Narrative */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="w-4 h-4 text-[#C9A84C]" />Hallazgos de Proceso — KPIs & Riesgos (AS-IS)</CardTitle></CardHeader>
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
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{item.type === 'risk' ? 'Riesgo Proceso' : item.type === 'action' ? 'Acción' : 'Hallazgo'}</span>
                          <p className="text-sm text-gray-800 mt-0.5">{item.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-400 text-center py-6">Insights basados en KPIs de proceso se generan al cargar datos.</p>}
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-4 flex-wrap">
                <span>{cxp.length} CxP</span><span>{flujo.length} ingresos/operaciones</span>
                <span>{projection.length} meses proyección</span>
                <span>BU: {buFilter === 'all' ? 'Todas' : buFilter}</span>
                <span>Divisa: $ USD</span>
              </div>
              <span>CVE Treasury Copilot — ARA Group</span>
            </div>
          </>
        )}
      </div>

      {/* Record Detail Modal — CxP or Flujo */}
      <RecordDetailModal
        open={!!detailRecord}
        onClose={() => setDetailRecord(null)}
        title={detailType === 'cxp' ? 'Detalle Cuenta por Pagar' : 'Detalle Ingreso / Operación'}
        subtitle={
          detailRecord
            ? detailType === 'cxp'
              ? `${(detailRecord as Record<string, unknown>).proveedor || ''} — ${(detailRecord as Record<string, unknown>).empresa || ''}`
              : `${(detailRecord as Record<string, unknown>).operacion || ''} — ${(detailRecord as Record<string, unknown>).banco || ''}`
            : ''
        }
        record={detailRecord}
        fields={detailType === 'cxp' ? CXP_FIELDS : FLUJO_FIELDS}
        schema="silver_finance"
        table={detailType === 'cxp' ? 'cxp_items' : 'flujo_semanal'}
        onSaved={fetchData}
      />
    </Layout>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex flex-col items-center justify-center py-10 text-gray-400"><BarChart3 className="w-8 h-8 mb-2 opacity-30" /><p className="text-xs text-center max-w-xs">{text}</p></div>;
}
