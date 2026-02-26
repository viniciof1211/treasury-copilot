import { useMemo } from 'react';
import { formatCurrency } from '../../lib/utils';
import type { GanttItem } from '../../types/projects';

interface GanttChartProps {
  items: GanttItem[];
  onSelectContract?: (id: string) => void;
}

export function GanttChart({ items, onSelectContract }: GanttChartProps) {
  const { minDate, maxDate, totalDays } = useMemo(() => {
    if (!items.length) return { minDate: new Date(), maxDate: new Date(), totalDays: 1 };
    const dates = items.flatMap((i) => [new Date(i.start), new Date(i.end)]);
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    min.setDate(min.getDate() - 15);
    max.setDate(max.getDate() + 15);
    return { minDate: min, maxDate: max, totalDays: Math.max((max.getTime() - min.getTime()) / 86400000, 1) };
  }, [items]);

  const today = new Date();
  const todayPct = Math.max(0, Math.min(100, ((today.getTime() - minDate.getTime()) / 86400000 / totalDays) * 100));

  const months = useMemo(() => {
    const result: { label: string; pct: number }[] = [];
    const cursor = new Date(minDate);
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() + 1);
    while (cursor <= maxDate) {
      const pct = ((cursor.getTime() - minDate.getTime()) / 86400000 / totalDays) * 100;
      result.push({
        label: cursor.toLocaleDateString('es-CR', { month: 'short', year: '2-digit' }),
        pct,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return result;
  }, [minDate, maxDate, totalDays]);

  const barColor = (status: string) => {
    if (status === 'completed') return 'bg-emerald-500';
    if (status === 'overdue') return 'bg-red-500';
    return 'bg-[#1A4A28]';
  };

  const trackColor = (status: string) => {
    if (status === 'completed') return 'bg-emerald-100';
    if (status === 'overdue') return 'bg-red-100';
    return 'bg-emerald-50';
  };

  if (!items.length) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        No hay contratos para mostrar en la linea de tiempo
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[800px]">
        {/* Month headers */}
        <div className="relative h-7 border-b border-gray-200 mb-1 ml-[280px]">
          {months.map((m, i) => (
            <div
              key={i}
              className="absolute text-[10px] text-gray-500 font-medium"
              style={{ left: `${Math.max(0, m.pct)}%`, transform: 'translateX(-50%)' }}
            >
              {m.label}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="relative">
          {/* Month gridlines */}
          <div className="absolute left-[280px] right-0 top-0" style={{ height: `${items.length * 52}px` }}>
            {months.map((m, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-gray-100"
                style={{ left: `${m.pct}%` }}
              />
            ))}
            {/* Today marker */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-400 z-10"
              style={{ left: `${todayPct}%` }}
            >
              <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] bg-red-400 text-white px-1.5 py-0.5 rounded whitespace-nowrap">
                Hoy
              </div>
            </div>
          </div>

          {items.map((item) => {
            const startPct = ((new Date(item.start).getTime() - minDate.getTime()) / 86400000 / totalDays) * 100;
            const endPct = ((new Date(item.end).getTime() - minDate.getTime()) / 86400000 / totalDays) * 100;
            const widthPct = Math.max(endPct - startPct, 0.5);

            return (
              <div
                key={item.id}
                className="flex items-center h-[52px] hover:bg-gray-50 group cursor-pointer"
                onClick={() => onSelectContract?.(item.id)}
              >
                {/* Label */}
                <div className="w-[280px] flex-shrink-0 pr-3 truncate">
                  <div className="text-xs font-medium text-gray-900 truncate">{item.nombre_proyecto}</div>
                  <div className="text-[10px] text-gray-500 truncate">
                    {item.nombre_cliente} &middot; {formatCurrency(item.monto_contrato)}
                  </div>
                </div>

                {/* Bar area */}
                <div className="flex-1 relative h-7">
                  {/* Track */}
                  <div
                    className={`absolute h-7 rounded ${trackColor(item.status)}`}
                    style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                  />
                  {/* Progress fill */}
                  <div
                    className={`absolute h-7 rounded-l ${item.progress >= 100 ? 'rounded-r' : ''} ${barColor(item.status)} opacity-90`}
                    style={{
                      left: `${startPct}%`,
                      width: `${widthPct * (item.progress / 100)}%`,
                    }}
                  />
                  {/* % label */}
                  <div
                    className="absolute h-7 flex items-center text-[10px] font-bold text-white px-1.5"
                    style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                  >
                    {item.pct_cobrado.toFixed(0)}% cobrado
                  </div>

                  {/* Tooltip on hover */}
                  <div
                    className="absolute -top-16 z-20 hidden group-hover:block bg-gray-900 text-white text-[10px] px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap"
                    style={{ left: `${startPct + widthPct / 2}%`, transform: 'translateX(-50%)' }}
                  >
                    <div className="font-medium">{item.nombre_proyecto}</div>
                    <div>Contrato: {formatCurrency(item.monto_contrato)} &middot; Pend: {formatCurrency(item.pendiente_cobrar)}</div>
                    <div>
                      {new Date(item.start).toLocaleDateString('es-CR')} - {new Date(item.end).toLocaleDateString('es-CR')}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
