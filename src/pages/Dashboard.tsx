import { useState, useEffect, useCallback } from 'react';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, Clock, Building2,
  ShieldCheck, Lightbulb, RefreshCw, BarChart3, Wallet, CreditCard, Landmark,
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  formatCurrency, formatCompactCurrency, formatMonthYear, formatShortDate,
  semaphore, ARA_COLORS, getPriorityLabel,
} from '../lib/utils';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
  ComposedChart,
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
  empresa: string;
  proveedor: string;
  monto_usd: number;
  vencimiento_fecha: string;
  prioridad: string;
  clasificacion: string;
}
interface FlujoItem {
  compania: string;
  cuota: number;
  principal: number;
  intereses: number;
  vencimiento: string;
  banco: string;
  tipo: string;
  operacion: string;
}
interface Projection {
  projection_month: string;
  projected_inflows: number;
  projected_outflows: number;
  projected_balance: number;
}
interface BU { code: string; name: string; }

// ── Dashboard ──────────────────────────────────────────────────────────────────
export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [cxp, setCxp] = useState<CxPItem[]>([]);
  const [flujo, setFlujo] = useState<FlujoItem[]>([]);
  const [projection, setProjection] = useState<Projection[]>([]);
  const [bus, setBus] = useState<BU[]>([]);
  const [ingestCount, setIngestCount] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cxpR, flujoR, projR, buR, ingestR] = await Promise.all([
        querySQL(`SELECT empresa, proveedor, monto_usd, vencimiento_fecha, prioridad, clasificacion FROM silver_finance.cxp_items ORDER BY vencimiento_fecha`),
        querySQL(`SELECT compania, cuota, principal, intereses, vencimiento, banco, tipo, operacion FROM silver_finance.flujo_semanal ORDER BY vencimiento`),
        querySQL(`SELECT projection_month, projected_inflows, projected_outflows, projected_balance FROM silver_finance.projection_12m ORDER BY projection_month`),
        querySQL(`SELECT code, name FROM dim.business_units WHERE is_active = true`),
        querySQL(`SELECT COUNT(*) as cnt FROM bronze_finance.ingest_runs WHERE status = 'completed'`),
      ]);
      setCxp(cxpR);
      setFlujo(flujoR);
      setProjection(projR);
      setBus(buR);
      setIngestCount(ingestR[0]?.cnt || 0);
      setLastRefresh(new Date());
    } catch (e) {
      console.error('Dashboard fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Derived metrics ────────────────────────────────────────────────────────
  const totalCxP = cxp.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0);
  const totalFlujoInflows = flujo.reduce((s, r) => s + (Number(r.cuota) || 0), 0);
  const totalPrincipal = flujo.reduce((s, r) => s + (Number(r.principal) || 0), 0);
  const totalIntereses = flujo.reduce((s, r) => s + (Number(r.intereses) || 0), 0);
  const netCashflow = totalFlujoInflows - totalCxP;

  // Projection-based
  const projInflows = projection.reduce((s, r) => s + (Number(r.projected_inflows) || 0), 0);
  const projOutflows = projection.reduce((s, r) => s + (Number(r.projected_outflows) || 0), 0);
  const latestBalance = projection.length > 0 ? Number(projection[projection.length - 1].projected_balance) || 0 : 0;
  const firstBalance = projection.length > 0 ? Number(projection[0].projected_balance) || 0 : 0;

  // Runway (months with positive balance)
  const runwayMonths = projection.filter(p => Number(p.projected_balance) > 0).length;
  const runwaySemaphore = semaphore(runwayMonths, 6, 3);

  // Ratio activos/pasivos
  const ratio = totalCxP > 0 ? totalFlujoInflows / totalCxP : totalFlujoInflows > 0 ? 99 : 0;
  const ratioSemaphore = semaphore(ratio, 1.5, 1.0);

  // CxP by priority
  const cxpByPriority: Record<string, number> = {};
  cxp.forEach(r => {
    const p = String(r.prioridad || 'Sin prioridad').replace(/[^0-9]/g, '') || '0';
    cxpByPriority[p] = (cxpByPriority[p] || 0) + (Number(r.monto_usd) || 0);
  });

  // CxP by top proveedores
  const proveedorMap: Record<string, number> = {};
  cxp.forEach(r => {
    const prov = r.proveedor || 'Desconocido';
    proveedorMap[prov] = (proveedorMap[prov] || 0) + (Number(r.monto_usd) || 0);
  });
  const topProveedores = Object.entries(proveedorMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, total]) => ({ name: name.length > 25 ? name.slice(0, 22) + '...' : name, total }));

  // Pareto: cumulative %
  const paretoTotal = topProveedores.reduce((s, p) => s + p.total, 0);
  let paretoCum = 0;
  const paretoData = topProveedores.map(p => {
    paretoCum += p.total;
    return { ...p, cumPct: paretoTotal > 0 ? (paretoCum / totalCxP) * 100 : 0 };
  });

  // Flujo by BU (compania)
  const flujoByBU: Record<string, { inflows: number; outflows: number }> = {};
  flujo.forEach(r => {
    const bu = r.compania || 'Sin BU';
    if (!flujoByBU[bu]) flujoByBU[bu] = { inflows: 0, outflows: 0 };
    flujoByBU[bu].inflows += Number(r.cuota) || 0;
  });
  cxp.forEach(r => {
    const bu = r.empresa || 'Sin BU';
    if (!flujoByBU[bu]) flujoByBU[bu] = { inflows: 0, outflows: 0 };
    flujoByBU[bu].outflows += Number(r.monto_usd) || 0;
  });
  const buChartData = Object.entries(flujoByBU)
    .map(([bu, v]) => ({ bu: bu.length > 18 ? bu.slice(0, 15) + '...' : bu, inflows: v.inflows, outflows: v.outflows, neto: v.inflows - v.outflows }))
    .sort((a, b) => b.neto - a.neto);

  // CxP por clasificacion (donut)
  const cxpByClasif: Record<string, number> = {};
  cxp.forEach(r => {
    const c = r.clasificacion || 'Sin clasificación';
    cxpByClasif[c] = (cxpByClasif[c] || 0) + (Number(r.monto_usd) || 0);
  });
  const donutData = Object.entries(cxpByClasif)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, value]) => ({ name: name.length > 20 ? name.slice(0, 17) + '...' : name, value }));
  const DONUT_COLORS = [ARA_COLORS.primary, ARA_COLORS.gold, ARA_COLORS.blue, ARA_COLORS.orange, ARA_COLORS.red, ARA_COLORS.gray];

  // CxP upcoming by week
  const now = new Date();
  const weekBuckets: { label: string; p1: number; p2: number; p3: number; other: number }[] = [];
  for (let w = 0; w < 4; w++) {
    const start = new Date(now); start.setDate(start.getDate() + w * 7);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const label = `Sem ${w + 1}`;
    const bucket = { label, p1: 0, p2: 0, p3: 0, other: 0 };
    cxp.forEach(r => {
      const d = new Date(r.vencimiento_fecha);
      if (d >= start && d <= end) {
        const p = String(r.prioridad || '').replace(/[^0-9]/g, '');
        const amt = Number(r.monto_usd) || 0;
        if (p === '1') bucket.p1 += amt;
        else if (p === '2') bucket.p2 += amt;
        else if (p === '3') bucket.p3 += amt;
        else bucket.other += amt;
      }
    });
    weekBuckets.push(bucket);
  }

  // Flujo by banco
  const bancoMap: Record<string, number> = {};
  flujo.forEach(r => {
    const b = r.banco || 'Sin banco';
    bancoMap[b] = (bancoMap[b] || 0) + (Number(r.cuota) || 0);
  });
  const bancoData = Object.entries(bancoMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, total]) => ({ name: name.length > 20 ? name.slice(0, 17) + '...' : name, total }));

  // ── Executive Narrative ────────────────────────────────────────────────────
  const insights: { type: 'insight' | 'risk' | 'action'; text: string }[] = [];

  if (totalCxP > 0 && totalFlujoInflows > 0) {
    if (ratio >= 1.5) {
      insights.push({ type: 'insight', text: `Posición de liquidez saludable: los ingresos operativos (${formatCompactCurrency(totalFlujoInflows)}) cubren ${ratio.toFixed(1)}x las CxP (${formatCompactCurrency(totalCxP)}).` });
    } else if (ratio >= 1.0) {
      insights.push({ type: 'risk', text: `Ratio de cobertura ajustado: ingresos cubren ${ratio.toFixed(1)}x las CxP. Margen limitado para imprevistos.` });
    } else {
      insights.push({ type: 'risk', text: `Alerta de liquidez: las CxP (${formatCompactCurrency(totalCxP)}) superan los ingresos operativos (${formatCompactCurrency(totalFlujoInflows)}). Gap: ${formatCompactCurrency(totalCxP - totalFlujoInflows)}.` });
    }
  }

  if (cxpByPriority['1'] > 0) {
    insights.push({ type: 'action', text: `${formatCompactCurrency(cxpByPriority['1'])} en pagos Prioridad 1 (urgentes) pendientes. Gestionar esta semana.` });
  }

  if (topProveedores.length > 0 && paretoTotal > 0) {
    const top3Pct = topProveedores.slice(0, 3).reduce((s, p) => s + p.total, 0) / totalCxP * 100;
    if (top3Pct > 50) {
      insights.push({ type: 'risk', text: `Concentración de CxP: los 3 mayores proveedores representan el ${top3Pct.toFixed(0)}% del total. Riesgo de dependencia.` });
    }
  }

  if (runwayMonths > 0) {
    insights.push({ type: 'insight', text: `Runway proyectado: ${runwayMonths} meses con balance positivo según proyección 12M.` });
  }

  if (projection.length > 0) {
    const deficitMonths = projection.filter(p => Number(p.projected_balance) < 0);
    if (deficitMonths.length > 0) {
      insights.push({ type: 'risk', text: `Se proyectan ${deficitMonths.length} mes(es) con déficit de caja. Primer mes crítico: ${formatMonthYear(deficitMonths[0].projection_month)}.` });
    }
  }

  if (totalIntereses > 0) {
    insights.push({ type: 'insight', text: `Carga financiera por intereses: ${formatCompactCurrency(totalIntereses)} en el período. Principal: ${formatCompactCurrency(totalPrincipal)}.` });
  }

  if (insights.length === 0 && ingestCount === 0) {
    insights.push({ type: 'action', text: 'Sin datos cargados aún. Sube archivos Excel en "Fuentes de Datos" para activar el dashboard.' });
  }

  // ── Chart tooltip ──────────────────────────────────────────────────────────
  const chartTooltipStyle = {
    backgroundColor: 'white',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
    fontSize: '12px',
  };

  const hasData = cxp.length > 0 || flujo.length > 0 || projection.length > 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Panel Ejecutivo de Tesorería</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Visión consolidada de cashflow, CxP, CxC y proyecciones &middot; ARA Group
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              Actualizado: {lastRefresh.toLocaleTimeString('es-CR')}
            </span>
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#1A4A28] bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
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
            {/* ─── 1. KPI Snapshot ──────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <KPICard
                title="Total CxP Pendiente"
                value={totalCxP}
                icon={CreditCard}
                format="currency"
                semaphore={semaphore(totalCxP, 100000, 500000, true)}
                subtitle={`${cxp.length} facturas`}
              />
              <KPICard
                title="Ingresos Operativos"
                value={totalFlujoInflows}
                icon={Wallet}
                format="currency"
                semaphore={totalFlujoInflows > 0 ? 'green' : 'red'}
                subtitle={`${flujo.length} operaciones`}
              />
              <KPICard
                title="Cashflow Neto"
                value={netCashflow}
                icon={netCashflow >= 0 ? TrendingUp : TrendingDown}
                format="currency"
                semaphore={semaphore(netCashflow, 0, -50000)}
                subtitle={netCashflow >= 0 ? 'Superávit' : 'Déficit'}
              />
              <KPICard
                title="Ratio Cobertura"
                value={ratio}
                icon={ShieldCheck}
                format="number"
                semaphore={ratioSemaphore}
                subtitle="Ingresos / CxP"
              />
              <KPICard
                title="Runway Proyectado"
                value={runwayMonths}
                icon={Clock}
                format="months"
                semaphore={runwaySemaphore}
                subtitle="Meses con balance +"
              />
            </div>

            {/* ─── 2. Proyección 12M + Ingresos vs Egresos ─────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Projection 12M */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BarChart3 className="w-4 h-4 text-[#1A4A28]" />
                    Proyección de Caja 12M
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {projection.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart data={projection.map(p => ({
                        month: formatMonthYear(p.projection_month),
                        inflows: Number(p.projected_inflows),
                        outflows: Number(p.projected_outflows),
                        balance: Number(p.projected_balance),
                      }))}>
                        <defs>
                          <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={ARA_COLORS.primary} stopOpacity={0.2} />
                            <stop offset="95%" stopColor={ARA_COLORS.primary} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="month" stroke="#9ca3af" fontSize={11} />
                        <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={chartTooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="inflows" fill={ARA_COLORS.primary} name="Ingresos" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="outflows" fill={ARA_COLORS.red} name="Egresos" radius={[3, 3, 0, 0]} opacity={0.7} />
                        <Area type="monotone" dataKey="balance" stroke={ARA_COLORS.gold} strokeWidth={2} fill="url(#balGrad)" name="Balance" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState text="Ejecuta recalc_projection en el AI Chat para generar la proyección 12M." />
                  )}
                </CardContent>
              </Card>

              {/* CxP by week + priority (stacked) */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CreditCard className="w-4 h-4 text-red-600" />
                    CxP Próximas 4 Semanas por Prioridad
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {weekBuckets.some(w => w.p1 + w.p2 + w.p3 + w.other > 0) ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={weekBuckets}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={11} />
                        <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={chartTooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="p1" stackId="a" fill={ARA_COLORS.red} name="P1 Urgente" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="p2" stackId="a" fill={ARA_COLORS.orange} name="P2 Esta semana" />
                        <Bar dataKey="p3" stackId="a" fill={ARA_COLORS.gold} name="P3 Próximo ciclo" />
                        <Bar dataKey="other" stackId="a" fill={ARA_COLORS.gray} name="Sin prioridad" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState text="No hay CxP con fechas de vencimiento en las próximas 4 semanas." />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ─── 3. Top Proveedores (Pareto) + Clasificación CxP ─────── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Pareto proveedores */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="w-4 h-4 text-[#1A4A28]" />
                    Top Proveedores CxP (Pareto 80/20)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {paretoData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <ComposedChart data={paretoData} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" stroke="#9ca3af" fontSize={11} tickFormatter={v => formatCompactCurrency(v)} />
                        <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={10} width={120} />
                        <Tooltip formatter={(v: number, name: string) => name === 'cumPct' ? `${v.toFixed(1)}%` : formatCurrency(v)} contentStyle={chartTooltipStyle} />
                        <Bar dataKey="total" fill={ARA_COLORS.primary} name="Monto CxP" radius={[0, 4, 4, 0]} barSize={16} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState text="Sin datos de proveedores en CxP." />
                  )}
                </CardContent>
              </Card>

              {/* Donut - clasificacion */}
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
                        <Pie
                          data={donutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={3}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                          style={{ fontSize: 9 }}
                        >
                          {donutData.map((_, i) => (
                            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={chartTooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState text="Sin clasificaciones en CxP." />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ─── 4. Cashflow por BU + Créditos por Banco ─────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* By BU */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="w-4 h-4 text-[#1A4A28]" />
                    Cashflow Neto por Unidad de Negocio
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {buChartData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={buChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="bu" stroke="#9ca3af" fontSize={10} />
                        <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={v => formatCompactCurrency(v)} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={chartTooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="inflows" fill={ARA_COLORS.primary} name="Ingresos" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="outflows" fill={ARA_COLORS.red} name="Egresos" radius={[3, 3, 0, 0]} opacity={0.7} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState text="Sin datos por unidad de negocio." />
                  )}
                </CardContent>
              </Card>

              {/* Créditos por Banco */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Landmark className="w-4 h-4 text-[#1A4A28]" />
                    Desembolsos / Cuotas por Banco
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {bancoData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={bancoData} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis type="number" stroke="#9ca3af" fontSize={11} tickFormatter={v => formatCompactCurrency(v)} />
                        <YAxis type="category" dataKey="name" stroke="#9ca3af" fontSize={10} width={110} />
                        <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={chartTooltipStyle} />
                        <Bar dataKey="total" fill={ARA_COLORS.gold} name="Total Cuotas" radius={[0, 4, 4, 0]} barSize={18} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <EmptyState text="Sin datos de operaciones bancarias." />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ─── 5. CxP Table (Top items) ────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="w-4 h-4 text-orange-500" />
                  Pagos Prioritarios Próximos
                </CardTitle>
              </CardHeader>
              <CardContent>
                {cxp.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                          <th className="pb-3 pr-4">Proveedor</th>
                          <th className="pb-3 pr-4">Empresa</th>
                          <th className="pb-3 pr-4 text-right">Monto USD</th>
                          <th className="pb-3 pr-4">Vencimiento</th>
                          <th className="pb-3 pr-4">Prioridad</th>
                          <th className="pb-3">Clasificación</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {cxp.slice(0, 15).map((item, idx) => {
                          const isOverdue = new Date(item.vencimiento_fecha) < now;
                          return (
                            <tr key={idx} className="hover:bg-gray-50/50">
                              <td className="py-2.5 pr-4 font-medium text-gray-900 max-w-[200px] truncate">{item.proveedor || '—'}</td>
                              <td className="py-2.5 pr-4 text-gray-600">{item.empresa || '—'}</td>
                              <td className="py-2.5 pr-4 text-right font-semibold tabular-nums">{formatCurrency(Number(item.monto_usd) || 0)}</td>
                              <td className={`py-2.5 pr-4 ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                                {item.vencimiento_fecha ? formatShortDate(item.vencimiento_fecha) : '—'}
                                {isOverdue && <span className="ml-1 text-[10px]">VENCIDO</span>}
                              </td>
                              <td className="py-2.5 pr-4">
                                <Badge variant={
                                  String(item.prioridad).includes('1') ? 'error' :
                                  String(item.prioridad).includes('2') ? 'warning' : 'default'
                                }>
                                  {getPriorityLabel(item.prioridad)}
                                </Badge>
                              </td>
                              <td className="py-2.5 text-gray-500 text-xs">{item.clasificacion || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {cxp.length > 15 && (
                      <p className="text-xs text-gray-400 mt-3 text-center">
                        Mostrando 15 de {cxp.length} registros. Usa el AI Chat para consultas detalladas.
                      </p>
                    )}
                  </div>
                ) : (
                  <EmptyState text="Sin datos de CxP. Ingesta un archivo GV CXP Totales para ver pagos pendientes." />
                )}
              </CardContent>
            </Card>

            {/* ─── 6. Narrativa Ejecutiva ───────────────────────────────── */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="w-4 h-4 text-[#C9A84C]" />
                  Narrativa Ejecutiva — Insights y Acciones
                </CardTitle>
              </CardHeader>
              <CardContent>
                {insights.length > 0 ? (
                  <div className="space-y-3">
                    {insights.map((item, idx) => (
                      <div
                        key={idx}
                        className={`flex items-start gap-3 p-3 rounded-lg ${
                          item.type === 'risk'
                            ? 'bg-red-50 border border-red-100'
                            : item.type === 'action'
                              ? 'bg-amber-50 border border-amber-100'
                              : 'bg-emerald-50 border border-emerald-100'
                        }`}
                      >
                        <span className="flex-shrink-0 mt-0.5">
                          {item.type === 'risk' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                          {item.type === 'action' && <Lightbulb className="w-4 h-4 text-amber-600" />}
                          {item.type === 'insight' && <TrendingUp className="w-4 h-4 text-emerald-600" />}
                        </span>
                        <div>
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                            {item.type === 'risk' ? 'Riesgo' : item.type === 'action' ? 'Acción' : 'Hallazgo'}
                          </span>
                          <p className="text-sm text-gray-800 mt-0.5">{item.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-400 text-center py-6">
                    Los insights se generarán automáticamente al cargar datos de tesorería.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ─── Footer stats ─────────────────────────────────────────── */}
            <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-4">
                <span>{cxp.length} registros CxP</span>
                <span>{flujo.length} operaciones flujo</span>
                <span>{projection.length} meses proyección</span>
                <span>{bus.length} unidades de negocio</span>
                <span>{ingestCount} ingestas completadas</span>
              </div>
              <span>CVE Treasury Copilot — ARA Group</span>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}

// ── Empty state placeholder ──────────────────────────────────────────────────
function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
      <BarChart3 className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm text-center max-w-xs">{text}</p>
    </div>
  );
}
