import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { formatCurrency, formatPercent } from '../../lib/utils';

interface KPICardProps {
  title: string;
  value: number;
  trend?: number;
  icon: LucideIcon;
  format?: 'currency' | 'number' | 'percent';
  currency?: string;
}

export function KPICard({ title, value, trend, icon: Icon, format = 'currency', currency = 'USD' }: KPICardProps) {
  const formattedValue = format === 'currency'
    ? formatCurrency(value, currency)
    : format === 'percent'
    ? formatPercent(value)
    : value.toLocaleString();

  const trendPositive = trend !== undefined && trend > 0;
  const trendNegative = trend !== undefined && trend < 0;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
            <p className="text-3xl font-bold text-gray-900">{formattedValue}</p>
            {trend !== undefined && (
              <div className="flex items-center mt-2 text-sm">
                {trendPositive && (
                  <>
                    <TrendingUp className="w-4 h-4 text-green-600 mr-1" />
                    <span className="text-green-600 font-medium">
                      +{Math.abs(trend).toFixed(1)}%
                    </span>
                  </>
                )}
                {trendNegative && (
                  <>
                    <TrendingDown className="w-4 h-4 text-red-600 mr-1" />
                    <span className="text-red-600 font-medium">
                      {trend.toFixed(1)}%
                    </span>
                  </>
                )}
                <span className="text-gray-500 ml-1">vs last month</span>
              </div>
            )}
          </div>
          <div className="w-12 h-12 bg-[#1A4A28] bg-opacity-10 rounded-lg flex items-center justify-center">
            <Icon className="w-6 h-6 text-[#1A4A28]" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
