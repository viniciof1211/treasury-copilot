import { AlertTriangle, Clock, AlertCircle, CalendarClock } from 'lucide-react';
import { formatCurrency, formatDate } from '../../lib/utils';
import type { MilestoneAlert } from '../../types/projects';

interface MilestoneAlertsProps {
  alerts: MilestoneAlert[];
  onSelectContract?: (id: string) => void;
}

const urgencyConfig = {
  overdue: { icon: AlertTriangle, label: 'Vencido', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500' },
  critical: { icon: AlertCircle, label: '< 7 dias', bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-600', dot: 'bg-red-400' },
  warning: { icon: Clock, label: '< 14 dias', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500' },
  attention: { icon: CalendarClock, label: '< 30 dias', bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500' },
};

export function MilestoneAlerts({ alerts, onSelectContract }: MilestoneAlertsProps) {
  if (!alerts.length) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
        No hay alertas de hitos pendientes
      </div>
    );
  }

  const grouped = {
    overdue: alerts.filter((a) => a.urgency === 'overdue'),
    critical: alerts.filter((a) => a.urgency === 'critical'),
    warning: alerts.filter((a) => a.urgency === 'warning'),
    attention: alerts.filter((a) => a.urgency === 'attention'),
  };

  return (
    <div className="space-y-3">
      {/* Summary badges */}
      <div className="flex gap-2 flex-wrap">
        {Object.entries(grouped).map(([key, items]) => {
          if (!items.length) return null;
          const cfg = urgencyConfig[key as keyof typeof urgencyConfig];
          return (
            <div key={key} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
              <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
              {items.length} {cfg.label}
            </div>
          );
        })}
      </div>

      {/* Alert list */}
      <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
        {alerts.map((alert) => {
          const cfg = urgencyConfig[alert.urgency];
          const Icon = cfg.icon;
          return (
            <div
              key={alert.contract_id}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:shadow-sm transition-shadow ${cfg.bg} ${cfg.border}`}
              onClick={() => onSelectContract?.(alert.contract_id)}
            >
              <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${cfg.text}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900 truncate">{alert.nombre_proyecto}</span>
                  <span className={`text-xs font-bold whitespace-nowrap ${cfg.text}`}>
                    {alert.days_until < 0
                      ? `${Math.abs(alert.days_until)}d vencido`
                      : `${alert.days_until}d restantes`}
                  </span>
                </div>
                <div className="text-xs text-gray-600 truncate mt-0.5">
                  {alert.nombre_cliente} &middot; {alert.area}
                </div>
                <div className="flex gap-4 mt-1.5 text-xs">
                  <span className="text-gray-700">
                    <span className="font-medium">Pend cobro:</span> {formatCurrency(alert.pendiente_cobrar)}
                  </span>
                  <span className="text-gray-700">
                    <span className="font-medium">Pend fact:</span> {formatCurrency(alert.pendiente_facturar)}
                  </span>
                  <span className="text-gray-500">Cierre: {formatDate(alert.fecha_cierre)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
