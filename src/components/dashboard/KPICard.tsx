import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { formatCurrency, formatPercent, SEMAPHORE_COLORS } from '../../lib/utils';
import { InfoTooltip, type TooltipMeta } from '../ui/InfoTooltip';

interface KPICardProps {
  title: string;
  value: number | string;
  trend?: number;
  trendLabel?: string;
  icon: LucideIcon;
  format?: 'currency' | 'number' | 'percent' | 'months' | 'weeks' | 'text';
  currency?: string;
  semaphore?: 'green' | 'yellow' | 'red';
  subtitle?: string;
  info?: TooltipMeta;
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
  info,
}: KPICardProps) {
  // Format the display value
  const formattedValue =
    format === 'text'
      ? String(value)
      : format === 'currency'
        ? formatCurrency(typeof value === 'number' ? value : parseFloat(String(value)) || 0, currency)
        : format === 'percent'
          ? formatPercent(typeof value === 'number' ? value : parseFloat(String(value)) || 0)
          : format === 'months'
            ? `${(typeof value === 'number' ? value : parseFloat(String(value)) || 0).toFixed(1)} meses`
            : format === 'weeks'
              ? `${(typeof value === 'number' ? value : parseFloat(String(value)) || 0).toFixed(0)} sem.`
              : typeof value === 'number'
                ? value.toLocaleString('es-CR')
                : String(value);

  // Auto-size: use smaller font for longer values to prevent truncation
  const len = formattedValue.length;
  const valueSizeClass =
    len > 18
      ? 'text-base'
      : len > 14
        ? 'text-lg'
        : len > 10
          ? 'text-xl'
          : 'text-2xl';

  const trendPositive = trend !== undefined && trend > 0;
  const trendNegative = trend !== undefined && trend < 0;
  const trendNeutral = trend !== undefined && trend === 0;

  const sem = semaphore ? SEMAPHORE_COLORS[semaphore] : null;

  return (
    <Card
      className={`hover:shadow-md transition-shadow ${sem ? `${sem.border} border-l-4` : ''}`}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              {sem && (
                <span className={`w-2.5 h-2.5 rounded-full ${sem.dot} flex-shrink-0`} />
              )}
              <p className="text-xs font-medium text-gray-500 leading-tight flex items-center gap-1">
                {title}
                {info && <InfoTooltip meta={info} size="sm" />}
              </p>
            </div>
            <p className={`${valueSizeClass} font-bold text-gray-900 leading-tight break-words`}>
              {formattedValue}
            </p>
            {subtitle && (
              <p className="text-xs text-gray-500 mt-0.5 leading-tight">{subtitle}</p>
            )}
            {trend !== undefined && (
              <div className="flex items-center mt-1 text-xs">
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
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
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
