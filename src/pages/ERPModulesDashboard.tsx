import { useState, useEffect, useCallback } from 'react';
import {
  FileText, TrendingUp, BarChart3, Users, Building2, Calendar,
  DollarSign, Search, X, ChevronDown, ChevronRight, RefreshCw,
  Filter, Eye, Database, AlertTriangle, Layers, Hash,
} from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate } from '../lib/utils';
import { InfoTooltip, type TooltipMeta } from '../components/ui/InfoTooltip';
import { ERP } from '../lib/glossary';
import {
  fetchFacturas, fetchFacturaDetalle, fetchFacturasKPIs,
  fetchFacturasPorNegocio, fetchFacturasMensual, fetchTopClientes,
  fetchContratos, fetchHitos, fetchTableSchema,
} from '../lib/erp-api';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, AreaChart, Area, PieChart as RPieChart, Pie, Cell,
} from 'recharts';
import type {
  Factura, FacturaHeader, FacturaLinea, FacturasKPIsResponse,
  NegocioBreakdown, MonthlyTrend, TopCliente,
  ContratosResponse, ContratoProyecto, HitosResponse, TableSchemaResponse,
} from '../types/erp-modules';

type Tab = 'facturas' | 'contratos' | 'hitos' | 'schema';

const COLORS = ['#1A4A28', '#2D6A3F', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#6B7280'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtCur = ((v: any) => formatCurrency(Number(v || 0))) as any;

export function ERPModulesDashboard() {
  const [tab, setTab] = useState<Tab>('facturas');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Facturas state
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [facturasTotal, setFacturasTotal] = useState(0);
  const [facturasKpis, setFacturasKpis] = useState<FacturasKPIsResponse | null>(null);
  const [negocios, setNegocios] = useState<NegocioBreakdown[]>([]);
  const [monthly, setMonthly] = useState<MonthlyTrend[]>([]);
  const [topClientes, setTopClientes] = useState<TopCliente[]>([]);
  const [facturaSearch, setFacturaSearch] = useState('');
  const [selectedFactura, setSelectedFactura] = useState<string | null>(null);
  const [facturaHeader, setFacturaHeader] = useState<FacturaHeader | null>(null);
  const [facturaLines, setFacturaLines] = useState<FacturaLinea[]>([]);

  // Contratos state
  const [contratosData, setContratosData] = useState<ContratosResponse | null>(null);
  const [contratoSearch, setContratoSearch] = useState('');

  // Hitos state
  const [hitosData, setHitosData] = useState<HitosResponse | null>(null);
  const [hitoSearch, setHitoSearch] = useState('');

  // Schema state
  const [schemaTable, setSchemaTable] = useState('FA00');
  const [schemaData, setSchemaData] = useState<TableSchemaResponse | null>(null);

  const loadFacturas = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [facData, kpis, neg, mon, top] = await Promise.all([
        fetchFacturas({ limit: 100, cliente: facturaSearch || undefined }),
        fetchFacturasKPIs(),
        fetchFacturasPorNegocio(),
        fetchFacturasMensual(),
        fetchTopClientes(15),
      ]);
      setFacturas(facData.facturas);
      setFacturasTotal(facData.total);
      setFacturasKpis(kpis);
      setNegocios(neg.breakdown);
      setMonthly(mon.monthly);
      setTopClientes(top.clientes);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [facturaSearch]);

  const loadContratos = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchContratos({ proyecto: contratoSearch || undefined });
      setContratosData(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [contratoSearch]);

  const loadHitos = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchHitos(hitoSearch || undefined);
      setHitosData(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [hitoSearch]);

  const loadSchema = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchTableSchema(schemaTable);
      setSchemaData(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [schemaTable]);

  useEffect(() => {
    if (tab === 'facturas') loadFacturas();
    else if (tab === 'contratos') loadContratos();
    else if (tab === 'hitos') loadHitos();
    else if (tab === 'schema') loadSchema();
  }, [tab, loadFacturas, loadContratos, loadHitos, loadSchema]);

  const openFacturaDetail = async (pedido: string) => {
    setSelectedFactura(pedido);
    try {
      const data = await fetchFacturaDetalle(pedido);
      setFacturaHeader(data.header);
      setFacturaLines(data.lines);
    } catch (e) {
      setError(String(e));
    }
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'facturas', label: 'Facturas', icon: <FileText className="w-4 h-4" /> },
    { key: 'contratos', label: 'Contratos por Proyecto', icon: <Layers className="w-4 h-4" /> },
    { key: 'hitos', label: 'Hitos por Contrato', icon: <Calendar className="w-4 h-4" /> },
    { key: 'schema', label: 'Esquema ERP', icon: <Database className="w-4 h-4" /> },
  ];

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Módulos ERP — PcGraf Euromobilia</h1>
            <p className="text-sm text-gray-500 mt-1">
              Facturas (FA00/FA01) · Contratos por Proyecto (HO00/IM00) · Hitos por Contrato (HO01/HO03/HO05)
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (tab === 'facturas') loadFacturas();
              else if (tab === 'contratos') loadContratos();
              else if (tab === 'hitos') loadHitos();
              else loadSchema();
            }}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-white text-[#1A4A28] shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <Card>
            <CardContent>
              <div className="flex items-center gap-2 text-red-600 py-2">
                <AlertTriangle className="w-5 h-5" />
                <span className="text-sm">{error}</span>
                <Button size="sm" variant="ghost" onClick={() => setError('')}><X className="w-4 h-4" /></Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 animate-spin text-[#1A4A28] mr-2" />
            <span className="text-gray-500">Consultando ERP PcGraf…</span>
          </div>
        )}

        {/* Tab content */}
        {!loading && tab === 'facturas' && (
          <FacturasTab
            facturas={facturas}
            total={facturasTotal}
            kpis={facturasKpis}
            negocios={negocios}
            monthly={monthly}
            topClientes={topClientes}
            search={facturaSearch}
            onSearchChange={setFacturaSearch}
            onSearch={loadFacturas}
            onSelectFactura={openFacturaDetail}
            selectedFactura={selectedFactura}
            facturaHeader={facturaHeader}
            facturaLines={facturaLines}
            onCloseDetail={() => { setSelectedFactura(null); setFacturaHeader(null); setFacturaLines([]); }}
          />
        )}

        {!loading && tab === 'contratos' && (
          <ContratosTab
            data={contratosData}
            search={contratoSearch}
            onSearchChange={setContratoSearch}
            onSearch={loadContratos}
          />
        )}

        {!loading && tab === 'hitos' && (
          <HitosTab
            data={hitosData}
            search={hitoSearch}
            onSearchChange={setHitoSearch}
            onSearch={loadHitos}
          />
        )}

        {!loading && tab === 'schema' && (
          <SchemaTab
            data={schemaData}
            table={schemaTable}
            onTableChange={setSchemaTable}
            onLoad={loadSchema}
          />
        )}
      </div>
    </Layout>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTURAS TAB
// ═══════════════════════════════════════════════════════════════════════════

function FacturasTab({
  facturas, total, kpis, negocios, monthly, topClientes,
  search, onSearchChange, onSearch, onSelectFactura,
  selectedFactura, facturaHeader, facturaLines, onCloseDetail,
}: {
  facturas: Factura[];
  total: number;
  kpis: FacturasKPIsResponse | null;
  negocios: NegocioBreakdown[];
  monthly: MonthlyTrend[];
  topClientes: TopCliente[];
  search: string;
  onSearchChange: (s: string) => void;
  onSearch: () => void;
  onSelectFactura: (pedido: string) => void;
  selectedFactura: string | null;
  facturaHeader: FacturaHeader | null;
  facturaLines: FacturaLinea[];
  onCloseDetail: () => void;
}) {
  const monthlyChart = monthly.map((m) => ({
    label: `${m.anio}-${String(m.mes).padStart(2, '0')}`,
    total: m.total_precio,
    impuesto: m.total_impuesto,
    facturas: m.num_facturas,
  }));

  const negPie = negocios.slice(0, 8).map((n, i) => ({
    name: n.negocio || '(sin negocio)',
    value: n.total_precio,
    fill: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <KPICard icon={<FileText />} label="Total Facturas" value={kpis.all_time.total_facturas.toLocaleString()} info={ERP.facturasTotales} />
          <KPICard icon={<Users />} label="Clientes Únicos" value={kpis.all_time.clientes_unicos.toLocaleString()} />
          <KPICard icon={<DollarSign />} label="Monto Total" value={formatCurrency(kpis.all_time.sum_total)} info={ERP.facturasMontoTotal} />
          <KPICard icon={<TrendingUp />} label="Impuesto Total" value={formatCurrency(kpis.all_time.sum_impuesto)} />
          <KPICard icon={<FileText />} label="Últ. 30 días" value={kpis.last_30_days.facturas_30d?.toLocaleString() || '0'} sub={formatCurrency(kpis.last_30_days.total_30d || 0)} />
          <KPICard icon={<Building2 />} label="Negocios" value={String(kpis.all_time.negocios)} />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-[#1A4A28]" /> Facturación Mensual (24m)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={monthlyChart}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={50} />
                <YAxis tickFormatter={(v) => `₡${(v / 1e6).toFixed(1)}M`} tick={{ fontSize: 11 }} />
                <Tooltip formatter={fmtCur} />
                <Area type="monotone" dataKey="total" name="Total" fill="#1A4A28" fillOpacity={0.3} stroke="#1A4A28" strokeWidth={2} />
                <Area type="monotone" dataKey="impuesto" name="Impuesto" fill="#3B82F6" fillOpacity={0.2} stroke="#3B82F6" strokeWidth={1.5} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Pie by negocio */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-[#1A4A28]" /> Por Negocio</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <RPieChart>
                <Pie data={negPie} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="value"
                  label={({ name, percent }: any) => `${(name as string).slice(0, 12)} ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {negPie.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
                <Tooltip formatter={fmtCur} />
              </RPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top clientes bar */}
      {topClientes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-[#1A4A28]" /> Top 15 Clientes por Monto</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topClientes.slice(0, 15)} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => `₡${(v / 1e6).toFixed(1)}M`} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="nombre" width={180} tick={{ fontSize: 10 }} />
                <Tooltip formatter={fmtCur} />
                <Bar dataKey="total_precio" name="Total" fill="#1A4A28" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Search + table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Facturas ({total.toLocaleString()})</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  className="pl-9 pr-3 py-2 border rounded-md text-sm w-64"
                  placeholder="Buscar cliente o código…"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSearch()}
                />
                {search && (
                  <button className="absolute right-2 top-2.5" onClick={() => { onSearchChange(''); }}>
                    <X className="w-4 h-4 text-gray-400" />
                  </button>
                )}
              </div>
              <Button size="sm" onClick={onSearch}><Filter className="w-4 h-4 mr-1" /> Filtrar</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
              <tr>
                <th className="px-3 py-3 text-left">Pedido</th>
                <th className="px-3 py-3 text-left">Factura</th>
                <th className="px-3 py-3 text-left">Tipo</th>
                <th className="px-3 py-3 text-left">Fecha</th>
                <th className="px-3 py-3 text-left">Cliente</th>
                <th className="px-3 py-3 text-left">Negocio</th>
                <th className="px-3 py-3 text-right">Total</th>
                <th className="px-3 py-3 text-right">Impuesto</th>
                <th className="px-3 py-3 text-center">Estado</th>
                <th className="px-3 py-3 text-center"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {facturas.map((f) => (
                <tr key={f.sPedido} className="hover:bg-gray-50 cursor-pointer" onClick={() => onSelectFactura(f.sPedido)}>
                  <td className="px-3 py-2 font-mono text-xs">{f.sPedido}</td>
                  <td className="px-3 py-2 font-mono text-xs">{f.sFactura}</td>
                  <td className="px-3 py-2">
                    <Badge variant={f.bProforma ? 'info' : 'default'}>{f.sTipoFactura}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">{formatDate(f.dFecha)}</td>
                  <td className="px-3 py-2 text-xs max-w-[200px] truncate" title={f.sNombre_Cliente}>{f.sNombre_Cliente}</td>
                  <td className="px-3 py-2 text-xs">{f.sNegocio}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatCurrency(f.monto_total)}</td>
                  <td className="px-3 py-2 text-right text-gray-500">{formatCurrency(f.monto_impuesto)}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant={f.bEstado === 1 ? 'success' : f.bEstado === 0 ? 'warning' : 'error'}>
                      {f.bEstado === 1 ? 'Activa' : f.bEstado === 0 ? 'Pendiente' : 'Anulada'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Eye className="w-4 h-4 text-gray-400" />
                  </td>
                </tr>
              ))}
              {facturas.length === 0 && (
                <tr><td colSpan={10} className="text-center py-8 text-gray-400">Sin resultados</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Factura detail modal */}
      {selectedFactura && facturaHeader && (
        <FacturaDetailModal
          header={facturaHeader}
          lines={facturaLines}
          onClose={onCloseDetail}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTURA DETAIL MODAL
// ═══════════════════════════════════════════════════════════════════════════

function FacturaDetailModal({ header, lines, onClose }: {
  header: FacturaHeader;
  lines: FacturaLinea[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between z-10">
          <div>
            <h2 className="text-lg font-bold">Factura {header.sFactura}</h2>
            <p className="text-sm text-gray-500">Pedido: {header.sPedido} · {header.sTipoFactura} · {formatDate(header.dFecha)}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Header info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block">Cliente</span>
              <span className="font-medium">{header.sNombre_Cliente}</span>
              <span className="text-xs text-gray-400 block">{header.sCodigo_Cliente} · {header.sCedula}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Negocio</span>
              <span className="font-medium">{header.sNegocio}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Vendedor</span>
              <span className="font-medium">{header.sVendedor}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Bodega</span>
              <span className="font-medium">{header.sBodega}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Plazo</span>
              <span className="font-medium">{header.iPlazo} días</span>
            </div>
            <div>
              <span className="text-gray-500 block">Vencimiento</span>
              <span className="font-medium">{formatDate(header.dVencimiento)}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Tipo Cambio</span>
              <span className="font-medium">₡{header.tipo_cambio}</span>
            </div>
            <div>
              <span className="text-gray-500 block">Proyecto</span>
              <span className="font-medium">{header.sProyecto || '—'}</span>
            </div>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 bg-gray-50 rounded-lg p-4">
            <div className="text-center">
              <span className="text-xs text-gray-500 block">Gravado</span>
              <span className="font-bold text-[#1A4A28]">{formatCurrency(header.monto_gravado)}</span>
            </div>
            <div className="text-center">
              <span className="text-xs text-gray-500 block">Exento</span>
              <span className="font-bold">{formatCurrency(header.monto_exento)}</span>
            </div>
            <div className="text-center">
              <span className="text-xs text-gray-500 block">Impuesto</span>
              <span className="font-bold text-blue-600">{formatCurrency(header.monto_impuesto)}</span>
            </div>
            <div className="text-center">
              <span className="text-xs text-gray-500 block">Descuento</span>
              <span className="font-bold text-amber-600">{formatCurrency(header.monto_descuento)}</span>
            </div>
            <div className="text-center">
              <span className="text-xs text-gray-500 block">TOTAL</span>
              <span className="font-bold text-lg text-[#1A4A28]">{formatCurrency(header.monto_total)}</span>
            </div>
          </div>

          {/* Proforma info */}
          {header.bProforma === 1 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
              <p><strong>Atención:</strong> {header.sProAtencion}</p>
              <p><strong>Vigencia:</strong> {header.sProVigencia}</p>
              <p><strong>Condiciones:</strong> {header.sProCondiciones}</p>
              <p><strong>T. Entrega:</strong> {header.sProTEntrega}</p>
            </div>
          )}

          {/* Detail lines */}
          <div>
            <h3 className="font-semibold mb-2">Detalle ({lines.length} líneas)</h3>
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left">#</th>
                    <th className="px-3 py-2 text-left">Código</th>
                    <th className="px-3 py-2 text-left">Descripción</th>
                    <th className="px-3 py-2 text-right">Cant</th>
                    <th className="px-3 py-2 text-right">Precio</th>
                    <th className="px-3 py-2 text-right">Desc%</th>
                    <th className="px-3 py-2 text-right">IVA%</th>
                    <th className="px-3 py-2 text-right">Subtotal</th>
                    <th className="px-3 py-2 text-center">Bodega</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l) => (
                    <tr key={l.iLinea} className="hover:bg-gray-50">
                      <td className="px-3 py-1.5 text-xs text-gray-400">{l.iLinea}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{l.sCodigo_Producto}</td>
                      <td className="px-3 py-1.5 text-xs max-w-[250px] truncate">{l.sDescripcion}</td>
                      <td className="px-3 py-1.5 text-right">{l.cantidad.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right">{formatCurrency(l.precio_venta)}</td>
                      <td className="px-3 py-1.5 text-right text-gray-500">{(l.descuento * 100).toFixed(1)}%</td>
                      <td className="px-3 py-1.5 text-right text-gray-500">{(l.impuesto * 100).toFixed(0)}%</td>
                      <td className="px-3 py-1.5 text-right font-medium">{formatCurrency(l.subtotal)}</td>
                      <td className="px-3 py-1.5 text-center text-xs">{l.sBodega}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTRATOS TAB
// ═══════════════════════════════════════════════════════════════════════════

function ContratosTab({ data, search, onSearchChange, onSearch }: {
  data: ContratosResponse | null;
  search: string;
  onSearchChange: (s: string) => void;
  onSearch: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!data) return <div className="text-center py-8 text-gray-400">Sin datos</div>;

  return (
    <div className="space-y-6">
      {/* Info banner */}
      <Card>
        <CardContent>
          <div className="flex items-center gap-3 py-2">
            <Database className="w-5 h-5 text-[#1A4A28]" />
            <div className="text-sm">
              <span className="font-medium">Fuente: </span>
              <Badge variant="info">{data.source}</Badge>
              <span className="ml-4">Tablas disponibles: </span>
              {Object.entries(data.tables_available).map(([t, avail]) => (
                <Badge key={t} variant={avail ? 'success' : 'warning'} className="ml-1">{t}: {avail ? '✓' : '✗'}</Badge>
              ))}
              {data.imports_count > 0 && (
                <span className="ml-4">Documentos importados (IM00): <strong>{data.imports_count}</strong></span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Layers className="w-5 h-5" /> Contratos por Proyecto ({data.total})
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" />
                <input
                  className="pl-9 pr-3 py-2 border rounded-md text-sm w-56"
                  placeholder="Buscar proyecto…"
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSearch()}
                />
              </div>
              <Button size="sm" onClick={onSearch}><Filter className="w-4 h-4" /></Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {data.contracts.map((c: ContratoProyecto, i: number) => (
              <div key={i}>
                <div
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => setExpanded(expanded === String(i) ? null : String(i))}
                >
                  <div className="flex items-center gap-3">
                    {expanded === String(i) ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    <div>
                      <span className="font-medium text-sm">{c.proyecto || `Contrato #${i + 1}`}</span>
                      {c.cliente_principal && (
                        <span className="text-xs text-gray-500 ml-2">— {c.cliente_principal}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    {c.num_facturas > 0 && (
                      <span className="text-gray-500">{c.num_facturas} facturas</span>
                    )}
                    {c.total_precio > 0 && (
                      <span className="font-medium text-[#1A4A28]">{formatCurrency(c.total_precio)}</span>
                    )}
                    {c.fecha_inicio && (
                      <span className="text-xs text-gray-400">{formatDate(c.fecha_inicio)} — {formatDate(c.fecha_fin)}</span>
                    )}
                  </div>
                </div>
                {expanded === String(i) && (
                  <div className="bg-gray-50 px-8 py-3 text-sm">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Object.entries(c).map(([k, v]) => (
                        v != null && v !== '' && (
                          <div key={k}>
                            <span className="text-gray-500 text-xs">{k}</span>
                            <span className="block font-medium text-xs">{typeof v === 'number' ? (v > 1000 ? formatCurrency(v) : v.toLocaleString()) : String(v)}</span>
                          </div>
                        )
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {data.contracts.length === 0 && (
              <div className="text-center py-8 text-gray-400">No se encontraron contratos</div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* IM00 imports */}
      {data.imports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Documentos Importados (IM00)</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-left">ID</th>
                  <th className="px-3 py-2 text-left">Proyecto</th>
                  <th className="px-3 py-2 text-left">Documento</th>
                  <th className="px-3 py-2 text-left">Archivo</th>
                  <th className="px-3 py-2 text-left">Observaciones</th>
                  <th className="px-3 py-2 text-left">Ingresó</th>
                  <th className="px-3 py-2 text-left">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.imports.map((im) => (
                  <tr key={im.IDLinea} className="hover:bg-gray-50">
                    <td className="px-3 py-2">{im.IDLinea}</td>
                    <td className="px-3 py-2">{im.CodProyecto}</td>
                    <td className="px-3 py-2">{im.NombreDocumento}</td>
                    <td className="px-3 py-2 text-xs">{im.FileName}</td>
                    <td className="px-3 py-2 text-xs max-w-[200px] truncate">{im.Observaciones}</td>
                    <td className="px-3 py-2 text-xs">{im.QuienIngreso}</td>
                    <td className="px-3 py-2 text-xs">{im.FechaIngreso ? formatDate(im.FechaIngreso) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HITOS TAB
// ═══════════════════════════════════════════════════════════════════════════

function HitosTab({ data, search, onSearchChange, onSearch }: {
  data: HitosResponse | null;
  search: string;
  onSearchChange: (s: string) => void;
  onSearch: () => void;
}) {
  if (!data) return <div className="text-center py-8 text-gray-400">Sin datos</div>;

  const hitoTables = Object.entries(data.hitos);

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <Card>
        <CardContent>
          <div className="flex items-center gap-3 py-2">
            <Search className="w-5 h-5 text-gray-400" />
            <input
              className="flex-1 border rounded-md px-3 py-2 text-sm"
              placeholder="Filtrar por contrato (busca en HO01, HO03, HO05)…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            />
            <Button size="sm" onClick={onSearch}><Filter className="w-4 h-4 mr-1" /> Buscar</Button>
          </div>
        </CardContent>
      </Card>

      {/* One card per HO table */}
      {hitoTables.map(([table, info]) => (
        <Card key={table}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Hash className="w-5 h-5 text-[#1A4A28]" />
                {table}
                {info.available ? (
                  <Badge variant="success">{info.row_count} filas</Badge>
                ) : (
                  <Badge variant="warning">No disponible</Badge>
                )}
              </CardTitle>
              {info.total > 0 && <span className="text-sm text-gray-500">Total en BD: {info.total}</span>}
            </div>
          </CardHeader>
          <CardContent>
            {!info.available && (
              <div className="text-center py-4 text-gray-400">
                <AlertTriangle className="w-6 h-6 mx-auto mb-2" />
                <p>Tabla {table} no encontrada en siawin0</p>
                {info.error && <p className="text-xs text-red-500 mt-1">{info.error}</p>}
              </div>
            )}

            {info.available && info.rows.length === 0 && (
              <div className="text-center py-4 text-gray-400">Sin registros{search ? ` para "${search}"` : ''}</div>
            )}

            {info.available && info.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                    <tr>
                      {info.columns.slice(0, 12).map((col) => (
                        <th key={col} className="px-3 py-2 text-left whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {info.rows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        {info.columns.slice(0, 12).map((col) => (
                          <td key={col} className="px-3 py-1.5 text-xs max-w-[150px] truncate">
                            {row[col] != null ? String(row[col]) : '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {info.columns.length > 12 && (
                  <p className="text-xs text-gray-400 px-3 py-2">+{info.columns.length - 12} columnas más ocultas</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA TAB (discovery/debug)
// ═══════════════════════════════════════════════════════════════════════════

function SchemaTab({ data, table, onTableChange, onLoad }: {
  data: TableSchemaResponse | null;
  table: string;
  onTableChange: (t: string) => void;
  onLoad: () => void;
}) {
  const tables = ['FA00', 'FA01', 'CEM0', 'IM00', 'HO00', 'HO01', 'HO03', 'HO05'];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Database className="w-5 h-5 text-[#1A4A28]" />
            <CardTitle>Explorador de Esquema ERP</CardTitle>
            <select
              className="border rounded-md px-3 py-1.5 text-sm"
              value={table}
              onChange={(e) => onTableChange(e.target.value)}
            >
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Button size="sm" onClick={onLoad}>Cargar</Button>
          </div>
        </CardHeader>
        <CardContent>
          {!data && <div className="text-center py-4 text-gray-400">Seleccione una tabla</div>}

          {data && !data.exists && (
            <div className="text-center py-6 text-amber-600">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
              <p className="font-medium">Tabla {data.table} no existe en siawin0</p>
              <p className="text-sm text-gray-500">Esta tabla puede no estar disponible en esta versión del ERP</p>
            </div>
          )}

          {data && data.exists && (
            <div className="space-y-4">
              <div className="flex items-center gap-4 text-sm">
                <Badge variant="success">{data.table}</Badge>
                <span>{data.row_count.toLocaleString()} filas</span>
                <span>{data.columns.length} columnas</span>
              </div>

              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Columna</th>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-left">Max Length</th>
                      <th className="px-3 py-2 text-left">Nullable</th>
                      {data.sample && <th className="px-3 py-2 text-left">Ejemplo</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.columns.map((col, i) => (
                      <tr key={col.COLUMN_NAME} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-xs text-gray-400">{i + 1}</td>
                        <td className="px-3 py-1.5 font-mono text-xs font-medium">{col.COLUMN_NAME}</td>
                        <td className="px-3 py-1.5 text-xs">{col.DATA_TYPE}</td>
                        <td className="px-3 py-1.5 text-xs">{col.CHARACTER_MAXIMUM_LENGTH || '—'}</td>
                        <td className="px-3 py-1.5 text-xs">{col.IS_NULLABLE}</td>
                        {data.sample && (
                          <td className="px-3 py-1.5 text-xs max-w-[200px] truncate text-gray-500">
                            {data.sample[col.COLUMN_NAME] != null ? String(data.sample[col.COLUMN_NAME]).slice(0, 60) : '—'}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// KPI Card helper
// ═══════════════════════════════════════════════════════════════════════════

function KPICard({ icon, label, value, sub, info }: { icon: React.ReactNode; label: string; value: string; sub?: string; info?: TooltipMeta }) {
  return (
    <Card>
      <CardContent>
        <div className="flex items-center gap-3 py-1">
          <div className="p-2 bg-[#1A4A28]/10 rounded-lg text-[#1A4A28]">{icon}</div>
          <div>
            <p className="text-xs text-gray-500 flex items-center gap-1">{label}{info && <InfoTooltip meta={info} size="sm" />}</p>
            <p className="text-lg font-bold text-gray-900">{value}</p>
            {sub && <p className="text-xs text-gray-500">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
