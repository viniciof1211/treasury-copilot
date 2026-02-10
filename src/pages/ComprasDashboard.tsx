import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShoppingCart, Package, AlertTriangle, Truck, Clock, BarChart3, TrendingUp,
  TrendingDown, RefreshCw, Lightbulb, DollarSign, Layers, Shield, Globe,
  BookOpen, Search, ChevronDown, ChevronUp, Scale, Anchor, Warehouse, FileText,
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { RecordDetailModal, type FieldDef } from '../components/ui/RecordDetailModal';
import {
  formatCurrency, formatCompactCurrency, ARA_COLORS,
} from '../lib/utils';
import { querySQL, type MRPItem, tooltipStyle } from '../lib/queries';
import { supabase } from '../lib/supabase';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell, ComposedChart, Line, Area, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Treemap,
} from 'recharts';

const CHART_COLORS = ['#1A4A28', '#2D6A3F', '#C9A84C', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#EF4444', '#06B6D4', '#84CC16'];
const ABC_COLORS: Record<string, string> = { A: '#1A4A28', B: '#C9A84C', C: '#9CA3AF' };
const ORIGIN_COLORS: Record<string, string> = { 'Europa': '#3B82F6', 'Asia': '#EF4444', 'Local': '#1A4A28', 'America': '#8B5CF6', 'China': '#F59E0B', 'Ecuador': '#06B6D4', 'Mexico': '#EC4899' };

const fmt = (n: number) => new Intl.NumberFormat('es-CR', { maximumFractionDigits: 0 }).format(n);
const fmtUSD = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtUSD2 = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// ══════════════════════════════════════════════════════════════════════════════
// Costa Rica — Import Tax & Fee Configuration (Ministerio de Hacienda / TICA)
// Source: https://api.hacienda.go.cr, portaltica.hacienda.go.cr, Ley 9635 IVA
// ══════════════════════════════════════════════════════════════════════════════

/** DAI % by origin — typical rates for manufacturing/industrial inputs.
 *  Actual rates depend on TICA tariff classification (partida arancelaria). */
const DAI_BY_ORIGIN: Record<string, number> = {
  'Local': 0,
  'America': 0.01,   // CAFTA-DR / TLC EEUU-CR
  'Mexico': 0.01,    // TLC México-CR
  'Ecuador': 0.05,
  'Europa': 0.05,    // Acuerdo de Asociación UE-CA
  'Asia': 0.10,
  'China': 0.10,
};

/** Maritime freight as % of FOB — estimates by origin */
const FLETE_BY_ORIGIN: Record<string, number> = {
  'Local': 0,
  'America': 0.03,
  'Mexico': 0.03,
  'Ecuador': 0.04,
  'Europa': 0.07,
  'Asia': 0.08,
  'China': 0.08,
};

/** Insurance as % of FOB */
const SEGURO_PCT = 0.015;
/** Ley 6946 (IFAM) — 1% on CIF */
const LEY6946_PCT = 0.01;
/** Default IVA rate — 13% (Costa Rica, most goods) */
const IVA_DEFAULT_PCT = 0.13;
/** Selectivo de Consumo — 0% for industrial inputs */
const SC_DEFAULT_PCT = 0;
/** Customs broker fee as % of CIF (typical 1.5%, min $25) */
const AGENTE_ADUANAL_PCT = 0.015;
/** Almacén Fiscal — bonded warehouse fee (estimated per-item equivalent USD) */
const ALMACEN_FISCAL_USD = 15;
/** Handling / deconsolidation fee per item equivalent */
const HANDLING_USD = 10;
/** Internal transport as % of CIF */
const TRANSPORTE_INTERNO_PCT = 0.01;

// ── CABYS API (Hacienda) ─────────────────────────────────────────────────────
const CABYS_API = 'https://api.hacienda.go.cr/fe/cabys';

interface CABYSResult {
  codigo: string;
  descripcion: string;
  impuesto: number;
  categorias: string[];
}

interface NacItem {
  codigo: string;
  descripcion: string;
  origen: string;
  proveedor: string;
  abc_class: string;
  cantidad: number;
  costoUnit: number;
  fob: number;
  flete: number;
  seguro: number;
  cif: number;
  dai: number;
  daiPct: number;
  sc: number;
  ley6946: number;
  iva: number;
  ivaPct: number;
  agenteAduanal: number;
  almacenFiscal: number;
  handling: number;
  transporteInterno: number;
  valorNacionalizado: number;
  costoUnitNac: number;
  markup: number; // % increase from FOB to nacionalizado
}

/** Fiscal glossary — definitions */
const FISCAL_GLOSSARY: { term: string; abbr: string; description: string; legal: string; color: string }[] = [
  { term: 'Valor FOB', abbr: 'FOB', description: 'Free On Board — costo del producto puesto en el puerto de embarque del país de origen.', legal: 'Incoterms 2020 (ICC)', color: '#1A4A28' },
  { term: 'Flete Marítimo', abbr: 'Flete', description: 'Costo de transporte internacional de la mercancía hasta el puerto de destino en Costa Rica (Limón/Caldera).', legal: 'Incoterms CFR/CIF', color: '#3B82F6' },
  { term: 'Seguro', abbr: 'Seguro', description: 'Póliza de seguro de transporte internacional, protege contra pérdida o daño durante el trayecto.', legal: 'Art. 1 Acuerdo de Valoración OMC', color: '#06B6D4' },
  { term: 'Valor CIF', abbr: 'CIF', description: 'Cost, Insurance, Freight — base imponible para el cálculo de tributos aduaneros. CIF = FOB + Flete + Seguro.', legal: 'Art. 252 Ley General de Aduanas (LGA)', color: '#8B5CF6' },
  { term: 'Derechos Arancelarios a la Importación', abbr: 'DAI', description: 'Tributo ad valorem sobre el CIF. La tasa varía según partida arancelaria (Sistema Armonizado) y tratados de libre comercio vigentes.', legal: 'CAUCA/RECAUCA, TICA, SAC', color: '#F59E0B' },
  { term: 'Selectivo de Consumo', abbr: 'SC', description: 'Impuesto sobre bienes específicos (vehículos, bebidas, tabaco). Base: CIF + DAI. 0% para la mayoría de insumos industriales.', legal: 'Ley 4961 / Ley 9635 Art. 22', color: '#EC4899' },
  { term: 'Ley 6946 (IFAM)', abbr: 'L6946', description: 'Contribución del 1% sobre el valor CIF destinada al Instituto de Fomento y Asesoría Municipal (IFAM).', legal: 'Ley 6946 (Art. 1)', color: '#EF4444' },
  { term: 'Impuesto al Valor Agregado', abbr: 'IVA', description: 'Impuesto general del 13% sobre el valor acumulado (CIF + DAI + SC + Ley6946). Consultar CABYS para tasas reducidas (0%, 1%, 2%, 4%).', legal: 'Ley 9635, Título I (IVA)', color: '#C9A84C' },
  { term: 'Agente Aduanal', abbr: 'Agente', description: 'Honorarios del agente de aduanas por la gestión del Documento Único Aduanero (DUA). Típico 1.5% del CIF (mínimo $25).', legal: 'Art. 33 LGA', color: '#84CC16' },
  { term: 'Almacén Fiscal', abbr: 'Almacén', description: 'Costo de almacenamiento en depósito aduanero (recinto fiscal) mientras se completa el proceso de desaduanaje.', legal: 'Art. 145 LGA', color: '#64748B' },
  { term: 'Handling / Desconsolidación', abbr: 'Handling', description: 'Costos de manipulación portuaria, desconsolidación de contenedores y documentación en puerto.', legal: 'Regulación JAPDEVA/INCOP', color: '#A855F7' },
  { term: 'Transporte Interno', abbr: 'Transp.', description: 'Flete terrestre desde el puerto de entrada (Limón/Caldera) hasta la bodega o planta del importador.', legal: 'Costo logístico comercial', color: '#0EA5E9' },
  { term: 'Valor Nacionalizado', abbr: 'V.Nac.', description: 'Costo total de la mercancía puesta en bodega del importador, incluyendo todos los tributos, aranceles y costos logísticos.', legal: 'CIF + DAI + SC + L6946 + IVA + Agente + Almacén + Handling + Transporte', color: '#1A4A28' },
  { term: 'CABYS', abbr: 'CABYS', description: 'Catálogo de Bienes y Servicios del Ministerio de Hacienda. Clasifica productos con su tasa de IVA aplicable. API: api.hacienda.go.cr/fe/cabys', legal: 'Res. MH-DGT-RES-0012-2020', color: '#2D6A3F' },
  { term: 'DUA', abbr: 'DUA', description: 'Documento Único Aduanero — declaración obligatoria ante el Servicio Nacional de Aduanas para toda importación/exportación.', legal: 'Art. 86 LGA, TICA (TI-Control Aduanero)', color: '#7C3AED' },
];

const MRP_FIELDS: FieldDef[] = [
  { key: 'codigo', label: 'Código / SKU', type: 'text', group: 'Identificación del Producto' },
  { key: 'descripcion', label: 'Descripción', type: 'text', highlight: true },
  { key: 'abc_class', label: 'Clasificación ABC', type: 'select', options: ['A', 'B', 'C'] },
  { key: 'tipo_stock', label: 'Tipo Stock', type: 'select', options: ['MTS', 'MTO'] },
  { key: 'familia', label: 'Familia', type: 'text' },
  { key: 'subclasificacion', label: 'Subclasificación', type: 'text' },
  { key: 'infaltable', label: 'Infaltable', type: 'select', options: ['Infaltable', ''] },
  { key: 'descontinuado', label: 'Descontinuado', type: 'select', options: ['X', ''] },
  { key: 'proveedor', label: 'Proveedor', type: 'text', group: 'Proveedor y Logística' },
  { key: 'comprador', label: 'Comprador', type: 'text' },
  { key: 'tipo_item', label: 'Tipo Ítem', type: 'select', options: ['Importado', 'Local', 'Sin Definir'] },
  { key: 'origen', label: 'Origen', type: 'text' },
  { key: 'lead_time_dias', label: 'Lead Time', type: 'number', suffix: 'días' },
  { key: 'dificultad_logistica', label: 'Dificultad Logística', type: 'number', suffix: '/ 10' },
  { key: 'compra_minima', label: 'Compra Mínima', type: 'number' },
  { key: 'unidad_medida', label: 'Unidad de Medida', type: 'text' },
  { key: 'consumo_promedio', label: 'Consumo Promedio Mensual', type: 'number', group: 'Consumo', highlight: true },
  { key: 'consumo_diario', label: 'Consumo Diario', type: 'number' },
  { key: 'desv_estandar', label: 'Desviación Estándar', type: 'number' },
  { key: 'consumo_m1', label: 'Consumo Mes 1', type: 'number' },
  { key: 'consumo_m2', label: 'Consumo Mes 2', type: 'number' },
  { key: 'consumo_m3', label: 'Consumo Mes 3', type: 'number' },
  { key: 'consumo_m4', label: 'Consumo Mes 4', type: 'number' },
  { key: 'inventario', label: 'Inventario', type: 'number', group: 'Inventario' },
  { key: 'reserva', label: 'Reserva', type: 'number' },
  { key: 'inventario_disponible', label: 'Inventario Disponible', type: 'number', highlight: true },
  { key: 'transito', label: 'En Tránsito', type: 'number' },
  { key: 'inventario_total', label: 'Inventario Total', type: 'number' },
  { key: 'dias_cobertura', label: 'Días de Cobertura', type: 'number', suffix: 'días' },
  { key: 'minimo_inventario', label: 'Mínimo Inventario', type: 'number', group: 'Parámetros MRP' },
  { key: 'dias_stock', label: 'Días de Stock', type: 'number', suffix: 'días' },
  { key: 'stock_seguridad', label: 'Stock de Seguridad', type: 'number' },
  { key: 'punto_reorden', label: 'Punto de Reorden', type: 'number' },
  { key: 'max_inventario', label: 'Máximo Inventario', type: 'number' },
  { key: 'costo_unitario', label: 'Costo Unitario', type: 'currency', suffix: 'USD', group: 'Costos' },
  { key: 'costo_inventario', label: 'Costo Inventario', type: 'currency', suffix: 'USD' },
  { key: 'costo_total_inventario', label: 'Costo Total Inventario', type: 'currency', suffix: 'USD', highlight: true },
  { key: 'costo_stock_seguridad', label: 'Costo Stock Seguridad', type: 'currency', suffix: 'USD' },
  { key: 'alerta_desabasto', label: 'Alerta de Desabasto', type: 'select', options: ['Alerta', ''], group: 'Alertas y Acciones' },
  { key: 'hacer_pedido', label: 'Hacer Pedido', type: 'select', options: ['Si', 'No', ''] },
  { key: 'cantidad_requerida', label: 'Cantidad Requerida', type: 'number', highlight: true },
  { key: 'analisis_parametros', label: 'Análisis Parámetros', type: 'select', options: ['Bajo Parametro', 'Dentro parametro', 'Sobre parametro'] },
  { key: 'ingest_run_id', label: 'Run de Ingesta', type: 'readonly', group: 'Metadata' },
  { key: 'created_at', label: 'Fecha de Creación', type: 'readonly' },
];

export function ComprasDashboard() {
  const [loading, setLoading] = useState(true);
  const [mrpAll, setMrpAll] = useState<MRPItem[]>([]);
  const [cxpTotal, setCxpTotal] = useState(0);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [provFilter, setProvFilter] = useState('all');
  const [abcFilter, setAbcFilter] = useState('all');
  const [detailRecord, setDetailRecord] = useState<Record<string, unknown> | null>(null);
  // Valor Nacionalizado state
  const [showGlossary, setShowGlossary] = useState(false);
  const [cabysQuery, setCabysQuery] = useState('');
  const [cabysResults, setCabysResults] = useState<CABYSResult[]>([]);
  const [cabysLoading, setCabysLoading] = useState(false);
  const [nacSortKey, setNacSortKey] = useState<'valorNacionalizado' | 'markup' | 'fob' | 'dai' | 'iva'>('valorNacionalizado');
  const [nacPage, setNacPage] = useState(0);
  const NAC_PAGE_SIZE = 25;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Use direct PostgREST access — exec_sql with jsonb_agg chokes on large MRP tables
      const [mrpRes, cxpRows] = await Promise.all([
        supabase
          .schema('silver_finance' as 'public')
          .from('mrp_master')
          .select('*')
          .order('costo_total_inventario', { ascending: false })
          .limit(10000),
        querySQL(`SELECT COALESCE(SUM(monto_usd), 0) as total FROM silver_finance.cxp_items`),
      ]);

      if (mrpRes.error) {
        console.error('MRP fetch error:', mrpRes.error.message);
        // Fallback: try exec_sql with LIMIT
        const fallback = await querySQL(
          `SELECT * FROM silver_finance.mrp_master ORDER BY costo_total_inventario DESC LIMIT 5000`
        );
        setMrpAll(fallback as MRPItem[]);
      } else {
        setMrpAll((mrpRes.data || []) as MRPItem[]);
      }

      setCxpTotal(Number(cxpRows[0]?.total) || 0);
      setLastRefresh(new Date());
    } catch (e) { console.error('Compras fetchData error:', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── CABYS API Lookup ──────────────────────────────────────────────────────
  const searchCABYS = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 3) return;
    setCabysLoading(true);
    try {
      const res = await fetch(`${CABYS_API}?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const json = await res.json();
        setCabysResults((json.cabys || []).slice(0, 15) as CABYSResult[]);
      }
    } catch (e) { console.error('CABYS error:', e); }
    finally { setCabysLoading(false); }
  }, []);

  // ── Filters ──────────────────────────────────────────────────────────────
  const data = useMemo(() => {
    let d = mrpAll;
    if (provFilter !== 'all') d = d.filter(r => r.proveedor === provFilter);
    if (abcFilter !== 'all') d = d.filter(r => r.abc_class === abcFilter);
    return d;
  }, [mrpAll, provFilter, abcFilter]);

  const proveedores = useMemo(() => {
    const s = new Set(mrpAll.map(r => r.proveedor).filter(Boolean));
    return Array.from(s).sort();
  }, [mrpAll]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const totalInvValue = data.reduce((s, r) => s + (Number(r.costo_total_inventario) || 0), 0);
  const totalSSCost = data.reduce((s, r) => s + (Number(r.costo_stock_seguridad) || 0), 0);
  const alertCount = data.filter(r => r.alerta_desabasto === 'Alerta').length;
  const orderCount = data.filter(r => r.hacer_pedido === 'Si').length;
  const withLT = data.filter(r => (Number(r.lead_time_dias) || 0) > 0);
  const avgLeadTime = withLT.length ? withLT.reduce((s, r) => s + Number(r.lead_time_dias), 0) / withLT.length : 0;
  const withCov = data.filter(r => (Number(r.dias_cobertura) || 0) > 0 && (Number(r.dias_cobertura) || 0) < 10000);
  const avgCovDays = withCov.length ? withCov.reduce((s, r) => s + Number(r.dias_cobertura), 0) / withCov.length : 0;
  const totalSKUs = data.length;
  const activeSKUs = data.filter(r => (Number(r.consumo_promedio) || 0) > 0).length;

  // ── ABC Distribution ──────────────────────────────────────────────────────
  const abcDist = useMemo(() => {
    const map: Record<string, { cls: string; count: number; invValue: number; consumption: number }> = {};
    data.forEach(r => {
      const c = r.abc_class || 'Sin clasificar';
      if (!map[c]) map[c] = { cls: c, count: 0, invValue: 0, consumption: 0 };
      map[c].count++;
      map[c].invValue += Number(r.costo_total_inventario) || 0;
      map[c].consumption += Number(r.consumo_promedio) || 0;
    });
    return Object.values(map).sort((a, b) => b.invValue - a.invValue);
  }, [data]);

  // ── Monthly consumption trend ─────────────────────────────────────────────
  const consumoTrend = useMemo(() => {
    const months = ['M8 (May)', 'M7 (Jun)', 'M6 (Jul)', 'M5 (Ago)', 'M4 (Sep)', 'M3 (Oct)', 'M2 (Nov)', 'M1 (Dic)'];
    const keys: (keyof MRPItem)[] = ['consumo_m8', 'consumo_m7', 'consumo_m6', 'consumo_m5', 'consumo_m4', 'consumo_m3', 'consumo_m2', 'consumo_m1'];
    return months.map((label, i) => ({
      mes: label,
      consumo: data.reduce((s, r) => s + (Number(r[keys[i]]) || 0), 0),
    }));
  }, [data]);

  // ── Top Proveedores by inventory value ────────────────────────────────────
  const topProveedores = useMemo(() => {
    const map: Record<string, { prov: string; invValue: number; skus: number; avgLT: number; ltSum: number; ltCount: number }> = {};
    data.forEach(r => {
      const p = r.proveedor || 'Sin proveedor';
      if (!map[p]) map[p] = { prov: p, invValue: 0, skus: 0, avgLT: 0, ltSum: 0, ltCount: 0 };
      map[p].invValue += Number(r.costo_total_inventario) || 0;
      map[p].skus++;
      const lt = Number(r.lead_time_dias) || 0;
      if (lt > 0) { map[p].ltSum += lt; map[p].ltCount++; }
    });
    return Object.values(map)
      .map(p => ({ ...p, avgLT: p.ltCount > 0 ? p.ltSum / p.ltCount : 0 }))
      .sort((a, b) => b.invValue - a.invValue)
      .slice(0, 15);
  }, [data]);

  // ── Inventory by Origin ───────────────────────────────────────────────────
  const byOrigin = useMemo(() => {
    const map: Record<string, { origen: string; value: number; count: number }> = {};
    data.forEach(r => {
      const o = r.origen || 'Sin definir';
      if (!map[o]) map[o] = { origen: o, value: 0, count: 0 };
      map[o].value += Number(r.costo_total_inventario) || 0;
      map[o].count++;
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [data]);

  // ── Coverage buckets ──────────────────────────────────────────────────────
  const covBuckets = useMemo(() => {
    const buckets = [
      { label: '< 0 (Desabasto)', min: -999999, max: 0, count: 0, value: 0, color: '#EF4444' },
      { label: '0–15 días', min: 0, max: 15, count: 0, value: 0, color: '#F59E0B' },
      { label: '15–30 días', min: 15, max: 30, count: 0, value: 0, color: '#C9A84C' },
      { label: '30–60 días', min: 30, max: 60, count: 0, value: 0, color: '#3B82F6' },
      { label: '60–90 días', min: 60, max: 90, count: 0, value: 0, color: '#2D6A3F' },
      { label: '90+ días', min: 90, max: 999999, count: 0, value: 0, color: '#1A4A28' },
    ];
    data.forEach(r => {
      const d = Number(r.dias_cobertura) || 0;
      if (d > 10000 || d < -10000) return; // skip outliers
      for (const b of buckets) {
        if (d >= b.min && d < b.max) { b.count++; b.value += Number(r.costo_total_inventario) || 0; break; }
      }
    });
    return buckets;
  }, [data]);

  // ── MTS vs MTO ────────────────────────────────────────────────────────────
  const stockPolicy = useMemo(() => {
    const map: Record<string, { tipo: string; count: number; value: number }> = {};
    data.forEach(r => {
      const t = r.tipo_stock || 'Sin definir';
      if (!map[t]) map[t] = { tipo: t, count: 0, value: 0 };
      map[t].count++;
      map[t].value += Number(r.costo_total_inventario) || 0;
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [data]);

  // ── Lead time by origin ───────────────────────────────────────────────────
  const ltByOrigin = useMemo(() => {
    const map: Record<string, { origen: string; sum: number; count: number; maxLT: number }> = {};
    data.forEach(r => {
      const o = r.origen || 'Sin definir';
      const lt = Number(r.lead_time_dias) || 0;
      if (lt <= 0) return;
      if (!map[o]) map[o] = { origen: o, sum: 0, count: 0, maxLT: 0 };
      map[o].sum += lt;
      map[o].count++;
      map[o].maxLT = Math.max(map[o].maxLT, lt);
    });
    return Object.values(map)
      .map(o => ({ ...o, avgLT: o.count > 0 ? Math.round(o.sum / o.count) : 0 }))
      .sort((a, b) => b.avgLT - a.avgLT);
  }, [data]);

  // ── Parameter analysis ────────────────────────────────────────────────────
  const paramDist = useMemo(() => {
    const map: Record<string, number> = {};
    data.forEach(r => {
      const p = r.analisis_parametros || 'Sin análisis';
      map[p] = (map[p] || 0) + 1;
    });
    return Object.entries(map).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [data]);

  // ── 12-Month Purchase Projection ──────────────────────────────────────────
  const projection12m = useMemo(() => {
    const avgMonthlyConsumptionCost = data.reduce((s, r) =>
      s + (Number(r.consumo_promedio) || 0) * (Number(r.costo_unitario) || 0), 0);
    const months: { mes: string; comprasProyectadas: number; stockActual: number; deficit: number }[] = [];
    let runningStock = totalInvValue;
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const m = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const label = m.toLocaleDateString('es-CR', { month: 'short', year: '2-digit' });
      const burn = avgMonthlyConsumptionCost * (1 + (i < 3 ? 0 : i < 6 ? 0.05 : 0.1)); // seasonal adj
      runningStock -= burn;
      const deficit = Math.min(0, runningStock);
      months.push({
        mes: label,
        comprasProyectadas: Math.round(burn),
        stockActual: Math.max(0, Math.round(runningStock)),
        deficit: Math.round(deficit),
      });
    }
    return months;
  }, [data, totalInvValue]);

  // ── Top items requiring orders ────────────────────────────────────────────
  const topOrderItems = useMemo(() =>
    data.filter(r => r.hacer_pedido === 'Si')
      .sort((a, b) => (Number(b.cantidad_requerida) || 0) * (Number(b.costo_unitario) || 0) -
                       (Number(a.cantidad_requerida) || 0) * (Number(a.costo_unitario) || 0))
      .slice(0, 20)
  , [data]);

  // ── Items with stockout alerts ────────────────────────────────────────────
  const alertItems = useMemo(() =>
    data.filter(r => r.alerta_desabasto === 'Alerta')
      .sort((a, b) => (Number(b.costo_total_inventario) || 0) - (Number(a.costo_total_inventario) || 0))
      .slice(0, 15)
  , [data]);

  // ── Valor Nacionalizado calculation engine ────────────────────────────────
  const nacionalizadoAll = useMemo(() => {
    return data
      .filter(r => (Number(r.cantidad_requerida) || 0) > 0 && (Number(r.costo_unitario) || 0) > 0)
      .map(r => {
        const origen = r.origen || 'Sin definir';
        const cantidad = Number(r.cantidad_requerida) || 0;
        const costoUnit = Number(r.costo_unitario) || 0;
        const fob = cantidad * costoUnit;
        const fletePct = FLETE_BY_ORIGIN[origen] ?? 0.05;
        const flete = fob * fletePct;
        const seguro = fob * SEGURO_PCT;
        const cif = fob + flete + seguro;
        const daiPct = DAI_BY_ORIGIN[origen] ?? 0.05;
        const dai = cif * daiPct;
        const sc = cif * SC_DEFAULT_PCT; // 0 for industrial
        const ley6946 = cif * LEY6946_PCT;
        const ivaPct = IVA_DEFAULT_PCT;
        const iva = (cif + dai + sc + ley6946) * ivaPct;
        const agenteAduanal = Math.max(25, cif * AGENTE_ADUANAL_PCT);
        const almacenFiscal = ALMACEN_FISCAL_USD;
        const handling = HANDLING_USD;
        const transporteInterno = cif * TRANSPORTE_INTERNO_PCT;
        const valorNacionalizado = cif + dai + sc + ley6946 + iva + agenteAduanal + almacenFiscal + handling + transporteInterno;
        const costoUnitNac = cantidad > 0 ? valorNacionalizado / cantidad : 0;
        const markup = fob > 0 ? ((valorNacionalizado - fob) / fob) * 100 : 0;
        return {
          codigo: r.codigo, descripcion: r.descripcion, origen, proveedor: r.proveedor || '—',
          abc_class: r.abc_class || '—', cantidad, costoUnit, fob, flete, seguro, cif, dai, daiPct,
          sc, ley6946, iva, ivaPct, agenteAduanal, almacenFiscal, handling, transporteInterno,
          valorNacionalizado, costoUnitNac, markup,
        } as NacItem;
      });
  }, [data]);

  const nacSorted = useMemo(() =>
    [...nacionalizadoAll].sort((a, b) => (b[nacSortKey] as number) - (a[nacSortKey] as number)),
  [nacionalizadoAll, nacSortKey]);

  const nacPaged = nacSorted.slice(nacPage * NAC_PAGE_SIZE, (nacPage + 1) * NAC_PAGE_SIZE);
  const nacTotalPages = Math.ceil(nacSorted.length / NAC_PAGE_SIZE);

  // ── Nac aggregates ──────────────────────────────────────────────────────
  const nacTotals = useMemo(() => {
    const t = { fob: 0, flete: 0, seguro: 0, cif: 0, dai: 0, sc: 0, ley6946: 0, iva: 0, agente: 0, almacen: 0, handling: 0, transporte: 0, total: 0 };
    nacionalizadoAll.forEach(r => {
      t.fob += r.fob; t.flete += r.flete; t.seguro += r.seguro; t.cif += r.cif;
      t.dai += r.dai; t.sc += r.sc; t.ley6946 += r.ley6946; t.iva += r.iva;
      t.agente += r.agenteAduanal; t.almacen += r.almacenFiscal; t.handling += r.handling;
      t.transporte += r.transporteInterno; t.total += r.valorNacionalizado;
    });
    return t;
  }, [nacionalizadoAll]);

  const nacCostComposition = useMemo(() => [
    { name: 'FOB', value: nacTotals.fob, color: '#1A4A28' },
    { name: 'Flete', value: nacTotals.flete, color: '#3B82F6' },
    { name: 'Seguro', value: nacTotals.seguro, color: '#06B6D4' },
    { name: 'DAI', value: nacTotals.dai, color: '#F59E0B' },
    { name: 'Ley 6946', value: nacTotals.ley6946, color: '#EF4444' },
    { name: 'IVA', value: nacTotals.iva, color: '#C9A84C' },
    { name: 'Agente', value: nacTotals.agente, color: '#84CC16' },
    { name: 'Almacén', value: nacTotals.almacen, color: '#64748B' },
    { name: 'Handling', value: nacTotals.handling, color: '#A855F7' },
    { name: 'Transporte', value: nacTotals.transporte, color: '#0EA5E9' },
  ], [nacTotals]);

  // Cost composition by origin (stacked bar)
  const nacByOrigin = useMemo(() => {
    const map: Record<string, { origen: string; fob: number; impuestos: number; logistica: number; total: number; items: number }> = {};
    nacionalizadoAll.forEach(r => {
      const o = r.origen || 'Sin definir';
      if (!map[o]) map[o] = { origen: o, fob: 0, impuestos: 0, logistica: 0, total: 0, items: 0 };
      map[o].fob += r.fob;
      map[o].impuestos += r.dai + r.sc + r.ley6946 + r.iva;
      map[o].logistica += r.flete + r.seguro + r.agenteAduanal + r.almacenFiscal + r.handling + r.transporteInterno;
      map[o].total += r.valorNacionalizado;
      map[o].items++;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [nacionalizadoAll]);

  const avgMarkup = nacionalizadoAll.length > 0
    ? nacionalizadoAll.reduce((s, r) => s + r.markup, 0) / nacionalizadoAll.length : 0;

  // ── Treasury link: PO pipeline value ──────────────────────────────────────
  const poPipelineValue = topOrderItems.reduce((s, r) =>
    s + (Number(r.cantidad_requerida) || 0) * (Number(r.costo_unitario) || 0), 0);

  // ── Supplier concentration (Herfindahl) ───────────────────────────────────
  const supplierHHI = useMemo(() => {
    const totalVal = topProveedores.reduce((s, p) => s + p.invValue, 0);
    if (totalVal <= 0) return 0;
    return topProveedores.reduce((s, p) => {
      const share = p.invValue / totalVal;
      return s + share * share;
    }, 0) * 10000;
  }, [topProveedores]);

  // ── Radar chart: supplier risk profile ────────────────────────────────────
  const radarData = useMemo(() => {
    const totalItems = data.length || 1;
    return [
      { metric: 'Concentración Proveedor', value: Math.min(100, supplierHHI / 100) },
      { metric: 'SKUs en Alerta', value: (alertCount / totalItems) * 100 },
      { metric: 'Lead Time >60d', value: (data.filter(r => (Number(r.lead_time_dias) || 0) > 60).length / totalItems) * 100 },
      { metric: 'Bajo Parámetro', value: (data.filter(r => r.analisis_parametros === 'Bajo Parametro').length / totalItems) * 100 },
      { metric: 'Items Importados', value: (data.filter(r => r.tipo_item === 'Importado').length / totalItems) * 100 },
      { metric: 'Infaltables sin Stock', value: (data.filter(r => r.infaltable === 'Infaltable' && (Number(r.inventario_disponible) || 0) <= 0).length / Math.max(1, data.filter(r => r.infaltable === 'Infaltable').length)) * 100 },
    ];
  }, [data, supplierHHI, alertCount]);

  // ── Narrative ─────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    const items: { icon: 'insight' | 'risk' | 'action'; text: string }[] = [];
    // Top provider concentration
    if (topProveedores.length > 0) {
      const top1 = topProveedores[0];
      const top1Share = totalInvValue > 0 ? (top1.invValue / totalInvValue * 100) : 0;
      if (top1Share > 20) items.push({ icon: 'risk', text: `${top1.prov} concentra ${fmtPct(top1Share)} del valor de inventario (${fmtUSD(top1.invValue)}). Alta dependencia de un solo proveedor.` });
    }
    if (alertCount > 0) items.push({ icon: 'risk', text: `${alertCount} SKUs en alerta de desabasto. ${alertItems.slice(0, 3).map(i => i.codigo).join(', ')} son los más críticos por valor.` });
    if (orderCount > 0) items.push({ icon: 'action', text: `${orderCount} ítems requieren orden de compra inmediata. Pipeline de compra estimado: ${fmtUSD(poPipelineValue)}.` });
    // Coverage
    const lowCov = covBuckets.filter(b => b.max <= 15).reduce((s, b) => s + b.count, 0);
    if (lowCov > 0) items.push({ icon: 'risk', text: `${lowCov} SKUs con cobertura < 15 días. Riesgo de desabasto en las próximas 2 semanas.` });
    // Overstock
    const overstock90 = covBuckets.find(b => b.min >= 90);
    if (overstock90 && overstock90.count > 0) items.push({ icon: 'insight', text: `${overstock90.count} SKUs con +90 días de cobertura (sobre-stock por ${fmtUSD(overstock90.value)}). Capital inmovilizado que podría liberarse.` });
    // Lead time
    const longLT = data.filter(r => (Number(r.lead_time_dias) || 0) > 60).length;
    if (longLT > 0) items.push({ icon: 'risk', text: `${longLT} ítems con lead time > 60 días. Planificación de compras debe anticipar al menos 2 meses para estos proveedores.` });
    // Treasury
    items.push({ icon: 'insight', text: `Valor inventario total: ${fmtUSD(totalInvValue)}. Esto representa capital comprometido que impacta directamente la posición de caja.` });
    if (poPipelineValue > 0) items.push({ icon: 'action', text: `Pipeline de órdenes de compra pendientes: ${fmtUSD(poPipelineValue)} se sumará a CxP en las próximas semanas. Coordinar con Tesorería.` });
    // Infaltables
    const infaltablesSinStock = data.filter(r => r.infaltable === 'Infaltable' && (Number(r.inventario_disponible) || 0) <= 0);
    if (infaltablesSinStock.length > 0) items.push({ icon: 'risk', text: `${infaltablesSinStock.length} ítems marcados como "Infaltable" sin inventario disponible. Impacto operativo alto.` });

    // Valor Nacionalizado insights
    if (nacionalizadoAll.length > 0 && nacTotals.total > 0) {
      const taxBurden = nacTotals.total - nacTotals.fob;
      const taxPct = (taxBurden / nacTotals.fob) * 100;
      items.push({ icon: 'insight', text: `Carga tributaria y logística sobre OC pendientes: ${fmtUSD(taxBurden)} (${fmtPct(taxPct)} sobre FOB ${fmtUSD(nacTotals.fob)}). Valor nacionalizado total: ${fmtUSD(nacTotals.total)}.` });
      if (nacTotals.iva > nacTotals.dai) {
        items.push({ icon: 'insight', text: `El IVA (${fmtUSD(nacTotals.iva)}) es el tributo más significativo. Verifique códigos CABYS para identificar productos con tasa reducida (0%, 1%, 2%, 4%).` });
      }
      const highMarkup = nacionalizadoAll.filter(r => r.markup > 40);
      if (highMarkup.length > 0) {
        items.push({ icon: 'risk', text: `${highMarkup.length} ítems con markup > 40% del FOB al nacionalizar. Los orígenes sin TLC (Asia, China) generan mayor carga arancelaria.` });
      }
    }

    return items;
  }, [data, topProveedores, alertCount, orderCount, poPipelineValue, totalInvValue, alertItems, covBuckets, nacionalizadoAll, nacTotals]);

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <LoadingSpinner size="lg" />
          <span className="ml-3 text-gray-500">Cargando datos MRP / Compras...</span>
        </div>
      </Layout>
    );
  }

  if (mrpAll.length === 0) {
    return (
      <Layout>
        <div className="text-center py-20">
          <ShoppingCart className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-700 mb-2">Sin datos de Compras / MRP</h2>
          <p className="text-gray-500 max-w-md mx-auto">
            Sube el archivo <strong>MRP Planning</strong> (.xlsx) en la sección de{' '}
            <a href="/data" className="text-[#1A4A28] underline">Fuentes de Datos</a> y haz clic en <strong>Ingest</strong>.
            El sistema detectará automáticamente el formato MRP.
          </p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <ShoppingCart className="w-8 h-8 text-[#1A4A28]" />
              Compras &amp; MRP
            </h1>
            <p className="text-gray-500 mt-1">
              {fmt(totalSKUs)} SKUs · {fmt(activeSKUs)} activos · {proveedores.length} proveedores · Última carga: {lastRefresh.toLocaleTimeString('es-CR')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* ABC filter */}
            <select
              value={abcFilter}
              onChange={e => setAbcFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">Todas las clases ABC</option>
              <option value="A">Clase A</option>
              <option value="B">Clase B</option>
              <option value="C">Clase C</option>
            </select>
            {/* Provider filter */}
            <select
              value={provFilter}
              onChange={e => setProvFilter(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm max-w-[200px]"
            >
              <option value="all">Todos los proveedores</option>
              {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <button onClick={fetchData} className="p-2 rounded-lg border border-gray-300 hover:bg-gray-50">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── KPIs ────────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard title="Valor Inventario" value={fmtUSD(totalInvValue)} icon={DollarSign} format="text" />
          <KPICard title="SKUs en Alerta" value={alertCount} icon={AlertTriangle} format="number"
            semaphore={alertCount === 0 ? 'green' : alertCount < 20 ? 'yellow' : 'red'} />
          <KPICard title="OC Pendientes" value={orderCount} icon={ShoppingCart} format="number"
            subtitle={`Pipeline: ${fmtUSD(poPipelineValue)}`} />
          <KPICard title="Cobertura Prom." value={`${Math.round(avgCovDays)} días`} icon={Shield} format="text"
            semaphore={avgCovDays >= 30 ? 'green' : avgCovDays >= 15 ? 'yellow' : 'red'} />
          <KPICard title="Lead Time Prom." value={`${Math.round(avgLeadTime)} días`} icon={Clock} format="text" />
          <KPICard title="Costo Stock Seguridad" value={fmtUSD(totalSSCost)} icon={Layers} format="text" />
        </div>

        {/* ── Treasury Link Banner ────────────────────────────────────────── */}
        <Card className="border-[#1A4A28] bg-green-50/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <TrendingDown className="w-5 h-5 text-[#1A4A28] mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-[#1A4A28]">Impacto en Tesorería</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-2 text-sm">
                  <div>
                    <span className="text-gray-600">Capital inmovilizado:</span>
                    <span className="font-bold text-gray-900 ml-1">{fmtUSD(totalInvValue)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">OC pendientes → futuras CxP:</span>
                    <span className="font-bold text-gray-900 ml-1">{fmtUSD(poPipelineValue)}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">CxP actuales:</span>
                    <span className="font-bold text-gray-900 ml-1">{formatCurrency(cxpTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Row 1: Consumo Trend + ABC ──────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Consumption Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Tendencia de Consumo — 8 Meses
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={consumoTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => fmt(v)} tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmt(v), 'Consumo (uds)']} />
                  <Area type="monotone" dataKey="consumo" fill="#1A4A2820" stroke="#1A4A28" strokeWidth={2} />
                  <Line type="monotone" dataKey="consumo" stroke="#1A4A28" strokeWidth={2} dot={{ r: 4, fill: '#1A4A28' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* ABC Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5" />
                Distribución ABC — Valor de Inventario
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="50%" height={260}>
                  <PieChart>
                    <Pie data={abcDist} dataKey="invValue" nameKey="cls" cx="50%" cy="50%"
                         outerRadius={100} label={({ cls, percent }) => `${cls}: ${(percent * 100).toFixed(0)}%`}>
                      {abcDist.map((entry, i) => (
                        <Cell key={i} fill={ABC_COLORS[entry.cls] || CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtUSD(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-3">
                  {abcDist.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ABC_COLORS[item.cls] || CHART_COLORS[i] }} />
                        <span className="font-medium">Clase {item.cls}</span>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{fmtUSD(item.invValue)}</p>
                        <p className="text-gray-500 text-xs">{fmt(item.count)} SKUs · {fmt(item.consumption)} uds/mes</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Row 2: Top Proveedores + Origin ─────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top Providers Pareto */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="w-5 h-5" />
                Top 15 Proveedores por Valor de Inventario (USD)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={topProveedores} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={v => fmtUSD(v)} tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="prov" width={130} tick={{ fontSize: 10 }} />
                  <Tooltip contentStyle={tooltipStyle}
                    formatter={(v: number) => fmtUSD(v)}
                    labelFormatter={(l) => {
                      const p = topProveedores.find(x => x.prov === l);
                      return `${l} · ${p?.skus || 0} SKUs · LT: ${Math.round(p?.avgLT || 0)}d`;
                    }}
                  />
                  <Bar dataKey="invValue" name="Valor Inventario" radius={[0, 4, 4, 0]}>
                    {topProveedores.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* By Origin */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Inventario por Origen
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={byOrigin} dataKey="value" nameKey="origen" cx="50%" cy="50%"
                       outerRadius={90} innerRadius={40}
                       label={({ origen, percent }) => `${origen}: ${(percent * 100).toFixed(0)}%`}>
                    {byOrigin.map((entry, i) => (
                      <Cell key={i} fill={ORIGIN_COLORS[entry.origen] || CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtUSD(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1.5">
                {byOrigin.slice(0, 6).map((o, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ORIGIN_COLORS[o.origen] || CHART_COLORS[i] }} />
                      {o.origen}
                    </span>
                    <span className="font-medium">{fmt(o.count)} SKUs</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Row 3: Coverage + Lead Time + Policy ────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Coverage Buckets */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                Cobertura de Inventario (días)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={covBuckets}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle}
                    formatter={(v: number, name: string) => [fmt(v), name === 'count' ? 'SKUs' : 'Valor']} />
                  <Bar dataKey="count" name="SKUs" radius={[4, 4, 0, 0]}>
                    {covBuckets.map((b, i) => <Cell key={i} fill={b.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {covBuckets.map((b, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.color }} />
                    <span>{b.label}: <strong>{fmt(b.count)}</strong></span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Lead Time by Origin */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Lead Time por Origen (días)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={ltByOrigin}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="origen" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={tooltipStyle}
                    formatter={(v: number, name: string) => [`${v} días`, name === 'avgLT' ? 'Promedio' : 'Máximo']} />
                  <Bar dataKey="avgLT" name="Promedio" fill="#1A4A28" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="maxLT" name="Máximo" fill="#C9A84C" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Risk Radar */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                Perfil de Riesgo — Compras
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="70%">
                  <PolarGrid />
                  <PolarAngleAxis dataKey="metric" tick={{ fontSize: 9 }} />
                  <PolarRadiusAxis tick={{ fontSize: 9 }} />
                  <Radar name="Riesgo %" dataKey="value" stroke="#EF4444" fill="#EF444440" strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* ── Row 4: MTS/MTO + Parameter Analysis + 12M Projection ─────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* MTS vs MTO */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Política de Stock (MTS vs MTO)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={stockPolicy} dataKey="value" nameKey="tipo" cx="50%" cy="50%"
                       outerRadius={85} innerRadius={35}
                       label={({ tipo, percent }) => `${tipo}: ${(percent * 100).toFixed(0)}%`}>
                    {stockPolicy.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtUSD(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {stockPolicy.map((s, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i] }} />
                      {s.tipo}
                    </span>
                    <span className="font-medium">{fmt(s.count)} SKUs · {fmtUSD(s.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Param analysis */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5" />
                Análisis de Parámetros MRP
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={paramDist} dataKey="value" nameKey="label" cx="50%" cy="50%"
                       outerRadius={85} innerRadius={35}
                       label={({ label, percent }) => `${label.slice(0, 15)}: ${(percent * 100).toFixed(0)}%`}>
                    {paramDist.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {paramDist.map((p, i) => (
                  <div key={i} className="flex justify-between text-xs">
                    <span className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i] }} />
                      {p.label}
                    </span>
                    <span className="font-medium">{fmt(p.value)} SKUs</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 12M Projection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Proyección Compras 12M
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={270}>
                <ComposedChart data={projection12m}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="mes" tick={{ fontSize: 9 }} />
                  <YAxis tickFormatter={v => fmtUSD(v)} tick={{ fontSize: 9 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtUSD(v)} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                  <Bar dataKey="comprasProyectadas" name="Compras Proy." fill="#C9A84C" radius={[3, 3, 0, 0]} />
                  <Line type="monotone" dataKey="stockActual" name="Stock Restante" stroke="#1A4A28" strokeWidth={2} dot={{ r: 3 }} />
                  <Area type="monotone" dataKey="deficit" name="Déficit" fill="#EF444430" stroke="#EF4444" strokeWidth={1} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* ── Items requiring orders ──────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              Órdenes de Compra Recomendadas — Top {topOrderItems.length}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left">
                    <th className="pb-2 font-medium text-gray-600">Código</th>
                    <th className="pb-2 font-medium text-gray-600">Descripción</th>
                    <th className="pb-2 font-medium text-gray-600">ABC</th>
                    <th className="pb-2 font-medium text-gray-600">Proveedor</th>
                    <th className="pb-2 font-medium text-gray-600 text-right">Cant. Req.</th>
                    <th className="pb-2 font-medium text-gray-600 text-right">Costo Unit.</th>
                    <th className="pb-2 font-medium text-gray-600 text-right">Costo Total</th>
                    <th className="pb-2 font-medium text-gray-600 text-right">Lead Time</th>
                    <th className="pb-2 font-medium text-gray-600">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {topOrderItems.map((item, i) => {
                    const orderCost = (Number(item.cantidad_requerida) || 0) * (Number(item.costo_unitario) || 0);
                    return (
                      <tr key={i} className="hover:bg-gray-50 cursor-pointer" onDoubleClick={() => setDetailRecord(item as unknown as Record<string, unknown>)} title="Doble clic para ver/editar detalle">
                        <td className="py-2 font-mono text-xs">{item.codigo}</td>
                        <td className="py-2 max-w-[200px] truncate" title={item.descripcion}>{item.descripcion}</td>
                        <td className="py-2">
                          <Badge variant={item.abc_class === 'A' ? 'success' : item.abc_class === 'B' ? 'warning' : 'default'}>
                            {item.abc_class || '—'}
                          </Badge>
                        </td>
                        <td className="py-2 text-xs">{item.proveedor || '—'}</td>
                        <td className="py-2 text-right font-medium">{fmt(Number(item.cantidad_requerida) || 0)}</td>
                        <td className="py-2 text-right">{fmtUSD(Number(item.costo_unitario) || 0)}</td>
                        <td className="py-2 text-right font-bold">{fmtUSD(orderCost)}</td>
                        <td className="py-2 text-right">{Number(item.lead_time_dias) || 0}d</td>
                        <td className="py-2">
                          {item.alerta_desabasto === 'Alerta' ? (
                            <Badge variant="error">Alerta</Badge>
                          ) : (
                            <Badge variant="warning">Pedir</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* ══════════════════════════════════════════════════════════════════ */}
        {/* ── VALOR NACIONALIZADO — Costa Rica Import Landed Cost ──────── */}
        {/* ══════════════════════════════════════════════════════════════════ */}

        {nacionalizadoAll.length > 0 && (
          <>
            {/* Section Header */}
            <div className="mt-4 pt-6 border-t-4 border-[#1A4A28]">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    <Scale className="w-7 h-7 text-[#C9A84C]" />
                    Valor Nacionalizado — Costa Rica
                  </h2>
                  <p className="text-gray-500 mt-1 text-sm">
                    Simulación de costo total de importación incluyendo tributos (DAI, IVA, Ley 6946) y costos logísticos.
                    Fuente: Ministerio de Hacienda · TICA · api.hacienda.go.cr
                  </p>
                </div>
                <button
                  onClick={() => setShowGlossary(!showGlossary)}
                  className="flex items-center gap-2 px-4 py-2 bg-[#1A4A28] text-white rounded-lg text-sm hover:bg-[#2D6A3F] transition-colors"
                >
                  <BookOpen className="w-4 h-4" />
                  Glosario Fiscal
                  {showGlossary ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* ── Fiscal Glossary (collapsible) ──────────────────────────────── */}
            {showGlossary && (
              <Card className="border-[#C9A84C] bg-amber-50/30">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-[#1A4A28]">
                    <BookOpen className="w-5 h-5" />
                    Glosario Fiscal — Impuestos y Costos de Importación (Costa Rica)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {FISCAL_GLOSSARY.map((item, i) => (
                      <div key={i} className="bg-white rounded-lg p-3 border border-gray-200 hover:shadow-md transition-shadow">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                          <span className="font-bold text-sm text-gray-900">{item.term}</span>
                          <Badge variant="default">{item.abbr}</Badge>
                        </div>
                        <p className="text-xs text-gray-600 leading-relaxed">{item.description}</p>
                        <p className="text-xs text-gray-400 mt-1 italic flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {item.legal}
                        </p>
                      </div>
                    ))}
                  </div>
                  {/* Formula summary */}
                  <div className="mt-4 p-4 bg-white rounded-lg border border-[#1A4A28]/20">
                    <p className="font-bold text-sm text-[#1A4A28] mb-2">Fórmula de Cálculo — Valor Nacionalizado</p>
                    <div className="font-mono text-xs text-gray-700 space-y-1">
                      <p><span className="text-blue-600 font-bold">CIF</span> = FOB + Flete Marítimo + Seguro</p>
                      <p><span className="text-amber-600 font-bold">DAI</span> = CIF × %DAI <span className="text-gray-400">(según partida arancelaria y TLC)</span></p>
                      <p><span className="text-pink-600 font-bold">SC</span> = (CIF + DAI) × %SC <span className="text-gray-400">(0% insumos industriales)</span></p>
                      <p><span className="text-red-600 font-bold">Ley 6946</span> = CIF × 1%</p>
                      <p><span className="text-[#C9A84C] font-bold">IVA</span> = (CIF + DAI + SC + Ley6946) × 13% <span className="text-gray-400">(verificar CABYS para tasas reducidas)</span></p>
                      <p className="pt-1 border-t font-bold"><span className="text-[#1A4A28]">V. Nacionalizado</span> = CIF + DAI + SC + Ley6946 + IVA + Agente + Almacén + Handling + Transporte</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── CABYS Lookup ────────────────────────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Search className="w-5 h-5 text-[#2D6A3F]" />
                  Consulta CABYS — Tasa de IVA por Producto (Ministerio de Hacienda)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 mb-3">
                  <input
                    type="text"
                    value={cabysQuery}
                    onChange={e => setCabysQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchCABYS(cabysQuery)}
                    placeholder="Buscar producto en CABYS (ej: pintura, motor, tornillo, acero)..."
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#1A4A28]"
                  />
                  <button
                    onClick={() => searchCABYS(cabysQuery)}
                    disabled={cabysLoading || cabysQuery.length < 3}
                    className="px-4 py-2 bg-[#1A4A28] text-white rounded-lg text-sm hover:bg-[#2D6A3F] disabled:opacity-50 flex items-center gap-2"
                  >
                    {cabysLoading ? <LoadingSpinner size="sm" /> : <Search className="w-4 h-4" />}
                    Consultar
                  </button>
                </div>
                {cabysResults.length > 0 && (
                  <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-gray-200 text-left">
                          <th className="pb-2 font-medium text-gray-600">Código CABYS</th>
                          <th className="pb-2 font-medium text-gray-600">Descripción</th>
                          <th className="pb-2 font-medium text-gray-600">Categoría</th>
                          <th className="pb-2 font-medium text-gray-600 text-center">IVA %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {cabysResults.map((r, i) => (
                          <tr key={i} className="hover:bg-green-50/30">
                            <td className="py-2 font-mono text-xs">{r.codigo}</td>
                            <td className="py-2 max-w-[280px] text-xs">{r.descripcion}</td>
                            <td className="py-2 text-xs text-gray-500 max-w-[200px] truncate" title={r.categorias?.[1]}>
                              {r.categorias?.[1] || '—'}
                            </td>
                            <td className="py-2 text-center">
                              <Badge variant={r.impuesto === 0 ? 'success' : r.impuesto < 13 ? 'warning' : 'error'}>
                                {r.impuesto}%
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {cabysResults.length === 0 && !cabysLoading && (
                  <p className="text-xs text-gray-400 italic">
                    Ingrese un término y presione Consultar para buscar en el Catálogo de Bienes y Servicios (CABYS) del Ministerio de Hacienda.
                    La tasa de IVA mostrada es la oficial vigente para cada producto.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* ── Nac KPIs ──────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <KPICard title="Total FOB" value={fmtUSD(nacTotals.fob)} icon={DollarSign} format="text" />
              <KPICard title="Valor Nacionalizado" value={fmtUSD(nacTotals.total)} icon={Scale} format="text" />
              <KPICard title="Total Impuestos" value={fmtUSD(nacTotals.dai + nacTotals.sc + nacTotals.ley6946 + nacTotals.iva)} icon={FileText} format="text"
                subtitle={fmtPct(nacTotals.fob > 0 ? ((nacTotals.dai + nacTotals.sc + nacTotals.ley6946 + nacTotals.iva) / nacTotals.fob) * 100 : 0) + ' s/FOB'} />
              <KPICard title="Costo Logístico" value={fmtUSD(nacTotals.flete + nacTotals.seguro + nacTotals.agente + nacTotals.almacen + nacTotals.handling + nacTotals.transporte)} icon={Anchor} format="text" />
              <KPICard title="Markup Promedio" value={fmtPct(avgMarkup)} icon={TrendingUp} format="text"
                semaphore={avgMarkup < 20 ? 'green' : avgMarkup < 35 ? 'yellow' : 'red'}
                subtitle="FOB → Nacionalizado" />
              <KPICard title="Ítems c/OC" value={nacionalizadoAll.length} icon={ShoppingCart} format="number" />
            </div>

            {/* ── Nac Charts Row ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Cost composition donut */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="w-5 h-5" />
                    Composición del Valor Nacionalizado
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <ResponsiveContainer width="55%" height={280}>
                      <PieChart>
                        <Pie data={nacCostComposition} dataKey="value" nameKey="name" cx="50%" cy="50%"
                             outerRadius={110} innerRadius={50}
                             label={({ name, percent }) => percent > 0.03 ? `${name}: ${(percent * 100).toFixed(0)}%` : ''}>
                          {nacCostComposition.map((entry, i) => (
                            <Cell key={i} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtUSD(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="flex-1 space-y-1.5">
                      {nacCostComposition.filter(c => c.value > 0).map((c, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c.color }} />
                            {c.name}
                          </span>
                          <span className="font-medium">{fmtUSD(c.value)}</span>
                        </div>
                      ))}
                      <div className="pt-2 border-t flex items-center justify-between text-xs font-bold">
                        <span>Total Nacionalizado</span>
                        <span className="text-[#1A4A28]">{fmtUSD(nacTotals.total)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Cost by Origin stacked bar */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="w-5 h-5" />
                    Valor Nacionalizado por Origen — FOB vs Impuestos vs Logística
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={nacByOrigin}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="origen" tick={{ fontSize: 10 }} />
                      <YAxis tickFormatter={v => fmtUSD(v)} tick={{ fontSize: 9 }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtUSD(v)} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="fob" name="FOB" stackId="a" fill="#1A4A28" />
                      <Bar dataKey="impuestos" name="Impuestos" stackId="a" fill="#C9A84C" />
                      <Bar dataKey="logistica" name="Logística" stackId="a" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* ── Valor Nacionalizado Detail Table ────────────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Warehouse className="w-5 h-5" />
                  Detalle Valor Nacionalizado por Orden de Compra — {nacionalizadoAll.length} ítems
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/* Sort controls */}
                <div className="flex items-center gap-3 mb-3 text-xs">
                  <span className="text-gray-500">Ordenar por:</span>
                  {([['valorNacionalizado', 'V. Nacionalizado'], ['markup', 'Markup %'], ['fob', 'FOB'], ['dai', 'DAI'], ['iva', 'IVA']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => { setNacSortKey(key); setNacPage(0); }}
                      className={`px-2 py-1 rounded ${nacSortKey === key ? 'bg-[#1A4A28] text-white' : 'bg-gray-100 hover:bg-gray-200'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b-2 border-gray-300 text-left bg-gray-50">
                        <th className="py-2 px-1 font-semibold text-gray-700">SKU</th>
                        <th className="py-2 px-1 font-semibold text-gray-700">Descripción</th>
                        <th className="py-2 px-1 font-semibold text-gray-700">Origen</th>
                        <th className="py-2 px-1 font-semibold text-gray-700">ABC</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right">Cant.</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right">FOB Unit.</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right bg-blue-50">FOB Total</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right bg-blue-50">Flete</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right bg-blue-50">CIF</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right bg-amber-50">DAI</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right bg-amber-50">L6946</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right bg-amber-50">IVA</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right bg-green-50">Logística</th>
                        <th className="py-2 px-1 font-semibold text-[#1A4A28] text-right bg-green-100 font-bold">V. Nac.</th>
                        <th className="py-2 px-1 font-semibold text-[#1A4A28] text-right bg-green-100 font-bold">Unit. Nac.</th>
                        <th className="py-2 px-1 font-semibold text-gray-700 text-right">Markup</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {nacPaged.map((r, i) => {
                        const logTotal = r.agenteAduanal + r.almacenFiscal + r.handling + r.transporteInterno + r.flete + r.seguro;
                        const origItem = data.find(d => d.codigo === r.codigo);
                        return (
                          <tr key={i} className="hover:bg-gray-50 cursor-pointer" onDoubleClick={() => origItem && setDetailRecord(origItem as unknown as Record<string, unknown>)} title="Doble clic para ver/editar detalle del ítem MRP">
                            <td className="py-1.5 px-1 font-mono">{r.codigo}</td>
                            <td className="py-1.5 px-1 max-w-[160px] truncate" title={r.descripcion}>{r.descripcion}</td>
                            <td className="py-1.5 px-1">
                              <span className="inline-flex items-center gap-1">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ORIGIN_COLORS[r.origen] || '#999' }} />
                                {r.origen}
                              </span>
                            </td>
                            <td className="py-1.5 px-1">
                              <Badge variant={r.abc_class === 'A' ? 'success' : r.abc_class === 'B' ? 'warning' : 'default'}>{r.abc_class}</Badge>
                            </td>
                            <td className="py-1.5 px-1 text-right">{fmt(r.cantidad)}</td>
                            <td className="py-1.5 px-1 text-right">{fmtUSD2(r.costoUnit)}</td>
                            <td className="py-1.5 px-1 text-right bg-blue-50/50 font-medium">{fmtUSD(r.fob)}</td>
                            <td className="py-1.5 px-1 text-right bg-blue-50/50 text-gray-600">{fmtUSD(r.flete)}</td>
                            <td className="py-1.5 px-1 text-right bg-blue-50/50 font-medium">{fmtUSD(r.cif)}</td>
                            <td className="py-1.5 px-1 text-right bg-amber-50/50">{fmtUSD(r.dai)} <span className="text-gray-400">({fmtPct(r.daiPct * 100)})</span></td>
                            <td className="py-1.5 px-1 text-right bg-amber-50/50">{fmtUSD(r.ley6946)}</td>
                            <td className="py-1.5 px-1 text-right bg-amber-50/50">{fmtUSD(r.iva)}</td>
                            <td className="py-1.5 px-1 text-right bg-green-50/50 text-gray-600">{fmtUSD(logTotal)}</td>
                            <td className="py-1.5 px-1 text-right bg-green-100/50 font-bold text-[#1A4A28]">{fmtUSD(r.valorNacionalizado)}</td>
                            <td className="py-1.5 px-1 text-right bg-green-100/50 font-medium">{fmtUSD2(r.costoUnitNac)}</td>
                            <td className="py-1.5 px-1 text-right">
                              <Badge variant={r.markup < 20 ? 'success' : r.markup < 35 ? 'warning' : 'error'}>
                                +{fmtPct(r.markup)}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* Totals footer */}
                    <tfoot>
                      <tr className="border-t-2 border-gray-400 bg-gray-100 font-bold text-xs">
                        <td colSpan={6} className="py-2 px-1 text-right">TOTALES:</td>
                        <td className="py-2 px-1 text-right bg-blue-100">{fmtUSD(nacTotals.fob)}</td>
                        <td className="py-2 px-1 text-right bg-blue-100">{fmtUSD(nacTotals.flete)}</td>
                        <td className="py-2 px-1 text-right bg-blue-100">{fmtUSD(nacTotals.cif)}</td>
                        <td className="py-2 px-1 text-right bg-amber-100">{fmtUSD(nacTotals.dai)}</td>
                        <td className="py-2 px-1 text-right bg-amber-100">{fmtUSD(nacTotals.ley6946)}</td>
                        <td className="py-2 px-1 text-right bg-amber-100">{fmtUSD(nacTotals.iva)}</td>
                        <td className="py-2 px-1 text-right bg-green-100">
                          {fmtUSD(nacTotals.agente + nacTotals.almacen + nacTotals.handling + nacTotals.transporte + nacTotals.flete + nacTotals.seguro)}
                        </td>
                        <td className="py-2 px-1 text-right bg-green-200 text-[#1A4A28] text-sm">{fmtUSD(nacTotals.total)}</td>
                        <td className="py-2 px-1" />
                        <td className="py-2 px-1 text-right">
                          <Badge variant={avgMarkup < 20 ? 'success' : avgMarkup < 35 ? 'warning' : 'error'}>
                            +{fmtPct(avgMarkup)}
                          </Badge>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {/* Pagination */}
                {nacTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t">
                    <span className="text-xs text-gray-500">
                      Mostrando {nacPage * NAC_PAGE_SIZE + 1}–{Math.min((nacPage + 1) * NAC_PAGE_SIZE, nacSorted.length)} de {nacSorted.length}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setNacPage(p => Math.max(0, p - 1))}
                        disabled={nacPage === 0}
                        className="px-3 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30"
                      >
                        ← Anterior
                      </button>
                      <span className="px-2 py-1 text-xs text-gray-600">
                        Pág. {nacPage + 1} / {nacTotalPages}
                      </span>
                      <button
                        onClick={() => setNacPage(p => Math.min(nacTotalPages - 1, p + 1))}
                        disabled={nacPage >= nacTotalPages - 1}
                        className="px-3 py-1 text-xs rounded bg-gray-100 hover:bg-gray-200 disabled:opacity-30"
                      >
                        Siguiente →
                      </button>
                    </div>
                  </div>
                )}
                <p className="text-xs text-gray-400 mt-2 text-center italic">Doble clic en una fila para ver/editar detalle completo del ítem MRP</p>
                {/* Disclaimer */}
                <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800">
                  <p className="font-semibold flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Nota importante
                  </p>
                  <p>
                    Los montos de impuestos y costos logísticos son <strong>estimaciones</strong> basadas en tasas típicas para insumos industriales.
                    El DAI real depende de la <strong>partida arancelaria</strong> (TICA) y los <strong>TLC vigentes</strong>.
                    El IVA puede variar según el código <strong>CABYS</strong> del producto (0%, 1%, 2%, 4% o 13%).
                    Consulte con su agente aduanal para valores definitivos.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* ── Nac default rates reference ────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Anchor className="w-4 h-4" />
                    Tasas de DAI y Flete por Origen (Estimadas)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-gray-600">Origen</th>
                        <th className="pb-2 font-medium text-gray-600 text-right">DAI %</th>
                        <th className="pb-2 font-medium text-gray-600 text-right">Flete %</th>
                        <th className="pb-2 font-medium text-gray-600">Tratado / Nota</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {Object.entries(DAI_BY_ORIGIN).map(([origen, dai]) => (
                        <tr key={origen} className="hover:bg-gray-50">
                          <td className="py-1.5 flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ORIGIN_COLORS[origen] || '#999' }} />
                            {origen}
                          </td>
                          <td className="py-1.5 text-right font-medium">{fmtPct(dai * 100)}</td>
                          <td className="py-1.5 text-right">{fmtPct((FLETE_BY_ORIGIN[origen] || 0) * 100)}</td>
                          <td className="py-1.5 text-gray-500">
                            {origen === 'Local' ? 'Sin arancel' :
                             origen === 'America' ? 'CAFTA-DR (TLC EEUU-CR-CA)' :
                             origen === 'Mexico' ? 'TLC México-CR' :
                             origen === 'Europa' ? 'AA UE-Centroamérica' :
                             origen === 'Ecuador' ? 'Sin TLC vigente' :
                             origen === 'China' ? 'Sin TLC vigente' :
                             origen === 'Asia' ? 'Sin TLC vigente' : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <FileText className="w-4 h-4" />
                    Otros Tributos y Costos Fijos (Estimados)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium text-gray-600">Concepto</th>
                        <th className="pb-2 font-medium text-gray-600 text-right">Tasa / Monto</th>
                        <th className="pb-2 font-medium text-gray-600">Base</th>
                        <th className="pb-2 font-medium text-gray-600">Fundamento Legal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      <tr className="hover:bg-gray-50">
                        <td className="py-1.5 font-medium">Seguro</td>
                        <td className="py-1.5 text-right">{fmtPct(SEGURO_PCT * 100)}</td>
                        <td className="py-1.5">FOB</td>
                        <td className="py-1.5 text-gray-500">Incoterms CIF</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="py-1.5 font-medium">Ley 6946 (IFAM)</td>
                        <td className="py-1.5 text-right">{fmtPct(LEY6946_PCT * 100)}</td>
                        <td className="py-1.5">CIF</td>
                        <td className="py-1.5 text-gray-500">Ley 6946 Art. 1</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="py-1.5 font-medium">IVA</td>
                        <td className="py-1.5 text-right">{fmtPct(IVA_DEFAULT_PCT * 100)}</td>
                        <td className="py-1.5">CIF + DAI + SC + L6946</td>
                        <td className="py-1.5 text-gray-500">Ley 9635 Título I</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="py-1.5 font-medium">Selectivo Consumo</td>
                        <td className="py-1.5 text-right">{fmtPct(SC_DEFAULT_PCT * 100)}</td>
                        <td className="py-1.5">CIF + DAI</td>
                        <td className="py-1.5 text-gray-500">Ley 4961 (0% insumos)</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="py-1.5 font-medium">Agente Aduanal</td>
                        <td className="py-1.5 text-right">{fmtPct(AGENTE_ADUANAL_PCT * 100)} (mín $25)</td>
                        <td className="py-1.5">CIF</td>
                        <td className="py-1.5 text-gray-500">Art. 33 LGA</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="py-1.5 font-medium">Almacén Fiscal</td>
                        <td className="py-1.5 text-right">${ALMACEN_FISCAL_USD}/línea</td>
                        <td className="py-1.5">Fijo</td>
                        <td className="py-1.5 text-gray-500">Art. 145 LGA</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="py-1.5 font-medium">Handling</td>
                        <td className="py-1.5 text-right">${HANDLING_USD}/línea</td>
                        <td className="py-1.5">Fijo</td>
                        <td className="py-1.5 text-gray-500">JAPDEVA/INCOP</td>
                      </tr>
                      <tr className="hover:bg-gray-50">
                        <td className="py-1.5 font-medium">Transporte Interno</td>
                        <td className="py-1.5 text-right">{fmtPct(TRANSPORTE_INTERNO_PCT * 100)}</td>
                        <td className="py-1.5">CIF</td>
                        <td className="py-1.5 text-gray-500">Costo comercial</td>
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </div>
          </>
        )}

        {/* ── Stockout Alert Items ────────────────────────────────────────── */}
        {alertItems.length > 0 && (
          <Card className="border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-700">
                <AlertTriangle className="w-5 h-5" />
                SKUs en Alerta de Desabasto ({alertCount})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left">
                      <th className="pb-2 font-medium text-gray-600">Código</th>
                      <th className="pb-2 font-medium text-gray-600">Descripción</th>
                      <th className="pb-2 font-medium text-gray-600">Proveedor</th>
                      <th className="pb-2 font-medium text-gray-600 text-right">Inventario</th>
                      <th className="pb-2 font-medium text-gray-600 text-right">Mínimo</th>
                      <th className="pb-2 font-medium text-gray-600 text-right">Consumo/mes</th>
                      <th className="pb-2 font-medium text-gray-600 text-right">Cobertura</th>
                      <th className="pb-2 font-medium text-gray-600 text-right">Valor Inv.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {alertItems.map((item, i) => (
                      <tr key={i} className="hover:bg-red-50/30 cursor-pointer" onDoubleClick={() => setDetailRecord(item as unknown as Record<string, unknown>)} title="Doble clic para ver/editar detalle">
                        <td className="py-2 font-mono text-xs">{item.codigo}</td>
                        <td className="py-2 max-w-[200px] truncate" title={item.descripcion}>{item.descripcion}</td>
                        <td className="py-2 text-xs">{item.proveedor || '—'}</td>
                        <td className="py-2 text-right font-medium">{fmt(Number(item.inventario_disponible) || 0)}</td>
                        <td className="py-2 text-right">{fmt(Number(item.minimo_inventario) || 0)}</td>
                        <td className="py-2 text-right">{fmt(Number(item.consumo_promedio) || 0)}</td>
                        <td className="py-2 text-right">
                          <Badge variant={Number(item.dias_cobertura) < 15 ? 'error' : 'warning'}>
                            {Math.round(Number(item.dias_cobertura) || 0)}d
                          </Badge>
                        </td>
                        <td className="py-2 text-right font-bold">{fmtUSD(Number(item.costo_total_inventario) || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Narrative ──────────────────────────────────────────────────── */}
        <Card className="border-t-4 border-t-[#1A4A28]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-[#C9A84C]" />
              Narrativa de Hallazgos &amp; Riesgos — Compras
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {insights.map((item, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg ${
                  item.icon === 'risk' ? 'bg-red-50' : item.icon === 'action' ? 'bg-amber-50' : 'bg-blue-50'
                }`}>
                  {item.icon === 'risk' ? <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" /> :
                   item.icon === 'action' ? <ShoppingCart className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" /> :
                   <Lightbulb className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />}
                  <p className="text-sm text-gray-800">{item.text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Record Detail Modal */}
      <RecordDetailModal
        open={!!detailRecord}
        onClose={() => setDetailRecord(null)}
        title="Detalle Ítem MRP / Compras"
        subtitle={detailRecord ? `${(detailRecord as Record<string, unknown>).codigo || ''} — ${(detailRecord as Record<string, unknown>).descripcion || ''}` : ''}
        record={detailRecord}
        fields={MRP_FIELDS}
        schema="silver_finance"
        table="mrp_master"
        onSaved={fetchData}
      />
    </Layout>
  );
}
