import { useState } from 'react';
import { Users, Shield, Activity, Building2 } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatDate } from '../lib/utils';
import type { User, CompanyBU, AuditLog } from '../types';

const mockUsers: User[] = [
  {
    id: '1',
    email: 'admin@ara-group.com',
    full_name: 'Admin User',
    role: 'admin',
    is_active: true,
    last_login_at: '2026-02-04T09:30:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-04T09:30:00Z',
  },
  {
    id: '2',
    email: 'finance@ara-group.com',
    full_name: 'Maria González',
    role: 'finance_manager',
    is_active: true,
    last_login_at: '2026-02-04T08:15:00Z',
    created_at: '2026-01-05T00:00:00Z',
    updated_at: '2026-02-04T08:15:00Z',
  },
  {
    id: '3',
    email: 'analyst@ara-group.com',
    full_name: 'Carlos Rodríguez',
    role: 'treasury_analyst',
    is_active: true,
    last_login_at: '2026-02-03T16:45:00Z',
    created_at: '2026-01-10T00:00:00Z',
    updated_at: '2026-02-03T16:45:00Z',
  },
];

const mockBusinessUnits: CompanyBU[] = [
  {
    id: '1',
    name: 'ARA Group - Corporate',
    code: 'ARA-CORP',
    description: 'Corporate headquarters and central treasury',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '2',
    name: 'CVE Division',
    code: 'CVE-DIV',
    description: 'CVE certified operations',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '3',
    name: 'Aurea Ventures',
    code: 'AUREA',
    description: 'Investment and venture capital arm',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    id: '4',
    name: 'ECS Solutions',
    code: 'ECS',
    description: 'Enterprise consulting services',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

const mockAuditLogs: AuditLog[] = [
  {
    id: '1',
    user_id: '2',
    action: 'Updated data source configuration',
    entity_type: 'data_source',
    entity_id: '1',
    ip_address: '192.168.1.100',
    created_at: '2026-02-04T10:30:00Z',
  },
  {
    id: '2',
    user_id: '1',
    action: 'Created new engagement project',
    entity_type: 'project',
    entity_id: '2',
    ip_address: '192.168.1.101',
    created_at: '2026-02-04T09:15:00Z',
  },
  {
    id: '3',
    user_id: '3',
    action: 'Exported cashflow report',
    entity_type: 'report',
    ip_address: '192.168.1.102',
    created_at: '2026-02-04T08:45:00Z',
  },
];

export function Admin() {
  const [activeTab, setActiveTab] = useState<'users' | 'business-units' | 'audit'>('users');

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'finance_manager':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'treasury_analyst':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Administration</h1>
            <p className="text-gray-600 mt-1">Manage users, business units, and system settings</p>
          </div>
        </div>

        <div className="flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-[#1A4A28] text-[#1A4A28]'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Users className="w-4 h-4 inline mr-2" />
            Users
          </button>
          <button
            onClick={() => setActiveTab('business-units')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'business-units'
                ? 'border-[#1A4A28] text-[#1A4A28]'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Building2 className="w-4 h-4 inline mr-2" />
            Business Units
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
              activeTab === 'audit'
                ? 'border-[#1A4A28] text-[#1A4A28]'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <Activity className="w-4 h-4 inline mr-2" />
            Audit Logs
          </button>
        </div>

        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-600">{mockUsers.length} users</p>
              <Button variant="primary">
                <Users className="w-4 h-4 mr-2" />
                Add User
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          User
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Role
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Last Login
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {mockUsers.map((user) => (
                        <tr key={user.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <p className="font-medium text-gray-900">{user.full_name}</p>
                              <p className="text-sm text-gray-600">{user.email}</p>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge className={getRoleColor(user.role)}>
                              {user.role.replace('_', ' ')}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <Badge variant={user.is_active ? 'success' : 'error'}>
                              {user.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                            {user.last_login_at ? formatDate(user.last_login_at) : 'Never'}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm">
                            <Button variant="ghost" size="sm">
                              Edit
                            </Button>
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

        {activeTab === 'business-units' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <p className="text-sm text-gray-600">{mockBusinessUnits.length} business units</p>
              <Button variant="primary">
                <Building2 className="w-4 h-4 mr-2" />
                Add Business Unit
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mockBusinessUnits.map((bu) => (
                <Card key={bu.id}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#1A4A28] bg-opacity-10 rounded-lg flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-[#1A4A28]" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">{bu.name}</h3>
                          <p className="text-sm text-gray-600">{bu.code}</p>
                        </div>
                      </div>
                      <Badge variant={bu.is_active ? 'success' : 'error'}>
                        {bu.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">{bu.description}</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1">
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm">
                        Settings
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Recent activity across the platform</p>

            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-200">
                  {mockAuditLogs.map((log) => (
                    <div key={log.id} className="p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 bg-[#1A4A28] bg-opacity-10 rounded-full flex items-center justify-center">
                            <Activity className="w-4 h-4 text-[#1A4A28]" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{log.action}</p>
                            <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                              <span>Entity: {log.entity_type}</span>
                              {log.ip_address && (
                                <>
                                  <span>•</span>
                                  <span>IP: {log.ip_address}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-600">{formatDate(log.created_at)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
