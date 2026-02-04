import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(date));
}

export function formatPercent(value: number): string {
  return new Intl.NumberFormat('en-US', {
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

export function getPriorityColor(priority: number): string {
  if (priority === 1) return 'text-red-600 bg-red-50';
  if (priority === 2) return 'text-orange-600 bg-orange-50';
  if (priority === 3) return 'text-yellow-600 bg-yellow-50';
  return 'text-gray-600 bg-gray-50';
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
