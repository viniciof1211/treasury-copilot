import { useState, useEffect, useCallback } from 'react';
import { Radio, Server, Layers, RefreshCw, Wifi, HardDrive } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { getKafkaStatus, type KafkaStatus, type KafkaTopic } from '../../lib/dataModel';

export function KafkaMonitorTab() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<KafkaStatus | null>(null);
  const [error, setError] = useState('');
  const [topicFilter, setTopicFilter] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getKafkaStatus();
      if (result.error) throw new Error(result.error);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Kafka status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <LoadingSpinner size="lg" />
        <span className="ml-3 text-gray-500">Cargando estado de Kafka...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-6 text-center">
          <p className="text-red-700">{error || 'No data'}</p>
          <Button variant="outline" className="mt-3" onClick={fetchData}>
            <RefreshCw className="w-4 h-4 mr-2" /> Reintentar
          </Button>
        </CardContent>
      </Card>
    );
  }

  const filteredTopics = data.topics.filter((t) =>
    !topicFilter || t.name.toLowerCase().includes(topicFilter.toLowerCase()) ||
    t.entity.toLowerCase().includes(topicFilter.toLowerCase())
  );

  return (
    <div className="space-y-4">
      {/* Cluster overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-orange-50 to-white border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <Server className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{data.cluster.brokers}</p>
                <p className="text-xs text-gray-500">Brokers</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-white border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <HardDrive className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{data.cluster.controllers}</p>
                <p className="text-xs text-gray-500">Controllers</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-green-50 to-white border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <Radio className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{data.topics.length}</p>
                <p className="text-xs text-gray-500">Topics</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-50 to-white border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Wifi className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900">{data.cluster.mode}</p>
                <p className="text-xs text-gray-500">Kafka {data.cluster.version}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Cluster info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-orange-600" />
            Cluster Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500">Bootstrap</p>
              <p className="font-mono text-xs text-gray-900 break-all">{data.bootstrap}</p>
            </div>
            <div>
              <p className="text-gray-500">Topic Prefix</p>
              <p className="font-mono text-xs text-gray-900">{data.topic_prefix}</p>
            </div>
            <div>
              <p className="text-gray-500">Strimzi</p>
              <p className="font-mono text-xs text-gray-900">v{data.cluster.strimzi_version}</p>
            </div>
            <div>
              <p className="text-gray-500">Replication</p>
              <p className="font-mono text-xs text-gray-900">RF=3, min.isr=2</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Topics */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Radio className="w-5 h-5 text-orange-600" />
              Topics ({filteredTopics.length})
            </CardTitle>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Filtrar topics..."
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-48 focus:ring-2 focus:ring-[#1A4A28]"
              />
              <Button variant="outline" size="sm" onClick={fetchData}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="pb-2 font-medium text-gray-600">Topic</th>
                  <th className="pb-2 font-medium text-gray-600">Tabla ERP</th>
                  <th className="pb-2 font-medium text-gray-600">Entidad</th>
                  <th className="pb-2 font-medium text-gray-600 text-center">Particiones</th>
                  <th className="pb-2 font-medium text-gray-600 text-center">RF</th>
                  <th className="pb-2 font-medium text-gray-600 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredTopics.map((topic) => (
                  <tr key={topic.name} className="hover:bg-gray-50">
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-xs text-gray-900">{topic.name}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge variant="default">{topic.table}</Badge>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600">{topic.entity}</td>
                    <td className="py-2.5 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                        {topic.partitions}
                      </span>
                    </td>
                    <td className="py-2.5 text-center">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                        {topic.replication_factor}
                      </span>
                    </td>
                    <td className="py-2.5 text-center">
                      <span className="inline-flex items-center gap-1 text-green-600 text-xs">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
