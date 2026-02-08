import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Clock, Building2,
  ShieldCheck, Lightbulb, RefreshCw, BarChart3, Wallet, CreditCard, Landmark,
  CalendarDays, Target, History, Layers, Activity, Percent, BanknoteIcon,
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  formatCurrency, formatCompactCurrency, formatMonthYear, formatShortDate,
  semaphore, ARA_COLORS, getPriorityLabel, formatDate,
} from '../lib/utils';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ComposedChart, Line, ReferenceLine,
} from 'recharts';

// ── Data fetching ──────────────────────────────────────────────────────────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function querySQL(sql: string) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/treasury-tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ tool: 'query_sql', params: { sql } }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.rows || [];
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface CxPItem {
  empresa: string; proveedor: string; monto_usd: number;
  vencimiento_fecha: string; prioridad: string; clasificacion: string;
  created_at: string; ingest_run_id: string;
}
interface FlujoItem {
  compania: string; cuota: number; principal: number; intereses: number;
  vencimiento: string; banco: string; tipo: string; operacion: string;
  saldo_original: number; capital: number; capital_actualizado: number;
  moneda: string; semana_inicio: string; semana_fin: string;
  created_at: string; ingest_run_id: string;
}
interface Projection {
  projection_month: string; projected_inflows: number;
  projected_outflows: number; projected_balance: number;
}
interface IngestRun {
  id: string; source_file: string; status: string;
  rows_inserted: number; created_at: string;
}

type TimePeriod = '1m' | '3m' | '6m' | '12m' | 'all';

function getDateCutoff(period: TimePeriod): string | null {
  if (period === 'all') return null;
  const d = new Date();
  const months = period === '1m' ? 1 : period === '3m' ? 3 : period === '6m' ? 6 : 12;
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

const CREDIT_COLORS = ['#1A4A28', '#2D6A3F', '#C9A84C', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16'];
const TIPO_COLORS: Record<string, string> = {
  'Largo Plazo': '#1A4A28',
  'Capital Trabajo': '#C9A84C',
  'Tarjeta': '#3B82F6',
};

// ── Dashboard ──────────────────────────────────────────────────────────────────
export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [cxpAll, setCxpAll] = useState<CxPItem[]>([]);
  const [flujoAll, setFlujoAll] = useState<FlujoItem[]>([]);
  const [projection, setProjection] = useState<Projection[]>([]);
  const [ingestRuns, setIngestRuns] = useState<IngestRun[]>([]);
  const [period, setPeriod] = useState<TimePeriod>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cxpR, flujoR, projR, ingestR] = await Promise.all([
        querySQL(`SELECT empresa, proveedor, monto_usd, vencimiento_fecha, prioridad, clasificacion, created_at, ingest_run_id FROM silver_finance.cxp_items ORDER BY vencimiento_fecha`),
        querySQL(`SELECT compania, cuota, principal, intereses, vencimiento, banco, tipo, operacion, saldo_original, capital, capital_actualizado, moneda, semana_inicio, semana_fin, created_at, ingest_run_id FROM silver_finance.flujo_semanal ORDER BY vencimiento`),
        querySQL(`SELECT projection_month, projected_inflows, projected_outflows, projected_balance FROM silver_finance.projection_12m ORDER BY projection_month`),
        querySQL(`SELECT id, source_file, status, rows_inserted, created_at FROM bronze_finance.ingest_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 50`),
      ]);
      setCxpAll(cxpR);
      setFlujoAll(flujoR);
      setProjection(projR);
      setIngestRuns(ingestR);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Dashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Filter by time period ──────────────────────────────────────────────────
  const cutoff = getDateCutoff(period);
  const cxp = useMemo(() => {
    if (!cutoff) return cxpAll;
    return cxpAll.filter(r => (r.vencimiento_fecha || r.created_at) >= cutoff);
  }, [cxpAll, cutoff]);
  const flujo = useMemo(() => {
    if (!cutoff) return flujoAll;
    return flujoAll.filter(r => (r.vencimiento || r.created_at) >= cutoff);
  }, [flujoAll, cutoff]);

  // ── Derived metrics ────────────────────────────────────────────────────────
  const totalCxP = cxp.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0);
  const totalFlujoInflows = flujo.reduce((s, r) => s + (Number(r.cuota) || 0), 0);
  const totalPrincipal = flujo.reduce((s, r) => s + (Number(r.principal) || 0), 0);
  const totalIntereses = flujo.reduce((s, r) => s + (Number(r.intereses) || 0), 0);
  const totalSaldoOriginal = flujo.reduce((s, r) => s + (Number(r.saldo_original) || 0), 0);
  const totalCapitalAct = flujo.reduce((s, r) => s + (Number(r.capital_actualizado) || 0), 0);
  const netCashflow = totalFlujoInflows - totalCxP;

  // Projection-based
  const runwayMonths = projection.filter(p => Number(p.projected_balance) > 0).length;
  const runwaySemaphore = semaphore(runwayMonths, 6, 3);
  const ratio = totalCxP > 0 ? totalFlujoInflows / totalCxP : totalFlujoInflows > 0 ? 99 : 0;
  const ratioSemaphore = semaphore(ratio, 1.5, 1.0);

  // ── Credit operations analytics ────────────────────────────────────────────
  const uniqueOperations = useMemo(() => {
    const ops = new Map<string, FlujoItem>();
    flujo.forEach(r => {
      const key = `${r.compania}|${r.operacion}|${r.banco}`;
      if (!ops.has(key) || (Number(r.saldo_original) || 0) > (Number(ops.get(key)!.saldo_original) || 0)) {
        ops.set(key, r);
      }
    });
    return Array.from(ops.values());
  }, [flujo]);

  const uniqueBanks = useMemo(() => new Set(flujo.map(r => r.banco).filter(Boolean)), [flujo]);
  const uniqueCompanies = useMemo(() => new Set(flujo.map(r => r.compania).filter(Boolean)), [flujo]);

  // Ratio intereses vs principal
  const interestRatio = totalPrincipal > 0 ? (totalIntereses / totalPrincipal) * 100 : 0;

  // ── Operaciones por Tipo (Largo Plazo vs Capital Trabajo) ──────────────────
  const opsByTipo = useMemo(() => {
    const byType: Record<string, { tipo: string; cuota: number; principal: number; intereses: number; saldo: number; count: number }> = {};
    flujo.forEach(r => {
      const t = r.tipo || 'Otro';
      if (!byType[t]) byType[t] = { tipo: t, cuota: 0, principal: 0, intereses: 0, saldo: 0, count: 0 };
      byType[t].cuota += Number(r.cuota) || 0;
      byType[t].principal += Number(r.principal) || 0;
      byType[t].intereses += Number(r.intereses) || 0;
      byType[t].saldo += Number(r.saldo_original) || 0;
      byType[t].count++;
    });
    return Object.values(byType).sort((a, b) => b.cuota - a.cuota);
  }, [flujo]);

  // ── Principal vs Intereses by Banco ────────────────────────────────────────
  const bancoComposition = useMemo(() => {
    const byBank: Record<string, { banco: string; principal: number; intereses: number; cuota: number; saldo: number }> = {};
    flujo.forEach(r => {
      const b = r.banco || 'Sin banco';
      if (!byBank[b]) byBank[b] = { banco: b, principal: 0, intereses: 0, cuota: 0, saldo: 0 };
      byBank[b].principal += Number(r.principal) || 0;
      byBank[b].intereses += Number(r.intereses) || 0;
      byBank[b].cuota += Number(r.cuota) || 0;
      byBank[b].saldo += Number(r.saldo_original) || 0;
    });
    return Object.values(byBank).sort((a, b) => b.cuota - a.cuota).slice(0, 10);
  }, [flujo]);

  // ── Timeline / Gantt of credit lines ───────────────────────────────────────
  const ganttData = useMemo(() => {
    // Group by operacion (credit line) and compute date ranges
    const lines: {
      id: string; operacion: string; compania: string; banco: string; tipo: string;
      start: string; end: string; saldo: number; cuotaTotal: number; moneda: string;
      startMs: number; endMs: number;
    }[] = [];

    const opMap = new Map<string, FlujoItem[]>();
    flujo.forEach(r => {
      const key = `${r.compania}|${r.operacion}|${r.banco}`;
      if (!opMap.has(key)) opMap.set(key, []);
      opMap.get(key)!.push(r);
    });

    opMap.forEach((items, key) => {
      const dates = items.map(i => i.vencimiento || i.created_at).filter(Boolean).sort();
      if (dates.length === 0) return;
      const firstItem = items[0];
      const start = dates[0];
      const end = dates[dates.length - 1];
      lines.push({
        id: key,
        operacion: firstItem.operacion || '—',
        compania: firstItem.compania || '—',
        banco: firstItem.banco || '—',
        tipo: firstItem.tipo || '—',
        start, end,
        saldo: Math.max(...items.map(i => Number(i.saldo_original) || 0)),
        cuotaTotal: items.reduce((s, i) => s + (Number(i.cuota) || 0), 0),
        moneda: firstItem.moneda || 'CRC',
        startMs: new Date(start).getTime(),
        endMs: new Date(end).getTime(),
      });
    });

    return lines.sort((a, b) => a.startMs - b.startMs);
  }, [flujo]);

  // Gantt date boundaries
  const ganttMinDate = ganttData.length > 0 ? Math.min(...ganttData.map(g => g.startMs)) : Date.now();
  const ganttMaxDate = ganttData.length > 0 ? Math.max(...ganttData.map(g => g.endMs)) : Date.now();
  const ganttSpan = Math.max(ganttMaxDate - ganttMinDate, 1);
  const nowMs = Date.now();

  // ── Longitudinal: Saldo vs Capital Actualizado evolution by month ──────────
  const capitalEvolution = useMemo(() => {
    const months: Record<string, { month: string; saldo_original: number; capital_actualizado: number; principal: number; intereses: number }> = {};
    flujo.forEach(r => {
      const key = (r.vencimiento || r.created_at || '').slice(0, 7);
      if (!key) return;
      if (!months[key]) months[key] = { month: key, saldo_original: 0, capital_actualizado: 0, principal: 0, intereses: 0 };
      months[key].saldo_original += Number(r.saldo_original) || 0;
      months[key].capital_actualizado += Number(r.capital_actualizado) || 0;
      months[key].principal += Number(r.principal) || 0;
      months[key].intereses += Number(r.intereses) || 0;
    });
    return Object.values(months)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, label: formatMonthYear(m.month + '-01') }));
  }, [flujo]);

  // ── Operations by Moneda (CRC vs USD) ──────────────────────────────────────
  const byMoneda = useMemo(() => {
    const map: Record<string, { moneda: string; cuota: number; count: number }> = {};
    flujo.forEach(r => {
      const m = (r.moneda || 'CRC').toUpperCase().includes('DOL') || (r.moneda || '').toUpperCase().includes('USD') ? 'USD' : 'CRC';
      if (!map[m]) map[m] = { moneda: m, cuota: 0, count: 0 };
      map[m].cuota += Number(r.cuota) || 0;
      map[m].count++;
    });
    return Object.values(map);
  }, [flujo]);

  // ── Historical monthly trends ──────────────────────────────────────────────
  const monthlyTrends = useMemo(() => {
    const months: Record<string, { month: string; ingresos: number; egresos: number; neto: number }> = {};
    const addMonth = (dateStr: string, field: 'ingresos' | 'egresos', val: number) => {
      if (!dateStr) return;
      const key = dateStr.slice(0, 7);
      if (!months[key]) months[key] = { month: key, ingresos: 0, egresos: 0, neto: 0 };
      months[key][field] += val;
    };
    flujo.forEach(r => addMonth(r.vencimiento || r.created_at, 'ingresos', Number(r.cuota) || 0));
    cxp.forEach(r => addMonth(r.vencimiento_fecha || r.created_at, 'egresos', Number(r.monto_usd) || 0));
    return Object.values(months)
      .sort((a, b) => a.month.localeCompare(b.month))
      .map(m => ({ ...m, neto: m.ingresos - m.egresos, label: formatMonthYear(m.month + '-01') }));
  }, [cxp, flujo]);

  // ── Projection with break-even ─────────────────────────────────────────────
  const projectionChart = useMemo(() => {
    const all: { month: string; label: string; ingresos: number; egresos: number; balance: number; tipo: string }[] = [];
    let cumBalance = 0;
    monthlyTrends.forEach(m => {
      cumBalance += m.neto;
      all.push({ month: m.month, label: m.label, ingresos: m.ingresos, egresos: m.egresos, balance: cumBalance, tipo: 'histórico' });
    });
    projection.forEach(p => {
      const key = p.projection_month.slice(0, 7);
      if (all.some(a => a.month === key)) return;
      all.push({
        month: key, label: formatMonthYear(p.projection_month),
        ingresos: Number(p.projected_inflows), egresos: Number(p.projected_outflows),
        balance: Number(p.projected_balance), tipo: 'proyectado',
      });
    });
    return all.sort((a, b) => a.month.localeCompare(b.month));
  }, [monthlyTrends, projection]);

  const breakEvenMonth = projectionChart.find(p => p.tipo === 'proyectado' && p.balance <= 0);

  // ── CxP by priority ────────────────────────────────────────────────────────
  const cxpByPriority: Record<string, number> = {};
  cxp.forEach(r => {
    const p = String(r.prioridad || 'Sin prioridad').replace(/[^0-9]/g, '') || '0';
    cxpByPriority[p] = (cxpByPriority[p] || 0) + (Number(r.monto_usd) || 0);
  });

  // Top proveedores
  const proveedorMap: Record<string, number> = {};
  cxp.forEach(r => { const prov = r.proveedor || 'Desconocido'; proveedorMap[prov] = (proveedorMap[prov] || 0) + (Number(r.monto_usd) || 0); });
  const topProveedores = Object.entries(proveedorMap).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, total]) => ({ name: name.length > 25 ? name.slice(0, 22) + '...' : name, total }));

  // Flujo by BU
  const flujoByBU: Record<string, { ingresos: number; egresos: number }> = {};
  flujo.forEach(r => { const bu = r.compania || 'Sin BU'; if (!flujoByBU[bu]) flujoByBU[bu] = { ingresos: 0, egresos: 0 }; flujoByBU[bu].ingresos += Number(r.cuota) || 0; });
  cxp.forEach(r => { const bu = r.empresa || 'Sin BU'; if (!flujoByBU[bu]) flujoByBU[bu] = { ingresos: 0, egresos: 0 }; flujoByBU[bu].egresos += Number(r.monto_usd) || 0; });
  const buChartData = Object.entries(flujoByBU)
    .map(([bu, v]) => ({ bu: bu.length > 18 ? bu.slice(0, 15) + '...' : bu, ingresos: v.ingresos, egresos: v.egresos, neto: v.ingresos - v.egresos }))
    .sort((a, b) => b.neto - a.neto);

  // CxP clasificacion donut
  const cxpByClasif: Record<string, number> = {};
  cxp.forEach(r => { const c = r.clasificacion || 'Sin clasificación'; cxpByClasif[c] = (cxpByClasif[c] || 0) + (Number(r.monto_usd) || 0); });
  const donutData = Object.entries(cxpByClasif).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([name, value]) => ({ name: name.length > 20 ? name.slice(0, 17) + '...' : name, value }));
  const DONUT_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.orange, ARA_COLORS.red, ARA_COLORS.gray];

  // CxP by week
  const now = new Date();
  const weekBuckets: { label: string; p1: number; p2: number; p3: number; other: number }[] = [];
  for (let w = 0; w < 4; w++) {
    const start = new Date(now); start.setDate(start.getDate() + w * 7);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const bucket = { label: `Sem ${w + 1}`, p1: 0, p2: 0, p3: 0, other: 0 };
    cxp.forEach(r => {
      const d = new Date(r.vencimiento_fecha);
      if (d >= start && d <= end) {
        const p = String(r.prioridad || '').replace(/[^0-9]/g, '');
        const amt = Number(r.monto_usd) || 0;
        if (p === '1') bucket.p1 += amt; else if (p === '2') bucket.p2 += amt;
        else if (p === '3') bucket.p3 += amt; else bucket.other += amt;
      }
    });
    weekBuckets.push(bucket);
  }

  // Banco data
  const bancoMap: Record<string, number> = {};
  flujo.forEach(r => { const b = r.banco || 'Sin banco'; bancoMap[b] = (bancoMap[b] || 0) + (Number(r.cuota) || 0); });
  const bancoData = Object.entries(bancoMap).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, total]) => ({ name: name.length > 20 ? name.slice(0, 17) + '...' : name, total }));

  // ── Executive Narrative ────────────────────────────────────────────────────
  const insights: { type: 'insight' | 'risk' | 'action'; text: string }[] = [];

  if (totalCxP > 0 && totalFlujoInflows > 0) {
    if (ratio >= 1.5) insights.push({ type: 'insight', text: `Posición de liquidez saludable: ingresos operativos (${formatCompactCurrency(totalFlujoInflows)}) cubren ${ratio.toFixed(1)}x las CxP (${formatCompactCurrency(totalCxP)}).` });
    else if (ratio >= 1.0) insights.push({ type: 'risk', text: `Ratio de cobertura ajustado (${ratio.toFixed(1)}x). Margen limitado para imprevistos.` });
    else insights.push({ type: 'risk', text: `Alerta de liquidez: CxP (${formatCompactCurrency(totalCxP)}) superan ingresos (${formatCompactCurrency(totalFlujoInflows)}). Gap: ${formatCompactCurrency(totalCxP - totalFlujoInflows)}.` });
  }
  if (cxpByPriority['1'] > 0) insights.push({ type: 'action', text: `${formatCompactCurrency(cxpByPriority['1'])} en pagos P1 (urgentes) pendientes. Gestionar esta semana.` });
  if (topProveedores.length >= 3) {
    const top3Pct = topProveedores.slice(0, 3).reduce((s, p) => s + p.total, 0) / (totalCxP || 1) * 100;
    if (top3Pct > 50) insights.push({ type: 'risk', text: `Concentración CxP: 3 mayores proveedores = ${top3Pct.toFixed(0)}% del total. Riesgo de dependencia.` });
  }
  if (breakEvenMonth) insights.push({ type: 'risk', text: `Punto de equilibrio proyectado en ${breakEvenMonth.label}: balance llega a cero. Acción preventiva requerida.` });
  if (runwayMonths > 0 && !breakEvenMonth) insights.push({ type: 'insight', text: `Runway proyectado: ${runwayMonths} meses con balance positivo.` });

  // Credit-specific insights
  if (totalIntereses > 0) {
    insights.push({ type: 'insight', text: `Carga financiera total: ${formatCompactCurrency(totalIntereses)} en intereses sobre ${formatCompactCurrency(totalPrincipal)} de principal. Ratio interés/principal: ${interestRatio.toFixed(1)}%.` });
  }
  if (uniqueOperations.length > 0) {
    insights.push({ type: 'insight', text: `${uniqueOperations.length} líneas de crédito activas en ${uniqueBanks.size} bancos para ${uniqueCompanies.size} compañías. Saldo original total: ${formatCompactCurrency(totalSaldoOriginal)}.` });
  }
  if (totalCapitalAct > 0 && totalSaldoOriginal > 0) {
    const amortPct = ((totalSaldoOriginal - totalCapitalAct) / totalSaldoOriginal) * 100;
    if (amortPct > 0) insights.push({ type: 'insight', text: `Amortización acumulada: ${amortPct.toFixed(1)}% del saldo original ya pagado. Capital vigente: ${formatCompactCurrency(totalCapitalAct)}.` });
  }
  if (bancoComposition.length > 0) {
    const topBanco = bancoComposition[0];
    const topBancoPct = totalFlujoInflows > 0 ? (topBanco.cuota / totalFlujoInflows) * 100 : 0;
    if (topBancoPct > 40) insights.push({ type: 'risk', text: `Concentración bancaria: ${topBanco.banco} representa ${topBancoPct.toFixed(0)}% de las cuotas totales. Diversificar fuentes de crédito.` });
  }
  if (ganttData.some(g => g.endMs < nowMs)) {
    const expired = ganttData.filter(g => g.endMs < nowMs).length;
    insights.push({ type: 'action', text: `${expired} operación(es) de crédito con vencimiento cumplido. Revisar renovación o cierre.` });
  }
  if (ingestRuns.length > 0) insights.push({ type: 'insight', text: `Datos basados en ${ingestRuns.length} ingestas. Última: ${ingestRuns[0]?.source_file?.split('_').pop() || 'N/A'}.` });
  if (cxpAll.length === 0 && flujoAll.length === 0) insights.push({ type: 'action', text: 'Sin datos cargados. Sube archivos Excel en "Fuentes de Datos" para activar el dashboard.' });

  // ── Chart styles ───────────────────────────────────────────────────────────
  const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };
  const hasData = cxpAll.length > 0 || flujoAll.length > 0 || projection.length > 0;
  const PERIOD_LABELS: Record<TimePeriod, string> = { '1m': 'Último mes', '3m': '3 meses', '6m': '6 meses', '12m': '12 meses', all: 'Todo' };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="space-y-6">
        {/* Header + Period Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Panel Ejecutivo de Tesorería</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Visión consolidada de cashflow, operaciones de crédito, CxP y proyecciones en colones (₡) &middot; ARA Group
            </p>
          </div>
          <div className="flex items-center gap-3">
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
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-sm">Cargando datos de tesorería...</p>
          </div>
        ) : (
          <>
            {/* ─── 1. KPI Snapshot ──────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              <KPICard title="Total CxP" value={totalCxP} icon={CreditCard}
                semaphore={semaphore(totalCxP, 100000, 500000, true)}
                subtitle={`${cxp.length} facturas`} />
              <KPICard title="Ingresos Operativos" value={totalFlujoInflows} icon={Wallet}
                semaphore={totalFlujoInflows > 0 ? 'green' : 'red'}
                subtitle={`${flujo.length} operaciones`} />
              <KPICard title="Cashflow Neto" value={netCashflow}
                icon={netCashflow >= 0 ? TrendingUp : TrendingDown}
                semaphore={semaphore(netCashflow, 0, -50000)}
                subtitle={netCashflow >= 0 ? 'Superávit' : 'Déficit'} />
              <KPICard title="Ratio Cobertura" value={ratio} icon={ShieldCheck}
                format="number" semaphore={ratioSemaphore} subtitle="Ingresos / CxP" />
              <KPICard title="Runway" value={runwayMonths} icon={Clock}
                format="months" semaphore={runwaySemaphore} subtitle="Balance positivo" />
            </div>

            {/* ─── 2. Credit Operations KPIs ───────────────────────── */}
            {flujo.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <KPICard title="Líneas de Crédito" value={uniqueOperations.length} icon={Layers}
                  format="number" semaphore="green" subtitle={`${uniqueBanks.size} bancos`} />
                <KPICard title="Saldo Original" value={totalSaldoOriginal} icon={BanknoteIcon}
                  subtitle="Monto desembolsado" />
                <KPICard title="Capital Vigente" value={totalCapitalAct} icon={Activity}
                  semaphore={totalCapitalAct > 0 ? 'yellow' : 'green'}
                  subtitle="Por amortizar" />
                <KPICard title="Principal" value={totalPrincipal} icon={TrendingDown}
                  subtitle="Abonos a capital" />
                <KPICard title="Intereses" value={totalIntereses} icon={Percent}
                  semaphore={semaphore(interestRatio, 5, 15, true)}
                  subtitle={`${interestRatio.toFixed(1)}% del principal`} />
                <KPICard title="Cuotas Totales" value={totalFlujoInflows} icon={DollarSign}
                  subtitle={`${uniqueCompanies.size} compañías`} />
              </div>
            )}

            {/* ─── 3. Cashflow Histórico + Proyección ──────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Target className="w-4 h-4 text-[#1A4A28]" />
                  Flujo de Caja: Histórico + Proyección 12M con Punto de Equilibrio
                </CardTitle>
              </CardHeader>
              <CardContent>
                {projectionChart.length > 0 ? (
                  <ResponsiveContainer width="100%" height={340}>
                    <ComposedChart data={projectionChart}>
                      <defs>
                        <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={ARA_COLORS.primary} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={ARA_COLORS.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" label={{ value: 'Equilibrio ₡0', fill: ARA_COLORS.red, fontSize: 10 }} />
                      <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos ₡" radius={[2, 2, 0, 0]} opacity={0.7} />
                      <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos ₡" radius={[2, 2, 0, 0]} opacity={0.5} />
                      <Area type="monotone" dataKey="balance" stroke={ARA_COLORS.gold} strokeWidth={2.5} fill="url(#balGrad)" name="Balance Acum. ₡" />
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
                ) : (
                  <EmptyState text="Ejecuta recalc_projection en el AI Chat o ingesta datos para generar la proyección." />
                )}
              </CardContent>
            </Card>

            {/* ═══════════════════════════════════════════════════════════
                OPERACIONES DE CRÉDITO & LÍNEAS DE CRÉDITO
            ═══════════════════════════════════════════════════════════ */}

            {flujo.length > 0 && (
              <>
                {/* Section Header */}
                <div className="flex items-center gap-3 pt-2">
                  <div className="h-px flex-1 bg-gradient-to-r from-[#1A4A28]/30 to-transparent" />
                  <h2 className="text-lg font-bold text-[#1A4A28] flex items-center gap-2">
                    <Landmark className="w-5 h-5" />
                    Operaciones & Líneas de Crédito
                  </h2>
                  <div className="h-px flex-1 bg-gradient-to-l from-[#1A4A28]/30 to-transparent" />
                </div>

                {/* ─── 4. Timeline / Gantt de Líneas de Crédito ──────── */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CalendarDays className="w-4 h-4 text-[#1A4A28]" />
                      Timeline de Operaciones de Crédito (Gantt Longitudinal)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {ganttData.length > 0 ? (
                      <div className="space-y-1">
                        {/* Legend */}
                        <div className="flex items-center gap-4 text-[10px] text-gray-500 mb-3">
                          {Object.entries(TIPO_COLORS).map(([tipo, color]) => (
                            <span key={tipo} className="flex items-center gap-1">
                              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                              {tipo}
                            </span>
                          ))}
                          <span className="flex items-center gap-1">
                            <span className="w-px h-3 bg-red-500 border-l-2 border-red-500 border-dashed" />
                            Hoy
                          </span>
                        </div>

                        {/* Date axis header */}
                        <div className="flex items-center text-[9px] text-gray-400 mb-1">
                          <div className="w-[280px] shrink-0" />
                          <div className="flex-1 flex justify-between px-1">
                            <span>{formatShortDate(new Date(ganttMinDate))}</span>
                            <span>{formatShortDate(new Date((ganttMinDate + ganttMaxDate) / 2))}</span>
                            <span>{formatShortDate(new Date(ganttMaxDate))}</span>
                          </div>
                        </div>

                        {/* Gantt bars */}
                        <div className="space-y-1 max-h-[400px] overflow-y-auto">
                          {ganttData.map((g, idx) => {
                            const leftPct = ((g.startMs - ganttMinDate) / ganttSpan) * 100;
                            const widthPct = Math.max(((g.endMs - g.startMs) / ganttSpan) * 100, 1);
                            const nowPct = ((nowMs - ganttMinDate) / ganttSpan) * 100;
                            const isExpired = g.endMs < nowMs;
                            const barColor = TIPO_COLORS[g.tipo] || CREDIT_COLORS[idx % CREDIT_COLORS.length];

                            return (
                              <div key={g.id} className="flex items-center group hover:bg-gray-50/50 rounded py-0.5">
                                {/* Label */}
                                <div className="w-[280px] shrink-0 flex items-center gap-2 pr-3">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-medium text-gray-800 truncate" title={g.operacion}>
                                      {(g.operacion || '—').length > 28 ? (g.operacion || '—').slice(0, 25) + '...' : g.operacion}
                                    </p>
                                    <p className="text-[9px] text-gray-400 truncate">
                                      {g.compania} · {g.banco} · {formatCompactCurrency(g.saldo)}
                                    </p>
                                  </div>
                                </div>
                                {/* Bar */}
                                <div className="flex-1 relative h-6 bg-gray-100 rounded overflow-hidden">
                                  <div
                                    className={`absolute top-0.5 bottom-0.5 rounded transition-all ${isExpired ? 'opacity-40' : 'opacity-85'}`}
                                    style={{
                                      left: `${leftPct}%`,
                                      width: `${widthPct}%`,
                                      backgroundColor: barColor,
                                      minWidth: '4px',
                                    }}
                                    title={`${g.operacion}\n${formatShortDate(g.start)} → ${formatShortDate(g.end)}\nSaldo: ${formatCompactCurrency(g.saldo)} | Cuotas: ${formatCompactCurrency(g.cuotaTotal)}`}
                                  />
                                  {/* Today marker */}
                                  {nowPct >= 0 && nowPct <= 100 && (
                                    <div className="absolute top-0 bottom-0 w-px bg-red-500 z-10"
                                      style={{ left: `${nowPct}%` }} />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <p className="text-[10px] text-gray-400 mt-2 text-center">
                          {ganttData.length} operaciones · {ganttData.filter(g => g.endMs >= nowMs).length} vigentes · {ganttData.filter(g => g.endMs < nowMs).length} vencidas
                        </p>
                      </div>
                    ) : <EmptyState text="Ingesta 'Control de Operaciones' o 'Flujo Semanal' para visualizar el timeline de crédito." />}
                  </CardContent>
                </Card>

                {/* ─── 5. Operaciones por Tipo + Principal vs Intereses ─ */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Layers className="w-4 h-4 text-[#1A4A28]" />
                        Operaciones por Tipo de Crédito (₡)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {opsByTipo.length > 0 ? (
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={opsByTipo}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="tipo" stroke="#9ca3af" fontSize={10} />
                            <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                            <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Bar dataKey="principal" stackId="a" fill={ARA_COLORS.primary} name="Principal ₡" />
                            <Bar dataKey="intereses" stackId="a" fill={ARA_COLORS.gold} name="Intereses ₡" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : <EmptyState text="Sin datos por tipo de crédito." />}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Landmark className="w-4 h-4 text-[#1A4A28]" />
                        Principal vs Intereses por Banco (₡)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {bancoComposition.length > 0 ? (
                        <ResponsiveContainer width="100%" height={260}>
                          <BarChart data={bancoComposition.map(b => ({
                            ...b, banco: b.banco.length > 15 ? b.banco.slice(0, 12) + '...' : b.banco,
                          }))} layout="vertical" margin={{ left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis type="number" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                            <YAxis type="category" dataKey="banco" stroke="#9ca3af" fontSize={9} width={100} />
                            <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Bar dataKey="principal" stackId="a" fill={ARA_COLORS.primary} name="Principal ₡" />
                            <Bar dataKey="intereses" stackId="a" fill={ARA_COLORS.orange} name="Intereses ₡" radius={[0, 3, 3, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : <EmptyState text="Sin datos bancarios." />}
                    </CardContent>
                  </Card>
                </div>

                {/* ─── 6. Evolución Longitudinal Capital + Moneda ─────── */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Activity className="w-4 h-4 text-[#1A4A28]" />
                        Evolución Longitudinal: Saldo Original vs Capital Actualizado (₡)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {capitalEvolution.length > 0 ? (
                        <ResponsiveContainer width="100%" height={280}>
                          <ComposedChart data={capitalEvolution}>
                            <defs>
                              <linearGradient id="saldoGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={ARA_COLORS.blue} stopOpacity={0.2} />
                                <stop offset="100%" stopColor={ARA_COLORS.blue} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                            <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                            <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                            <Legend wrapperStyle={{ fontSize: 10 }} />
                            <Area type="monotone" dataKey="saldo_original" stroke={ARA_COLORS.blue} strokeWidth={2} fill="url(#saldoGrad)" name="Saldo Original ₡" />
                            <Line type="monotone" dataKey="capital_actualizado" stroke={ARA_COLORS.gold} strokeWidth={2} dot={{ r: 3 }} name="Capital Vigente ₡" />
                            <Bar dataKey="principal" fill={ARA_COLORS.primary} name="Amortización ₡" radius={[2, 2, 0, 0]} opacity={0.6} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      ) : <EmptyState text="Sin datos de evolución de capital." />}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <DollarSign className="w-4 h-4 text-[#1A4A28]" />
                        Composición por Moneda
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {byMoneda.length > 0 ? (
                        <>
                          <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                              <Pie data={byMoneda} cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                                paddingAngle={4} dataKey="cuota"
                                label={({ moneda, percent }) => `${moneda} ${(percent * 100).toFixed(0)}%`}
                                labelLine={false} style={{ fontSize: 11 }}>
                                <Cell fill={ARA_COLORS.primary} />
                                <Cell fill={ARA_COLORS.blue} />
                              </Pie>
                              <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="space-y-1 mt-2">
                            {byMoneda.map(m => (
                              <div key={m.moneda} className="flex items-center justify-between text-xs">
                                <span className="flex items-center gap-1.5">
                                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.moneda === 'CRC' ? ARA_COLORS.primary : ARA_COLORS.blue }} />
                                  {m.moneda === 'CRC' ? 'Colones (₡)' : 'Dólares ($)'}
                                </span>
                                <span className="font-semibold tabular-nums">{m.count} ops</span>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : <EmptyState text="Sin datos de moneda." />}
                    </CardContent>
                  </Card>
                </div>

                {/* ─── 7. Operations Detail Table ─────────────────────── */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Layers className="w-4 h-4 text-[#1A4A28]" />
                      Detalle de Operaciones de Crédito
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                            <th className="pb-2 pr-3">Operación</th>
                            <th className="pb-2 pr-3">Compañía</th>
                            <th className="pb-2 pr-3">Banco</th>
                            <th className="pb-2 pr-3">Tipo</th>
                            <th className="pb-2 pr-3 text-right">Saldo Original ₡</th>
                            <th className="pb-2 pr-3 text-right">Cuota ₡</th>
                            <th className="pb-2 pr-3">Vencimiento</th>
                            <th className="pb-2">Moneda</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {uniqueOperations.slice(0, 20).map((op, idx) => {
                            const isExpired = op.vencimiento && new Date(op.vencimiento) < now;
                            return (
                              <tr key={idx} className="hover:bg-gray-50/50">
                                <td className="py-2 pr-3 font-medium text-gray-900 text-xs max-w-[180px] truncate" title={op.operacion}>
                                  {op.operacion || '—'}
                                </td>
                                <td className="py-2 pr-3 text-gray-600 text-xs">{op.compania || '—'}</td>
                                <td className="py-2 pr-3 text-gray-600 text-xs">{op.banco || '—'}</td>
                                <td className="py-2 pr-3">
                                  <Badge variant={op.tipo === 'Largo Plazo' ? 'default' : op.tipo === 'Capital Trabajo' ? 'warning' : 'info'}>
                                    {op.tipo || '—'}
                                  </Badge>
                                </td>
                                <td className="py-2 pr-3 text-right font-semibold tabular-nums text-xs">
                                  {formatCurrency(Number(op.saldo_original) || 0)}
                                </td>
                                <td className="py-2 pr-3 text-right tabular-nums text-xs">
                                  {formatCurrency(Number(op.cuota) || 0)}
                                </td>
                                <td className={`py-2 pr-3 text-xs ${isExpired ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                                  {op.vencimiento ? formatDate(op.vencimiento) : '—'}
                                  {isExpired && <span className="ml-1 text-[8px] bg-red-100 text-red-700 px-1 rounded">VENCIDO</span>}
                                </td>
                                <td className="py-2 text-xs text-gray-500">{op.moneda || 'CRC'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {uniqueOperations.length > 20 && (
                        <p className="text-xs text-gray-400 mt-3 text-center">
                          Mostrando 20 de {uniqueOperations.length} líneas de crédito.
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}

            {/* ═══════════════════════════════════════════════════════════
                CxP & PROVEEDORES
            ═══════════════════════════════════════════════════════════ */}

            {/* Section Divider */}
            <div className="flex items-center gap-3 pt-2">
              <div className="h-px flex-1 bg-gradient-to-r from-red-300/40 to-transparent" />
              <h2 className="text-lg font-bold text-gray-700 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-red-500" />
                CxP & Proveedores
              </h2>
              <div className="h-px flex-1 bg-gradient-to-l from-red-300/40 to-transparent" />
            </div>

            {/* ─── 8. Proyección 12M + CxP Semanal ────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CalendarDays className="w-4 h-4 text-[#1A4A28]" />
                    Proyección Mensual 12M (₡)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {projection.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <AreaChart data={projection.map(p => ({
                        mes: formatMonthYear(p.projection_month),
                        balance: Number(p.projected_balance),
                      }))}>
                        <defs>
                          <linearGradient id="proj12" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ARA_COLORS.primary} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={ARA_COLORS.primary} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="mes" stroke="#9ca3af" fontSize={10} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" />
                        <Area type="monotone" dataKey="balance" stroke={ARA_COLORS.primary} strokeWidth={2} fill="url(#proj12)" name="Balance ₡" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin proyección 12M. Usa recalc_projection en AI Chat." />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CreditCard className="w-4 h-4 text-red-600" />
                    CxP Próximas 4 Semanas por Prioridad (₡)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {weekBuckets.some(w => w.p1 + w.p2 + w.p3 + w.other > 0) ? (
                    <ResponsiveContainer width="100%" height={260}>
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
                  ) : <EmptyState text="Sin CxP con vencimiento en las próximas 4 semanas." />}
                </CardContent>
              </Card>
            </div>

            {/* ─── 9. Top Proveedores + Clasificación CxP ─────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="w-4 h-4 text-[#1A4A28]" />
                    Top Proveedores CxP — Pareto (₡)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {topProveedores.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={topProveedores} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={9} width={130} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Bar dataKey="total" fill={ARA_COLORS.primary} name="Monto CxP ₡" radius={[0, 4, 4, 0]} barSize={16} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos de proveedores." />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="w-4 h-4 text-[#1A4A28]" />
                    CxP por Clasificación
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {donutData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie data={donutData} cx="50%" cy="50%" innerRadius={50} outerRadius={85}
                          paddingAngle={3} dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false} style={{ fontSize: 9 }}>
                          {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin clasificaciones." />}
                </CardContent>
              </Card>
            </div>

            {/* ─── 10. BU + Banco ─────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="w-4 h-4 text-[#1A4A28]" />
                    Cashflow Neto por Unidad de Negocio (₡)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {buChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={buChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="bu" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="ingresos" fill={ARA_COLORS.primary} name="Ingresos ₡" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="egresos" fill={ARA_COLORS.red} name="Egresos ₡" radius={[3, 3, 0, 0]} opacity={0.6} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos por unidad de negocio." />}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Landmark className="w-4 h-4 text-[#1A4A28]" />
                    Desembolsos / Cuotas por Banco (₡)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {bancoData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <BarChart data={bancoData} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={10} width={110} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Bar dataKey="total" fill={ARA_COLORS.gold} name="Total Cuotas ₡" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos bancarios." />}
                </CardContent>
              </Card>
            </div>

            {/* ─── 11. Historial de Ingestas ───────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="w-4 h-4 text-[#1A4A28]" />
                  Historial de Fuentes de Datos (Persistencia)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {ingestRuns.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                          <th className="pb-2 pr-4">Archivo</th>
                          <th className="pb-2 pr-4">Filas</th>
                          <th className="pb-2 pr-4">Estado</th>
                          <th className="pb-2">Fecha Ingesta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {ingestRuns.slice(0, 10).map((run, idx) => (
                          <tr key={idx} className="hover:bg-gray-50/50">
                            <td className="py-2 pr-4 text-xs font-mono text-gray-700 max-w-[300px] truncate">
                              {run.source_file?.split('_').slice(1).join('_') || run.source_file}
                            </td>
                            <td className="py-2 pr-4 font-semibold tabular-nums">{run.rows_inserted}</td>
                            <td className="py-2 pr-4">
                              <Badge variant={run.status === 'completed' ? 'success' : 'error'}>{run.status}</Badge>
                            </td>
                            <td className="py-2 text-gray-500 text-xs">{formatShortDate(run.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <EmptyState text="Sin ingestas registradas. Los datos se persisten automáticamente en Supabase Storage + Postgres." />}
              </CardContent>
            </Card>

            {/* ─── 12. Tabla CxP ────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  Pagos Prioritarios Próximos (₡)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cxp.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                          <th className="pb-2 pr-4">Proveedor</th>
                          <th className="pb-2 pr-4">Empresa</th>
                          <th className="pb-2 pr-4 text-right">Monto ₡</th>
                          <th className="pb-2 pr-4">Vencimiento</th>
                          <th className="pb-2 pr-4">Prioridad</th>
                          <th className="pb-2">Clasificación</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {cxp.slice(0, 15).map((item, idx) => {
                          const isOverdue = new Date(item.vencimiento_fecha) < now;
                          return (
                            <tr key={idx} className="hover:bg-gray-50/50">
                              <td className="py-2 pr-4 font-medium text-gray-900 max-w-[200px] truncate">{item.proveedor || '—'}</td>
                              <td className="py-2 pr-4 text-gray-600 text-xs">{item.empresa || '—'}</td>
                              <td className="py-2 pr-4 text-right font-semibold tabular-nums">{formatCurrency(Number(item.monto_usd) || 0)}</td>
                              <td className={`py-2 pr-4 text-xs ${isOverdue ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                                {item.vencimiento_fecha ? formatShortDate(item.vencimiento_fecha) : '—'}
                                {isOverdue && <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1 rounded">VENCIDO</span>}
                              </td>
                              <td className="py-2 pr-4">
                                <Badge variant={String(item.prioridad).includes('1') ? 'error' : String(item.prioridad).includes('2') ? 'warning' : 'default'}>
                                  {getPriorityLabel(item.prioridad)}
                                </Badge>
                              </td>
                              <td className="py-2 text-gray-500 text-xs">{item.clasificacion || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {cxp.length > 15 && (
                      <p className="text-xs text-gray-400 mt-3 text-center">
                        Mostrando 15 de {cxp.length}. Usa AI Chat para consultas detalladas.
                      </p>
                    )}
                  </div>
                ) : <EmptyState text="Sin datos de CxP. Ingesta un archivo GV CXP Totales." />}
              </CardContent>
            </Card>

            {/* ─── 13. Narrativa Ejecutiva ──────────────────────────── */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="w-4 h-4 text-[#C9A84C]" />
                  Narrativa Ejecutiva — Hallazgos, Riesgos y Acciones
                </CardTitle>
              </CardHeader>
              <CardContent>
                {insights.length > 0 ? (
                  <div className="space-y-2.5">
                    {insights.map((item, idx) => (
                      <div key={idx} className={`flex items-start gap-3 p-3 rounded-lg ${
                        item.type === 'risk' ? 'bg-red-50 border border-red-100'
                          : item.type === 'action' ? 'bg-amber-50 border border-amber-100'
                          : 'bg-emerald-50 border border-emerald-100'
                      }`}>
                        <span className="flex-shrink-0 mt-0.5">
                          {item.type === 'risk' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                          {item.type === 'action' && <Lightbulb className="w-4 h-4 text-amber-600" />}
                          {item.type === 'insight' && <TrendingUp className="w-4 h-4 text-emerald-600" />}
                        </span>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            {item.type === 'risk' ? 'Riesgo' : item.type === 'action' ? 'Acción Requerida' : 'Hallazgo'}
                          </span>
                          <p className="text-sm text-gray-800 mt-0.5">{item.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-6">
                    Los insights se generan automáticamente al cargar datos.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ─── Footer ──────────────────────────────────────────── */}
            <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-4 flex-wrap">
                <span>{cxp.length} CxP</span>
                <span>{flujo.length} operaciones</span>
                <span>{uniqueOperations.length} líneas crédito</span>
                <span>{projection.length} meses proyección</span>
                <span>{ingestRuns.length} ingestas</span>
                <span>Divisa: ₡ CRC</span>
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
  return (
    <div className="flex flex-col items-center justify-center py-10 text-gray-400">
      <BarChart3 className="w-8 h-8 mb-2 opacity-30" />
      <p className="text-xs text-center max-w-xs">{text}</p>
    </div>
  );
}
