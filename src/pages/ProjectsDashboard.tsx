import { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, AlertTriangle, BarChart3, Calendar,
  DollarSign, Users, Building2, ChevronDown, ChevronRight,
  Filter, RefreshCw, PieChart, ArrowUpRight, ArrowDownRight,
  Clock, FileText, Search, X, Edit3, FileImage,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart as RPieChart, Pie, Cell, Legend, AreaChart, Area,
} from 'recharts';
import { Layout } from '../components/layout/Layout';
import { ContractPdfViewer } from '../components/ContractPdfViewer';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { GanttChart } from '../components/projects/GanttChart';
import { MilestoneAlerts } from '../components/projects/MilestoneAlerts';
import { ContractDetail } from '../components/projects/ContractDetail';
import { AlertEmailSubscription } from '../components/projects/AlertEmailSubscription';
import { formatCurrency, formatCompactCurrency, formatDate } from '../lib/utils';
import { InfoTooltip, type TooltipMeta } from '../components/ui/InfoTooltip';
import { PROJECTS } from '../lib/glossary';
import {
  fetchProjectKPIs, fetchPortfolio, fetchContracts, fetchAlerts,
  fetchGantt, fetchAreaBreakdown, fetchForecast, fetchAging,
} from '../lib/projects-api';
import type {
  ProjectKPIs, ProjectPortfolio, Contract, MilestoneAlert,
  GanttItem, AreaBreakdown, WeeklyForecast, AgingSummary,
} from '../types/projects';

type Tab = 'overview' | 'gantt' | 'alerts' | 'collections' | 'aging' | 'curation' | 'documentos';

const AREA_COLORS = ['#1A4A28', '#2D6A3F', '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#6B7280'];
const AGING_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#F97316', '#EF4444'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fmtTooltip = ((v: any) => formatCurrency(Number(v || 0))) as any;

export function ProjectsDashboard() {
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Data state
  const [kpis, setKpis] = useState<ProjectKPIs | null>(null);
  const [portfolio, setPortfolio] = useState<ProjectPortfolio[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [alerts, setAlerts] = useState<MilestoneAlert[]>([]);
  const [ganttItems, setGanttItems] = useState<GanttItem[]>([]);
  const [areas, setAreas] = useState<AreaBreakdown[]>([]);
  const [forecast, setForecast] = useState<WeeklyForecast[]>([]);
  const [agingSummary, setAgingSummary] = useState<AgingSummary | null>(null);

  // UI state
  const [selectedContract, setSelectedContract] = useState<Contract | null>(null);
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [ganttClient, setGanttClient] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [k, p, c, al, g, ar, f, ag] = await Promise.all([
        fetchProjectKPIs(),
        fetchPortfolio(),
        fetchContracts(),
        fetchAlerts(),
        fetchGantt(),
        fetchAreaBreakdown(),
        fetchForecast(),
        fetchAging(),
      ]);
      setKpis(k);
      setPortfolio(p);
      setContracts(c.contracts);
      setAlerts(al);
      setGanttItems(g);
      setAreas(ar);
      setForecast(f);
      setAgingSummary(ag.summary);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Filter gantt by client
  useEffect(() => {
    if (tab === 'gantt' && ganttClient) {
      fetchGantt(ganttClient).then(setGanttItems).catch(() => {});
    } else if (tab === 'gantt' && !ganttClient) {
      fetchGantt().then(setGanttItems).catch(() => {});
    }
  }, [tab, ganttClient]);

  const handleSelectContractById = (id: string) => {
    const c = contracts.find((ct) => ct.id === id);
    if (c) setSelectedContract(c);
  };

  // Filtered contracts for curation tab
  const filteredContracts = contracts.filter((c) => {
    const matchSearch = !searchQuery || c.nombre_proyecto.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.nombre_cliente.toLowerCase().includes(searchQuery.toLowerCase());
    const matchArea = !areaFilter || c.area === areaFilter;
    return matchSearch && matchArea;
  });

  const uniqueAreas = [...new Set(contracts.map((c) => c.area).filter(Boolean))].sort();

  // Aging pie data
  const agingPieData = agingSummary ? [
    { name: 'Sin Vencer', value: agingSummary.sin_vencer },
    { name: '30 dias', value: agingSummary.de_30_dias },
    { name: '60 dias', value: agingSummary.de_60_dias },
    { name: '90 dias', value: agingSummary.de_90_dias },
    { name: '+90 dias', value: agingSummary.mas_90_dias },
  ].filter((d) => d.value > 0) : [];

  // Area pie data
  const areaPieData = areas.map((a, i) => ({
    name: a.area,
    value: a.monto_contrato,
    fill: AREA_COLORS[i % AREA_COLORS.length],
  }));

  if (loading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-96">
          <RefreshCw className="w-8 h-8 animate-spin text-[#1A4A28]" />
          <span className="ml-3 text-gray-600">Cargando datos de proyectos...</span>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="text-center py-16">
          <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Error cargando datos</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <Button onClick={loadData}>Reintentar</Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Proyectos & Contratos</h1>
            <p className="text-gray-600 mt-1">BI de contratos, hitos de pago, cobros y facturacion</p>
          </div>
          <Button variant="ghost" onClick={loadData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Actualizar
          </Button>
        </div>

        {/* KPI Cards */}
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-4">
            <KPICard icon={FileText} label="Contratos" value={kpis.total_contracts.toString()} sub={`${kpis.unique_clients} clientes`} color="text-[#1A4A28]" info={PROJECTS.activeContracts} />
            <KPICard icon={DollarSign} label="Monto Total" value={formatCompactCurrency(kpis.total_monto_contrato)} sub={`${kpis.pct_cobrado_global.toFixed(0)}% cobrado`} color="text-[#1A4A28]" info={PROJECTS.totalContractValue} />
            <KPICard icon={ArrowUpRight} label="Cancelado" value={formatCompactCurrency(kpis.total_cancelado)} sub={formatCompactCurrency(kpis.total_pendiente_cobrar) + ' pendiente'} color="text-emerald-600" info={PROJECTS.collectionEfficiency} />
            <KPICard icon={ArrowDownRight} label="Facturado" value={formatCompactCurrency(kpis.total_facturado)} sub={formatCompactCurrency(kpis.total_pendiente_facturar) + ' pend fact'} color="text-blue-600" />
            <KPICard icon={AlertTriangle} label="Alertas Criticas" value={kpis.critical_alert_count.toString()} sub={formatCompactCurrency(kpis.critical_alert_value) + ' en riesgo'} color="text-red-600" info={PROJECTS.milestoneAlerts} />
            <KPICard icon={Clock} label="Alertas 14d" value={kpis.warning_alert_count.toString()} sub={`${kpis.total_alert_count} total alertas`} color="text-amber-600" />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          {([
            { key: 'overview', label: 'Resumen', icon: BarChart3 },
            { key: 'gantt', label: 'Timeline', icon: Calendar },
            { key: 'alerts', label: 'Alertas', icon: AlertTriangle },
            { key: 'collections', label: 'Cobros', icon: DollarSign },
            { key: 'aging', label: 'Cartera', icon: PieChart },
            { key: 'curation', label: 'Datos', icon: FileText },
            { key: 'documentos', label: 'Documentos PDF', icon: FileImage },
          ] as { key: Tab; label: string; icon: any }[]).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  tab === t.key ? 'bg-white text-[#1A4A28] shadow-sm' : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4" /> {t.label}
                {t.key === 'alerts' && alerts.length > 0 && (
                  <span className="ml-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                    {alerts.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {tab === 'overview' && <OverviewTab portfolio={portfolio} areas={areas} areaPieData={areaPieData} forecast={forecast} onExpandClient={setExpandedClient} expandedClient={expandedClient} onSelectContract={(c) => setSelectedContract(c)} />}
        {tab === 'gantt' && <GanttTab items={ganttItems} ganttClient={ganttClient} setGanttClient={setGanttClient} portfolio={portfolio} onSelectContract={handleSelectContractById} />}
        {tab === 'alerts' && <AlertsTab alerts={alerts} onSelectContract={handleSelectContractById} />}
        {tab === 'collections' && <CollectionsTab forecast={forecast} />}
        {tab === 'aging' && <AgingTab summary={agingSummary} pieData={agingPieData} />}
        {tab === 'curation' && <CurationTab contracts={filteredContracts} searchQuery={searchQuery} setSearchQuery={setSearchQuery} areaFilter={areaFilter} setAreaFilter={setAreaFilter} uniqueAreas={uniqueAreas} onSelect={setSelectedContract} />}
        {tab === 'documentos' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileImage className="w-4 h-4 text-[#1A4A28]" />
                Documentos de Contratos (CEM0.IM00)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ContractPdfViewer inline />
            </CardContent>
          </Card>
        )}

        {/* Contract detail modal */}
        {selectedContract && (
          <ContractDetail contract={selectedContract} onClose={() => setSelectedContract(null)} />
        )}
      </div>
    </Layout>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function KPICard({ icon: Icon, label, value, sub, color, info }: { icon: any; label: string; value: string; sub: string; color: string; info?: TooltipMeta }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs font-medium text-gray-500 flex items-center gap-1">{label}{info && <InfoTooltip meta={info} size="sm" />}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{sub}</div>
    </Card>
  );
}

// --- Overview Tab ---
function OverviewTab({ portfolio, areas, areaPieData, forecast, onExpandClient, expandedClient, onSelectContract }: {
  portfolio: ProjectPortfolio[];
  areas: AreaBreakdown[];
  areaPieData: { name: string; value: number; fill: string }[];
  forecast: WeeklyForecast[];
  onExpandClient: (c: string | null) => void;
  expandedClient: string | null;
  onSelectContract: (c: Contract) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Top row: Area breakdown chart + Area pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-[#1A4A28]" /> Contratos por Area</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={areas} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => formatCompactCurrency(v)} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="area" width={130} tick={{ fontSize: 11 }} />
                <Tooltip formatter={fmtTooltip} />
                <Bar dataKey="cancelado" name="Cancelado" fill="#1A4A28" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="pendiente_cobrar" name="Pend Cobro" fill="#3B82F6" stackId="a" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PieChart className="w-5 h-5 text-[#1A4A28]" /> Distribucion</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <RPieChart>
                <Pie data={areaPieData} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} dataKey="value">
                  {areaPieData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip formatter={fmtTooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </RPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Forecast chart */}
      {forecast.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-[#1A4A28]" /> Proyeccion Semanal de Cobros</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={forecast}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="semana" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatCompactCurrency(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={fmtTooltip} />
                <Area type="monotone" dataKey="confirmado" name="Confirmado" fill="#1A4A28" fillOpacity={0.3} stroke="#1A4A28" strokeWidth={2} stackId="1" />
                <Area type="monotone" dataKey="pendiente" name="Pendiente" fill="#3B82F6" fillOpacity={0.2} stroke="#3B82F6" strokeWidth={2} stackId="1" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Portfolio drill-down */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-[#1A4A28]" /> Portfolio por Cliente (drill-down)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y divide-gray-100">
            {portfolio.slice(0, 30).map((p) => {
              const isExpanded = expandedClient === p.nombre_cliente;
              return (
                <div key={p.nombre_cliente}>
                  <div
                    className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => onExpandClient(isExpanded ? null : p.nombre_cliente)}
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900 truncate">{p.nombre_cliente}</span>
                        <Badge variant="info">{p.contract_count} contratos</Badge>
                        {p.areas.map((a) => (
                          <Badge key={a} variant="default">{a}</Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-6 text-xs">
                      <div className="text-right">
                        <div className="font-semibold text-gray-900">{formatCompactCurrency(p.total_monto_contrato)}</div>
                        <div className="text-gray-500">contrato</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-emerald-600">{formatCompactCurrency(p.total_cancelado)}</div>
                        <div className="text-gray-500">{p.pct_cobrado.toFixed(0)}% cobrado</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-amber-600">{formatCompactCurrency(p.total_pendiente_cobrar)}</div>
                        <div className="text-gray-500">pendiente</div>
                      </div>
                      <div className="w-24">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className="bg-[#1A4A28] h-2 rounded-full" style={{ width: `${Math.min(p.pct_cobrado, 100)}%` }} />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded contracts */}
                  {isExpanded && (
                    <div className="bg-gray-50 px-6 py-3 space-y-2">
                      {p.contracts.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center gap-3 bg-white px-4 py-2.5 rounded-lg border border-gray-100 hover:border-[#1A4A28]/30 cursor-pointer transition-colors"
                          onClick={() => onSelectContract(c)}
                        >
                          <FileText className="w-4 h-4 text-[#1A4A28] flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{c.nombre_proyecto}</div>
                            <div className="text-[10px] text-gray-500">{c.proyecto_code} &middot; {c.asesores}</div>
                          </div>
                          <div className="flex items-center gap-4 text-xs">
                            <span className="font-medium">{formatCompactCurrency(c.monto_contrato)}</span>
                            <div className="w-16">
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div className="bg-[#1A4A28] h-1.5 rounded-full" style={{ width: `${Math.min(c.pct_cobrado, 100)}%` }} />
                              </div>
                            </div>
                            <span className="text-gray-500 w-12 text-right">{c.pct_cobrado.toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Gantt Tab ---
function GanttTab({ items, ganttClient, setGanttClient, portfolio, onSelectContract }: {
  items: GanttItem[];
  ganttClient: string;
  setGanttClient: (v: string) => void;
  portfolio: ProjectPortfolio[];
  onSelectContract: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Client filter */}
      <div className="flex items-center gap-3">
        <Filter className="w-4 h-4 text-gray-400" />
        <select
          value={ganttClient}
          onChange={(e) => setGanttClient(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-[#1A4A28] outline-none min-w-[280px]"
        >
          <option value="">Todos los clientes</option>
          {portfolio.map((p) => (
            <option key={p.nombre_cliente} value={p.nombre_cliente}>{p.nombre_cliente} ({p.contract_count})</option>
          ))}
        </select>
        {ganttClient && (
          <button onClick={() => setGanttClient('')} className="text-xs text-gray-500 hover:text-gray-700">
            <X className="w-4 h-4" />
          </button>
        )}
        <span className="text-xs text-gray-500 ml-auto">{items.length} contratos</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-[#1A4A28]" />
            Timeline de Contratos {ganttClient && `— ${ganttClient}`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <GanttChart items={items.slice(0, 50)} onSelectContract={onSelectContract} />
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-gray-500 px-2">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#1A4A28]" /> Activo</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-emerald-500" /> Completado</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500" /> Vencido</div>
        <div className="flex items-center gap-1.5"><span className="w-1 h-4 bg-red-400 rounded" /> Hoy</div>
      </div>
    </div>
  );
}

// --- Alerts Tab ---
function AlertsTab({ alerts, onSelectContract }: { alerts: MilestoneAlert[]; onSelectContract: (id: string) => void }) {
  return (
    <div className="space-y-6">
      {/* Email subscription panel */}
      <Card>
        <CardContent className="p-4">
          <AlertEmailSubscription />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            Hitos de Pago Proximos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MilestoneAlerts alerts={alerts} onSelectContract={onSelectContract} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-[#1A4A28]" />
            Resumen de Alertas por Valor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Value at risk by urgency */}
            {(['overdue', 'critical', 'warning', 'attention'] as const).map((u) => {
              const items = alerts.filter((a) => a.urgency === u);
              if (!items.length) return null;
              const total = items.reduce((s, a) => s + a.pendiente_cobrar, 0);
              const colors = { overdue: 'bg-red-500', critical: 'bg-red-400', warning: 'bg-amber-500', attention: 'bg-blue-500' };
              const labels = { overdue: 'Vencidos', critical: '< 7 dias', warning: '7-14 dias', attention: '14-30 dias' };
              return (
                <div key={u}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-700">{labels[u]} ({items.length})</span>
                    <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div className={`${colors[u]} h-3 rounded-full`} style={{ width: `${Math.min(total / (alerts.reduce((s, a) => s + a.pendiente_cobrar, 0) || 1) * 100, 100)}%` }} />
                  </div>
                </div>
              );
            })}

            {/* Top contracts at risk */}
            <div className="mt-6">
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Top 5 Mayor Riesgo</h4>
              {alerts.slice(0, 5).map((a) => (
                <div
                  key={a.contract_id}
                  className="flex items-center justify-between py-2 border-b border-gray-50 cursor-pointer hover:bg-gray-50 px-2 rounded"
                  onClick={() => onSelectContract(a.contract_id)}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{a.nombre_proyecto}</div>
                    <div className="text-[10px] text-gray-500">{a.nombre_cliente}</div>
                  </div>
                  <div className="text-right ml-4">
                    <div className="text-sm font-bold text-red-600">{formatCurrency(a.pendiente_cobrar)}</div>
                    <div className="text-[10px] text-gray-500">
                      {a.days_until < 0 ? `${Math.abs(a.days_until)}d vencido` : `${a.days_until}d`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    </div>
  );
}

// --- Collections Tab ---
function CollectionsTab({ forecast }: { forecast: WeeklyForecast[] }) {
  const totalConfirmado = forecast.reduce((s, f) => s + f.confirmado, 0);
  const totalPendiente = forecast.reduce((s, f) => s + f.pendiente, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Total Proyectado</div>
          <div className="text-2xl font-bold text-gray-900">{formatCurrency(totalConfirmado + totalPendiente)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Confirmado</div>
          <div className="text-2xl font-bold text-emerald-600">{formatCurrency(totalConfirmado)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Pendiente Confirmar</div>
          <div className="text-2xl font-bold text-amber-600">{formatCurrency(totalPendiente)}</div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BarChart3 className="w-5 h-5 text-[#1A4A28]" /> Cobros por Semana</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={forecast}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="semana" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => formatCompactCurrency(v)} tick={{ fontSize: 11 }} />
              <Tooltip formatter={fmtTooltip} />
              <Legend />
              <Bar dataKey="confirmado" name="Confirmado" fill="#1A4A28" radius={[4, 4, 0, 0]} />
              <Bar dataKey="pendiente" name="Pendiente" fill="#F59E0B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed table */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle Semanal</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Semana</th>
                <th className="px-4 py-3 text-left">Mes</th>
                <th className="px-4 py-3 text-right">Items</th>
                <th className="px-4 py-3 text-right">Confirmado</th>
                <th className="px-4 py-3 text-right">Pendiente</th>
                <th className="px-4 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {forecast.map((f, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-medium">{f.semana}</td>
                  <td className="px-4 py-2.5 text-gray-600">{f.mes ? new Date(f.mes).toLocaleDateString('es-CR', { month: 'short', year: '2-digit' }) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">{f.count}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-600 font-medium">{formatCurrency(f.confirmado)}</td>
                  <td className="px-4 py-2.5 text-right text-amber-600">{formatCurrency(f.pendiente)}</td>
                  <td className="px-4 py-2.5 text-right font-bold">{formatCurrency(f.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

// --- Aging Tab ---
function AgingTab({ summary, pieData }: { summary: AgingSummary | null; pieData: { name: string; value: number }[] }) {
  if (!summary) return <div className="text-gray-400 text-center py-12">Sin datos de cartera</div>;

  const buckets = [
    { label: 'Sin Vencer', value: summary.sin_vencer, color: AGING_COLORS[0] },
    { label: '30 dias', value: summary.de_30_dias, color: AGING_COLORS[1] },
    { label: '60 dias', value: summary.de_60_dias, color: AGING_COLORS[2] },
    { label: '90 dias', value: summary.de_90_dias, color: AGING_COLORS[3] },
    { label: '+90 dias', value: summary.mas_90_dias, color: AGING_COLORS[4] },
  ];

  return (
    <div className="space-y-6">
      {/* Bucket cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {buckets.map((b) => (
          <Card key={b.label} className="p-4 border-l-4" style={{ borderLeftColor: b.color }}>
            <div className="text-xs text-gray-500 font-medium mb-1">{b.label}</div>
            <div className="text-xl font-bold text-gray-900">{formatCompactCurrency(b.value)}</div>
            <div className="text-[10px] text-gray-400">
              {summary.total ? ((b.value / summary.total) * 100).toFixed(1) : 0}% del total
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><PieChart className="w-5 h-5 text-[#1A4A28]" /> Distribucion Cartera</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RPieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value" label={({ name, percent }: any) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={AGING_COLORS[i % AGING_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={fmtTooltip} />
              </RPieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* By business unit */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-[#1A4A28]" /> Cartera por Negocio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[320px] overflow-y-auto">
              {Object.entries(summary.by_negocio)
                .sort(([, a], [, b]) => b.total - a.total)
                .map(([name, data]) => (
                  <div key={name} className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-900">{name}</div>
                      <div className="text-[10px] text-gray-500">{data.count} documentos</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-gray-900">{formatCurrency(data.total)}</div>
                      <div className="text-[10px] text-gray-500">
                        {summary.total ? ((data.total / summary.total) * 100).toFixed(1) : 0}%
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// --- Curation Tab ---
function CurationTab({ contracts, searchQuery, setSearchQuery, areaFilter, setAreaFilter, uniqueAreas, onSelect }: {
  contracts: Contract[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  areaFilter: string;
  setAreaFilter: (v: string) => void;
  uniqueAreas: string[];
  onSelect: (c: Contract) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar proyecto o cliente..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-[#1A4A28] outline-none"
          />
        </div>
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-1 focus:ring-[#1A4A28] outline-none"
        >
          <option value="">Todas las areas</option>
          {uniqueAreas.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-xs text-gray-500">{contracts.length} contratos</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600 uppercase sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left">Proyecto</th>
                <th className="px-4 py-3 text-left">Cliente</th>
                <th className="px-4 py-3 text-left">Area</th>
                <th className="px-4 py-3 text-right">Contrato</th>
                <th className="px-4 py-3 text-right">Cancelado</th>
                <th className="px-4 py-3 text-right">Pend Cobro</th>
                <th className="px-4 py-3 text-right">% Cobrado</th>
                <th className="px-4 py-3 text-center">Cierre</th>
                <th className="px-4 py-3 text-center">Accion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {contracts.slice(0, 100).map((c) => (
                <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => onSelect(c)}>
                  <td className="px-4 py-2.5 max-w-[200px] truncate font-medium">{c.nombre_proyecto}</td>
                  <td className="px-4 py-2.5 max-w-[160px] truncate text-gray-600">{c.nombre_cliente}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant="default">{c.area || '—'}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatCurrency(c.monto_contrato)}</td>
                  <td className="px-4 py-2.5 text-right text-emerald-600">{formatCurrency(c.monto_cancelado)}</td>
                  <td className="px-4 py-2.5 text-right text-amber-600">{formatCurrency(c.pendiente_cobrar)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-14 bg-gray-200 rounded-full h-1.5">
                        <div className="bg-[#1A4A28] h-1.5 rounded-full" style={{ width: `${Math.min(c.pct_cobrado, 100)}%` }} />
                      </div>
                      <span className="text-xs w-10 text-right">{c.pct_cobrado.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-center text-xs text-gray-600">{c.fecha_cierre ? formatDate(c.fecha_cierre) : '—'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onSelect(c); }}>
                      <Edit3 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
