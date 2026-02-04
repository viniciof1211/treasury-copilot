import { useState } from 'react';
import { Database, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatDate, getStatusColor } from '../lib/utils';
import type { DataSource } from '../types';

const mockDataSources: DataSource[] = [
  {
    id: '1',
    company_bu_id: '1',
    name: 'Databricks - Production',
    type: 'databricks',
    status: 'active',
    config: { endpoint: 'https://databricks.company.com' },
    last_sync_at: '2026-02-04T10:30:00Z',
    last_sync_status: 'success',
    sync_frequency_minutes: 60,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-04T10:30:00Z',
  },
  {
    id: '2',
    company_bu_id: '1',
    name: 'CSV Upload - Monthly Reports',
    type: 'csv_upload',
    status: 'active',
    config: {},
    last_sync_at: '2026-02-01T09:00:00Z',
    last_sync_status: 'success',
    created_at: '2026-01-15T00:00:00Z',
    updated_at: '2026-02-01T09:00:00Z',
  },
  {
    id: '3',
    company_bu_id: '1',
    name: 'API - External System',
    type: 'api',
    status: 'error',
    config: { endpoint: 'https://api.external.com' },
    last_sync_at: '2026-02-03T14:20:00Z',
    last_sync_status: 'Connection timeout',
    sync_frequency_minutes: 120,
    created_at: '2026-01-20T00:00:00Z',
    updated_at: '2026-02-03T14:20:00Z',
  },
];

export function DataSources() {
  const [sources, setSources] = useState<DataSource[]>(mockDataSources);
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});

  const handleSync = async (sourceId: string) => {
    setSyncing((prev) => ({ ...prev, [sourceId]: true }));

    setTimeout(() => {
      setSources((prev) =>
        prev.map((source) =>
          source.id === sourceId
            ? {
                ...source,
                last_sync_at: new Date().toISOString(),
                last_sync_status: 'success',
                status: 'active',
              }
            : source
        )
      );
      setSyncing((prev) => ({ ...prev, [sourceId]: false }));
    }, 2000);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'error':
        return <XCircle className="w-5 h-5 text-red-600" />;
      case 'syncing':
        return <RefreshCw className="w-5 h-5 text-blue-600 animate-spin" />;
      default:
        return <Clock className="w-5 h-5 text-gray-600" />;
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Data Sources</h1>
            <p className="text-gray-600 mt-1">Manage external data connections and synchronization</p>
          </div>
          <Button variant="primary">
            <Database className="w-4 h-4 mr-2" />
            Add Data Source
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-6">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-12 h-12 bg-[#1A4A28] bg-opacity-10 rounded-lg flex items-center justify-center">
                      <Database className="w-6 h-6 text-[#1A4A28]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">{source.name}</h3>
                        <Badge variant="default" className="capitalize">
                          {source.type.replace('_', ' ')}
                        </Badge>
                        <div className="flex items-center gap-1">
                          {getStatusIcon(syncing[source.id] ? 'syncing' : source.status)}
                          <span className={`text-sm font-medium ${getStatusColor(source.status)}`}>
                            {syncing[source.id] ? 'Syncing...' : source.status}
                          </span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-600">Last Sync</p>
                          <p className="font-medium text-gray-900">
                            {source.last_sync_at ? formatDate(source.last_sync_at) : 'Never'}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-600">Sync Status</p>
                          <p className="font-medium text-gray-900">
                            {source.last_sync_status || 'N/A'}
                          </p>
                        </div>
                        {source.sync_frequency_minutes && (
                          <div>
                            <p className="text-gray-600">Frequency</p>
                            <p className="font-medium text-gray-900">
                              Every {source.sync_frequency_minutes} minutes
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-gray-600">Created</p>
                          <p className="font-medium text-gray-900">
                            {formatDate(source.created_at)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(source.id)}
                      disabled={syncing[source.id]}
                    >
                      <RefreshCw className={`w-4 h-4 mr-2 ${syncing[source.id] ? 'animate-spin' : ''}`} />
                      Sync Now
                    </Button>
                    <Button variant="ghost" size="sm">
                      Configure
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Available Connectors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { name: 'Databricks SQL', type: 'databricks', available: true },
                { name: 'CSV Upload', type: 'csv_upload', available: true },
                { name: 'REST API', type: 'api', available: true },
                { name: 'Snowflake', type: 'snowflake', available: false },
                { name: 'SAP', type: 'sap', available: false },
                { name: 'Oracle ERP', type: 'oracle', available: false },
              ].map((connector) => (
                <div
                  key={connector.type}
                  className={`p-4 border-2 rounded-lg ${
                    connector.available
                      ? 'border-gray-200 hover:border-[#1A4A28] cursor-pointer'
                      : 'border-gray-100 bg-gray-50 cursor-not-allowed opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{connector.name}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        {connector.available ? 'Available' : 'Coming Soon'}
                      </p>
                    </div>
                    {connector.available && (
                      <Database className="w-5 h-5 text-[#1A4A28]" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
