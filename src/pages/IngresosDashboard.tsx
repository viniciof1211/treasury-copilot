import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TrendingUp, TrendingDown, AlertTriangle, Lightbulb, RefreshCw,
  Wallet, DollarSign, Users, Receipt, BarChart3, Clock, ShieldCheck,
  Target, FileText, CalendarDays, Banknote, Building2, Activity,
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { RecordDetailModal, type FieldDef } from '../components/ui/RecordDetailModal';
import {
  formatCurrency, formatCompactCurrency, formatMonthYear, formatShortDate,
  semaphore, ARA_COLORS, formatDate, formatPercent,
} from '../lib/utils';
import { useExchangeRate, toUSD, normalizeCurrency } from '../hooks/useExchangeRate';
import {
  querySQL, type FlujoItem, type CxCItem, type Projection,
  type TimePeriod, getDateCutoff, PERIOD_LABELS, tooltipStyle,
} from '../lib/queries';
import { supabase } from '../lib/supabase';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Line, ReferenceLine, PieChart, Pie, Cell,
} from 'recharts';
import { FilterableTable, type ColumnDef } from '../components/ui/FilterableTable';

// ── Field definitions for detail modals ──────────────────────────────────────

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

const CXC_FIELDS: FieldDef[] = [
  { key: 'cliente', label: 'Cliente', type: 'text', group: 'Información General' },
  { key: 'empresa', label: 'Empresa / BU', type: 'text' },
  { key: 'factura', label: 'No. Factura', type: 'text' },
  { key: 'area_comercial', label: 'Área Comercial', type: 'text' },
  { key: 'gestor_cobro', label: 'Gestor de Cobro', type: 'text' },
  { key: 'monto', label: 'Monto', type: 'currency', group: 'Financiero', highlight: true },
  { key: 'moneda', label: 'Moneda', type: 'select', options: ['CRC', 'USD', 'EUR'] },
  { key: 'estado', label: 'Estado', type: 'select', options: ['Pendiente', 'Pagada', 'Vencida', 'Parcial'] },
  { key: 'tipo', label: 'Tipo', type: 'select', options: ['Normal', 'Adelanto Proyecto', 'Nota Credito'] },
  { key: 'fecha_factura', label: 'Fecha Factura', type: 'date', group: 'Plazos' },
  { key: 'vencimiento', label: 'Vencimiento', type: 'date' },
  { key: 'dias_mora', label: 'Días en Mora', type: 'readonly', suffix: 'días' },
  { key: 'proyecto', label: 'Proyecto', type: 'text', group: 'Detalle' },
  { key: 'hito', label: 'Hito', type: 'text' },
  { key: 'notas', label: 'Notas', type: 'text' },
  { key: 'ingest_run_id', label: 'Run de Ingesta', type: 'readonly', group: 'Metadata' },
  { key: 'created_at', label: 'Fecha de Creación', type: 'readonly' },
];

// ── Colors ───────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#1A4A28', '#2E7D4A', '#4CAF50', '#66BB6A', '#81C784',
  '#A5D6A7', '#C8E6C9', '#1565C0', '#1E88E5', '#42A5F5',
];
const AGING_COLORS = ['#4CAF50', '#FFCA28', '#FF9800', '#F44336', '#B71C1C'];

// ── Component ────────────────────────────────────────────────────────────────

export function IngresosDashboard() {
  const [flujo, setFlujo] = useState<FlujoItem[]>([]);
  const [cxc, setCxc] = useState<CxCItem[]>([]);
  const [projections, setProjections] = useState<Projection[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [detailRecord, setDetailRecord] = useState<Record<string, unknown> | null>(null);
  const [detailType, setDetailType] = useState<'flujo' | 'cxc'>('flujo');
  const { rate } = useExchangeRate();

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch flujo semanal (income proxy)
      const { data: flujoData } = await supabase
        .schema('silver_finance' as 'public')
        .from('flujo_semanal')
        .select('*');

      // Fetch CxC items (if any exist)
      const { data: cxcData } = await supabase
        .schema('silver_finance' as 'public')
        .from('cxc_items')
        .select('*');

      // Fetch projections
      const { data: projData } = await supabase
        .schema('silver_finance' as 'public')
        .from('projection_12m')
        .select('*')
        .order('projection_month', { ascending: true });

      setFlujo((flujoData as FlujoItem[]) || []);
      // Compute dias_mora dynamically (CURRENT_DATE - vencimiento)
      const cxcWithMora = ((cxcData as CxCItem[]) || []).map(c => {
        if (c.vencimiento) {
          const today = new Date();
          const venc = new Date(c.vencimiento);
          c.dias_mora = Math.max(0, Math.floor((today.getTime() - venc.getTime()) / (1000 * 60 * 60 * 24)));
        }
        return c;
      });
      setCxc(cxcWithMora);
      setProjections((projData as Projection[]) || []);
    } catch (e) {
      console.error('IngresosDashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Currency helper ──────────────────────────────────────────────────────

  const asUSD = useCallback(
    (amount: number, moneda?: string) => toUSD(amount, moneda || 'USD', rate),
    [rate],
  );

  // ── Filtered data ────────────────────────────────────────────────────────

  const filteredFlujo = useMemo(() => {
    const cutoff = getDateCutoff(period);
    if (!cutoff) return flujo;
    return flujo.filter(f => f.vencimiento >= cutoff || f.semana_inicio >= cutoff);
  }, [flujo, period]);

  const filteredCxc = useMemo(() => {
    const cutoff = getDateCutoff(period);
    if (!cutoff) return cxc;
    return cxc.filter(c => c.vencimiento >= cutoff);
  }, [cxc, period]);

  const hasCxc = cxc.length > 0;

  // ── KPI calculations ────────────────────────────────────────────────────

  const totalIngresos = useMemo(
    () => filteredFlujo.reduce((s, f) => s + asUSD(f.cuota || 0, f.moneda), 0),
    [filteredFlujo, asUSD],
  );

  const totalPrincipal = useMemo(
    () => filteredFlujo.reduce((s, f) => s + asUSD(f.principal || 0, f.moneda), 0),
    [filteredFlujo, asUSD],
  );

  const totalIntereses = useMemo(
    () => filteredFlujo.reduce((s, f) => s + asUSD(f.intereses || 0, f.moneda), 0),
    [filteredFlujo, asUSD],
  );

  // Monthly average income
  const monthsInData = useMemo(() => {
    if (filteredFlujo.length === 0) return 1;
    const dates = filteredFlujo.map(f => f.vencimiento || f.semana_inicio).filter(Boolean).sort();
    if (dates.length < 2) return 1;
    const first = new Date(dates[0]);
    const last = new Date(dates[dates.length - 1]);
    return Math.max(1, (last.getTime() - first.getTime()) / (30 * 24 * 3600 * 1000));
  }, [filteredFlujo]);

  const avgMonthlyIncome = totalIngresos / monthsInData;

  // Budget target: 110% of average monthly income
  const budgetTarget = avgMonthlyIncome * 1.1;

  // CxC KPIs
  const totalCxcPendiente = useMemo(
    () => filteredCxc.filter(c => c.estado !== 'Pagada').reduce((s, c) => s + asUSD(c.monto || 0, c.moneda), 0),
    [filteredCxc, asUSD],
  );

  const cxcTotalFacturas = filteredCxc.length;
  const cxcPagadas = filteredCxc.filter(c => c.estado === 'Pagada').length;
  const tasaCobro = cxcTotalFacturas > 0 ? (cxcPagadas / cxcTotalFacturas) * 100 : 0;

  const dso = useMemo(() => {
    const vencidas = filteredCxc.filter(c => (c.dias_mora || 0) > 0);
    if (vencidas.length === 0) return 0;
    return vencidas.reduce((s, c) => s + (c.dias_mora || 0), 0) / vencidas.length;
  }, [filteredCxc]);

  // Projected inflows 3M
  const projected3M = useMemo(() => {
    const today = new Date();
    const threeMonths = new Date(today);
    threeMonths.setMonth(threeMonths.getMonth() + 3);
    return projections
      .filter(p => p.projection_month >= today.toISOString().slice(0, 7) && p.projection_month <= threeMonths.toISOString().slice(0, 7))
      .reduce((s, p) => s + (p.projected_inflows || 0), 0);
  }, [projections]);

  // Top 3 client concentration (CxC)
  const top3Concentration = useMemo(() => {
    if (!hasCxc) return 0;
    const byClient: Record<string, number> = {};
    filteredCxc.forEach(c => {
      const key = c.cliente || 'N/D';
      byClient[key] = (byClient[key] || 0) + asUSD(c.monto || 0, c.moneda);
    });
    const sorted = Object.values(byClient).sort((a, b) => b - a);
    const total = sorted.reduce((s, v) => s + v, 0);
    const top3 = sorted.slice(0, 3).reduce((s, v) => s + v, 0);
    return total > 0 ? (top3 / total) * 100 : 0;
  }, [filteredCxc, hasCxc, asUSD]);

  // ── Chart data ───────────────────────────────────────────────────────────

  // Chart 1 & 2: Monthly income timeline
  const monthlyIncome = useMemo(() => {
    const map: Record<string, { real: number; count: number }> = {};
    filteredFlujo.forEach(f => {
      const mo = (f.vencimiento || f.semana_inicio || '').slice(0, 7);
      if (!mo) return;
      if (!map[mo]) map[mo] = { real: 0, count: 0 };
      map[mo].real += asUSD(f.cuota || 0, f.moneda);
      map[mo].count += 1;
    });
    const months = Object.keys(map).sort();
    let cumulative = 0;
    return months.map(mo => {
      cumulative += map[mo].real;
      const proj = projections.find(p => p.projection_month === mo);
      return {
        month: mo,
        label: formatMonthYear(mo + '-01'),
        real: Math.round(map[mo].real),
        projected: proj ? Math.round(proj.projected_inflows || 0) : null,
        cumulative: Math.round(cumulative),
        budget: Math.round(budgetTarget),
        ops: map[mo].count,
      };
    });
  }, [filteredFlujo, projections, budgetTarget, asUSD]);

  // Chart 3: Income by BU
  const incomeByBU = useMemo(() => {
    const map: Record<string, number> = {};
    filteredFlujo.forEach(f => {
      const bu = f.compania || 'N/D';
      map[bu] = (map[bu] || 0) + asUSD(f.cuota || 0, f.moneda);
    });
    return Object.entries(map)
      .map(([bu, amount]) => ({ bu, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredFlujo, asUSD]);

  const totalBU = incomeByBU.reduce((s, b) => s + b.amount, 0);

  // Chart 4: Income by credit type (donut)
  const incomeByTipo = useMemo(() => {
    const map: Record<string, number> = {};
    filteredFlujo.forEach(f => {
      const tipo = f.tipo || 'Otro';
      map[tipo] = (map[tipo] || 0) + asUSD(f.cuota || 0, f.moneda);
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value);
  }, [filteredFlujo, asUSD]);

  // Chart 5: CxC Aging
  const agingData = useMemo(() => {
    const buckets = [
      { label: 'Corriente', min: -Infinity, max: 0, amount: 0, count: 0 },
      { label: '1–30 días', min: 1, max: 30, amount: 0, count: 0 },
      { label: '31–60 días', min: 31, max: 60, amount: 0, count: 0 },
      { label: '61–90 días', min: 61, max: 90, amount: 0, count: 0 },
      { label: '90+ días', min: 91, max: Infinity, amount: 0, count: 0 },
    ];
    filteredCxc.forEach(c => {
      const dias = c.dias_mora || 0;
      const bucket = buckets.find(b => dias >= b.min && dias <= b.max);
      if (bucket) {
        bucket.amount += asUSD(c.monto || 0, c.moneda);
        bucket.count += 1;
      }
    });
    return buckets.map(b => ({ ...b, amount: Math.round(b.amount) }));
  }, [filteredCxc, asUSD]);

  // Chart 6: Top 10 Clients by CxC
  const topClients = useMemo(() => {
    const map: Record<string, number> = {};
    filteredCxc.filter(c => c.estado !== 'Pagada').forEach(c => {
      const key = c.cliente || 'N/D';
      map[key] = (map[key] || 0) + asUSD(c.monto || 0, c.moneda);
    });
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
  }, [filteredCxc, asUSD]);

  // Chart 7: Monthly collection trend
  const collectionTrend = useMemo(() => {
    const byMonth: Record<string, { total: number; collected: number }> = {};
    filteredCxc.forEach(c => {
      const mo = (c.vencimiento || '').slice(0, 7);
      if (!mo) return;
      if (!byMonth[mo]) byMonth[mo] = { total: 0, collected: 0 };
      byMonth[mo].total += asUSD(c.monto || 0, c.moneda);
      if (c.estado === 'Pagada') byMonth[mo].collected += asUSD(c.monto || 0, c.moneda);
    });
    return Object.keys(byMonth).sort().map(mo => ({
      month: mo,
      label: formatMonthYear(mo + '-01'),
      efficiency: byMonth[mo].total > 0 ? Math.round((byMonth[mo].collected / byMonth[mo].total) * 100) : 0,
      target: 95,
    }));
  }, [filteredCxc, asUSD]);

  // Chart 8: Income by Bank
  const incomeByBanco = useMemo(() => {
    const map: Record<string, number> = {};
    filteredFlujo.forEach(f => {
      const bank = f.banco || 'N/D';
      map[bank] = (map[bank] || 0) + asUSD(f.cuota || 0, f.moneda);
    });
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredFlujo, asUSD]);

  // Chart 9: Budget gap (waterfall-style)
  const budgetGap = useMemo(() => {
    return monthlyIncome.map(m => ({
      ...m,
      gap: m.real - m.budget,
      fill: m.real >= m.budget ? '#4CAF50' : '#F44336',
    }));
  }, [monthlyIncome]);

  // Chart 10: Income scenarios 12M
  const scenarioData = useMemo(() => {
    return monthlyIncome.map(m => ({
      ...m,
      optimistic: Math.round(m.real * 1.15),
      pessimistic: Math.round(m.real * 0.80),
      breakeven: Math.round(budgetTarget * 0.9),
    }));
  }, [monthlyIncome, budgetTarget]);

  // ── Predictive Analytics ─────────────────────────────────────────────────────

  // P1: Income Forecast — SMA-3 extrapolation
  const incomeForecast = useMemo(() => {
    if (monthlyIncome.length < 2) return [] as (typeof monthlyIncome[0] & { type: string })[];
    const hist = monthlyIncome.map(m => ({ ...m, type: 'real' as string }));
    const w = Math.min(3, hist.length);
    const avg = hist.slice(-w).reduce((s, m) => s + m.real, 0) / w;
    const last = hist[hist.length - 1].month;
    const fc: typeof hist = [];
    for (let i = 1; i <= 6; i++) {
      const d = new Date(last + '-01'); d.setMonth(d.getMonth() + i);
      const mo = d.toISOString().slice(0, 7);
      fc.push({ month: mo, label: formatMonthYear(mo + '-01'), real: Math.round(avg * (1 + i * 0.01)), projected: null, cumulative: 0, budget: Math.round(budgetTarget), ops: 0, type: 'forecast' as string });
    }
    return [...hist, ...fc];
  }, [monthlyIncome, budgetTarget]);

  // P2: CxC Recovery Projection — expected collection timeline
  const cxcRecovery = useMemo(() => {
    if (!hasCxc) return [] as { month: string; label: string; pending: number; expected: number; atRisk: number }[];
    const byMonth: Record<string, { month: string; pending: number; expected: number; atRisk: number }> = {};
    filteredCxc.filter(c => c.estado !== 'Pagada').forEach(c => {
      const mo = (c.vencimiento || '').slice(0, 7);
      if (!mo) return;
      if (!byMonth[mo]) byMonth[mo] = { month: mo, pending: 0, expected: 0, atRisk: 0 };
      const amt = asUSD(c.monto || 0, c.moneda);
      byMonth[mo].pending += amt;
      if ((c.dias_mora || 0) <= 30) byMonth[mo].expected += amt * 0.9;
      else if ((c.dias_mora || 0) <= 60) byMonth[mo].expected += amt * 0.7;
      else byMonth[mo].atRisk += amt;
    });
    return Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({ ...m, label: formatMonthYear(m.month + '-01') }));
  }, [filteredCxc, hasCxc, asUSD]);

  // P3: Client Risk Matrix — amount vs aging days
  const clientRisk = useMemo(() => {
    if (!hasCxc) return [] as { name: string; amount: number; avgDays: number; count: number; riskScore: number }[];
    const m: Record<string, { name: string; amount: number; avgDays: number; count: number; riskScore: number }> = {};
    filteredCxc.filter(c => c.estado !== 'Pagada').forEach(c => {
      const cl = c.cliente || 'N/D';
      const amt = asUSD(c.monto || 0, c.moneda);
      const days = c.dias_mora || 0;
      if (!m[cl]) m[cl] = { name: cl, amount: 0, avgDays: 0, count: 0, riskScore: 0 };
      m[cl].amount += amt;
      m[cl].avgDays += days;
      m[cl].count++;
      m[cl].riskScore += amt * Math.max(1, days / 30);
    });
    return Object.values(m)
      .map(v => ({ ...v, avgDays: v.count > 0 ? Math.round(v.avgDays / v.count) : 0, name: v.name.length > 20 ? v.name.slice(0, 17) + '...' : v.name }))
      .sort((a, b) => b.riskScore - a.riskScore).slice(0, 10);
  }, [filteredCxc, hasCxc, asUSD]);

  // P4: Income Volatility
  const incomeVolatility = useMemo(() => {
    if (monthlyIncome.length < 2) return [] as (typeof monthlyIncome[0] & { deviation: number; mean: number })[];
    const mean = monthlyIncome.reduce((s, m) => s + m.real, 0) / monthlyIncome.length;
    return monthlyIncome.map(m => ({
      ...m,
      deviation: m.real - mean,
      mean: Math.round(mean),
    }));
  }, [monthlyIncome]);

  // ── FilterableTable column defs ─────────────────────────────────────────────
  const flujoColumns: ColumnDef<FlujoItem>[] = useMemo(() => [
    { key: 'operacion', header: 'Operación', render: (r) => <span className="font-medium text-gray-900">{r.operacion || '—'}</span>, filterType: 'text' },
    { key: 'compania', header: 'Compañía', render: (r) => <span>{r.compania || '—'}</span>, filterType: 'select' },
    { key: 'banco', header: 'Banco', render: (r) => <span>{r.banco || '—'}</span>, filterType: 'select' },
    { key: 'tipo', header: 'Tipo', render: (r) => <Badge variant="default" className="text-[10px]">{r.tipo || '—'}</Badge>, filterType: 'select' },
    { key: 'cuota', header: 'Cuota', align: 'right', render: (r) => <span className="font-semibold text-emerald-700">{formatCurrency(r.cuota || 0, normalizeCurrency(r.moneda))}</span>, accessor: (r) => asUSD(r.cuota || 0, r.moneda) },
    { key: 'principal', header: 'Principal', align: 'right', render: (r) => <span>{formatCurrency(r.principal || 0, normalizeCurrency(r.moneda))}</span>, accessor: (r) => Number(r.principal) || 0 },
    { key: 'intereses', header: 'Intereses', align: 'right', render: (r) => <span>{formatCurrency(r.intereses || 0, normalizeCurrency(r.moneda))}</span>, accessor: (r) => Number(r.intereses) || 0 },
    { key: 'vencimiento', header: 'Vencimiento', render: (r) => <span>{r.vencimiento ? formatShortDate(r.vencimiento) : '—'}</span>, accessor: (r) => r.vencimiento || '' },
    { key: 'moneda', header: 'Moneda', render: (r) => <Badge variant="info" className="text-[10px]">{normalizeCurrency(r.moneda)}</Badge>, filterType: 'select', accessor: (r) => normalizeCurrency(r.moneda) },
  ], [asUSD]);

  const cxcColumns: ColumnDef<CxCItem>[] = useMemo(() => [
    { key: 'cliente', header: 'Cliente', render: (r) => <span className="font-medium text-gray-900">{r.cliente || '—'}</span>, filterType: 'text' },
    { key: 'factura', header: 'Factura', render: (r) => <span>{r.factura || '—'}</span>, filterType: 'text' },
    { key: 'empresa', header: 'Empresa', render: (r) => <span>{r.empresa || '—'}</span>, filterType: 'select' },
    { key: 'monto', header: 'Monto', align: 'right', render: (r) => <span className="font-semibold">{formatCurrency(r.monto || 0, normalizeCurrency(r.moneda))}</span>, accessor: (r) => asUSD(r.monto || 0, r.moneda) },
    { key: 'estado', header: 'Estado', render: (r) => <Badge variant={r.estado === 'Vencida' ? 'error' : r.estado === 'Parcial' ? 'warning' : 'default'} className="text-[10px]">{r.estado}</Badge>, filterType: 'select' },
    { key: 'dias_mora', header: 'Días Mora', align: 'right', render: (r) => { const mora = r.dias_mora || 0; const color = mora === 0 ? 'text-green-600' : mora <= 30 ? 'text-amber-600' : mora <= 60 ? 'text-orange-600' : 'text-red-600'; return <span className={`font-semibold ${color}`}>{mora}</span>; }, accessor: (r) => r.dias_mora || 0 },
    { key: 'vencimiento', header: 'Vencimiento', render: (r) => <span>{r.vencimiento ? formatShortDate(r.vencimiento) : '—'}</span>, accessor: (r) => r.vencimiento || '' },
    { key: 'area_comercial', header: 'Área', render: (r) => <span>{r.area_comercial || '—'}</span>, filterType: 'select' },
  ], [asUSD]);

  // ── Narrative ────────────────────────────────────────────────────────────

  const narrative = useMemo(() => {
    const insights: string[] = [];
    const risks: string[] = [];
    const actions: string[] = [];

    // Insights
    if (totalIngresos > 0) {
      insights.push(`Ingresos operativos totales: ${formatCurrency(totalIngresos, 'USD')} en el periodo seleccionado (${filteredFlujo.length} operaciones).`);
    }
    if (incomeByBU.length > 0) {
      const topBU = incomeByBU[0];
      const pct = totalBU > 0 ? ((topBU.amount / totalBU) * 100).toFixed(1) : '0';
      insights.push(`La unidad de negocio "${topBU.bu}" lidera con ${formatCurrency(topBU.amount, 'USD')} (${pct}% del total).`);
    }
    if (avgMonthlyIncome > 0) {
      insights.push(`Ingreso promedio mensual: ${formatCurrency(Math.round(avgMonthlyIncome), 'USD')}.`);
    }

    // Risks
    if (hasCxc && totalCxcPendiente > 0) {
      risks.push(`CxC pendiente: ${formatCurrency(totalCxcPendiente, 'USD')} — capital inmovilizado que afecta liquidez.`);
    }
    if (hasCxc && dso > 60) {
      risks.push(`DSO promedio de ${dso.toFixed(0)} días — superior al objetivo de 60 días.`);
    }
    if (hasCxc && top3Concentration > 60) {
      risks.push(`Alta concentración: Top 3 clientes representan ${top3Concentration.toFixed(1)}% de CxC.`);
    }
    if (monthlyIncome.length > 0) {
      const belowBudget = monthlyIncome.filter(m => m.real < m.budget);
      if (belowBudget.length > 0) {
        risks.push(`${belowBudget.length} de ${monthlyIncome.length} meses con ingresos bajo presupuesto objetivo.`);
      }
    }

    // Actions
    actions.push('Revisar facturas vencidas y priorizar gestión de cobro para reducir DSO.');
    if (projected3M > 0) {
      actions.push(`Ingresos proyectados 3M: ${formatCurrency(projected3M, 'USD')} — asegurar cumplimiento de hitos.`);
    }
    actions.push('Diversificar cartera de clientes para reducir riesgo de concentración.');

    return { insights, risks, actions };
  }, [totalIngresos, incomeByBU, avgMonthlyIncome, totalBU, hasCxc, totalCxcPendiente, dso, top3Concentration, monthlyIncome, projected3M, filteredFlujo.length]);

  // ── Render ───────────────────────────────────────────────────────────────

  const hasData = flujo.length > 0 || cxc.length > 0;
  const fc = (amount: number, cur?: string) => formatCurrency(amount, cur || 'USD');
  const fcc = (amount: number, cur?: string) => formatCompactCurrency(amount, cur || 'USD');

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ingresos / CxC</h1>
            <p className="text-sm text-gray-500">
              Control de ingresos operativos, cuentas por cobrar y presupuesto — Montos en $ USD
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Period filters */}
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              {(Object.keys(PERIOD_LABELS) as TimePeriod[]).map(p => (
                <button key={p} onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p ? 'bg-white text-[#1A4A28] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
            <button onClick={fetchData} disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#1A4A28] bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading && !hasData ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-sm">Cargando datos de ingresos...</p>
          </div>
        ) : (
          <>
            {/* ── KPI Row ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
              <KPICard title="Total Ingresos Período" value={totalIngresos} icon={Wallet} currency="USD"
                semaphore={totalIngresos > 0 ? 'green' : 'red'} subtitle={`${filteredFlujo.length} operaciones`} />
              <KPICard title="Proyección 3M" value={projected3M} icon={TrendingUp} currency="USD"
                semaphore={projected3M > 0 ? 'green' : 'yellow'} subtitle="Próximos 3 meses" />
              <KPICard title="Ingreso Promedio Mensual" value={Math.round(avgMonthlyIncome)} icon={BarChart3} currency="USD"
                semaphore={avgMonthlyIncome > 0 ? 'green' : 'yellow'} subtitle={`~${monthsInData.toFixed(0)} meses`} />
              <KPICard title="Presupuesto vs Real" value={budgetTarget > 0 ? `${((totalIngresos / (budgetTarget * monthsInData)) * 100).toFixed(0)}%` : '—'} icon={Target} format="text"
                semaphore={totalIngresos >= budgetTarget * monthsInData ? 'green' : totalIngresos >= budgetTarget * monthsInData * 0.8 ? 'yellow' : 'red'}
                subtitle={`Objetivo: ${fcc(budgetTarget)}/mes`} />
            </div>

            {/* CxC KPIs (shown always, gracefully handle empty) */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
              <KPICard title="CxC Pendiente" value={hasCxc ? totalCxcPendiente : 0} icon={Receipt} currency="USD"
                semaphore={!hasCxc ? 'yellow' : totalCxcPendiente > 0 ? 'red' : 'green'}
                subtitle={hasCxc ? `${filteredCxc.filter(c => c.estado !== 'Pagada').length} facturas` : 'Sin datos CxC'} />
              <KPICard title="Tasa de Cobro" value={hasCxc ? `${tasaCobro.toFixed(1)}%` : '—'} icon={ShieldCheck} format="text"
                semaphore={!hasCxc ? 'yellow' : tasaCobro >= 80 ? 'green' : tasaCobro >= 50 ? 'yellow' : 'red'}
                subtitle={hasCxc ? `${cxcPagadas}/${cxcTotalFacturas} cobradas` : 'Sin datos CxC'} />
              <KPICard title="DSO Promedio" value={hasCxc ? `${dso.toFixed(0)} días` : '—'} icon={Clock} format="text"
                semaphore={!hasCxc ? 'yellow' : dso <= 30 ? 'green' : dso <= 60 ? 'yellow' : 'red'}
                subtitle={hasCxc ? 'Días promedio cobro' : 'Sin datos CxC'} />
              <KPICard title="Concentración Top 3" value={hasCxc ? `${top3Concentration.toFixed(1)}%` : '—'} icon={Users} format="text"
                semaphore={!hasCxc ? 'yellow' : top3Concentration <= 50 ? 'green' : top3Concentration <= 70 ? 'yellow' : 'red'}
                subtitle={hasCxc ? '% CxC en 3 clientes' : 'Sin datos CxC'} />
            </div>

            {/* ── Row 1: Income Timeline ─────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 1: Historical + Projected Income */}
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Ingresos Históricos + Proyección</CardTitle></CardHeader>
                <CardContent>
                  {monthlyIncome.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={monthlyIncome}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={v => fcc(v)} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="real" name="Ingreso Real" fill="#1A4A28" radius={[4, 4, 0, 0]} />
                        <Line dataKey="projected" name="Proyectado" stroke="#42A5F5" strokeWidth={2} dot={false} strokeDasharray="5 5" />
                        <Area dataKey="cumulative" name="Acumulado" fill="#E8F5E9" stroke="#81C784" fillOpacity={0.3} />
                        <ReferenceLine y={budgetTarget} stroke="#FF9800" strokeDasharray="3 3" label={{ value: 'Meta', position: 'right', fontSize: 10 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-12">Sin datos de ingresos</p>
                  )}
                </CardContent>
              </Card>

              {/* Chart 2: Budget vs Real vs Projected */}
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Presupuesto vs Real vs Proyectado</CardTitle></CardHeader>
                <CardContent>
                  {monthlyIncome.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={monthlyIncome}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={v => fcc(v)} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="real" name="Real" fill="#2E7D4A" radius={[4, 4, 0, 0]} />
                        <Line dataKey="budget" name="Presupuesto" stroke="#FF9800" strokeWidth={2} strokeDasharray="5 5" />
                        <Line dataKey="projected" name="Proyectado" stroke="#1565C0" strokeWidth={2} dot={false} strokeDasharray="8 4" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-12">Sin datos de ingresos</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Row 2: Income Composition ───────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 3: Income by BU */}
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Ingresos por Unidad de Negocio</CardTitle></CardHeader>
                <CardContent>
                  {incomeByBU.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={incomeByBU} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tickFormatter={v => fcc(v)} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="bu" tick={{ fontSize: 10 }} width={120} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Bar dataKey="amount" name="Ingreso" fill="#1A4A28" radius={[0, 4, 4, 0]}
                          label={{ position: 'right', formatter: (v: number) => totalBU > 0 ? `${((v / totalBU) * 100).toFixed(0)}%` : '', fontSize: 10 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-12">Sin datos de ingresos</p>
                  )}
                </CardContent>
              </Card>

              {/* Chart 4: Income by Credit Type (Donut) */}
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Composición por Tipo de Crédito</CardTitle></CardHeader>
                <CardContent>
                  {incomeByTipo.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={incomeByTipo} cx="50%" cy="50%" innerRadius={60} outerRadius={100}
                          paddingAngle={3} dataKey="value" nameKey="name"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                          {incomeByTipo.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-12">Sin datos de ingresos</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Row 3: CxC Receivables Analysis ────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 5: CxC Aging */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Aging de CxC — Antigüedad de Cartera</CardTitle>
                </CardHeader>
                <CardContent>
                  {hasCxc ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={agingData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={v => fcc(v)} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Bar dataKey="amount" name="Monto CxC" radius={[4, 4, 0, 0]}
                          label={{ position: 'top', formatter: (v: number) => fcc(v), fontSize: 9 }}>
                          {agingData.map((_, i) => (
                            <Cell key={i} fill={AGING_COLORS[i]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Sin datos de CxC</p>
                      <p className="text-xs mt-1">Sube un archivo de Cuentas por Cobrar en Fuentes de Datos</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Chart 6: Top 10 Clients */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">CxC por Cliente — Top 10</CardTitle>
                </CardHeader>
                <CardContent>
                  {hasCxc && topClients.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={topClients} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" tickFormatter={v => fcc(v)} tick={{ fontSize: 10 }} />
                        <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={130} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Bar dataKey="amount" name="CxC Pendiente" fill="#F44336" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <Users className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Sin datos de CxC</p>
                      <p className="text-xs mt-1">Sube un archivo de Cuentas por Cobrar en Fuentes de Datos</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Row 4: Collection Efficiency & Banks ─────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 7: Collection Trend */}
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Tendencia de Cobro Mensual</CardTitle></CardHeader>
                <CardContent>
                  {hasCxc && collectionTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={collectionTrend}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => `${v}%`} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area dataKey="efficiency" name="Eficiencia Cobro" fill="#E8F5E9" stroke="#4CAF50" fillOpacity={0.4} />
                        <ReferenceLine y={95} stroke="#FF9800" strokeDasharray="3 3" label={{ value: 'Objetivo 95%', position: 'right', fontSize: 10 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p className="text-sm">Sin datos de CxC</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Chart 8: Income by Bank */}
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Ingresos por Banco / Fuente</CardTitle></CardHeader>
                <CardContent>
                  {incomeByBanco.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={incomeByBanco}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="name" tick={{ fontSize: 9 }} />
                        <YAxis tickFormatter={v => fcc(v)} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Bar dataKey="amount" name="Ingreso por Banco" fill="#1565C0" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-12">Sin datos de ingresos</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Row 5: Budget & Scenarios ───────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Chart 9: Budget Gap */}
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Gap Presupuesto vs Real</CardTitle></CardHeader>
                <CardContent>
                  {budgetGap.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={budgetGap}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={v => fcc(v)} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="gap" name="Gap (Real - Meta)">
                          {budgetGap.map((entry, i) => (
                            <Cell key={i} fill={entry.fill} />
                          ))}
                        </Bar>
                        <ReferenceLine y={0} stroke="#333" strokeWidth={2} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-12">Sin datos de ingresos</p>
                  )}
                </CardContent>
              </Card>

              {/* Chart 10: Income Scenarios */}
              <Card>
                <CardHeader><CardTitle className="text-sm font-semibold">Escenarios de Ingreso 12M</CardTitle></CardHeader>
                <CardContent>
                  {scenarioData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={scenarioData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={v => fcc(v)} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Area dataKey="optimistic" name="Optimista (+15%)" fill="#E8F5E9" stroke="#4CAF50" fillOpacity={0.2} />
                        <Line dataKey="real" name="Base (Real)" stroke="#1A4A28" strokeWidth={2} dot={false} />
                        <Area dataKey="pessimistic" name="Pesimista (-20%)" fill="#FFEBEE" stroke="#F44336" fillOpacity={0.2} />
                        <ReferenceLine y={Math.round(budgetTarget * 0.9)} stroke="#FF9800" strokeDasharray="3 3"
                          label={{ value: 'Break-even', position: 'right', fontSize: 10 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-400 text-center py-12">Sin datos para escenarios</p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Detail Table: Ingresos por Operación (Flujo) with filters ─── */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Detalle de Ingresos por Operación</CardTitle>
                  <Badge variant="info">{filteredFlujo.length} operaciones</Badge>
                </div>
                <p className="text-xs text-gray-400 mt-1">Fuente: Flujo Semanal</p>
              </CardHeader>
              <CardContent>
                <FilterableTable<FlujoItem>
                  data={filteredFlujo}
                  columns={flujoColumns}
                  maxRows={50}
                  hoverClass="hover:bg-emerald-50/50"
                  onRowDoubleClick={(item) => { setDetailRecord(item as unknown as Record<string, unknown>); setDetailType('flujo'); }}
                  emptyText="Sin operaciones de ingreso."
                />
                <div className="flex justify-between items-center mt-3 text-xs text-gray-400 px-2">
                  <span>Total Ingresos: {fc(totalIngresos)} · Principal: {fc(totalPrincipal)} · Intereses: {fc(totalIntereses)}</span>
                  <span>Montos en USD</span>
                </div>
              </CardContent>
            </Card>

            {/* ── Detail Table: CxC Pendientes with filters ──────────────── */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold">Detalle CxC Pendientes</CardTitle>
                  <Badge variant={hasCxc ? 'warning' : 'default'}>
                    {hasCxc ? `${filteredCxc.filter(c => c.estado !== 'Pagada').length} pendientes` : 'Sin datos CxC'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                {hasCxc ? (
                  <FilterableTable<CxCItem>
                    data={filteredCxc.filter(c => c.estado !== 'Pagada')}
                    columns={cxcColumns}
                    maxRows={50}
                    hoverClass="hover:bg-amber-50/50"
                    onRowDoubleClick={(item) => { setDetailRecord(item as unknown as Record<string, unknown>); setDetailType('cxc'); }}
                    emptyText="Sin CxC pendientes."
                  />
                ) : (
                  <div className="text-center py-12 text-gray-400">
                    <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-medium">Sin datos de Cuentas por Cobrar</p>
                    <p className="text-xs mt-1 max-w-md mx-auto">
                      Para ver el análisis de CxC, sube un archivo Excel con columnas como Cliente, Factura, Monto, Vencimiento, Estado en la sección de Fuentes de Datos.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Predictive Financial Treasury Analytics ─────────────── */}
            <div className="border-t border-gray-200 pt-6 mt-2">
              <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-[#1A4A28]" />
                Predictive Financial Treasury Analytics
              </h2>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* P1: Income Forecast */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="w-4 h-4 text-[#1A4A28]" />Pronóstico de Ingresos 6M (SMA-3)</CardTitle></CardHeader>
                <CardContent>
                  {incomeForecast.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={incomeForecast}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fcc(v)} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="real" name="Ingresos $" radius={[3, 3, 0, 0]}>
                          {incomeForecast.map((e, i) => <Cell key={i} fill={e.type === 'forecast' ? '#C9A84C' : '#1A4A28'} opacity={e.type === 'forecast' ? 0.6 : 0.8} />)}
                        </Bar>
                        <Line type="monotone" dataKey="budget" stroke="#F59E0B" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Meta $" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-gray-400 text-center py-12">Se requieren al menos 2 meses de datos.</p>}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Barras doradas = pronóstico basado en SMA-3 con drift de crecimiento</p>
                </CardContent>
              </Card>

              {/* P2: Income Volatility */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingDown className="w-4 h-4 text-red-500" />Volatilidad de Ingresos</CardTitle></CardHeader>
                <CardContent>
                  {incomeVolatility.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={incomeVolatility}>
                        <defs>
                          <linearGradient id="ingVolGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2} /><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} /></linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fcc(v)} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" />
                        <Area type="monotone" dataKey="deviation" stroke="#8B5CF6" strokeWidth={1.5} fill="url(#ingVolGrad)" name="Desviación $" />
                        <Line type="monotone" dataKey="real" stroke="#1A4A28" strokeWidth={2} dot={{ r: 2 }} name="Ingreso Real $" />
                        <Line type="monotone" dataKey="mean" stroke="#C9A84C" strokeWidth={1.5} strokeDasharray="5 5" dot={false} name="Media $" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-gray-400 text-center py-12">Se requieren al menos 2 meses.</p>}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Alta volatilidad = ingresos impredecibles, riesgo para planificación de tesorería</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* P3: CxC Recovery Projection */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="w-4 h-4 text-[#1A4A28]" />Proyección de Recuperación CxC</CardTitle></CardHeader>
                <CardContent>
                  {cxcRecovery.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={cxcRecovery}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={9} />
                        <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => fcc(v)} />
                        <Tooltip formatter={(v: number) => fc(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="expected" stackId="a" fill="#4CAF50" name="Recuperación Esperada $" />
                        <Bar dataKey="atRisk" stackId="a" fill="#F44336" name="En Riesgo $" radius={[3, 3, 0, 0]} />
                        <Line type="monotone" dataKey="pending" stroke="#C9A84C" strokeWidth={2} dot={{ r: 3 }} name="Total Pendiente $" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-gray-400 text-center py-12">Sin datos de CxC para proyección.</p>}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Probabilidad de recuperación basada en días de mora: 0-30d=90%, 31-60d=70%, 60d+=riesgo</p>
                </CardContent>
              </Card>

              {/* P4: Client Risk Score */}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="w-4 h-4 text-orange-500" />Score de Riesgo por Cliente</CardTitle></CardHeader>
                <CardContent>
                  {clientRisk.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={clientRisk} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" stroke="#9ca3af" fontSize={10} tickFormatter={v => fcc(v)} />
                        <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={8} width={120} />
                        <Tooltip formatter={(v: number, name: string) => name.includes('Días') ? `${v} días` : fc(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Bar dataKey="riskScore" fill="#F44336" name="Risk Score $" radius={[0, 4, 4, 0]} opacity={0.7} />
                        <Bar dataKey="amount" fill="#1A4A28" name="Monto $" radius={[0, 4, 4, 0]} opacity={0.5} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-gray-400 text-center py-12">Sin datos de clientes.</p>}
                  <p className="text-[9px] text-gray-400 text-center mt-1">Risk Score = Monto × Factor de Mora. Mayor score = mayor riesgo de incobrabilidad</p>
                </CardContent>
              </Card>
            </div>

            {/* ── Automated Narrative ──────────────────────────── */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-amber-500" />
                  Narrativa Ejecutiva — Ingresos y CxC
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
                  <div>
                    <h4 className="font-bold text-[#1A4A28] mb-2 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5" /> Insights Clave
                    </h4>
                    <ul className="space-y-1.5 text-gray-600">
                      {narrative.insights.map((item, i) => (
                        <li key={i} className="flex gap-1.5"><span className="text-emerald-500 flex-shrink-0">●</span>{item}</li>
                      ))}
                      {narrative.insights.length === 0 && <li className="text-gray-400">Sin datos suficientes para generar insights.</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-red-600 mb-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Riesgos
                    </h4>
                    <ul className="space-y-1.5 text-gray-600">
                      {narrative.risks.map((item, i) => (
                        <li key={i} className="flex gap-1.5"><span className="text-red-500 flex-shrink-0">●</span>{item}</li>
                      ))}
                      {narrative.risks.length === 0 && <li className="text-gray-400">Sin riesgos identificados.</li>}
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-bold text-blue-600 mb-2 flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5" /> Acciones Recomendadas
                    </h4>
                    <ul className="space-y-1.5 text-gray-600">
                      {narrative.actions.map((item, i) => (
                        <li key={i} className="flex gap-1.5"><span className="text-blue-500 flex-shrink-0">●</span>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* ── Record Detail Modal ─────────────────────────────── */}
      <RecordDetailModal
        open={!!detailRecord}
        onClose={() => setDetailRecord(null)}
        title={detailType === 'flujo' ? 'Detalle de Ingreso' : 'Detalle CxC'}
        subtitle={
          detailType === 'flujo'
            ? (detailRecord?.operacion as string) || 'Operación'
            : (detailRecord?.factura as string) || 'Factura'
        }
        record={detailRecord}
        fields={detailType === 'flujo' ? FLUJO_FIELDS : CXC_FIELDS}
        schema="silver_finance"
        table={detailType === 'flujo' ? 'flujo_semanal' : 'cxc_items'}
      />
    </Layout>
  );
}
