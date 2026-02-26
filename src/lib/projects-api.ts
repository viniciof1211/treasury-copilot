// ---------------------------------------------------------------------------
// Projects & Contracts BI — API client
// ---------------------------------------------------------------------------
import type {
  ProjectKPIs, ProjectPortfolio, Contract, MilestoneAlert,
  GanttItem, AreaBreakdown, CollectionRecord, WeeklyForecast, AgingSummary,
} from '../types/projects';

const API = import.meta.env.VITE_AGENT_URL || 'http://localhost:8000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

export async function fetchProjectKPIs(): Promise<ProjectKPIs> {
  return get<ProjectKPIs>('/projects/kpis');
}

export async function fetchPortfolio(): Promise<ProjectPortfolio[]> {
  const data = await get<{ projects: ProjectPortfolio[] }>('/projects/portfolio');
  return data.projects;
}

export async function fetchContracts(filters?: {
  area?: string; empresa?: string; cliente?: string;
}): Promise<{ contracts: Contract[]; total: number }> {
  const params = new URLSearchParams();
  if (filters?.area) params.set('area', filters.area);
  if (filters?.empresa) params.set('empresa', filters.empresa);
  if (filters?.cliente) params.set('cliente', filters.cliente);
  const qs = params.toString();
  return get(`/projects/contracts${qs ? `?${qs}` : ''}`);
}

export async function fetchAlerts(): Promise<MilestoneAlert[]> {
  const data = await get<{ alerts: MilestoneAlert[] }>('/projects/alerts');
  return data.alerts;
}

export async function fetchGantt(client?: string): Promise<GanttItem[]> {
  const qs = client ? `?client=${encodeURIComponent(client)}` : '';
  const data = await get<{ items: GanttItem[] }>(`/projects/gantt${qs}`);
  return data.items;
}

export async function fetchAreaBreakdown(): Promise<AreaBreakdown[]> {
  const data = await get<{ areas: AreaBreakdown[] }>('/projects/areas');
  return data.areas;
}

export async function fetchCollections(cliente?: string): Promise<CollectionRecord[]> {
  const qs = cliente ? `?cliente=${encodeURIComponent(cliente)}` : '';
  const data = await get<{ collections: CollectionRecord[]; total: number }>(`/projects/collections${qs}`);
  return data.collections;
}

export async function fetchForecast(): Promise<WeeklyForecast[]> {
  const data = await get<{ forecast: WeeklyForecast[] }>('/projects/forecast');
  return data.forecast;
}

export async function fetchAging(detail = false): Promise<{ summary: AgingSummary; records?: unknown[] }> {
  return get(`/projects/aging?detail=${detail}`);
}

export async function saveCuration(contractId: string, changes: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API}/projects/curation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract_id: contractId, changes }),
  });
  if (!res.ok) throw new Error(`Curation save failed: ${res.status}`);
  return res.json();
}
