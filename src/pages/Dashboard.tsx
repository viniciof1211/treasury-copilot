import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, AlertCircle, Calendar } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { KPICard } from '../components/dashboard/KPICard';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate } from '../lib/utils';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from 'recharts';
import type { DashboardMetrics } from '../types';

const mockCashflowData = [
  { month: 'Jan', cash: 2500000, inflows: 800000, outflows: 600000 },
  { month: 'Feb', cash: 2700000, inflows: 900000, outflows: 700000 },
  { month: 'Mar', cash: 2900000, inflows: 1000000, outflows: 800000 },
  { month: 'Apr', cash: 3100000, inflows: 1100000, outflows: 900000 },
  { month: 'May', cash: 3300000, inflows: 1200000, outflows: 1000000 },
  { month: 'Jun', cash: 3500000, inflows: 1300000, outflows: 1100000 },
];

const mockPayables = [
  { vendor: 'Acme Corp', amount: 150000, due_date: '2026-02-10', priority: 1, status: 'pending' },
  { vendor: 'Global Supplies', amount: 85000, due_date: '2026-02-15', priority: 2, status: 'pending' },
  { vendor: 'Tech Solutions', amount: 120000, due_date: '2026-02-20', priority: 1, status: 'pending' },
  { vendor: 'Office Pro', amount: 45000, due_date: '2026-02-25', priority: 3, status: 'pending' },
];

const mockReceivables = [
  { customer: 'Client A', amount: 200000, due_date: '2026-02-08', days_overdue: 0, status: 'outstanding' },
  { customer: 'Client B', amount: 175000, due_date: '2026-02-12', days_overdue: 0, status: 'outstanding' },
  { customer: 'Client C', amount: 95000, due_date: '2026-01-30', days_overdue: 5, status: 'overdue' },
];

export function Dashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalCash: 3500000,
    totalPayables: 400000,
    totalReceivables: 470000,
    netPosition: 3070000,
    cashTrend: 8.5,
    payablesDue30Days: 355000,
    receivablesOverdue: 95000,
    projectedLiquidity: 3800000,
  });

  return (
    <Layout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Executive Dashboard</h1>
          <p className="text-gray-600 mt-1">Real-time treasury and cashflow insights</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <KPICard
            title="Total Cash Position"
            value={metrics.totalCash}
            trend={metrics.cashTrend}
            icon={DollarSign}
            format="currency"
          />
          <KPICard
            title="Total Payables"
            value={metrics.totalPayables}
            icon={AlertCircle}
            format="currency"
          />
          <KPICard
            title="Total Receivables"
            value={metrics.totalReceivables}
            trend={2.3}
            icon={TrendingUp}
            format="currency"
          />
          <KPICard
            title="Net Position"
            value={metrics.netPosition}
            trend={5.7}
            icon={Calendar}
            format="currency"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Cashflow Trend (6M)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={mockCashflowData}>
                  <defs>
                    <linearGradient id="colorCash" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1A4A28" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#1A4A28" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" tickFormatter={(value) => `$${value / 1000000}M`} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                  />
                  <Area type="monotone" dataKey="cash" stroke="#1A4A28" strokeWidth={2} fillOpacity={1} fill="url(#colorCash)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inflows vs Outflows</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={mockCashflowData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="month" stroke="#6b7280" />
                  <YAxis stroke="#6b7280" tickFormatter={(value) => `$${value / 1000000}M`} />
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                  />
                  <Legend />
                  <Bar dataKey="inflows" fill="#1A4A28" name="Inflows" />
                  <Bar dataKey="outflows" fill="#dc2626" name="Outflows" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Priority Payables</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {mockPayables.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{item.vendor}</p>
                      <p className="text-sm text-gray-600">Due: {formatDate(item.due_date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatCurrency(item.amount)}</p>
                      <Badge variant={item.priority === 1 ? 'error' : item.priority === 2 ? 'warning' : 'default'}>
                        Priority {item.priority}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Expected Receivables</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {mockReceivables.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{item.customer}</p>
                      <p className="text-sm text-gray-600">Due: {formatDate(item.due_date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900">{formatCurrency(item.amount)}</p>
                      <Badge variant={item.status === 'overdue' ? 'error' : 'info'}>
                        {item.status === 'overdue' ? `${item.days_overdue}d overdue` : 'Outstanding'}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
