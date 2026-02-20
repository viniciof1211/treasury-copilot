import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Activity, Clock, AlertTriangle, CheckCircle, Zap, ArrowUpDown } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { getCDCStatus, triggerCDCPoll, getTableRegistry, type CDCWatermark, type TableRegistryEntry } from '../../lib/dataModel';

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return 'Nunca';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function CDCMonitorTab() {
  const [loading, setLoading] = useState(true);
  const [watermarks, setWatermarks] = useState<CDCWatermark[]>([]);
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({});
  const [totalEvents, setTotalEvents] = useState(0);
  const [registry, setRegistry] = useState<TableRegistryEntry[]>([]);
  const [polling, setPolling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [sortBy, setSortBy] = useState<'table' | 'changes' | 'time'>('table');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [cdcData, regData] = await Promise.all([getCDCStatus(), getTableRegistry()]);
      if (cdcData.error) throw new Error(cdcData.error);
      setWatermarks(cdcData.watermarks || []);
      setEventCounts(cdcData.recent_event_counts || {});
      setTotalEvents(cdcData.total_recent_events || 0);
      setRegistry(regData.tables || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load CDC status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handlePoll = async (table?: string) => {
    setPolling(table || 'all');
    try {
      await triggerCDCPoll(table);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Poll failed');
    } finally {
      setPolling(null);
    }
  };

  const getBusinessName = (sqlTable: string) => {
    const entry = registry.find((r) => r.sql_table_name === sqlTable);
    return entry?.entity_name || entry?.business_name || sqlTable;
  };

  const sorted = [...watermarks].sort((a, b) => {
    if (sortBy === 'changes') return (eventCounts[b.sql_table_name] || 0) - (eventCounts[a.sql_table_name] || 0);
    if (sortBy === 'time') return (b.last_poll_at || '').localeCompare(a.last_poll_at || '');
    return a.sql_table_name.localeCompare(b.sql_table_name);
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <LoadingSpinner size="lg" />
        <span className="ml-3 text-gray-500">Cargando estado CDC...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <Activity className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-gray-900">{watermarks.length}</p>
            <p className="text-xs text-gray-500">Tablas Monitoreadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Zap className="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <p className="text-2xl font-bold text-gray-900">{totalEvents}</p>
            <p className="text-xs text-gray-500">Eventos Recientes</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle className="w-8 h-8 text-green-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-gray-900">
              {watermarks.filter((w) => w.last_poll_at).length}
            </p>
            <p className="text-xs text-gray-500">Tablas Sincronizadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Clock className="w-8 h-8 text-blue-600 mx-auto mb-2" />
            <p className="text-2xl font-bold text-gray-900">5 min</p>
            <p className="text-xs text-gray-500">Intervalo de Polling</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Ordenar por:</span>
          {(['table', 'changes', 'time'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-3 py-1 text-xs rounded-full border transition ${
                sortBy === s ? 'bg-[#1A4A28] text-white border-[#1A4A28]' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {s === 'table' ? 'Tabla' : s === 'changes' ? 'Cambios' : 'Último Poll'}
            </button>
          ))}
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => handlePoll()}
          disabled={polling !== null}
        >
          {polling === 'all' ? <LoadingSpinner size="sm" className="mr-1" /> : <Zap className="w-3.5 h-3.5 mr-1" />}
          Poll All Now
        </Button>
      </div>

      {/* Table grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {sorted.map((wm) => {
          const changes = eventCounts[wm.sql_table_name] || 0;
          const hasChanges = changes > 0;
          const isStale = !wm.last_poll_at || (Date.now() - new Date(wm.last_poll_at).getTime()) > 600000;

          return (
            <Card
              key={wm.sql_table_name}
              className={`transition-all hover:shadow-md ${hasChanges ? 'border-amber-300 bg-amber-50/30' : isStale ? 'border-red-200 bg-red-50/20' : ''}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{wm.sql_table_name}</p>
                    <p className="text-xs text-gray-500">{getBusinessName(wm.sql_table_name)}</p>
                  </div>
                  {hasChanges ? (
                    <Badge variant="warning">{changes} cambios</Badge>
                  ) : isStale ? (
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-green-500" />
                  )}
                </div>
                <div className="space-y-1 text-xs text-gray-600">
                  <div className="flex justify-between">
                    <span>Último poll:</span>
                    <span className="font-medium">{timeAgo(wm.last_poll_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Filas en último poll:</span>
                    <span className="font-medium">{wm.rows_at_last_poll?.toLocaleString() || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cambios detectados:</span>
                    <span className="font-medium">{wm.changes_detected || 0}</span>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => handlePoll(wm.sql_table_name)}
                    disabled={polling !== null}
                    className="text-xs text-[#1A4A28] hover:underline flex items-center gap-1"
                  >
                    {polling === wm.sql_table_name ? (
                      <LoadingSpinner size="sm" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Poll ahora
                  </button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {watermarks.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            <ArrowUpDown className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p>No hay watermarks CDC registrados aún.</p>
            <p className="text-sm mt-1">Ejecuta un poll para iniciar el monitoreo.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
