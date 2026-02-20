/**
 * TICA / Aduanas Integration Module
 * Connects to https://ticaconsultas.hacienda.go.cr for DUA/CIF conciliation
 * and partidas arancelarias lookup.
 */

const AGENT_BASE = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000';

// ── Types ──────────────────────────────────────────────────────────────────
export interface TICADUAResult {
  dua_number: string;
  fecha: string;
  importador: string;
  aduana: string;
  regimen: string;
  estado: string;
  valor_cif: number;
  valor_fob: number;
  flete: number;
  seguro: number;
  dai_total: number;
  iva_total: number;
  total_impuestos: number;
  lineas: TICALineItem[];
}

export interface TICALineItem {
  partida_arancelaria: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
  peso_kg: number;
  valor_fob: number;
  valor_cif: number;
  dai_pct: number;
  dai_monto: number;
  iva_pct: number;
  iva_monto: number;
  pais_origen: string;
}

export interface PartidaArancelaria {
  codigo: string;
  descripcion: string;
  dai_pct: number;
  iva_pct: number;
  notas: string;
  tlc_aplicable: string[];
}

// ── API Calls (via backend proxy) ──────────────────────────────────────────

/**
 * Search DUAs by importer ID (cédula jurídica) and date range.
 */
export async function searchDUAs(params: {
  cedula: string;
  fecha_inicio?: string;
  fecha_fin?: string;
  aduana?: string;
}): Promise<{ duas: TICADUAResult[]; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/tica/duas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (e) {
    return { duas: [], error: String(e) };
  }
}

/**
 * Lookup a specific partida arancelaria.
 */
export async function lookupPartida(codigo: string): Promise<{ partida?: PartidaArancelaria; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/tica/partida?codigo=${encodeURIComponent(codigo)}`);
    return await res.json();
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Conciliate DUA line items against internal purchase orders.
 * Returns matched and unmatched items.
 */
export async function conciliateDUA(params: {
  dua_number: string;
  internal_items: Array<{ codigo: string; descripcion: string; cantidad: number; valor: number }>;
}): Promise<{
  matched: Array<{ dua_line: TICALineItem; internal_codigo: string; match_confidence: number }>;
  unmatched_dua: TICALineItem[];
  unmatched_internal: Array<{ codigo: string; descripcion: string }>;
  error?: string;
}> {
  try {
    const res = await fetch(`${AGENT_BASE}/tica/conciliate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (e) {
    return { matched: [], unmatched_dua: [], unmatched_internal: [], error: String(e) };
  }
}

/**
 * Get TICA service health/status.
 */
export async function ticaHealth(): Promise<{ status: string; api_url: string; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/tica/health`);
    return await res.json();
  } catch (e) {
    return { status: 'error', api_url: '', error: String(e) };
  }
}
