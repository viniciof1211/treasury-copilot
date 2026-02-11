import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Printer, Lightbulb, RefreshCw, DollarSign, FileText, Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Layout } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { useExchangeRate, toUSD, fmtCur, fmtCompact } from '../hooks/useExchangeRate';
import { querySQL, type CxPItem, type FlujoItem, type Projection } from '../lib/queries';

const fmtUSD = (v: number) => fmtCur(v, 'USD');
const fmtCompactUSD = (v: number) => fmtCompact(v, 'USD');

interface BoardKPI {
  label: string;
  computed: number;
  override: string; // manual override (empty = use computed)
}

interface BoardNote {
  title: string;
  body: string;
}

const STORAGE_KEY = 'board_presentation_data';

function loadSavedData(): { kpiOverrides: Record<string, string>; notes: BoardNote[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { kpiOverrides: {}, notes: [{ title: 'Resumen Ejecutivo', body: '' }, { title: 'Riesgos Clave', body: '' }, { title: 'Acciones Propuestas', body: '' }] };
}

export function BoardPresentation() {
  const [loading, setLoading] = useState(true);
  const [cxp, setCxp] = useState<CxPItem[]>([]);
  const [flujo, setFlujo] = useState<FlujoItem[]>([]);
  const [projection, setProjection] = useState<Projection[]>([]);
  const { rate } = useExchangeRate();

  const saved = useMemo(loadSavedData, []);
  const [kpiOverrides, setKpiOverrides] = useState<Record<string, string>>(saved.kpiOverrides);
  const [notes, setNotes] = useState<BoardNote[]>(saved.notes);
  const [lang, setLang] = useState<'es' | 'en'>(() => (localStorage.getItem('narrative_lang') as 'es' | 'en') || 'es');

  // Persist data on change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ kpiOverrides, notes }));
  }, [kpiOverrides, notes]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [c, f, p] = await Promise.all([
        querySQL(`SELECT empresa, proveedor, monto_usd, vencimiento_fecha, prioridad, clasificacion FROM silver_finance.cxp_items ORDER BY vencimiento_fecha`),
        querySQL(`SELECT compania, cuota, principal, intereses, vencimiento, banco, tipo, operacion, saldo_original, capital, capital_actualizado, moneda FROM silver_finance.flujo_semanal ORDER BY vencimiento`),
        querySQL(`SELECT projection_month, projected_inflows, projected_outflows, projected_balance FROM silver_finance.projection_12m ORDER BY projection_month`),
      ]);
      setCxp(c); setFlujo(f); setProjection(p);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const flujoUSD = useCallback((item: FlujoItem, field: 'cuota' | 'principal' | 'intereses' | 'saldo_original' | 'capital' | 'capital_actualizado') => {
    return toUSD(Number(item[field]) || 0, item.moneda, rate);
  }, [rate]);

  // ── Computed KPIs ─────────────────────────────────────────────────────────
  const totalCxP = cxp.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0);
  const totalInflows = flujo.reduce((s, r) => s + flujoUSD(r, 'cuota'), 0);
  const netCashflow = totalInflows - totalCxP;
  const totalSaldo = flujo.reduce((s, r) => s + flujoUSD(r, 'saldo_original'), 0);
  const totalCapAct = flujo.reduce((s, r) => s + flujoUSD(r, 'capital_actualizado'), 0);
  const totalIntereses = flujo.reduce((s, r) => s + flujoUSD(r, 'intereses'), 0);
  const ratio = totalCxP > 0 ? totalInflows / totalCxP : totalInflows > 0 ? 99 : 0;
  const now = new Date();
  const overdueCxP = cxp.filter(r => r.vencimiento_fecha && new Date(r.vencimiento_fecha) < now);
  const overdueAmount = overdueCxP.reduce((s, r) => s + (Number(r.monto_usd) || 0), 0);
  const debtLP = flujo.filter(r => r.tipo === 'Largo Plazo').reduce((s, r) => s + flujoUSD(r, 'saldo_original'), 0);
  const debtCP = flujo.filter(r => r.tipo !== 'Largo Plazo').reduce((s, r) => s + flujoUSD(r, 'saldo_original'), 0);

  const boardKPIs: BoardKPI[] = useMemo(() => [
    { label: lang === 'es' ? 'Total CxP' : 'Total AP', computed: totalCxP, override: kpiOverrides['cxp'] || '' },
    { label: lang === 'es' ? 'Ingresos Operativos' : 'Operational Income', computed: totalInflows, override: kpiOverrides['inflows'] || '' },
    { label: lang === 'es' ? 'Cashflow Neto' : 'Net Cashflow', computed: netCashflow, override: kpiOverrides['net'] || '' },
    { label: lang === 'es' ? 'Deuda Largo Plazo' : 'Long-term Debt', computed: debtLP, override: kpiOverrides['debtLP'] || '' },
    { label: lang === 'es' ? 'Deuda Corto Plazo' : 'Short-term Debt', computed: debtCP, override: kpiOverrides['debtCP'] || '' },
    { label: lang === 'es' ? 'CxP Vencidas' : 'Overdue AP', computed: overdueAmount, override: kpiOverrides['overdue'] || '' },
    { label: lang === 'es' ? 'Capital Vigente' : 'Outstanding Capital', computed: totalCapAct, override: kpiOverrides['capAct'] || '' },
    { label: lang === 'es' ? 'Intereses Totales' : 'Total Interest', computed: totalIntereses, override: kpiOverrides['interest'] || '' },
  ], [totalCxP, totalInflows, netCashflow, debtLP, debtCP, overdueAmount, totalCapAct, totalIntereses, kpiOverrides, lang]);

  const kpiKeys = ['cxp', 'inflows', 'net', 'debtLP', 'debtCP', 'overdue', 'capAct', 'interest'];

  const updateOverride = (key: string, value: string) => {
    setKpiOverrides(prev => ({ ...prev, [key]: value }));
  };

  const updateNote = (idx: number, field: 'title' | 'body', value: string) => {
    setNotes(prev => prev.map((n, i) => i === idx ? { ...n, [field]: value } : n));
  };

  const addNote = () => setNotes(prev => [...prev, { title: '', body: '' }]);

  const removeNote = (idx: number) => setNotes(prev => prev.filter((_, i) => i !== idx));

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportToExcel = useCallback(() => {
    const kpiData = boardKPIs.map((k, i) => ({
      KPI: k.label,
      'Valor Calculado ($)': k.computed,
      'Override Manual ($)': k.override || '—',
      'Valor Final ($)': k.override ? parseFloat(k.override) || k.computed : k.computed,
    }));
    const noteData = notes.map(n => ({ Sección: n.title, Contenido: n.body }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpiData), 'KPIs');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(noteData), 'Notas');
    XLSX.writeFile(wb, `Junta_Directiva_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [boardKPIs, notes]);

  const handlePrint = () => window.print();

  return (
    <Layout>
      <div className="space-y-6 print:space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              {lang === 'es' ? 'Presentación Junta Directiva' : 'Board of Directors Presentation'}
            </h1>
            <p className="text-gray-500 mt-1 text-sm">
              {lang === 'es'
                ? 'Módulo de ingreso de datos para exposición ejecutiva — KPIs editables, notas y exportación'
                : 'Data entry module for executive presentation — Editable KPIs, notes and export'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { const next = lang === 'es' ? 'en' : 'es'; setLang(next); localStorage.setItem('narrative_lang', next); }}
              className="px-2.5 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50">{lang === 'es' ? 'EN' : 'ES'}</button>
            <button onClick={exportToExcel}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1A4A28] bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">
              <Download className="w-3.5 h-3.5" /> Excel
            </button>
            <button onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">
              <Printer className="w-3.5 h-3.5" /> {lang === 'es' ? 'Imprimir / PDF' : 'Print / PDF'}
            </button>
            <button onClick={fetchData} disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#1A4A28] bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Print header */}
        <div className="hidden print:block text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900">ARA Group — {lang === 'es' ? 'Reporte Junta Directiva' : 'Board Report'}</h1>
          <p className="text-sm text-gray-500">{new Date().toLocaleDateString(lang === 'es' ? 'es-CR' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-gray-400">
            <LoadingSpinner size="lg" />
            <p className="mt-4 text-sm">{lang === 'es' ? 'Cargando datos...' : 'Loading data...'}</p>
          </div>
        ) : (
          <>
            {/* KPI Cards — editable */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="w-4 h-4 text-[#1A4A28]" />
                  {lang === 'es' ? 'KPIs Ejecutivos — Valores editables para Junta' : 'Executive KPIs — Editable values for Board'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {boardKPIs.map((kpi, idx) => {
                    const displayVal = kpi.override ? parseFloat(kpi.override) || kpi.computed : kpi.computed;
                    const isOverridden = !!kpi.override;
                    return (
                      <div key={kpiKeys[idx]} className={`p-4 rounded-xl border ${isOverridden ? 'border-amber-200 bg-amber-50/50' : 'border-gray-200 bg-white'}`}>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{kpi.label}</p>
                        <p className="text-xl font-bold text-gray-900 tabular-nums">{fmtCompactUSD(displayVal)}</p>
                        <p className="text-[9px] text-gray-400 mt-0.5">{lang === 'es' ? 'Calculado' : 'Computed'}: {fmtCompactUSD(kpi.computed)}</p>
                        <input type="text" value={kpi.override} onChange={e => updateOverride(kpiKeys[idx], e.target.value)}
                          placeholder={lang === 'es' ? 'Override...' : 'Override...'}
                          className="mt-2 w-full text-xs border border-gray-200 rounded px-2 py-1 text-right print:hidden" />
                        {isOverridden && <Badge variant="warning" className="mt-1 text-[8px] print:hidden">{lang === 'es' ? 'Manual' : 'Override'}</Badge>}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Executive Notes */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText className="w-4 h-4 text-[#1A4A28]" />
                    {lang === 'es' ? 'Notas Ejecutivas para Junta Directiva' : 'Executive Notes for Board'}
                  </CardTitle>
                  <button onClick={addNote} className="text-xs text-[#1A4A28] hover:underline print:hidden">
                    + {lang === 'es' ? 'Agregar sección' : 'Add section'}
                  </button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {notes.map((note, idx) => (
                    <div key={idx} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <input type="text" value={note.title} onChange={e => updateNote(idx, 'title', e.target.value)}
                          placeholder={lang === 'es' ? 'Título de sección...' : 'Section title...'}
                          className="text-sm font-semibold text-gray-900 border-none focus:ring-0 p-0 w-full print:font-bold" />
                        {notes.length > 1 && (
                          <button onClick={() => removeNote(idx)} className="text-xs text-red-400 hover:text-red-600 print:hidden">×</button>
                        )}
                      </div>
                      <textarea value={note.body} onChange={e => updateNote(idx, 'body', e.target.value)}
                        placeholder={lang === 'es' ? 'Escribir notas ejecutivas para la junta directiva...' : 'Write executive notes for the board...'}
                        rows={4}
                        className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 resize-y focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28] print:border-none print:px-0" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Auto-generated summary */}
            <Card className="border-l-4 border-l-[#1A4A28]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="w-4 h-4 text-[#C9A84C]" />
                  {lang === 'es' ? 'Resumen Automático (datos reales)' : 'Automated Summary (live data)'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2.5 text-sm text-gray-800">
                  <p>
                    {lang === 'es'
                      ? `Posición de tesorería: Cashflow neto de ${fmtCompactUSD(netCashflow)} (${netCashflow >= 0 ? 'superávit' : 'déficit'}). Ratio de cobertura: ${ratio.toFixed(1)}x.`
                      : `Treasury position: Net cashflow of ${fmtCompactUSD(netCashflow)} (${netCashflow >= 0 ? 'surplus' : 'deficit'}). Coverage ratio: ${ratio.toFixed(1)}x.`}
                  </p>
                  <p>
                    {lang === 'es'
                      ? `Deuda: Largo plazo ${fmtCompactUSD(debtLP)}, corto plazo ${fmtCompactUSD(debtCP)}. Capital vigente: ${fmtCompactUSD(totalCapAct)}.`
                      : `Debt: Long-term ${fmtCompactUSD(debtLP)}, short-term ${fmtCompactUSD(debtCP)}. Outstanding capital: ${fmtCompactUSD(totalCapAct)}.`}
                  </p>
                  {overdueCxP.length > 0 && (
                    <p className="text-red-700 font-medium">
                      {lang === 'es'
                        ? `⚠ ${overdueCxP.length} cuentas por pagar vencidas por ${fmtCompactUSD(overdueAmount)}.`
                        : `⚠ ${overdueCxP.length} overdue accounts payable totaling ${fmtCompactUSD(overdueAmount)}.`}
                    </p>
                  )}
                  <p>
                    {lang === 'es'
                      ? `Total registros: ${cxp.length} CxP, ${flujo.length} operaciones de crédito, ${projection.length} meses de proyección.`
                      : `Total records: ${cxp.length} AP, ${flujo.length} credit operations, ${projection.length} months projection.`}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-gray-400 border-t border-gray-100 pt-4">
              <span>{lang === 'es' ? 'Generado:' : 'Generated:'} {new Date().toLocaleString(lang === 'es' ? 'es-CR' : 'en-US')}</span>
              <span>CVE Treasury Copilot — ARA Group</span>
            </div>
          </>
        )}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          nav, .print\\:hidden { display: none !important; }
          .print\\:block { display: block !important; }
          body { font-size: 12px; }
        }
      `}</style>
    </Layout>
  );
}
