import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Landmark, Layers, Activity, Percent, BanknoteIcon, DollarSign,
  CalendarDays, RefreshCw, BarChart3, TrendingUp, TrendingDown, AlertTriangle, Lightbulb,
  Filter, CheckCircle2,
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { RecordDetailModal, type FieldDef } from '../components/ui/RecordDetailModal';
import {
  formatCurrency, formatCompactCurrency, formatMonthYear, formatShortDate,
  formatDate, semaphore, ARA_COLORS,
} from '../lib/utils';
import { useExchangeRate, toUSD, fromUSD, normalizeCurrency } from '../hooks/useExchangeRate';
import {
  querySQL, type FlujoItem, type TimePeriod, getDateCutoff, PERIOD_LABELS, tooltipStyle,
} from '../lib/queries';

const CREDIT_FIELDS: FieldDef[] = [
  { key: 'operacion', label: 'Operación', type: 'text', group: 'Identificación' },
  { key: 'compania', label: 'Compañía', type: 'text' },
  { key: 'banco', label: 'Banco', type: 'text' },
  { key: 'tipo', label: 'Tipo de Crédito', type: 'select', options: ['Largo Plazo', 'Capital Trabajo', 'Leasing', 'Línea Revolving'] },
  { key: 'moneda', label: 'Moneda', type: 'select', options: ['CRC', 'USD'] },
  { key: 'saldo_original', label: 'Saldo Original', type: 'currency', group: 'Financiero', highlight: true },
  { key: 'capital', label: 'Capital', type: 'currency' },
  { key: 'capital_actualizado', label: 'Capital Actualizado', type: 'currency' },
  { key: 'cuota', label: 'Cuota', type: 'currency' },
  { key: 'principal', label: 'Principal', type: 'currency' },
  { key: 'intereses', label: 'Intereses', type: 'currency' },
  { key: 'vencimiento', label: 'Vencimiento', type: 'date', group: 'Plazos' },
  { key: 'semana_inicio', label: 'Semana Inicio', type: 'date' },
  { key: 'semana_fin', label: 'Semana Fin', type: 'date' },
  { key: 'ingest_run_id', label: 'Run de Ingesta', type: 'readonly', group: 'Metadata' },
  { key: 'created_at', label: 'Fecha de Creación', type: 'readonly' },
];
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ComposedChart, Line, Area,
} from 'recharts';

const TIPO_COLORS: Record<string, string> = { 'Largo Plazo': '#1A4A28', 'Capital Trabajo': '#C9A84C', 'Tarjeta': '#3B82F6' };
const CREDIT_COLORS = ['#1A4A28', '#2D6A3F', '#C9A84C', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16'];

export function CreditDashboard() {
  const [loading, setLoading] = useState(true);
  const [flujoAll, setFlujoAll] = useState<FlujoItem[]>([]);
  const [period, setPeriod] = useState<TimePeriod>('all');
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [detailRecord, setDetailRecord] = useState<Record<string, unknown> | null>(null);
  const [bankFilter, setBankFilter] = useState<string>('all');

  const { rate } = useExchangeRate();

  /** Convert a flujo item's amount field to USD for aggregation */
  const asUSD = useCallback((item: FlujoItem, field: 'cuota' | 'principal' | 'intereses' | 'saldo_original' | 'capital' | 'capital_actualizado') => {
    return toUSD(Number(item[field]) || 0, item.moneda, rate);
  }, [rate]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await querySQL(
        `SELECT compania, cuota, principal, intereses, vencimiento, banco, tipo, operacion,
                saldo_original, capital, capital_actualizado, moneda, semana_inicio, semana_fin,
                created_at, ingest_run_id
         FROM silver_finance.flujo_semanal ORDER BY vencimiento`
      );
      setFlujoAll(rows);
      setLastRefresh(new Date());
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Bank list for filter ───────────────────────────────────────────────
  const allBanks = useMemo(() => {
    const s = new Set<string>();
    flujoAll.forEach(r => { if (r.banco) s.add(r.banco); });
    return Array.from(s).sort();
  }, [flujoAll]);

  const cutoff = getDateCutoff(period);
  const flujo = useMemo(() => {
    let d = flujoAll;
    if (cutoff) d = d.filter(r => (r.vencimiento || r.created_at) >= cutoff);
    if (bankFilter !== 'all') d = d.filter(r => r.banco === bankFilter);
    return d;
  }, [flujoAll, cutoff, bankFilter]);

  // ── Metrics (all converted to USD for aggregation) ──────────────────────
  const totalCuota = flujo.reduce((s, r) => s + asUSD(r, 'cuota'), 0);
  const totalPrincipal = flujo.reduce((s, r) => s + asUSD(r, 'principal'), 0);
  const totalIntereses = flujo.reduce((s, r) => s + asUSD(r, 'intereses'), 0);
  const totalSaldo = flujo.reduce((s, r) => s + asUSD(r, 'saldo_original'), 0);
  const totalCapAct = flujo.reduce((s, r) => s + asUSD(r, 'capital_actualizado'), 0);
  const intRatio = totalPrincipal > 0 ? (totalIntereses / totalPrincipal) * 100 : 0;
  const now = new Date();
  const nowMs = now.getTime();

  // ── Long-term vs Short-term debt breakdown ─────────────────────────────
  const debtLP = useMemo(() => flujo.filter(r => r.tipo === 'Largo Plazo'), [flujo]);
  const debtCP = useMemo(() => flujo.filter(r => r.tipo !== 'Largo Plazo'), [flujo]);
  const totalSaldoLP = debtLP.reduce((s, r) => s + asUSD(r, 'saldo_original'), 0);
  const totalSaldoCP = debtCP.reduce((s, r) => s + asUSD(r, 'saldo_original'), 0);

  // ── Amortization tracking (pctAmortized here; cumulativeAmort after capEvol) ─
  const pctAmortized = totalSaldo > 0 ? ((totalSaldo - totalCapAct) / totalSaldo) * 100 : 0;

  // ── Currency display helper by term ───────────────────────────────────
  /** LP → USD, CP → CRC (convert if needed) */
  const termCurrency = useCallback((item: FlujoItem) => {
    return item.tipo === 'Largo Plazo' ? 'USD' : 'CRC';
  }, []);

  const termAmount = useCallback((item: FlujoItem, field: 'cuota' | 'principal' | 'intereses' | 'saldo_original' | 'capital' | 'capital_actualizado') => {
    const raw = Number(item[field]) || 0;
    const target = termCurrency(item);
    const normalized = normalizeCurrency(item.moneda);
    if (normalized === target) return raw;
    // Convert: first to USD, then from USD to target
    const usd = toUSD(raw, item.moneda, rate);
    return fromUSD(usd, target, rate);
  }, [rate, termCurrency]);

  // Unique operations
  const uniqueOps = useMemo(() => {
    const m = new Map<string, FlujoItem>();
    flujo.forEach(r => {
      const k = `${r.compania}|${r.operacion}|${r.banco}`;
      if (!m.has(k) || (Number(r.saldo_original) || 0) > (Number(m.get(k)!.saldo_original) || 0)) m.set(k, r);
    });
    return Array.from(m.values());
  }, [flujo]);
  const uniqueBanks = useMemo(() => new Set(flujo.map(r => r.banco).filter(Boolean)), [flujo]);
  const uniqueCompanies = useMemo(() => new Set(flujo.map(r => r.compania).filter(Boolean)), [flujo]);

  // ── By Tipo (USD) ──────────────────────────────────────────────────────────
  const opsByTipo = useMemo(() => {
    const map: Record<string, { tipo: string; cuota: number; principal: number; intereses: number; saldo: number; count: number }> = {};
    flujo.forEach(r => {
      const t = r.tipo || 'Otro';
      if (!map[t]) map[t] = { tipo: t, cuota: 0, principal: 0, intereses: 0, saldo: 0, count: 0 };
      map[t].cuota += asUSD(r, 'cuota');
      map[t].principal += asUSD(r, 'principal');
      map[t].intereses += asUSD(r, 'intereses');
      map[t].saldo += asUSD(r, 'saldo_original');
      map[t].count++;
    });
    return Object.values(map).sort((a, b) => b.cuota - a.cuota);
  }, [flujo, asUSD]);

  // ── By Banco (USD) ────────────────────────────────────────────────────────
  const bancoComp = useMemo(() => {
    const map: Record<string, { banco: string; principal: number; intereses: number; cuota: number; saldo: number }> = {};
    flujo.forEach(r => {
      const b = r.banco || 'Sin banco';
      if (!map[b]) map[b] = { banco: b, principal: 0, intereses: 0, cuota: 0, saldo: 0 };
      map[b].principal += asUSD(r, 'principal');
      map[b].intereses += asUSD(r, 'intereses');
      map[b].cuota += asUSD(r, 'cuota');
      map[b].saldo += asUSD(r, 'saldo_original');
    });
    return Object.values(map).sort((a, b) => b.cuota - a.cuota).slice(0, 10);
  }, [flujo, asUSD]);

  // ── Gantt data ─────────────────────────────────────────────────────────────
  const ganttData = useMemo(() => {
    const opMap = new Map<string, FlujoItem[]>();
    flujo.forEach(r => { const k = `${r.compania}|${r.operacion}|${r.banco}`; if (!opMap.has(k)) opMap.set(k, []); opMap.get(k)!.push(r); });
    const lines: { id: string; operacion: string; compania: string; banco: string; tipo: string; start: string; end: string; saldo: number; cuotaTotal: number; moneda: string; startMs: number; endMs: number }[] = [];
    opMap.forEach((items, key) => {
      const dates = items.map(i => i.vencimiento || i.created_at).filter(Boolean).sort();
      if (!dates.length) return;
      const f = items[0];
      const itemMoneda = f.moneda || 'CRC';
      lines.push({ id: key, operacion: f.operacion || '—', compania: f.compania || '—', banco: f.banco || '—', tipo: f.tipo || '—', start: dates[0], end: dates[dates.length - 1], saldo: Math.max(...items.map(i => Number(i.saldo_original) || 0)), cuotaTotal: items.reduce((s, i) => s + (Number(i.cuota) || 0), 0), moneda: itemMoneda, startMs: new Date(dates[0]).getTime(), endMs: new Date(dates[dates.length - 1]).getTime() });
    });
    return lines.sort((a, b) => a.startMs - b.startMs);
  }, [flujo]);

  const ganttMin = ganttData.length ? Math.min(...ganttData.map(g => g.startMs)) : nowMs;
  const ganttMax = ganttData.length ? Math.max(...ganttData.map(g => g.endMs)) : nowMs;
  const ganttSpan = Math.max(ganttMax - ganttMin, 1);

  // ── Capital evolution (USD) ────────────────────────────────────────────────
  const capEvol = useMemo(() => {
    const m: Record<string, { month: string; saldo_original: number; capital_actualizado: number; principal: number; intereses: number }> = {};
    flujo.forEach(r => {
      const k = (r.vencimiento || r.created_at || '').slice(0, 7);
      if (!k) return;
      if (!m[k]) m[k] = { month: k, saldo_original: 0, capital_actualizado: 0, principal: 0, intereses: 0 };
      m[k].saldo_original += asUSD(r, 'saldo_original');
      m[k].capital_actualizado += asUSD(r, 'capital_actualizado');
      m[k].principal += asUSD(r, 'principal');
      m[k].intereses += asUSD(r, 'intereses');
    });
    return Object.values(m).sort((a, b) => a.month.localeCompare(b.month)).map(x => ({ ...x, label: formatMonthYear(x.month + '-01') }));
  }, [flujo, asUSD]);

  // ── Cumulative amortization (depends on capEvol) ──────────────────────────
  const cumulativeAmort = useMemo(() => {
    let running = 0;
    return capEvol.map(m => { running += m.principal; return { ...m, cumulativeAmort: running, pctPaid: totalSaldo > 0 ? (running / totalSaldo) * 100 : 0 }; });
  }, [capEvol, totalSaldo]);

  // ── By Moneda ──────────────────────────────────────────────────────────────
  const byMoneda = useMemo(() => {
    const m: Record<string, { moneda: string; cuota: number; count: number }> = {};
    flujo.forEach(r => {
      const mon = (r.moneda || '').toUpperCase().includes('DOL') || (r.moneda || '').toUpperCase().includes('USD') ? 'USD' : 'CRC';
      if (!m[mon]) m[mon] = { moneda: mon, cuota: 0, count: 0 };
      m[mon].cuota += Number(r.cuota) || 0;
      m[mon].count++;
    });
    return Object.values(m);
  }, [flujo]);

  // (Removed: byCompania — "Distribución de Cuotas por Compañía")

  // ── Insights ───────────────────────────────────────────────────────────────
  const insights: { type: 'insight' | 'risk' | 'action'; text: string }[] = [];
  if (uniqueOps.length > 0) insights.push({ type: 'insight', text: `${uniqueOps.length} líneas de crédito activas en ${uniqueBanks.size} bancos para ${uniqueCompanies.size} compañías.` });
  if (totalIntereses > 0) insights.push({ type: 'insight', text: `Carga financiera: ${formatCompactCurrency(totalIntereses)} intereses (${intRatio.toFixed(1)}% del principal). Cuotas totales: ${formatCompactCurrency(totalCuota)}.` });
  if (totalCapAct > 0 && totalSaldo > 0) { const pct = ((totalSaldo - totalCapAct) / totalSaldo) * 100; if (pct > 0) insights.push({ type: 'insight', text: `Amortización acumulada: ${pct.toFixed(1)}% del saldo original pagado. Capital vigente: ${formatCompactCurrency(totalCapAct)}.` }); }
  if (bancoComp.length > 0 && totalCuota > 0) { const topPct = (bancoComp[0].cuota / totalCuota) * 100; if (topPct > 40) insights.push({ type: 'risk', text: `Concentración: ${bancoComp[0].banco} = ${topPct.toFixed(0)}% de cuotas. Evaluar diversificación.` }); }
  if (ganttData.some(g => g.endMs < nowMs)) { const n = ganttData.filter(g => g.endMs < nowMs).length; insights.push({ type: 'action', text: `${n} operación(es) vencidas. Revisar renovación/cierre.` }); }
  const expiringSoon = ganttData.filter(g => g.endMs >= nowMs && g.endMs < nowMs + 90 * 86400000).length;
  if (expiringSoon > 0) insights.push({ type: 'risk', text: `${expiringSoon} operación(es) vencen en los próximos 90 días.` });

  const hasData = flujoAll.length > 0;

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Operaciones & Líneas de Crédito</h1>
            <p className="text-gray-500 mt-1 text-sm">Control longitudinal de crédito, bancos, composición y vencimientos ($ USD)</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Bank Filter */}
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-gray-400" />
              <select value={bankFilter} onChange={e => setBankFilter(e.target.value)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700 focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28]">
                <option value="all">Todos los Bancos</option>
                {allBanks.map(b => <option key={b} value={b}>{b}</option>)}
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
          <div className="flex flex-col items-center justify-center py-24 text-gray-400"><LoadingSpinner size="lg" /><p className="mt-4 text-sm">Cargando operaciones de crédito...</p></div>
        ) : !hasData ? (
          <Card><CardContent><EmptyState text='Sin operaciones de crédito. Ingesta "Control de Operaciones" o "Flujo Semanal" en Fuentes de Datos.' /></CardContent></Card>
        ) : (
          <>
            {/* KPIs Row 1 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <KPICard title="Líneas de Crédito" value={uniqueOps.length} icon={Layers} format="number" semaphore="green" subtitle={`${uniqueBanks.size} bancos`} />
              <KPICard title="Saldo Original" value={totalSaldo} icon={BanknoteIcon} subtitle="Total desembolsado" />
              <KPICard title="Capital Vigente" value={totalCapAct} icon={Activity} semaphore={totalCapAct > 0 ? 'yellow' : 'green'} subtitle="Por amortizar" />
              <KPICard title="% Amortizado" value={`${pctAmortized.toFixed(1)}%`} icon={CheckCircle2} format="text" semaphore={pctAmortized > 50 ? 'green' : pctAmortized > 20 ? 'yellow' : 'red'} subtitle="Saldo pagado" />
              <KPICard title="Deuda Largo Plazo" value={totalSaldoLP} icon={Landmark} subtitle="USD — Largo Plazo" />
              <KPICard title="Deuda Corto Plazo" value={totalSaldoCP} icon={DollarSign} subtitle="Capital Trabajo" />
            </div>
            {/* KPIs Row 2 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <KPICard title="Principal" value={totalPrincipal} icon={TrendingDown} subtitle="Abonos a capital" />
              <KPICard title="Intereses" value={totalIntereses} icon={Percent} semaphore={semaphore(intRatio, 5, 15, true)} subtitle={`${intRatio.toFixed(1)}% del principal`} />
              <KPICard title="Cuotas Totales" value={totalCuota} icon={DollarSign} subtitle={`${uniqueCompanies.size} compañías`} />
              <KPICard title="Banco Filtrado" value={bankFilter === 'all' ? 'Todos' : bankFilter} icon={Landmark} format="text" subtitle={bankFilter === 'all' ? `${allBanks.length} bancos` : `${flujo.length} operaciones`} />
            </div>

            {/* Gantt */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="w-4 h-4 text-[#1A4A28]" />Timeline Longitudinal de Operaciones de Crédito (Gantt)</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-1">
                  <div className="flex items-center gap-4 text-[10px] text-gray-500 mb-3">
                    {Object.entries(TIPO_COLORS).map(([t, c]) => <span key={t} className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ backgroundColor: c }} />{t}</span>)}
                    <span className="flex items-center gap-1"><span className="w-px h-3 border-l-2 border-red-500 border-dashed" />Hoy</span>
                  </div>
                  <div className="flex items-center text-[9px] text-gray-400 mb-1">
                    <div className="w-[280px] shrink-0" />
                    <div className="flex-1 flex justify-between px-1">
                      <span>{formatShortDate(new Date(ganttMin))}</span>
                      <span>{formatShortDate(new Date((ganttMin + ganttMax) / 2))}</span>
                      <span>{formatShortDate(new Date(ganttMax))}</span>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-[500px] overflow-y-auto">
                    {ganttData.map((g, idx) => {
                      const leftPct = ((g.startMs - ganttMin) / ganttSpan) * 100;
                      const widthPct = Math.max(((g.endMs - g.startMs) / ganttSpan) * 100, 1);
                      const nowPct = ((nowMs - ganttMin) / ganttSpan) * 100;
                      const isExpired = g.endMs < nowMs;
                      const barColor = TIPO_COLORS[g.tipo] || CREDIT_COLORS[idx % CREDIT_COLORS.length];
                      return (
                        <div key={g.id} className="flex items-center group hover:bg-gray-50/50 rounded py-0.5 cursor-pointer"
                          onDoubleClick={() => {
                            const op = flujo.find(f => f.operacion === g.operacion && f.banco === g.banco && f.compania === g.compania);
                            if (op) setDetailRecord(op as unknown as Record<string, unknown>);
                          }}
                          title="Doble clic para ver/editar detalle de la operación">
                          <div className="w-[280px] shrink-0 pr-3">
                            <p className="text-[11px] font-medium text-gray-800 truncate" title={g.operacion}>{g.operacion.length > 30 ? g.operacion.slice(0, 27) + '...' : g.operacion}</p>
                            <p className="text-[9px] text-gray-400 truncate">{g.compania} · {g.banco} · {formatCompactCurrency(g.saldo, normalizeCurrency(g.moneda))}</p>
                          </div>
                          <div className="flex-1 relative h-6 bg-gray-100 rounded overflow-hidden">
                            <div className={`absolute top-0.5 bottom-0.5 rounded ${isExpired ? 'opacity-40' : 'opacity-85'}`}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: barColor, minWidth: '4px' }}
                              title={`${g.operacion}\n${formatShortDate(g.start)} → ${formatShortDate(g.end)}\nSaldo: ${formatCompactCurrency(g.saldo, normalizeCurrency(g.moneda))}`} />
                            {nowPct >= 0 && nowPct <= 100 && <div className="absolute top-0 bottom-0 w-px bg-red-500 z-10" style={{ left: `${nowPct}%` }} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 text-center">
                    {ganttData.length} operaciones · {ganttData.filter(g => g.endMs >= nowMs).length} vigentes · {ganttData.filter(g => g.endMs < nowMs).length} vencidas
                    <span className="italic ml-2">· Doble clic en una operación para ver/editar detalle</span>
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Tipo + Banco composition */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4 text-[#1A4A28]" />Operaciones por Tipo de Crédito ($)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={opsByTipo}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="tipo" stroke="#9ca3af" fontSize={10} />
                      <YAxis stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="principal" stackId="a" fill={ARA_COLORS.primary} name="Principal $" />
                      <Bar dataKey="intereses" stackId="a" fill={ARA_COLORS.gold} name="Intereses $" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Landmark className="w-4 h-4 text-[#1A4A28]" />Principal vs Intereses por Banco ($)</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={bancoComp.map(b => ({ ...b, banco: b.banco.length > 15 ? b.banco.slice(0, 12) + '...' : b.banco }))} layout="vertical" margin={{ left: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                      <YAxis type="category" dataKey="banco" stroke="#9ca3af" fontSize={9} width={100} />
                      <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="principal" stackId="a" fill={ARA_COLORS.primary} name="Principal $" />
                      <Bar dataKey="intereses" stackId="a" fill={ARA_COLORS.orange} name="Intereses $" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Capital Evolution + Moneda + Compania */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Activity className="w-4 h-4 text-[#1A4A28]" />Seguimiento de Amortización: Saldo vs Capital ($)</CardTitle></CardHeader>
                <CardContent>
                  {cumulativeAmort.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={cumulativeAmort}>
                        <defs><linearGradient id="sGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ARA_COLORS.blue} stopOpacity={0.2} /><stop offset="100%" stopColor={ARA_COLORS.blue} stopOpacity={0} /></linearGradient></defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="label" stroke="#9ca3af" fontSize={10} />
                        <YAxis yAxisId="left" stroke="#9ca3af" fontSize={10} tickFormatter={v => formatCompactCurrency(v)} />
                        <YAxis yAxisId="right" orientation="right" stroke="#9ca3af" fontSize={10} tickFormatter={v => `${v}%`} domain={[0, 100]} />
                        <Tooltip formatter={(v: number, name: string) => name.includes('%') ? `${v.toFixed(1)}%` : formatCurrency(v)} contentStyle={tooltipStyle} />
                        <Legend wrapperStyle={{ fontSize: 10 }} />
                        <Area yAxisId="left" type="monotone" dataKey="saldo_original" stroke={ARA_COLORS.blue} strokeWidth={2} fill="url(#sGrad)" name="Saldo Original $" />
                        <Line yAxisId="left" type="monotone" dataKey="capital_actualizado" stroke={ARA_COLORS.gold} strokeWidth={2} dot={{ r: 3 }} name="Capital Vigente $" />
                        <Bar yAxisId="left" dataKey="principal" fill={ARA_COLORS.primary} name="Amortización Mensual $" radius={[2, 2, 0, 0]} opacity={0.6} />
                        <Line yAxisId="left" type="monotone" dataKey="cumulativeAmort" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Amortización Acumulada $" />
                        <Line yAxisId="right" type="monotone" dataKey="pctPaid" stroke="#EC4899" strokeWidth={1.5} dot={false} name="% Pagado" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <EmptyState text="Sin datos de evolución." />}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><DollarSign className="w-4 h-4 text-[#1A4A28]" />Composición por Moneda</CardTitle></CardHeader>
                <CardContent>
                  {byMoneda.length > 0 ? (
                    <>
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={byMoneda} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={4} dataKey="cuota"
                            label={({ moneda, percent }) => `${moneda} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 11 }}>
                            <Cell fill={ARA_COLORS.primary} /><Cell fill={ARA_COLORS.blue} />
                          </Pie>
                          <Tooltip formatter={(v: number) => formatCurrency(v)} contentStyle={tooltipStyle} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-1 mt-2">
                        {byMoneda.map(m => (
                          <div key={m.moneda} className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.moneda === 'CRC' ? ARA_COLORS.primary : ARA_COLORS.blue }} />{m.moneda === 'CRC' ? 'Colones (₡)' : 'Dólares ($)'}</span>
                            <span className="font-semibold tabular-nums">{m.count} ops · {formatCompactCurrency(m.cuota, m.moneda)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <EmptyState text="Sin datos." />}
                </CardContent>
              </Card>
            </div>

            {/* Detail table */}
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Layers className="w-4 h-4 text-[#1A4A28]" />Detalle de Operaciones de Crédito</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wider">
                      <th className="pb-2 pr-3">Operación</th><th className="pb-2 pr-3">Compañía</th><th className="pb-2 pr-3">Banco</th>
                      <th className="pb-2 pr-3">Tipo</th><th className="pb-2 pr-3 text-right">Saldo Original</th>
                      <th className="pb-2 pr-3 text-right">Cuota</th><th className="pb-2 pr-3">Vencimiento</th><th className="pb-2">Moneda</th>
                    </tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {uniqueOps.slice(0, 25).map((op, idx) => {
                        const expired = op.vencimiento && new Date(op.vencimiento) < now;
                        return (
                          <tr key={idx} className="hover:bg-gray-50/50 cursor-pointer" onDoubleClick={() => setDetailRecord(op as unknown as Record<string, unknown>)} title="Doble clic para ver/editar detalle">
                            <td className="py-2 pr-3 font-medium text-gray-900 text-xs max-w-[180px] truncate" title={op.operacion}>{op.operacion || '—'}</td>
                            <td className="py-2 pr-3 text-gray-600 text-xs">{op.compania || '—'}</td>
                            <td className="py-2 pr-3 text-gray-600 text-xs">{op.banco || '—'}</td>
                            <td className="py-2 pr-3"><Badge variant={op.tipo === 'Largo Plazo' ? 'default' : op.tipo === 'Capital Trabajo' ? 'warning' : 'info'}>{op.tipo || '—'}</Badge></td>
                            <td className="py-2 pr-3 text-right font-semibold tabular-nums text-xs">{formatCurrency(termAmount(op, 'saldo_original'), termCurrency(op))}</td>
                            <td className="py-2 pr-3 text-right tabular-nums text-xs">{formatCurrency(termAmount(op, 'cuota'), termCurrency(op))}</td>
                            <td className={`py-2 pr-3 text-xs ${expired ? 'text-red-600 font-bold' : 'text-gray-600'}`}>{op.vencimiento ? formatDate(op.vencimiento) : '—'}{expired && <span className="ml-1 text-[8px] bg-red-100 text-red-700 px-1 rounded">VENCIDO</span>}</td>
                            <td className="py-2 text-xs text-gray-500"><Badge variant={termCurrency(op) === 'USD' ? 'info' : 'default'}>{termCurrency(op)}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {uniqueOps.length > 25 && <p className="text-xs text-gray-400 mt-2 text-center">Mostrando 25 de {uniqueOps.length}.</p>}
                  <p className="text-xs text-gray-400 mt-1 text-center italic">Doble clic en una fila para ver/editar detalle completo</p>
                  <p className="text-xs text-gray-400 mt-1 text-center">Convención: Largo Plazo → USD ($) · Corto Plazo / Capital Trabajo → CRC (₡)</p>
                </div>
              </CardContent>
            </Card>

            {/* Narrative */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="w-4 h-4 text-[#C9A84C]" />Hallazgos & Riesgos — Crédito</CardTitle></CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Record Detail Modal */}
      <RecordDetailModal
        open={!!detailRecord}
        onClose={() => setDetailRecord(null)}
        title="Detalle Operación de Crédito"
        subtitle={detailRecord ? `${(detailRecord as Record<string, unknown>).operacion || ''} — ${(detailRecord as Record<string, unknown>).banco || ''}` : ''}
        record={detailRecord}
        fields={CREDIT_FIELDS}
        schema="silver_finance"
        table="flujo_semanal"
        onSaved={fetchData}
      />
    </Layout>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex flex-col items-center justify-center py-10 text-gray-400"><BarChart3 className="w-8 h-8 mb-2 opacity-30" /><p className="text-xs text-center max-w-xs">{text}</p></div>;
}
