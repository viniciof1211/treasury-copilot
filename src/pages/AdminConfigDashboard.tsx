import { useState, useEffect } from 'react';
import { Navbar } from '../components/layout/Navbar';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { formatDate, ARA_COLORS } from '../lib/utils';
import {
  fetchAdminHealth, fetchCdcStatus,
  fetchBankAccounts, fetchEInvoiceStatus, fetchWritebackStatus,
  type AdminHealthData, type CdcStatusItem,
  type BankAccount, type EInvoiceItem, type WritebackEntity,
} from '../lib/tms-api';
import {
  Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ComposedChart,
} from 'recharts';
import {
  Settings, Database, Activity, Shield,
  RefreshCw, Server, Bell, Plug, Landmark, FileCheck, ArrowLeftRight,
} from 'lucide-react';

const tooltipStyle = { backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: '12px' };

export function AdminConfigDashboard() {
  const [health, setHealth] = useState<AdminHealthData | null>(null);
  const [cdcStatus, setCdcStatus] = useState<CdcStatusItem[]>([]);
  const [cdcCheckedAt, setCdcCheckedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'health' | 'cdc' | 'rbac' | 'integrations'>('health');
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [einvoices, setEinvoices] = useState<EInvoiceItem[]>([]);
  const [einvoiceStats, setEinvoiceStats] = useState<{ accepted: number; pending: number }>({ accepted: 0, pending: 0 });
  const [writeback, setWriteback] = useState<WritebackEntity[]>([]);
  const [writebackMode, setWritebackMode] = useState('disabled');

  const load = async () => {
    setLoading(true);
    try {
      const [healthRes, cdcRes, bankRes, einvRes, wbRes] = await Promise.all([
        fetchAdminHealth().catch(() => null),
        fetchCdcStatus().catch(() => ({ cdc_status: [], checked_at: '' })),
        fetchBankAccounts().catch(() => ({ accounts: [], total: 0, note: '' })),
        fetchEInvoiceStatus().catch(() => ({ invoices: [], total: 0, accepted: 0, pending: 0, note: '' })),
        fetchWritebackStatus().catch(() => ({ writeback_queue: [], total_pending: 0, last_push: null, mode: 'disabled', note: '' })),
      ]);
      if (healthRes) setHealth(healthRes);
      setCdcStatus(cdcRes.cdc_status || []);
      setCdcCheckedAt(cdcRes.checked_at || '');
      setBankAccounts(bankRes.accounts || []);
      setEinvoices(einvRes.invoices || []);
      setEinvoiceStats({ accepted: einvRes.accepted || 0, pending: einvRes.pending || 0 });
      setWriteback(wbRes.writeback_queue || []);
      setWritebackMode(wbRes.mode || 'disabled');
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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
            <p className="text-sm text-gray-500 mt-1">System Health · CDC Monitor · RBAC · Audit Trail</p>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex gap-1 mb-6 bg-white rounded-lg p-1 border border-gray-200">
          {([
            { id: 'health' as const, label: 'System Health', icon: Activity },
            { id: 'cdc' as const, label: 'CDC Monitor', icon: Database },
            { id: 'rbac' as const, label: 'RBAC & Audit', icon: Shield },
            { id: 'integrations' as const, label: 'Integraciones', icon: Plug },
          ]).map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium ${activeTab === t.id ? 'bg-[#1A4A28] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                <Icon className="w-4 h-4" />{t.label}
              </button>
            );
          })}
        </div>

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

            {/* Entity Counts Chart */}
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

            {/* Recent Audit */}
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

        {activeTab === 'integrations' && (
          <div className="space-y-6">
            {/* Bank API */}
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Landmark className="w-4 h-4" />Bank API — Cuentas Bancarias</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Banco', 'Cuenta', 'Moneda', 'Tipo', 'Saldo', 'Último Sync', 'Estado', 'API'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bankAccounts.length === 0 ? (
                        <tr><td colSpan={8} className="py-6 text-center text-gray-400">Sin cuentas configuradas</td></tr>
                      ) : bankAccounts.map(a => (
                        <tr key={a.account_number} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium">{a.bank}</td>
                          <td className="py-2 px-3 font-mono text-xs">{a.account_number}</td>
                          <td className="py-2 px-3">{a.currency}</td>
                          <td className="py-2 px-3 text-gray-500">{a.type}</td>
                          <td className="py-2 px-3">{a.balance != null ? `$${a.balance.toLocaleString()}` : <span className="text-gray-300">—</span>}</td>
                          <td className="py-2 px-3 text-gray-400 text-xs">{a.last_sync || '—'}</td>
                          <td className="py-2 px-3"><Badge variant={a.status === 'configured' ? 'success' : 'warning'}>{a.status}</Badge></td>
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
                <CardTitle className="text-base flex items-center gap-2">
                  <FileCheck className="w-4 h-4" />Almamater E-Invoice
                  <Badge variant="success" className="ml-2">{einvoiceStats.accepted} aceptadas</Badge>
                  <Badge variant="warning">{einvoiceStats.pending} pendientes</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['# Factura', 'Cliente', 'Total', 'Fecha', 'Empresa', 'Estado', 'Hacienda', 'Almamater'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {einvoices.length === 0 ? (
                        <tr><td colSpan={8} className="py-6 text-center text-gray-400">Sin facturas electrónicas</td></tr>
                      ) : einvoices.map(inv => (
                        <tr key={inv.numero_factura} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-mono text-xs">{inv.numero_factura}</td>
                          <td className="py-2 px-3 max-w-[150px] truncate">{inv.cliente}</td>
                          <td className="py-2 px-3 font-semibold">${inv.total.toLocaleString()}</td>
                          <td className="py-2 px-3 text-gray-500 text-xs">{inv.fecha}</td>
                          <td className="py-2 px-3 text-xs">{inv.empresa}</td>
                          <td className="py-2 px-3"><Badge variant={inv.einvoice_status === 'accepted' ? 'success' : 'warning'}>{inv.einvoice_status}</Badge></td>
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
                <CardTitle className="text-base flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4" />PcGraf Write-back
                  <Badge variant={writebackMode === 'disabled' ? 'default' : 'success'}>{writebackMode}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {['Entidad', 'Tabla PcGraf', 'Dirección', 'Pendientes', 'Estado'].map(h => (
                          <th key={h} className="text-left py-2 px-3 text-xs font-semibold text-gray-500">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {writeback.length === 0 ? (
                        <tr><td colSpan={5} className="py-6 text-center text-gray-400">Sin entidades configuradas</td></tr>
                      ) : writeback.map(wb => (
                        <tr key={wb.entity} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-3 font-medium">{wb.entity}</td>
                          <td className="py-2 px-3 font-mono text-xs text-gray-500">{wb.pcgraf_table}</td>
                          <td className="py-2 px-3 text-xs">{wb.direction}</td>
                          <td className="py-2 px-3">
                            <span className={wb.pending > 0 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>{wb.pending}</span>
                          </td>
                          <td className="py-2 px-3"><Badge variant={wb.status === 'idle' ? 'default' : wb.status === 'syncing' ? 'info' : 'error'}>{wb.status}</Badge></td>
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

            {/* Entity Config Overview */}
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
