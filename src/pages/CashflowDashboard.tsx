import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, Lightbulb, RefreshCw, BarChart3,
  Wallet, CreditCard, Building2, CalendarDays, Target, ShieldCheck, Clock,
  Filter, CheckCircle2, XCircle, AlertOctagon, Banknote, Download, Activity,
} from 'lucide-react';
import * as XLSX from 'xlsx';
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
import { InfoTooltip } from '../components/ui/InfoTooltip';
import { CASHFLOW, DASHBOARD } from '../lib/glossary';
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
import { FilterableTable, type ColumnDef } from '../components/ui/FilterableTable';

export function CashflowDashboard() {
  const [loading, setLoading] = useState(true);
  const [cxpAll, setCxpAll] = useState<CxPItem[]>([]);
  const [flujoAll, setFlujoAll] = useState<FlujoItem[]>([]);
  const [projection, setProjection] = useState<Projection[]>([]);
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [detailRecord, setDetailRecord] = useState<Record<string, unknown> | null>(null);
  const [detailType, setDetailType] = useState<'cxp' | 'flujo'>('cxp');
  const [buFilter, setBuFilter] = useState<string>('all');
  const [provFilter, setProvFilter] = useState<string>('all');
  const [negocioFilter, setNegocioFilter] = useState<string>('all');
  const [budgetTarget, setBudgetTarget] = useState<number>(() => {
    const saved = localStorage.getItem('cashflow_budget_target');
    return saved ? parseFloat(saved) : 0;
  });
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

  // ── Provider & Negocio lists ──────────────────────────────────────────────
  const allProviders = useMemo(() => {
    const s = new Set<string>();
    cxpAll.forEach(r => { if (r.proveedor) s.add(r.proveedor); });
    return Array.from(s).sort();
  }, [cxpAll]);

  const allNegocios = useMemo(() => {
    const s = new Set<string>();
    cxpAll.forEach(r => { if (r.negocio) s.add(r.negocio); });
    return Array.from(s).sort();
  }, [cxpAll]);

  // ── Filters ─────────────────────────────────────────────────────────────────
  const cutoff = getDateCutoff(period);
  const cxp = useMemo(() => {
    let d = cxpAll;
    if (cutoff) d = d.filter(r => (r.vencimiento_fecha || r.created_at) >= cutoff);
    if (buFilter !== 'all') d = d.filter(r => r.empresa === buFilter);
    if (provFilter !== 'all') d = d.filter(r => r.proveedor === provFilter);
    if (negocioFilter !== 'all') d = d.filter(r => r.negocio === negocioFilter);
    return d;
  }, [cxpAll, cutoff, buFilter, provFilter, negocioFilter]);
  const flujo = useMemo(() => {
    let d = flujoAll.filter(r => r.operacion && String(r.operacion).trim() !== '');
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

  // ── Negocio breakdown (sub-BU) ─────────────────────────────────────────────
  const negocioBreakdown = useMemo(() => {
    const m: Record<string, { negocio: string; monto: number; count: number }> = {};
    cxp.forEach(r => {
      const n = r.negocio || 'Sin negocio';
      if (!m[n]) m[n] = { negocio: n, monto: 0, count: 0 };
      m[n].monto += Number(r.monto_usd) || 0;
      m[n].count++;
    });
    return Object.values(m).sort((a, b) => b.monto - a.monto);
  }, [cxp]);

  // ── Monthly egresos trend ──────────────────────────────────────────────────
  const egresosTrend = useMemo(() => {
    const m: Record<string, number> = {};
    cxp.forEach(r => {
      const k = (r.vencimiento_fecha || r.created_at || '').slice(0, 7);
      if (k) m[k] = (m[k] || 0) + (Number(r.monto_usd) || 0);
    });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([mo, total]) => ({ month: mo, label: formatMonthYear(mo + '-01'), total }));
  }, [cxp]);

  // ── Budget vs real ─────────────────────────────────────────────────────────
  const budgetVsReal = useMemo(() => {
    if (!budgetTarget) return [];
    return egresosTrend.map(e => ({
      ...e, budget: budgetTarget,
      variance: e.total - budgetTarget,
      fill: e.total <= budgetTarget ? ARA_COLORS.primary : ARA_COLORS.red,
    }));
  }, [egresosTrend, budgetTarget]);

  // ── Provider currency mapping ──────────────────────────────────────────────
  const provCurrencyMap = useMemo(() => {
    const m: Record<string, string> = {};
    // CxP doesn't have moneda, but flujo does — try to match by compania/empresa
    flujoAll.forEach(r => {
      if (r.moneda) m[r.compania || ''] = normalizeCurrency(r.moneda);
    });
    return m;
  }, [flujoAll]);

  // ── Export helper ──────────────────────────────────────────────────────────
  const exportCxPToXLSX = useCallback(() => {
    const data = cxp.map(r => ({
      Proveedor: r.proveedor, Empresa: r.empresa, Negocio: r.negocio,
      Monto_USD: Number(r.monto_usd) || 0, Vencimiento: r.vencimiento_fecha,
      Prioridad: r.prioridad, Clasificacion: r.clasificacion,
      Responsable: r.responsable, Detalle: r.detalle,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CxP');
    XLSX.writeFile(wb, `CxP_${new Date().toISOString().slice(0, 10)}.xlsx`);
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

  // ── Predictive Analytics ─────────────────────────────────────────────────────

  // P1: Cashflow Volatility — monthly std dev of net cashflow
  const cashflowVolatility = useMemo(() => {
    const monthlyNet: Record<string, number> = {};
    flujo.forEach(r => { const k = (r.vencimiento || r.created_at || '').slice(0, 7); if (k) monthlyNet[k] = (monthlyNet[k] || 0) + (Number(r.cuota) || 0); });
    cxp.forEach(r => { const k = (r.vencimiento_fecha || r.created_at || '').slice(0, 7); if (k) monthlyNet[k] = (monthlyNet[k] || 0) - (Number(r.monto_usd) || 0); });
    const vals = Object.entries(monthlyNet).sort(([a], [b]) => a.localeCompare(b));
    if (vals.length < 2) return [];
    const mean = vals.reduce((s, [, v]) => s + v, 0) / vals.length;
    let cumVol = 0;
    return vals.map(([mo, net]) => {
      const dev = net - mean;
      cumVol += Math.abs(dev);
      return { month: mo, label: formatMonthYear(mo + '-01'), net, mean, deviation: dev, cumVolatility: cumVol / vals.length };
    });
  }, [cxp, flujo]);

  // P2: CxP Forecast — SMA-3 egresos projection
  const egresosForecast = useMemo(() => {
    if (egresosTrend.length < 2) return [];
    const hist = egresosTrend.map(e => ({ ...e, type: 'real' as const }));
    const w = Math.min(3, hist.length);
    const avg = hist.slice(-w).reduce((s, e) => s + e.total, 0) / w;
    const last = hist[hist.length - 1].month;
    const fc: typeof hist = [];
    for (let i = 1; i <= 4; i++) {
      const d = new Date(last + '-01'); d.setMonth(d.getMonth() + i);
      const mo = d.toISOString().slice(0, 7);
      fc.push({ month: mo, label: formatMonthYear(mo + '-01'), total: avg * (1 + i * 0.005), type: 'forecast' as const });
    }
    return [...hist, ...fc];
  }, [egresosTrend]);

  // P3: Provider Risk Score — weighted by amount * aging days
  const providerRisk = useMemo(() => {
    const m: Record<string, { name: string; amount: number; avgDays: number; count: number; riskScore: number }> = {};
    const now = new Date();
    cxp.forEach(r => {
      const p = r.proveedor || 'Desconocido';
      const amt = Number(r.monto_usd) || 0;
      const days = r.vencimiento_fecha ? Math.max(0, (now.getTime() - new Date(r.vencimiento_fecha).getTime()) / 86400000) : 0;
      if (!m[p]) m[p] = { name: p, amount: 0, avgDays: 0, count: 0, riskScore: 0 };
      m[p].amount += amt;
      m[p].avgDays += days;
      m[p].count++;
      m[p].riskScore += amt * Math.max(1, days / 30);
    });
    return Object.values(m)
      .map(v => ({ ...v, avgDays: v.count > 0 ? v.avgDays / v.count : 0, name: v.name.length > 20 ? v.name.slice(0, 17) + '...' : v.name }))
      .sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
  }, [cxp]);

  // P4: Coverage Ratio Trend — monthly ratio evolution
  const coverageTrend = useMemo(() => {
    const monthIn: Record<string, number> = {};
    const monthOut: Record<string, number> = {};
    flujo.forEach(r => { const k = (r.vencimiento || r.created_at || '').slice(0, 7); if (k) monthIn[k] = (monthIn[k] || 0) + (Number(r.cuota) || 0); });
    cxp.forEach(r => { const k = (r.vencimiento_fecha || r.created_at || '').slice(0, 7); if (k) monthOut[k] = (monthOut[k] || 0) + (Number(r.monto_usd) || 0); });
    const months = [...new Set([...Object.keys(monthIn), ...Object.keys(monthOut)])].sort();
    return months.map(mo => {
      const inflow = monthIn[mo] || 0;
      const outflow = monthOut[mo] || 0;
      return { month: mo, label: formatMonthYear(mo + '-01'), ratio: outflow > 0 ? inflow / outflow : inflow > 0 ? 5 : 0, inflow, outflow };
    });
  }, [cxp, flujo]);

  // ── FilterableTable column defs ─────────────────────────────────────────────
  const cxpColumns: ColumnDef<CxPItem>[] = useMemo(() => [
    { key: 'proveedor', header: 'Proveedor', render: (r) => <span className="font-medium text-gray-900 max-w-[180px] truncate block">{r.proveedor || '—'}</span>, filterType: 'text' },
    { key: 'empresa', header: 'Empresa', render: (r) => <span className="text-gray-600">{r.empresa || '—'}</span>, filterType: 'select' },
    { key: 'monto_usd', header: 'Monto $', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{formatCurrency(Number(r.monto_usd) || 0)}</span>, accessor: (r) => Number(r.monto_usd) || 0 },
    { key: 'vencimiento_fecha', header: 'Vencimiento', render: (r) => { const isOv = r.vencimiento_fecha && new Date(r.vencimiento_fecha) < now; return <span className={isOv ? 'text-red-600 font-bold' : 'text-gray-600'}>{r.vencimiento_fecha ? formatShortDate(r.vencimiento_fecha) : '—'}{isOv && <span className="ml-1 text-[8px] bg-red-100 text-red-700 px-1 rounded">VENCIDO</span>}</span>; }, accessor: (r) => r.vencimiento_fecha || '' },
    { key: 'prioridad', header: 'Prioridad', render: (r) => <Badge variant={String(r.prioridad).includes('1') ? 'error' : String(r.prioridad).includes('2') ? 'warning' : 'default'}>{getPriorityLabel(r.prioridad)}</Badge>, filterType: 'select', accessor: (r) => getPriorityLabel(r.prioridad) },
    { key: 'clasificacion', header: 'Clasificación', render: (r) => <span className="text-gray-500">{r.clasificacion || '—'}</span>, filterType: 'select' },
    { key: 'negocio', header: 'Negocio', render: (r) => <span className="text-gray-500">{r.negocio || '—'}</span>, filterType: 'select' },
  ], [now]);

  const flujoColumns: ColumnDef<FlujoItem>[] = useMemo(() => [
    { key: 'operacion', header: 'Operación', render: (r) => <span className="font-medium text-gray-900 max-w-[200px] truncate block" title={r.operacion || ''}>{r.operacion || '—'}</span>, filterType: 'text' },
    { key: 'compania', header: 'Compañía', render: (r) => <span className="text-gray-600 max-w-[140px] truncate block" title={r.compania || ''}>{r.compania || '—'}</span>, filterType: 'select' },
    { key: 'banco', header: 'Banco', render: (r) => <span className="text-gray-600">{r.banco || '—'}</span>, filterType: 'select' },
    { key: 'tipo', header: 'Tipo', render: (r) => <Badge variant={r.tipo === 'Largo Plazo' ? 'success' : r.tipo === 'Capital Trabajo' ? 'warning' : 'default'}>{r.tipo || '—'}</Badge>, filterType: 'select' },
    { key: 'cuota', header: 'Cuota', align: 'right', render: (r) => { const cur = normalizeCurrency(r.moneda); return <span className={`font-semibold tabular-nums ${(Number(r.cuota) || 0) >= (cur === 'CRC' ? 50000000 : 100000) ? 'text-emerald-700' : ''}`}>{formatCurrency(Number(r.cuota) || 0, cur)}</span>; }, accessor: (r) => Number(r.cuota) || 0 },
    { key: 'principal', header: 'Principal', align: 'right', render: (r) => <span className="tabular-nums text-gray-600">{formatCurrency(Number(r.principal) || 0, normalizeCurrency(r.moneda))}</span>, accessor: (r) => Number(r.principal) || 0 },
    { key: 'intereses', header: 'Intereses', align: 'right', render: (r) => <span className="tabular-nums text-gray-500">{formatCurrency(Number(r.intereses) || 0, normalizeCurrency(r.moneda))}</span>, accessor: (r) => Number(r.intereses) || 0 },
    { key: 'vencimiento', header: 'Vencimiento', render: (r) => <span className="text-gray-600">{r.vencimiento ? formatShortDate(r.vencimiento) : '—'}</span>, accessor: (r) => r.vencimiento || '' },
    { key: 'moneda', header: 'Moneda', render: (r) => <Badge variant={normalizeCurrency(r.moneda) === 'USD' ? 'info' : 'default'}>{normalizeCurrency(r.moneda)}</Badge>, filterType: 'select', accessor: (r) => normalizeCurrency(r.moneda) },
  ], []);

  // ── Language toggle ─────────────────────────────────────────────────────────
  const [lang, setLang] = useState<'es' | 'en'>(() => (localStorage.getItem('narrative_lang') as 'es' | 'en') || 'es');
  const toggleLang = useCallback(() => { const next = lang === 'es' ? 'en' : 'es'; setLang(next); localStorage.setItem('narrative_lang', next); }, [lang]);

  // ── Insights (process gap-driven) ──────────────────────────────────────────
  const insights: { type: 'insight' | 'risk' | 'action'; text: string; textEn: string }[] = [];
  if (overdueRate > 30) insights.push({ type: 'risk', text: `KPI-06 Mora: ${overdueRate.toFixed(0)}% de CxP vencidas (${overdueCxP.length} items = ${formatCompactCurrency(overdueAmount)}). R4: Reacción tardía — activar micro-ciclo diario.`, textEn: `KPI-06 Arrears: ${overdueRate.toFixed(0)}% of AP overdue (${overdueCxP.length} items = ${formatCompactCurrency(overdueAmount)}). R4: Slow reaction — activate daily micro-cycle.` });
  else if (overdueRate > 10) insights.push({ type: 'risk', text: `${overdueRate.toFixed(0)}% CxP vencidas. ${formatCompactCurrency(overdueAmount)} en mora.`, textEn: `${overdueRate.toFixed(0)}% AP overdue. ${formatCompactCurrency(overdueAmount)} in arrears.` });
  if (dsoProxy > 45) insights.push({ type: 'risk', text: `KPI-01 DSO proxy: ${dsoProxy.toFixed(0)} días. R7: Conciliación manual lenta.`, textEn: `KPI-01 DSO proxy: ${dsoProxy.toFixed(0)} days. R7: Slow manual reconciliation.` });
  else if (dsoProxy > 0) insights.push({ type: 'insight', text: `KPI-01 DSO proxy: ${dsoProxy.toFixed(0)} días promedio de vencimiento.`, textEn: `KPI-01 DSO proxy: ${dsoProxy.toFixed(0)} days average maturity.` });
  if (ratio < 1) insights.push({ type: 'risk', text: `Déficit de cashflow: CxP (${formatCompactCurrency(totalCxP)}) > Ingresos (${formatCompactCurrency(totalInflows)}). Gap: ${formatCompactCurrency(totalCxP - totalInflows)}.`, textEn: `Cashflow deficit: AP (${formatCompactCurrency(totalCxP)}) > Income (${formatCompactCurrency(totalInflows)}). Gap: ${formatCompactCurrency(totalCxP - totalInflows)}.` });
  else if (ratio < 1.5) insights.push({ type: 'risk', text: `Ratio cobertura ajustado: ${ratio.toFixed(2)}x. Margen limitado.`, textEn: `Tight coverage ratio: ${ratio.toFixed(2)}x. Limited margin.` });
  else insights.push({ type: 'insight', text: `Cobertura saludable: ${ratio.toFixed(2)}x (Ingresos / CxP).`, textEn: `Healthy coverage: ${ratio.toFixed(2)}x (Income / AP).` });
  const agingHigh = agingBuckets.filter(b => b.label !== '0-30').reduce((s, b) => s + b.monto, 0);
  if (agingHigh > totalCxP * 0.3 && totalCxP > 0) insights.push({ type: 'risk', text: `KPI-05 Aging: ${((agingHigh / totalCxP) * 100).toFixed(0)}% de CxP con >30 días.`, textEn: `KPI-05 Aging: ${((agingHigh / totalCxP) * 100).toFixed(0)}% of AP over 30 days.` });
  if (topProv.length >= 3 && totalCxP > 0) {
    const top3 = topProv.slice(0, 3).reduce((s, p) => s + p.total, 0) / totalCxP * 100;
    if (top3 > 50) insights.push({ type: 'risk', text: `Concentración CxP: Top 3 proveedores = ${top3.toFixed(0)}%.`, textEn: `AP concentration: Top 3 suppliers = ${top3.toFixed(0)}%.` });
  }
  if (buBreakdown.some(b => b.neto < 0)) {
    const neg = buBreakdown.filter(b => b.neto < 0);
    insights.push({ type: 'action', text: `${neg.length} BU(s) con cashflow negativo: ${neg.map(b => `${b.bu} (${formatCompactCurrency(b.neto)})`).join(', ')}.`, textEn: `${neg.length} BU(s) with negative cashflow: ${neg.map(b => `${b.bu} (${formatCompactCurrency(b.neto)})`).join(', ')}.` });
  }
  if (cxpAll.length === 0 && flujoAll.length === 0) insights.push({ type: 'action', text: 'Sin datos. Ingesta archivos Excel en Fuentes de Datos.', textEn: 'No data. Upload Excel files in Data Sources.' });

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
              <select value={buFilter} onChange={e => { setBuFilter(e.target.value); setNegocioFilter('all'); }}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28]">
                <option value="all">Todas las BU</option>
                {allBUs.map(bu => <option key={bu} value={bu}>{bu}</option>)}
              </select>
            </div>
            {/* Negocio Filter */}
            {allNegocios.length > 0 && (
              <select value={negocioFilter} onChange={e => setNegocioFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28]">
                <option value="all">Todo Negocio</option>
                {allNegocios.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
            {/* Provider Filter */}
            <select value={provFilter} onChange={e => setProvFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28] max-w-[180px]">
              <option value="all">Todos Proveedores</option>
              {allProviders.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {provFilter !== 'all' && provCurrencyMap[provFilter] && (
              <Badge variant="info" className="text-[10px]">{provCurrencyMap[provFilter]}</Badge>
            )}
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
              <KPICard title="Total CxP" value={totalCxP} icon={CreditCard} semaphore={semaphore(totalCxP, 100000, 500000, true)} subtitle={`${cxp.length} facturas`} info={DASHBOARD.totalCxP} />
              <KPICard title="Ingresos (Cuotas)" value={totalInflows} icon={Wallet} semaphore={totalInflows > 0 ? 'green' : 'red'} subtitle={`${flujo.length} operaciones`} info={DASHBOARD.totalInflows} />
              <KPICard title="Cashflow Neto" value={netCashflow} icon={netCashflow >= 0 ? TrendingUp : TrendingDown} semaphore={semaphore(netCashflow, 0, -50000)} subtitle={netCashflow >= 0 ? 'Superávit' : 'Déficit'} info={DASHBOARD.netCashflow} />
              <KPICard title="Ratio Cobertura" value={ratio} icon={ShieldCheck} format="number" semaphore={semaphore(ratio, 1.5, 1.0)} subtitle="Ingresos / CxP" info={DASHBOARD.coverageRatio} />
              <KPICard title="DSO Proxy" value={dsoProxy} icon={Clock} format="number" semaphore={semaphore(dsoProxy, 30, 45, true)} subtitle="Días promedio" />
              <KPICard title="% Mora" value={overdueRate} icon={AlertOctagon} format="number" semaphore={semaphore(overdueRate, 10, 30, true)} subtitle={`${overdueCxP.length} vencidas`} info={CASHFLOW.cxpAging} />
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

            {/* CxP detail table with column filters */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-orange-500" />Detalle CxP — Pagos Prioritarios ($){buFilter !== 'all' && <Badge variant="info">{buFilter}</Badge>}{provFilter !== 'all' && <Badge variant="secondary">{provFilter}</Badge>}</CardTitle>
                  <button onClick={exportCxPToXLSX} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1A4A28] bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors" title="Exportar CxP a Excel">
                    <Download className="w-3.5 h-3.5" /> Exportar XLSX
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <FilterableTable<CxPItem>
                  data={cxp}
                  columns={cxpColumns}
                  maxRows={30}
                  onRowDoubleClick={(item) => { setDetailType('cxp'); setDetailRecord(item as unknown as Record<string, unknown>); }}
                  emptyText="Sin CxP."
                />
              </CardContent>
            </Card>

            {/* Ingresos (Flujo) detail table with column filters */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Banknote className="w-4 h-4 text-emerald-600" />Detalle de Ingresos — Cuotas y Operaciones{buFilter !== 'all' && <Badge variant="info">{buFilter}</Badge>}</CardTitle></CardHeader>
              <CardContent>
                <FilterableTable<FlujoItem>
                  data={flujo}
                  columns={flujoColumns}
                  maxRows={50}
                  hoverClass="hover:bg-emerald-50/40"
                  onRowDoubleClick={(item) => { setDetailType('flujo'); setDetailRecord(item as unknown as Record<string, unknown>); }}
                  emptyText='Sin ingresos. Ingesta "Flujo Semanal" o "Control de Operaciones" en Fuentes de Datos.'
                />
              </CardContent>
            </Card>

            {/* ── Egresos por Negocio (sub-BU) ──────────────────────────────── */}
            {negocioBreakdown.length > 1 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Building2 className="w-4 h-4 text-[#1A4A28]" />Egresos por Negocio (Sub-BU){buFilter !== 'all' && <Badge variant="info">{buFilter}</Badge>}</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={negocioBreakdown.slice(0, 12).map(n => ({ ...n, negocio: n.negocio.length > 20 ? n.negocio.slice(0, 17) + '...' : n.negocio }))} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                      <YAxis type="category" dataKey="negocio" stroke="#9ca3af" fontSize={9} width={140} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      <Bar dataKey="monto" fill={ARA_COLORS.primary} name="Egresos $" radius={[0, 4, 4, 0]} barSize={16}
                        label={{ position: 'right', formatter: (v: number) => `(${negocioBreakdown.find(n => n.monto === v)?.count || 0})`, fontSize: 9, fill: '#9ca3af' }} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* ── Control Presupuestario & Egresos ─────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Budget control */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Target className="w-4 h-4 text-[#1A4A28]" />Control Presupuestario — Egresos vs Meta</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-3 mb-4">
                    <label className="text-xs text-gray-500 whitespace-nowrap">Meta mensual ($):</label>
                    <input type="number" value={budgetTarget || ''} onChange={e => { const v = parseFloat(e.target.value) || 0; setBudgetTarget(v); localStorage.setItem('cashflow_budget_target', String(v)); }}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 w-32 text-right" placeholder="Ej: 500000" />
                    {budgetTarget > 0 && <Badge variant="info">{formatCompactCurrency(budgetTarget)}/mes</Badge>}
                  </div>
                  {budgetVsReal.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <ComposedChart data={budgetVsReal}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="total" name="Egreso Real $" radius={[4, 4, 0, 0]}>
                          {budgetVsReal.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                        </Bar>
                        <ReferenceLine y={budgetTarget} stroke={ARA_COLORS.gold} strokeDasharray="4 4" label={{ value: 'Meta', position: 'right', fontSize: 10 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="text-xs text-gray-400 text-center py-8">Define una meta mensual para ver el análisis presupuestario.</p>}
                </CardContent>
              </Card>

              {/* Expense control — trend */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingDown className="w-4 h-4 text-red-500" />Tendencia de Egresos Mensual ($)</CardTitle></CardHeader>
                <CardContent>
                  {egresosTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                      <ComposedChart data={egresosTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Bar dataKey="total" fill={ARA_COLORS.red} name="Egresos $" radius={[4, 4, 0, 0]} opacity={0.7} />
                        <Line type="monotone" dataKey="total" stroke={ARA_COLORS.orange} strokeWidth={2} dot={{ r: 3 }} name="Tendencia" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos de egresos." />}
                </CardContent>
              </Card>
            </div>

            {/* ── Predictive Financial Treasury Analytics ─────────────── */}
            <div className="border-t border-gray-200 pt-6 mt-2">
              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#1A4A28]" />
                Predictive Financial Treasury Analytics
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* P1: Cashflow Volatility */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingDown className="w-4 h-4 text-red-500" />Volatilidad de Cashflow Neto</CardTitle></CardHeader>
                <CardContent>
                  {cashflowVolatility.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={cashflowVolatility}>
                        <defs>
                          <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2} /><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine y={0} stroke={ARA_COLORS.red} strokeDasharray="4 4" />
                        <Area type="monotone" dataKey="deviation" stroke="#8B5CF6" strokeWidth={1.5} fill="url(#volGrad)" name="Desviación $" />
                        <Line type="monotone" dataKey="net" stroke={ARA_COLORS.primary} strokeWidth={2} dot={{ r: 2 }} name="Neto Real $" />
                        <Line type="monotone" dataKey="mean" stroke={ARA_COLORS.gold} strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Media $" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Se requieren al menos 2 meses de datos." />}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Desviación del cashflow neto respecto a la media — alta volatilidad = riesgo de liquidez</p>
                </CardContent>
              </Card>

              {/* P2: Egresos Forecast */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="w-4 h-4 text-[#1A4A28]" />Pronóstico de Egresos (SMA-3)</CardTitle></CardHeader>
                <CardContent>
                  {egresosForecast.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={egresosForecast}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="total" name="Egresos $" radius={[3, 3, 0, 0]}>
                          {egresosForecast.map((e, i) => <Cell key={i} fill={e.type === 'forecast' ? ARA_COLORS.gold : ARA_COLORS.red} opacity={e.type === 'forecast' ? 0.6 : 0.8} />)}
                        </Bar>
                        <Line type="monotone" dataKey="total" stroke={ARA_COLORS.orange} strokeWidth={2} dot={{ r: 2 }} name="Tendencia" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos de egresos para pronóstico." />}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Barras doradas = pronóstico basado en promedio móvil simple (SMA-3)</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* P3: Provider Risk Score */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-orange-500" />Score de Riesgo por Proveedor</CardTitle></CardHeader>
                <CardContent>
                  {providerRisk.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={providerRisk} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={8} width={120} />
                        <Tooltip formatter={(v: number, name: string) => name.includes('Días') ? `${v.toFixed(0)} días` : formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="riskScore" fill={ARA_COLORS.red} name="Risk Score $" radius={[0, 4, 4, 0]} opacity={0.7} />
                        <Bar dataKey="amount" fill={ARA_COLORS.primary} name="Monto $" radius={[0, 4, 4, 0]} opacity={0.5} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos de proveedores." />}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Risk Score = Monto × Factor de Aging. Mayor score = mayor riesgo de impago</p>
                </CardContent>
              </Card>

              {/* P4: Coverage Ratio Trend */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="w-4 h-4 text-[#1A4A28]" />Evolución Ratio de Cobertura</CardTitle></CardHeader>
                <CardContent>
                  {coverageTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <ComposedChart data={coverageTrend}>
                        <defs>
                          <linearGradient id="covGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                        <YAxis yAxisId="left" stroke="#9ca3af" fontSize={10} />
                        <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine yAxisId="left" y={1} stroke={ARA_COLORS.red} strokeDasharray="4 4" label={{ value: '1.0x', position: 'right', fontSize: 9, fill: ARA_COLORS.red }} />
                        <ReferenceLine yAxisId="left" y={1.5} stroke={ARA_COLORS.gold} strokeDasharray="4 4" label={{ value: '1.5x', position: 'right', fontSize: 9, fill: ARA_COLORS.gold }} />
                        <Area yAxisId="left" type="monotone" dataKey="ratio" stroke="#22c55e" strokeWidth={2.5} fill="url(#covGrad)" name="Ratio Cobertura" />
                        <Bar yAxisId="right" dataKey="inflow" fill={ARA_COLORS.primary} name="Ingresos $" radius={[2, 2, 0, 0]} opacity={0.3} />
                        <Bar yAxisId="right" dataKey="outflow" fill={ARA_COLORS.red} name="Egresos $" radius={[2, 2, 0, 0]} opacity={0.3} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos para ratio de cobertura." />}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Ratio &lt; 1.0 = déficit · 1.0-1.5 = ajustado · &gt; 1.5 = saludable</p>
                </CardContent>
              </Card>
            </div>

            {/* Process-Gap Narrative with Lang Toggle */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="w-4 h-4 text-[#C9A84C]" />{lang === 'es' ? 'Hallazgos de Proceso — KPIs & Riesgos' : 'Process Findings — KPIs & Risks'}</CardTitle>
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
                              ? (item.type === 'risk' ? 'Riesgo Proceso' : item.type === 'action' ? 'Acción' : 'Hallazgo')
                              : (item.type === 'risk' ? 'Process Risk' : item.type === 'action' ? 'Action' : 'Finding')}
                          </span>
                          <p className="text-sm text-gray-800 mt-0.5">{lang === 'es' ? item.text : item.textEn}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-gray-400 text-center py-6">{lang === 'es' ? 'Insights basados en KPIs de proceso se generan al cargar datos.' : 'Process KPI insights will appear once data is loaded.'}</p>}
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-4 flex-wrap">
                <span>{cxp.length} CxP</span><span>{flujo.length} ingresos/operaciones</span>
                <span>{projection.length} meses proyección</span>
                <span>BU: {buFilter === 'all' ? 'Todas' : buFilter}</span>
                {provFilter !== 'all' && <span>Prov: {provFilter}</span>}
                {negocioFilter !== 'all' && <span>Neg: {negocioFilter}</span>}
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
