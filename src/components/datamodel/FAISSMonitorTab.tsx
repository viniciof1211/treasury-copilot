import { useState, useEffect, useCallback } from 'react';
import { Brain, RefreshCw, Clock, FileText, Database, Zap, BarChart3 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { getKBStats, triggerKBSync, triggerKBCDCRefresh, type KBStats } from '../../lib/dataModel';

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return 'Nunca';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h ${mins % 60}m`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

export function FAISSMonitorTab() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<KBStats | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getKBStats();
      if (data.error) throw new Error(data.error);
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load KB stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh every 60s
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleFullSync = async () => {
    setSyncing(true);
    try {
      await triggerKBSync();
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleCDCRefresh = async () => {
    setRefreshing(true);
    try {
      await triggerKBCDCRefresh();
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CDC refresh failed');
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <LoadingSpinner size="lg" />
        <span className="ml-3 text-gray-500">Cargando estadísticas FAISS KB...</span>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-6 text-center">
          <p className="text-red-700">{error}</p>
          <Button variant="outline" className="mt-3" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats?.total_documents?.toLocaleString() || 0}</p>
                <p className="text-xs text-gray-500">Documentos Indexados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{stats?.total_tables || 0}</p>
                <p className="text-xs text-gray-500">Tablas Indexadas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-white border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">{timeAgo(stats?.last_sync)}</p>
                <p className="text-xs text-gray-500">Última Sincronización</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-white border-amber-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <RefreshCw className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">
                  {stats?.sync_interval_seconds ? `${Math.round(stats.sync_interval_seconds / 60)}min` : '—'}
                </p>
                <p className="text-xs text-gray-500">Intervalo Auto-Sync</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            Acciones de Knowledge Base
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={handleFullSync} disabled={syncing}>
              {syncing ? <LoadingSpinner size="sm" className="mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Full Sync (Rebuild)
            </Button>
            <Button variant="outline" onClick={handleCDCRefresh} disabled={refreshing}>
              {refreshing ? <LoadingSpinner size="sm" className="mr-2" /> : <Zap className="w-4 h-4 mr-2" />}
              CDC Incremental Refresh
            </Button>
            <Button variant="outline" onClick={fetchData}>
              <BarChart3 className="w-4 h-4 mr-2" />
              Refresh Stats
            </Button>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            El auto-sync daemon se ejecuta cada {stats?.sync_interval_seconds ? Math.round(stats.sync_interval_seconds / 60) : 4} minutos.
            Los cambios CDC se reflejan automáticamente vía triple-commit (Supabase → Kafka → FAISS).
          </p>
        </CardContent>
      </Card>

      {/* Indexed tables */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5 text-blue-600" />
            Tablas Indexadas ({stats?.tables_indexed?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats?.tables_indexed && stats.tables_indexed.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {stats.tables_indexed.map((table) => (
                <Badge key={table} variant="default">
                  <Database className="w-3 h-3 mr-1" />
                  {table}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No hay tablas indexadas aún. Ejecute un Full Sync.</p>
          )}
        </CardContent>
      </Card>

      {/* Architecture diagram */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-purple-600" />
            Arquitectura de Sincronización
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-gray-50 rounded-lg p-6">
            <div className="flex items-center justify-center gap-2 flex-wrap text-sm">
              <div className="px-4 py-2 bg-blue-100 border border-blue-300 rounded-lg text-blue-800 font-medium">
                PcGraf ERP
              </div>
              <span className="text-gray-400">→</span>
              <div className="px-4 py-2 bg-emerald-100 border border-emerald-300 rounded-lg text-emerald-800 font-medium">
                CDC Poller (5min)
              </div>
              <span className="text-gray-400">→</span>
              <div className="flex flex-col gap-1">
                <div className="px-3 py-1.5 bg-green-100 border border-green-300 rounded text-green-800 text-xs font-medium">
                  Supabase
                </div>
                <div className="px-3 py-1.5 bg-orange-100 border border-orange-300 rounded text-orange-800 text-xs font-medium">
                  Kafka
                </div>
                <div className="px-3 py-1.5 bg-purple-100 border border-purple-300 rounded text-purple-800 text-xs font-medium">
                  FAISS KB
                </div>
              </div>
              <span className="text-gray-400">→</span>
              <div className="px-4 py-2 bg-rose-100 border border-rose-300 rounded-lg text-rose-800 font-medium">
                AI Chat / BI Charts
              </div>
            </div>
            <p className="text-center text-xs text-gray-500 mt-4">
              Triple-commit: cada cambio detectado se escribe simultáneamente a Supabase, Kafka y FAISS KB
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
