import { useState, useEffect, useCallback } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchAdminHealth, fetchCdcStatus,
  fetchBankAccounts, fetchEInvoiceStatus, fetchWritebackStatus,
  fetchIntegrations, fetchSyncJobs, fetchSyncSchedules,
  triggerSync, testIntegration, connectIntegration, disconnectIntegration,
  updateSyncSchedule,
  type AdminHealthData, type CdcStatusItem,
  type BankAccount, type EInvoiceItem, type WritebackEntity,
  type IntegrationConnection, type SyncJob, type SyncSchedule,
  type BankConnection, type EInvoiceConnections, type WritebackConnection,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart,
} from 'recharts';
import {
  Settings, Database, Activity, Shield,
  RefreshCw, Server, Bell, Plug, Landmark, FileCheck, ArrowLeftRight,
  Play, Pause, CheckCircle, XCircle, Clock, Zap, Cable, Calendar,
  AlertTriangle, Loader2, Power, TestTube,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };

type TabId = 'health' | 'cdc' | 'rbac' | 'integrations' | 'sync';

const connStatusBadge = (status: string) => {
  const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
    connected: 'success', disconnected: 'default', error: 'error', pending_setup: 'warning',
  };
  return <Badge variant={map[status] || 'default'}>{status}</Badge>;
};

const jobStatusBadge = (status: string) => {
  const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
    completed: 'success', running: 'info', failed: 'error', pending: 'warning',
  };
  return <Badge variant={map[status] || 'default'}>{status}</Badge>;
};

const categoryIcon = (cat: string) => {
  if (cat === 'bank_api') return <Landmark className="w-4 h-4 text-blue-600" />;
  if (cat === 'einvoice') return <FileCheck className="w-4 h-4 text-green-600" />;
  if (cat === 'erp_writeback') return <ArrowLeftRight className="w-4 h-4 text-purple-600" />;
  return <Cable className="w-4 h-4 text-gray-500" />;
};

export function AdminConfigDashboard() {
  const [health, setHealth] = useState<AdminHealthData | null>(null);
  const [cdcStatus, setCdcStatus] = useState<CdcStatusItem[]>([]);
  const [cdcCheckedAt, setCdcCheckedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>('health');

  // Integrations state
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankConns, setBankConns] = useState<BankConnection[]>([]);
  const [einvoices, setEinvoices] = useState<EInvoiceItem[]>([]);
  const [einvoiceStats, setEinvoiceStats] = useState<{ accepted: number; pending: number; rejected: number }>({ accepted: 0, pending: 0, rejected: 0 });
  const [einvoiceConns, setEinvoiceConns] = useState<EInvoiceConnections | null>(null);
  const [writeback, setWriteback] = useState<WritebackEntity[]>([]);
  const [writebackMode, setWritebackMode] = useState('disabled');
  const [writebackConn, setWritebackConn] = useState<WritebackConnection | null>(null);
  const [writebackPending, setWritebackPending] = useState(0);
  const [writebackLastPush, setWritebackLastPush] = useState<string | null>(null);

  // Integration connections state
  const [integrations, setIntegrations] = useState<IntegrationConnection[]>([]);

  // Sync state
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([]);
  const [syncSchedules, setSyncSchedules] = useState<SyncSchedule[]>([]);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, cdcRes, bankRes, einvRes, wbRes, intRes, jobsRes, schedRes] = await Promise.all([
        fetchAdminHealth().catch(() => null),
        fetchCdcStatus().catch(() => ({ cdc_status: [], checked_at: '' })),
        fetchBankAccounts().catch(() => ({ accounts: [], total: 0, connections: [] })),
        fetchEInvoiceStatus().catch(() => ({ invoices: [], total: 0, accepted: 0, pending: 0, rejected: 0, connections: { hacienda_atv: { status: 'disconnected', enabled: false }, almamater: { status: 'disconnected', enabled: false } } })),
        fetchWritebackStatus().catch(() => ({ writeback_queue: [], total_pending: 0, last_push: null, mode: 'disabled', connection: { status: 'disconnected', enabled: false, host: '192.168.1.3' } })),
        fetchIntegrations().catch(() => ({ connections: [], total: 0 })),
        fetchSyncJobs().catch(() => ({ jobs: [], total: 0 })),
        fetchSyncSchedules().catch(() => ({ schedules: [] })),
      ]);
      if (healthRes) setHealth(healthRes);
      setCdcStatus(cdcRes.cdc_status || []);
      setCdcCheckedAt(cdcRes.checked_at || '');
      setBankAccounts(bankRes.accounts || []);
      setBankConns(bankRes.connections || []);
      setEinvoices(einvRes.invoices || []);
      setEinvoiceStats({ accepted: einvRes.accepted || 0, pending: einvRes.pending || 0, rejected: einvRes.rejected || 0 });
      setEinvoiceConns(einvRes.connections || null);
      setWriteback(wbRes.writeback_queue || []);
      setWritebackMode(wbRes.mode || 'disabled');
      setWritebackConn(wbRes.connection || null);
      setWritebackPending(wbRes.total_pending || 0);
      setWritebackLastPush(wbRes.last_push || null);
      setIntegrations(intRes.connections || []);
      setSyncJobs(jobsRes.jobs || []);
      setSyncSchedules(schedRes.schedules || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTestIntegration = async (provider: string) => {
    setActionLoading(`test-${provider}`);
    try {
      const res = await testIntegration(provider);
      if (res.test_ok) {
        alert(`${provider}: Conexión exitosa`);
      } else {
        alert(`${provider}: Error — ${res.error}`);
      }
      await load();
    } catch (e) { alert(`Error: ${e}`); }
    setActionLoading(null);
  };

  const handleToggleIntegration = async (provider: string, currentlyEnabled: boolean) => {
    setActionLoading(`toggle-${provider}`);
    try {
      if (currentlyEnabled) {
        await disconnectIntegration(provider);
      } else {
        await connectIntegration(provider);
      }
      await load();
    } catch (e) { alert(`Error: ${e}`); }
    setActionLoading(null);
  };

  const handleTriggerSync = async (integration: string) => {
    setActionLoading(`sync-${integration}`);
    try {
      const res = await triggerSync(integration);
      alert(res.message || `Sync triggered for ${integration}`);
      await load();
    } catch (e) { alert(`Error: ${e}`); }
    setActionLoading(null);
  };

  const handleToggleSchedule = async (integration: string, currentEnabled: boolean, currentInterval: number) => {
    setActionLoading(`sched-${integration}`);
    try {
      await updateSyncSchedule(integration, !currentEnabled, currentInterval);
      await load();
    } catch (e) { alert(`Error: ${e}`); }
    setActionLoading(null);
  };

  const entityChartData = health
    ? Object.entries(health.entity_counts)
        .filter(([, v]) => v >= 0)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
    : [];

  const statusBadge = (status: string) => {
    const map: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
      fresh: 'success', stale: 'warning', outdated: 'error', empty: 'default', error: 'error', unknown: 'default',
    };
    return <Badge variant={map[status] || 'default'}>{status}</Badge>;
  };

  const tabs: { id: TabId; label: string; icon: typeof Activity }[] = [
    { id: 'health', label: 'System Health', icon: Activity },
    { id: 'cdc', label: 'CDC Monitor', icon: Database },
    { id: 'rbac', label: 'RBAC & Audit', icon: Shield },
    { id: 'integrations', label: 'Integraciones', icon: Plug },
    { id: 'sync', label: 'Sync & Jobs', icon: Zap },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Settings className="w-7 h-7 text-[#1A4A28]" />
              M12: Admin & Configuration
            </h1>
            <p className="text-sm text-gray-500 mt-1">System Health · CDC Monitor · RBAC · Integraciones · Sync</p>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200 overflow-x-auto">
          {tabs.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap ${activeTab === t.id ? 'bg-[#1A4A28] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>

        {/* ═══ SYSTEM HEALTH TAB ═══ */}
        {activeTab === 'health' && health && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Entidades', value: String(health.total_entities), color: 'text-blue-600', icon: Database },
                { label: 'Reglas de Negocio', value: String(health.business_rules_count), color: 'text-purple-600', icon: Settings },
                { label: 'Roles Definidos', value: String(health.roles.length), color: 'text-green-600', icon: Shield },
                { label: 'Notificaciones Recientes', value: String(health.recent_notifications.length), color: 'text-amber-600', icon: Bell },
              ].map(k => {
                const Icon = k.icon;
                return (
                  <Card key={k.label}>
                    <CardContent className="p-4">
                      <p className="text-xs text-gray-500 uppercase flex items-center gap-1"><Icon className="w-3 h-3" />{k.label}</p>
                      <p className={`text-2xl font-bold mt-1 ${k.color}`}>{loading ? '...' : k.value}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Server className="w-4 h-4" />Registros por Entidad (Top 20)</CardTitle></CardHeader>
              <CardContent>
                {entityChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={350}>
                    <ComposedChart data={entityChartData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis type="number" tick={{ fontSize: 10 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={140} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar dataKey="count" name="Registros" fill={ARA_COLORS.primary} radius={[0, 4, 4, 0] as [number, number, number, number]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : <p className="py-8 text-center text-gray-400">Sin datos de entidades</p>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Audit Trail Reciente</CardTitle></CardHeader>
              <CardContent>
                {health.recent_audit.length > 0 ? (
                  <div className="space-y-2">
                    {health.recent_audit.map((a, i) => (
                      <div key={i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm">
                        <div className="flex items-center gap-3">
                          <Badge variant="info">{String(a.action || 'unknown')}</Badge>
                          <span className="font-medium">{String(a.entity || '')}</span>
                          <span className="text-gray-500 text-xs">{String(a.entity_id || '').slice(0, 8)}...</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>{String(a.user_name || a.user_id || '')}</span>
                          <span>{a.created_at ? formatDate(String(a.created_at)) : ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <p className="py-6 text-center text-gray-400">Sin entradas de auditoría</p>}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══ CDC MONITOR TAB ═══ */}
        {activeTab === 'cdc' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Última verificación: {cdcCheckedAt ? formatDate(cdcCheckedAt) : 'N/A'}
              </p>
              <div className="flex gap-2">
                {['fresh', 'stale', 'outdated', 'empty'].map(s => (
                  <div key={s} className="flex items-center gap-1 text-xs">
                    {statusBadge(s)} <span className="text-gray-400">{
                      s === 'fresh' ? '<10min' : s === 'stale' ? '<60min' : s === 'outdated' ? '>60min' : 'vacío'
                    }</span>
                  </div>
                ))}
              </div>
            </div>

            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Database className="w-4 h-4" />Estado CDC Pipeline — PcGraf → Supabase</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Entidad', 'Tabla', 'Última Sincronización', 'Antigüedad', 'Estado'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cdcStatus.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-gray-400">Sin datos CDC</td></tr>
                      ) : cdcStatus.map(item => (
                        <tr key={item.entity} className={`border-b border-gray-100 ${item.status === 'outdated' || item.status === 'error' ? 'bg-red-50' : 'hover:bg-gray-50'}`}>
                          <td className="py-2 px-3 font-medium">{item.entity}</td>
                          <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.table}</td>
                          <td className="py-2 px-3 text-gray-500">{item.last_sync ? formatDate(item.last_sync) : '—'}</td>
                          <td className="py-2 px-3">
                            {item.age_minutes >= 0 ? (
                              <span className={item.age_minutes < 10 ? 'text-green-600' : item.age_minutes < 60 ? 'text-amber-600' : 'text-red-600'}>
                                {item.age_minutes < 60 ? `${item.age_minutes.toFixed(0)} min` : `${(item.age_minutes / 60).toFixed(1)} hrs`}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-2 px-3">{statusBadge(item.status)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══ INTEGRATIONS TAB ═══ */}
        {activeTab === 'integrations' && (
          <div className="space-y-6">
            {/* Integration Connections Overview */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Cable className="w-4 h-4" />Conexiones de Integración
                </CardTitle>
              </CardHeader>
              <CardContent>
                {integrations.length === 0 ? (
                  <p className="py-6 text-center text-gray-400">Sin integraciones configuradas</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {integrations.map(c => (
                      <div key={c.id} className={`p-4 rounded-xl border-2 ${c.status === 'connected' ? 'border-green-200 bg-green-50/30' : c.status === 'error' ? 'border-red-200 bg-red-50/30' : 'border-gray-200 bg-gray-50/30'}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            {categoryIcon(c.category)}
                            <span className="font-semibold text-sm">{c.display_name}</span>
                          </div>
                          {connStatusBadge(c.status)}
                        </div>
                        <div className="text-xs text-gray-500 space-y-1 mb-3">
                          <p>Categoría: <span className="font-medium">{c.category}</span></p>
                          <p>Provider: <span className="font-mono">{c.provider}</span></p>
                          {c.last_test_at && <p>Último test: {formatDate(c.last_test_at)}</p>}
                          {c.last_error && <p className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{c.last_error}</p>}
                          {c.schedule && (
                            <p className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              Cada {c.schedule.interval_minutes}min
                              {c.schedule.enabled ? <Badge variant="success" className="text-[9px] py-0 px-1">ON</Badge> : <Badge variant="default" className="text-[9px] py-0 px-1">OFF</Badge>}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" className="text-xs"
                            onClick={() => handleTestIntegration(c.provider)}
                            disabled={actionLoading === `test-${c.provider}`}>
                            {actionLoading === `test-${c.provider}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <TestTube className="w-3 h-3" />}
                            Test
                          </Button>
                          <Button size="sm" variant="ghost" className={`text-xs ${c.enabled ? 'text-red-600' : 'text-green-600'}`}
                            onClick={() => handleToggleIntegration(c.provider, c.enabled)}
                            disabled={actionLoading === `toggle-${c.provider}`}>
                            {actionLoading === `toggle-${c.provider}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Power className="w-3 h-3" />}
                            {c.enabled ? 'Desconectar' : 'Conectar'}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bank API */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4" />Bank API — Cuentas Bancarias</CardTitle>
                  <div className="flex gap-2">
                    {bankConns.map(bc => (
                      <div key={bc.id} className="flex items-center gap-1 text-xs">
                        <span className="text-gray-500">{bc.display_name}</span>
                        {connStatusBadge(bc.status)}
                      </div>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Banco', 'Cuenta', 'Moneda', 'Tipo', 'Saldo', 'Último Sync', 'Conexión', 'API'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bankAccounts.length === 0 ? (
                        <tr><td colSpan={8} className="py-6 text-center text-gray-400">Sin cuentas configuradas</td></tr>
                      ) : bankAccounts.map((a, i) => (
                        <tr key={a.id || `bank-${i}`} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium">{a.bank}</td>
                          <td className="py-2 px-3 font-mono text-xs">{a.account_number}</td>
                          <td className="py-2 px-3">{a.currency}</td>
                          <td className="py-2 px-3 text-gray-500">{a.type}</td>
                          <td className="py-2 px-3">{a.balance != null ? `${a.currency === 'USD' ? '$' : '₡'}${a.balance.toLocaleString()}` : <span className="text-gray-300">—</span>}</td>
                          <td className="py-2 px-3 text-gray-400 text-xs">{a.last_sync ? formatDate(a.last_sync) : '—'}</td>
                          <td className="py-2 px-3">{connStatusBadge(a.connection_status)}</td>
                          <td className="py-2 px-3 text-xs text-gray-500">{a.api_type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* E-Invoice */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileCheck className="w-4 h-4" />Almamater / Hacienda E-Invoice
                    <Badge variant="success" className="ml-2">{einvoiceStats.accepted} aceptadas</Badge>
                    <Badge variant="warning">{einvoiceStats.pending} pendientes</Badge>
                    {einvoiceStats.rejected > 0 && <Badge variant="error">{einvoiceStats.rejected} rechazadas</Badge>}
                  </CardTitle>
                  <div className="flex gap-3 text-xs">
                    {einvoiceConns && (
                      <>
                        <span className="flex items-center gap-1">Hacienda ATV: {connStatusBadge(einvoiceConns.hacienda_atv.status)}</span>
                        <span className="flex items-center gap-1">Almamater: {connStatusBadge(einvoiceConns.almamater.status)}</span>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['# Factura', 'Cliente', 'Total', 'Fecha', 'Empresa', 'Almamater', 'Hacienda', 'Clave', 'Ref'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {einvoices.length === 0 ? (
                        <tr><td colSpan={9} className="py-6 text-center text-gray-400">Sin facturas electrónicas</td></tr>
                      ) : einvoices.map(inv => (
                        <tr key={inv.id || inv.numero_factura} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-mono text-xs">{inv.numero_factura}</td>
                          <td className="py-2 px-3 max-w-[150px] truncate">{inv.cliente}</td>
                          <td className="py-2 px-3 font-semibold">${inv.total?.toLocaleString()}</td>
                          <td className="py-2 px-3 text-gray-500 text-xs">{inv.fecha}</td>
                          <td className="py-2 px-3 text-xs">{inv.empresa}</td>
                          <td className="py-2 px-3">
                            <Badge variant={inv.einvoice_status === 'accepted' ? 'success' : inv.einvoice_status === 'rejected' ? 'error' : 'warning'}>
                              {inv.einvoice_status}
                            </Badge>
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant={inv.hacienda_status === 'aceptado' || inv.hacienda_status === 'accepted' ? 'success' : inv.hacienda_status === 'rechazado' || inv.hacienda_status === 'rejected' ? 'error' : 'default'}>
                              {inv.hacienda_status || 'pending'}
                            </Badge>
                          </td>
                          <td className="py-2 px-3 font-mono text-[10px] text-gray-400">{inv.hacienda_key || '—'}</td>
                          <td className="py-2 px-3 font-mono text-[10px] text-gray-400">{inv.almamater_ref || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* PcGraf Write-back */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between w-full">
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowLeftRight className="w-4 h-4" />PcGraf Write-back
                    <Badge variant={writebackMode === 'disabled' ? 'default' : 'success'}>{writebackMode}</Badge>
                    {writebackPending > 0 && <Badge variant="warning">{writebackPending} pendientes</Badge>}
                  </CardTitle>
                  <div className="flex items-center gap-3 text-xs">
                    {writebackConn && (
                      <span className="flex items-center gap-1">
                        <Server className="w-3 h-3" />{writebackConn.host}
                        {connStatusBadge(writebackConn.status)}
                      </span>
                    )}
                    {writebackLastPush && <span className="text-gray-400">Último push: {formatDate(writebackLastPush)}</span>}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Entidad', 'Tabla PcGraf', 'Dirección', 'Pendientes', 'Aprobados', 'Enviados', 'Fallidos', 'Estado'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {writeback.length === 0 ? (
                        <tr><td colSpan={8} className="py-6 text-center text-gray-400">Sin entidades en cola de write-back</td></tr>
                      ) : writeback.map(wb => (
                        <tr key={wb.entity} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium">{wb.entity}</td>
                          <td className="py-2 px-3 font-mono text-xs text-gray-500">{wb.pcgraf_table}</td>
                          <td className="py-2 px-3 text-xs">{wb.direction}</td>
                          <td className="py-2 px-3">
                            <span className={wb.pending > 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>{wb.pending}</span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={wb.approved > 0 ? 'text-blue-600 font-semibold' : 'text-gray-400'}>{wb.approved}</span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={wb.pushed > 0 ? 'text-green-600 font-semibold' : 'text-gray-400'}>{wb.pushed}</span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={wb.failed > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>{wb.failed}</span>
                          </td>
                          <td className="py-2 px-3">
                            <Badge variant={wb.status === 'idle' ? 'default' : wb.status === 'pending' ? 'warning' : wb.status === 'error' ? 'error' : 'info'}>{wb.status}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-gray-400">Write-back requiere conexión VPN a PcGraf (192.168.1.3) y aprobación explícita.</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══ SYNC & JOBS TAB ═══ */}
        {activeTab === 'sync' && (
          <div className="space-y-6">
            {/* Quick Sync Actions */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Zap className="w-4 h-4" />Acciones de Sincronización</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { id: 'full_sync', label: 'Full Sync', desc: 'Sincronizar todo', icon: RefreshCw, color: 'bg-blue-50 border-blue-200 text-blue-700' },
                    { id: 'pcgraf_cdc', label: 'CDC PcGraf', desc: 'Poll PcGraf → Supabase', icon: Database, color: 'bg-purple-50 border-purple-200 text-purple-700' },
                    { id: 'einvoice_almamater', label: 'E-Invoice Sync', desc: 'Facturas → Almamater', icon: FileCheck, color: 'bg-green-50 border-green-200 text-green-700' },
                    { id: 'bank_bac', label: 'Bank BAC', desc: 'Sync BAC balances', icon: Landmark, color: 'bg-amber-50 border-amber-200 text-amber-700' },
                  ].map(s => {
                    const Icon = s.icon;
                    const isLoading = actionLoading === `sync-${s.id}`;
                    return (
                      <button key={s.id}
                        onClick={() => handleTriggerSync(s.id)}
                        disabled={isLoading}
                        className={`p-4 rounded-xl border-2 ${s.color} text-left hover:shadow-md transition-all disabled:opacity-50`}>
                        <div className="flex items-center gap-2 mb-1">
                          {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                          <span className="font-semibold text-sm">{s.label}</span>
                        </div>
                        <p className="text-xs opacity-70">{s.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Sync Schedules */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4" />Programación de Sincronización</CardTitle>
              </CardHeader>
              <CardContent>
                {syncSchedules.length === 0 ? (
                  <p className="py-6 text-center text-gray-400">Sin programaciones configuradas</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          {['Integración', 'Intervalo', 'Estado', 'Última Ejecución', 'Próxima Ejecución', 'Acción'].map(h => (
                            <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {syncSchedules.map(s => (
                          <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="py-2 px-3 font-medium">{s.integration}</td>
                            <td className="py-2 px-3 flex items-center gap-1 text-gray-600">
                              <Clock className="w-3 h-3" />{s.interval_minutes} min
                            </td>
                            <td className="py-2 px-3">
                              {s.enabled
                                ? <Badge variant="success" className="flex items-center gap-1"><Play className="w-3 h-3" />Activo</Badge>
                                : <Badge variant="default" className="flex items-center gap-1"><Pause className="w-3 h-3" />Inactivo</Badge>
                              }
                            </td>
                            <td className="py-2 px-3 text-xs text-gray-500">{s.last_run_at ? formatDate(s.last_run_at) : '—'}</td>
                            <td className="py-2 px-3 text-xs text-gray-500">{s.next_run_at ? formatDate(s.next_run_at) : '—'}</td>
                            <td className="py-2 px-3">
                              <Button size="sm" variant="ghost" className="text-xs"
                                onClick={() => handleToggleSchedule(s.integration, s.enabled, s.interval_minutes)}
                                disabled={actionLoading === `sched-${s.integration}`}>
                                {actionLoading === `sched-${s.integration}` ? <Loader2 className="w-3 h-3 animate-spin" /> : s.enabled ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                                {s.enabled ? 'Pausar' : 'Activar'}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Sync Jobs History */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4" />Historial de Sync Jobs</CardTitle>
              </CardHeader>
              <CardContent>
                {syncJobs.length === 0 ? (
                  <p className="py-6 text-center text-gray-400">Sin jobs registrados</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          {['Integración', 'Tipo', 'Estado', 'Inicio', 'Duración', 'Procesados', 'Creados', 'Fallidos', 'Disparado por'].map(h => (
                            <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {syncJobs.map(j => {
                          const dur = j.completed_at && j.started_at
                            ? Math.round((new Date(j.completed_at).getTime() - new Date(j.started_at).getTime()) / 1000)
                            : null;
                          return (
                            <tr key={j.id} className={`border-b border-gray-100 ${j.status === 'failed' ? 'bg-red-50/50' : 'hover:bg-gray-50'}`}>
                              <td className="py-2 px-3 font-medium">{j.integration}</td>
                              <td className="py-2 px-3 text-xs">
                                <Badge variant={j.job_type === 'manual' ? 'info' : 'default'}>{j.job_type}</Badge>
                              </td>
                              <td className="py-2 px-3">{jobStatusBadge(j.status)}</td>
                              <td className="py-2 px-3 text-xs text-gray-500">{formatDate(j.started_at)}</td>
                              <td className="py-2 px-3 text-xs">
                                {j.status === 'running' ? (
                                  <span className="flex items-center gap-1 text-blue-600"><Loader2 className="w-3 h-3 animate-spin" />en progreso</span>
                                ) : dur != null ? (
                                  <span>{dur < 60 ? `${dur}s` : `${Math.floor(dur / 60)}m ${dur % 60}s`}</span>
                                ) : '—'}
                              </td>
                              <td className="py-2 px-3 text-center">{j.rows_processed}</td>
                              <td className="py-2 px-3 text-center">
                                <span className={j.rows_created > 0 ? 'text-green-600 font-semibold' : 'text-gray-400'}>{j.rows_created}</span>
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className={j.rows_failed > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}>{j.rows_failed}</span>
                              </td>
                              <td className="py-2 px-3 text-xs text-gray-500">{j.triggered_by}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {syncJobs.some(j => j.error_message) && (
                  <div className="mt-3 space-y-1">
                    <p className="text-xs font-semibold text-red-600 flex items-center gap-1"><XCircle className="w-3 h-3" />Errores recientes:</p>
                    {syncJobs.filter(j => j.error_message).slice(0, 3).map(j => (
                      <p key={j.id} className="text-xs text-red-500 bg-red-50 p-2 rounded">{j.integration}: {j.error_message}</p>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══ RBAC TAB ═══ */}
        {activeTab === 'rbac' && health && (
          <div className="space-y-6">
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Shield className="w-4 h-4" />Roles del Sistema</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {health.roles.map(role => (
                    <div key={role} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <p className="font-semibold text-sm">{role.replace(/_/g, ' ')}</p>
                      <p className="text-[10px] text-gray-400 mt-1">
                        {role === 'admin' ? 'Acceso total R/W a todos los módulos' :
                         role === 'finance_manager' ? 'R/W finanzas, R admin' :
                         role === 'treasury_analyst' ? 'R/W cash/cxp/cxc/recon, R otros' :
                         'Solo lectura en todos los módulos'}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Configuración de Entidades ({health.total_entities})</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Entidad', 'Registros', 'Estado'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(health.entity_counts).map(([name, count]) => (
                        <tr key={name} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-1.5 px-3 font-medium">{name}</td>
                          <td className="py-1.5 px-3">
                            {count >= 0 ? (
                              <span className={count > 0 ? 'text-green-600 font-semibold' : 'text-gray-400'}>{count.toLocaleString()}</span>
                            ) : (
                              <Badge variant="error">error</Badge>
                            )}
                          </td>
                          <td className="py-1.5 px-3">
                            <Badge variant={count > 0 ? 'success' : count === 0 ? 'default' : 'error'}>
                              {count > 0 ? 'active' : count === 0 ? 'empty' : 'unavailable'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
