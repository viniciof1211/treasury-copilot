/**
 * AI Code Mapping Module
 * Correlates vendor codes to internal codes using description similarity,
 * attribute matching, and AI embeddings.
 */

const AGENT_BASE = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000';

// ── Types ──────────────────────────────────────────────────────────────────
export interface CodeMapping {
  id?: string;
  codigo_interno: string;
  codigo_proveedor: string;
  proveedor: string;
  descripcion_interna: string;
  descripcion_proveedor: string;
  similarity_score: number;
  match_method: 'exact' | 'fuzzy' | 'ai_embedding' | 'manual';
  confirmed: boolean;
  confirmed_by?: string;
  confirmed_at?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface MappingCandidate {
  codigo_interno: string;
  descripcion_interna: string;
  similarity_score: number;
  match_method: string;
  reasons: string[];
}

// ── Local fuzzy matching utilities ─────────────────────────────────────────

/**
 * Normalize a string for comparison: lowercase, remove accents, trim, collapse spaces.
 */
function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract meaningful tokens from a description, filtering out stop words.
 */
function tokenize(s: string): string[] {
  const stopWords = new Set([
    'de', 'la', 'el', 'en', 'un', 'una', 'los', 'las', 'del', 'al', 'con',
    'por', 'para', 'que', 'se', 'es', 'no', 'si', 'su', 'a', 'o', 'y',
    'the', 'of', 'and', 'in', 'for', 'to', 'is', 'on', 'at', 'an', 'or',
    'mm', 'cm', 'kg', 'gr', 'lt', 'ml', 'mt', 'pcs', 'und', 'unid',
  ]);
  return normalize(s).split(' ').filter(t => t.length > 1 && !stopWords.has(t));
}

/**
 * Jaccard similarity between two token sets.
 */
function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Levenshtein distance between two strings (for short code matching).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

/**
 * Code similarity: normalized edit distance between two product codes.
 */
function codeSimilarity(a: string, b: string): number {
  const na = normalize(a).replace(/\s/g, '');
  const nb = normalize(b).replace(/\s/g, '');
  if (na === nb) return 1;
  if (!na || !nb) return 0;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

// ── Main matching function (client-side) ───────────────────────────────────

/**
 * Find the best internal code matches for a vendor item.
 * Uses a multi-signal approach: exact code match, fuzzy code, description similarity.
 */
export function findMatches(
  vendorCode: string,
  vendorDescription: string,
  internalItems: Array<{ codigo: string; descripcion: string; proveedor?: string; familia?: string }>,
  topN = 5,
): MappingCandidate[] {
  const vendorTokens = tokenize(vendorDescription);
  const vendorCodeNorm = normalize(vendorCode).replace(/\s/g, '');

  const scored = internalItems.map(item => {
    const reasons: string[] = [];
    let score = 0;

    // Signal 1: Exact code match (highest weight)
    const internalCodeNorm = normalize(item.codigo).replace(/\s/g, '');
    if (internalCodeNorm === vendorCodeNorm) {
      score += 0.5;
      reasons.push('Código exacto');
    } else {
      const cs = codeSimilarity(vendorCode, item.codigo);
      if (cs > 0.7) {
        score += cs * 0.3;
        reasons.push(`Código similar (${(cs * 100).toFixed(0)}%)`);
      }
    }

    // Signal 2: Description token similarity (Jaccard)
    const itemTokens = tokenize(item.descripcion);
    const descSim = jaccardSimilarity(vendorTokens, itemTokens);
    if (descSim > 0.1) {
      score += descSim * 0.4;
      reasons.push(`Descripción similar (${(descSim * 100).toFixed(0)}%)`);
    }

    // Signal 3: Substring containment
    const vendorDescNorm = normalize(vendorDescription);
    const itemDescNorm = normalize(item.descripcion);
    if (vendorDescNorm.includes(itemDescNorm) || itemDescNorm.includes(vendorDescNorm)) {
      score += 0.15;
      reasons.push('Descripción contenida');
    }

    // Signal 4: Shared numeric patterns (dimensions, sizes)
    const vendorNums = vendorDescNorm.match(/\d+(\.\d+)?/g) || [];
    const itemNums = itemDescNorm.match(/\d+(\.\d+)?/g) || [];
    const sharedNums = vendorNums.filter(n => itemNums.includes(n));
    if (sharedNums.length > 0 && vendorNums.length > 0) {
      const numScore = sharedNums.length / Math.max(vendorNums.length, itemNums.length);
      score += numScore * 0.1;
      reasons.push(`${sharedNums.length} valores numéricos coinciden`);
    }

    return {
      codigo_interno: item.codigo,
      descripcion_interna: item.descripcion,
      similarity_score: Math.min(score, 1),
      match_method: score >= 0.5 ? 'exact' as const : 'fuzzy' as const,
      reasons,
    };
  });

  return scored
    .filter(s => s.similarity_score > 0.05)
    .sort((a, b) => b.similarity_score - a.similarity_score)
    .slice(0, topN);
}

// ── Backend API calls ──────────────────────────────────────────────────────

/**
 * Run AI-powered code mapping via backend (uses embeddings for better matching).
 */
export async function aiCodeMapping(params: {
  vendor_items: Array<{ codigo: string; descripcion: string; proveedor: string }>;
  match_threshold?: number;
}): Promise<{ mappings: CodeMapping[]; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/code-mapping/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (e) {
    return { mappings: [], error: String(e) };
  }
}

/**
 * Save confirmed code mappings to the database.
 */
export async function saveCodeMappings(mappings: CodeMapping[]): Promise<{ saved: number; error?: string }> {
  try {
    const res = await fetch(`${AGENT_BASE}/code-mapping/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings }),
    });
    return await res.json();
  } catch (e) {
    return { saved: 0, error: String(e) };
  }
}

/**
 * Get existing code mappings from the database.
 */
export async function getCodeMappings(params?: {
  proveedor?: string;
  confirmed_only?: boolean;
}): Promise<{ mappings: CodeMapping[]; error?: string }> {
  try {
    const qs = new URLSearchParams();
    if (params?.proveedor) qs.set('proveedor', params.proveedor);
    if (params?.confirmed_only) qs.set('confirmed', 'true');
    const res = await fetch(`${AGENT_BASE}/code-mapping/list?${qs.toString()}`);
    return await res.json();
  } catch (e) {
    return { mappings: [], error: String(e) };
  }
}
