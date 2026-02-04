import { useState } from 'react';
import { Briefcase, TrendingUp, Calendar, DollarSign } from 'lucide-react';
import { Layout } from '../components/layout/Layout';
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate, getStatusColor } from '../lib/utils';
import type { EngagementProject } from '../types';

const mockProjects: EngagementProject[] = [
  {
    id: '1',
    company_bu_id: '1',
    name: 'Treasury Automation Initiative',
    description: 'Implement AI-driven cashflow forecasting and automated payment scheduling',
    status: 'active',
    start_date: '2026-01-15',
    end_date: '2026-06-30',
    budget_amount: 500000,
    actual_cost: 180000,
    expected_roi_usd: 750000,
    actual_roi_usd: 125000,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-04T00:00:00Z',
  },
  {
    id: '2',
    company_bu_id: '1',
    name: 'Receivables Optimization',
    description: 'Reduce DSO by 15 days through predictive analytics and automated collections',
    status: 'active',
    start_date: '2026-02-01',
    end_date: '2026-08-31',
    budget_amount: 350000,
    actual_cost: 45000,
    expected_roi_usd: 1200000,
    created_at: '2026-01-20T00:00:00Z',
    updated_at: '2026-02-04T00:00:00Z',
  },
  {
    id: '3',
    company_bu_id: '1',
    name: 'Payment Process Digitalization',
    description: 'Replace manual approval workflows with AI-powered risk assessment',
    status: 'planning',
    start_date: '2026-03-01',
    budget_amount: 280000,
    actual_cost: 0,
    expected_roi_usd: 450000,
    created_at: '2026-01-25T00:00:00Z',
    updated_at: '2026-02-03T00:00:00Z',
  },
  {
    id: '4',
    company_bu_id: '1',
    name: 'Legacy System Migration',
    description: 'Migrate from SAP to cloud-based treasury management platform',
    status: 'completed',
    start_date: '2025-06-01',
    end_date: '2025-12-31',
    budget_amount: 800000,
    actual_cost: 750000,
    expected_roi_usd: 600000,
    actual_roi_usd: 620000,
    created_at: '2025-05-15T00:00:00Z',
    updated_at: '2026-01-05T00:00:00Z',
  },
];

export function Projects() {
  const [projects] = useState<EngagementProject[]>(mockProjects);
  const [filter, setFilter] = useState<string>('all');

  const filteredProjects = filter === 'all'
    ? projects
    : projects.filter((p) => p.status === filter);

  const statusCounts = {
    all: projects.length,
    active: projects.filter((p) => p.status === 'active').length,
    planning: projects.filter((p) => p.status === 'planning').length,
    completed: projects.filter((p) => p.status === 'completed').length,
  };

  const calculateProgress = (project: EngagementProject) => {
    if (!project.budget_amount) return 0;
    return (project.actual_cost / project.budget_amount) * 100;
  };

  const calculateROIPercentage = (project: EngagementProject) => {
    const cost = project.actual_cost || project.budget_amount || 1;
    const roi = project.actual_roi_usd || project.expected_roi_usd || 0;
    return ((roi / cost) * 100).toFixed(0);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Engagement Projects</h1>
            <p className="text-gray-600 mt-1">Track initiatives, investments, and ROI</p>
          </div>
          <Button variant="primary">
            <Briefcase className="w-4 h-4 mr-2" />
            New Project
          </Button>
        </div>

        <div className="flex gap-2">
          {(['all', 'active', 'planning', 'completed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                filter === status
                  ? 'bg-[#1A4A28] text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)} ({statusCounts[status]})
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6">
          {filteredProjects.map((project) => (
            <Card key={project.id}>
              <CardContent className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-12 h-12 bg-[#1A4A28] bg-opacity-10 rounded-lg flex items-center justify-center">
                      <Briefcase className="w-6 h-6 text-[#1A4A28]" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">{project.name}</h3>
                        <Badge className={getStatusColor(project.status)}>
                          {project.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600 mb-4">{project.description}</p>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
                  <div>
                    <div className="flex items-center gap-2 text-gray-600 mb-1">
                      <Calendar className="w-4 h-4" />
                      <p className="text-sm">Timeline</p>
                    </div>
                    <p className="font-semibold text-gray-900">
                      {project.start_date ? formatDate(project.start_date) : 'TBD'}
                    </p>
                    {project.end_date && (
                      <p className="text-sm text-gray-600">to {formatDate(project.end_date)}</p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-gray-600 mb-1">
                      <DollarSign className="w-4 h-4" />
                      <p className="text-sm">Budget</p>
                    </div>
                    <p className="font-semibold text-gray-900">
                      {project.budget_amount ? formatCurrency(project.budget_amount) : 'TBD'}
                    </p>
                    {project.actual_cost > 0 && (
                      <div className="mt-2">
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div
                            className="bg-[#1A4A28] h-2 rounded-full transition-all"
                            style={{ width: `${Math.min(calculateProgress(project), 100)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-600 mt-1">
                          {formatCurrency(project.actual_cost)} spent ({calculateProgress(project).toFixed(0)}%)
                        </p>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-gray-600 mb-1">
                      <TrendingUp className="w-4 h-4" />
                      <p className="text-sm">Expected ROI</p>
                    </div>
                    <p className="font-semibold text-green-700">
                      {project.expected_roi_usd ? formatCurrency(project.expected_roi_usd) : 'TBD'}
                    </p>
                    {project.expected_roi_usd && (
                      <p className="text-sm text-gray-600">
                        {calculateROIPercentage(project)}% return
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2 text-gray-600 mb-1">
                      <DollarSign className="w-4 h-4" />
                      <p className="text-sm">Actual ROI</p>
                    </div>
                    {project.actual_roi_usd ? (
                      <>
                        <p className="font-semibold text-green-700">
                          {formatCurrency(project.actual_roi_usd)}
                        </p>
                        <Badge variant="success" className="mt-1">
                          Realized
                        </Badge>
                      </>
                    ) : (
                      <p className="text-sm text-gray-500">Pending</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex gap-2 justify-end">
                  <Button variant="outline" size="sm">
                    View Details
                  </Button>
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredProjects.length === 0 && (
          <Card className="p-12 text-center">
            <Briefcase className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No projects found</h3>
            <p className="text-gray-600">
              {filter === 'all'
                ? 'Create your first project to start tracking ROI'
                : `No ${filter} projects at this time`}
            </p>
          </Card>
        )}
      </div>
    </Layout>
  );
}
