import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { formatCurrency, formatPercent, SEMAPHORE_COLORS } from '../../lib/utils';

interface KPICardProps {
  title: string;
  value: number;
  trend?: number;
  trendLabel?: string;
  icon: LucideIcon;
  format?: 'currency' | 'number' | 'percent' | 'months' | 'weeks';
  currency?: string;
  semaphore?: 'green' | 'yellow' | 'red';
  subtitle?: string;
}

export function KPICard({
  title,
  value,
  trend,
  trendLabel = 'vs mes anterior',
  icon: Icon,
  format = 'currency',
  currency = 'USD',
  semaphore,
  subtitle,
}: KPICardProps) {
  const formattedValue =
    format === 'currency'
      ? formatCurrency(value, currency)
      : format === 'percent'
        ? formatPercent(value)
        : format === 'months'
          ? `${value.toFixed(1)} meses`
          : format === 'weeks'
            ? `${value.toFixed(0)} sem.`
            : value.toLocaleString('es-CR');

  const trendPositive = trend !== undefined && trend > 0;
  const trendNegative = trend !== undefined && trend < 0;
  const trendNeutral = trend !== undefined && trend === 0;

  const sem = semaphore ? SEMAPHORE_COLORS[semaphore] : null;

  return (
    <Card
      className={`hover:shadow-md transition-shadow ${sem ? `${sem.border} border-l-4` : ''}`}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {sem && (
                <span className={`w-2.5 h-2.5 rounded-full ${sem.dot} flex-shrink-0`} />
              )}
              <p className="text-sm font-medium text-gray-500 truncate">{title}</p>
            </div>
            <p className="text-2xl font-bold text-gray-900 truncate">{formattedValue}</p>
            {subtitle && (
              <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
            )}
            {trend !== undefined && (
              <div className="flex items-center mt-1.5 text-xs">
                {trendPositive && (
                  <>
                    <TrendingUp className="w-3.5 h-3.5 text-emerald-600 mr-1" />
                    <span className="text-emerald-600 font-semibold">
                      +{Math.abs(trend).toFixed(1)}%
                    </span>
                  </>
                )}
                {trendNegative && (
                  <>
                    <TrendingDown className="w-3.5 h-3.5 text-red-600 mr-1" />
                    <span className="text-red-600 font-semibold">
                      {trend.toFixed(1)}%
                    </span>
                  </>
                )}
                {trendNeutral && (
                  <>
                    <Minus className="w-3.5 h-3.5 text-gray-400 mr-1" />
                    <span className="text-gray-400 font-semibold">0%</span>
                  </>
                )}
                <span className="text-gray-400 ml-1">{trendLabel}</span>
              </div>
            )}
          </div>
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${
              sem ? `${sem.bg}` : 'bg-[#1A4A28]/10'
            }`}
          >
            <Icon className={`w-5 h-5 ${sem ? sem.text : 'text-[#1A4A28]'}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
