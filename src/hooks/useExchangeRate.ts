/**
 * useExchangeRate — fetches BCCR USD/CRC exchange rate.
 *
 * - On mount, checks localStorage cache (valid 2 hours).
 * - If stale / missing, calls the treasury-tools edge function `get_cr_indicators`.
 * - Returns { rate, loading, date, error }.
 * - `rate` is "tipo de cambio venta" (sell), used to convert CRC → USD:
 *     USD = CRC / rate
 * - Falls back to a sensible default (520) if fetch fails.
 */
import { useState, useEffect } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const CACHE_KEY = 'bccr_exchange_rate';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours
const FALLBACK_RATE = 520; // reasonable CRC/USD fallback

export interface ExchangeRateResult {
  /** CRC per 1 USD (venta) */
  rate: number;
  /** CRC per 1 USD (compra) */
  rateCompra: number;
  loading: boolean;
  date: string;
  error: string | null;
}

interface CachedRate {
  rate: number;
  rateCompra: number;
  date: string;
  ts: number;
}

function loadCache(): CachedRate | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c: CachedRate = JSON.parse(raw);
    if (Date.now() - c.ts < CACHE_TTL && c.rate > 0) return c;
  } catch { /* ignore */ }
  return null;
}

function saveCache(rate: number, rateCompra: number, date: string) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rate, rateCompra, date, ts: Date.now() }));
  } catch { /* ignore */ }
}

export function useExchangeRate(): ExchangeRateResult {
  const [rate, setRate] = useState(FALLBACK_RATE);
  const [rateCompra, setRateCompra] = useState(FALLBACK_RATE);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetch_rate() {
      // 1. Try cache
      const cached = loadCache();
      if (cached) {
        setRate(cached.rate);
        setRateCompra(cached.rateCompra);
        setDate(cached.date);
        setLoading(false);
        return;
      }

      // 2. Fetch from BCCR via edge function
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/treasury-tools`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ tool: 'get_cr_indicators', params: { indicator: 'tipo_cambio' } }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Edge function returns: { compra: { valor, fecha }, venta: { valor, fecha } }
        const venta = Number(data?.venta?.valor) || Number(data?.result?.venta?.valor) || 0;
        const compra = Number(data?.compra?.valor) || Number(data?.result?.compra?.valor) || 0;
        const fechaStr = data?.venta?.fecha || data?.result?.venta?.fecha || new Date().toISOString().slice(0, 10);

        if (!cancelled) {
          const finalRate = venta > 0 ? venta : FALLBACK_RATE;
          const finalCompra = compra > 0 ? compra : FALLBACK_RATE;
          setRate(finalRate);
          setRateCompra(finalCompra);
          setDate(fechaStr);
          saveCache(finalRate, finalCompra, fechaStr);
        }
      } catch (e) {
        console.warn('[useExchangeRate] BCCR fetch failed, using fallback', e);
        if (!cancelled) {
          setError(String(e));
          setRate(FALLBACK_RATE);
          setRateCompra(FALLBACK_RATE);
          setDate('fallback');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch_rate();
    return () => { cancelled = true; };
  }, []);

  return { rate, rateCompra, loading, date, error };
}

// ── Currency conversion helpers ───────────────────────────────────────────────

/** Convert an amount to USD given its currency code and the CRC/USD rate */
export function toUSD(amount: number, moneda: string, crcPerUsd: number): number {
  const cur = normalizeCurrency(moneda);
  if (cur === 'USD') return amount;
  if (cur === 'CRC') return crcPerUsd > 0 ? amount / crcPerUsd : amount;
  // EUR — approximate at 1.08
  if (cur === 'EUR') return amount * 1.08;
  return amount; // unknown → assume USD
}

/** Convert an amount from USD to a target currency */
export function fromUSD(amountUSD: number, targetCurrency: string, crcPerUsd: number): number {
  const cur = normalizeCurrency(targetCurrency);
  if (cur === 'USD') return amountUSD;
  if (cur === 'CRC') return amountUSD * crcPerUsd;
  if (cur === 'EUR') return amountUSD / 1.08;
  return amountUSD;
}

/** Normalize currency strings like "Dolares", "COLONES", "USD", etc. */
export function normalizeCurrency(moneda: string | null | undefined): string {
  if (!moneda) return 'USD';
  const m = moneda.trim().toUpperCase();
  if (m === 'USD' || m.includes('DOL') || m.includes('US')) return 'USD';
  if (m === 'CRC' || m.includes('COL') || m.includes('CRC') || m === '₡') return 'CRC';
  if (m === 'EUR' || m.includes('EUR')) return 'EUR';
  return 'USD'; // default
}

/** Get currency symbol */
export function currencySymbol(moneda: string): string {
  const cur = normalizeCurrency(moneda);
  if (cur === 'USD') return '$';
  if (cur === 'CRC') return '₡';
  if (cur === 'EUR') return '€';
  return '$';
}

// ── Multi-currency formatting ─────────────────────────────────────────────────

/** Format amount in a specific currency using Intl */
export function fmtCur(amount: number, currency: string = 'USD'): string {
  const cur = normalizeCurrency(currency);
  return new Intl.NumberFormat(cur === 'CRC' ? 'es-CR' : 'en-US', {
    style: 'currency',
    currency: cur,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Compact format (e.g. $1.5M, ₡500K) in any currency */
export function fmtCompact(amount: number, currency: string = 'USD'): string {
  const sym = currencySymbol(currency);
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${sym}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${sym}${abs.toFixed(0)}`;
}
