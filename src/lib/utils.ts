import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(amount: number, currency: string = 'CRC'): string {
  return new Intl.NumberFormat('es-CR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatCompactCurrency(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) return `₡${(amount / 1_000_000).toFixed(1)}M`;
  if (Math.abs(amount) >= 1_000) return `₡${(amount / 1_000).toFixed(0)}K`;
  return `₡${amount.toFixed(0)}`;
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export function formatShortDate(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CR', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export function formatMonthYear(date: string | Date): string {
  return new Intl.DateTimeFormat('es-CR', {
    month: 'short',
    year: '2-digit',
  }).format(new Date(date));
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('es-CR', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}

export function getDaysUntil(date: string | Date): number {
  const target = new Date(date);
  const today = new Date();
  const diffTime = target.getTime() - today.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export function getWeeksUntil(date: string | Date): number {
  return Math.ceil(getDaysUntil(date) / 7);
}

export function getPriorityColor(priority: number): string {
  if (priority === 1) return 'text-red-600 bg-red-50';
  if (priority === 2) return 'text-orange-600 bg-orange-50';
  if (priority === 3) return 'text-yellow-600 bg-yellow-50';
  return 'text-gray-600 bg-gray-50';
}

export function getPriorityLabel(priority: string | number | null): string {
  const p = String(priority || '').replace(/[^0-9]/g, '');
  if (p === '1') return 'P1 — Urgente';
  if (p === '2') return 'P2 — Esta semana';
  if (p === '3') return 'P3 — Próximo ciclo';
  return priority ? `P${p}` : 'Sin prioridad';
}

export function getStatusColor(status: string): string {
  const statusLower = status.toLowerCase();
  if (statusLower === 'active' || statusLower === 'completed' || statusLower === 'paid') {
    return 'text-green-700 bg-green-50 border-green-200';
  }
  if (statusLower === 'pending' || statusLower === 'outstanding') {
    return 'text-blue-700 bg-blue-50 border-blue-200';
  }
  if (statusLower === 'overdue' || statusLower === 'error' || statusLower === 'cancelled') {
    return 'text-red-700 bg-red-50 border-red-200';
  }
  if (statusLower === 'syncing' || statusLower === 'planning') {
    return 'text-yellow-700 bg-yellow-50 border-yellow-200';
  }
  return 'text-gray-700 bg-gray-50 border-gray-200';
}

export function calculateTrend(current: number, previous: number): number {
  if (previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

/** Semaphore: 'green' | 'yellow' | 'red' based on value vs thresholds */
export function semaphore(
  value: number,
  greenThreshold: number,
  yellowThreshold: number,
  invert = false
): 'green' | 'yellow' | 'red' {
  if (invert) {
    if (value <= greenThreshold) return 'green';
    if (value <= yellowThreshold) return 'yellow';
    return 'red';
  }
  if (value >= greenThreshold) return 'green';
  if (value >= yellowThreshold) return 'yellow';
  return 'red';
}

export const SEMAPHORE_COLORS = {
  green: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-300', dot: 'bg-emerald-500' },
  yellow: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', dot: 'bg-amber-500' },
  red: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500' },
};

/** ARA corporate palette */
export const ARA_COLORS = {
  primary: '#1A4A28',
  primaryLight: '#2D6A3F',
  gold: '#C9A84C',
  red: '#DC2626',
  orange: '#F59E0B',
  blue: '#3B82F6',
  gray: '#6B7280',
  lightGray: '#F3F4F6',
};
