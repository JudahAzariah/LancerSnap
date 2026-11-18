/** Staff report queue (LS-18; US-07, RC-01). Scoped by the backend to the caller's teams. */
import { apiFetch } from '@/lib/api';

export type QueueItem = {
  id: string;
  reference_code: string;
  status: string;
  location_name: string;
  team_name: string | null;
  category: { name: string; source: 'staff' | 'ai_suggestion' } | null;
  priority: 'low' | 'medium' | 'high' | null;
  potential_safety_hazard: boolean;
  ai_uncertain: boolean;
  in_manual_review: boolean;
  created_at: string;
  updated_at: string;
};

export type QueueFilters = {
  status: string | null;
  priority: 'high' | 'medium' | 'low' | 'none' | null;
  hazardsOnly: boolean;
  sort: 'priority' | 'newest' | 'oldest';
};

export const DEFAULT_FILTERS: QueueFilters = {
  status: null,
  priority: null,
  hazardsOnly: false,
  sort: 'priority',
};

export function queuePath(filters: QueueFilters): string {
  const params = new URLSearchParams({ sort: filters.sort });
  if (filters.status) params.append('status', filters.status);
  if (filters.priority) params.append('priority', filters.priority);
  if (filters.hazardsOnly) params.append('hazards_only', 'true');
  return `/staff/queue?${params.toString()}`;
}

export function fetchQueue(filters: QueueFilters): Promise<QueueItem[]> {
  return apiFetch<QueueItem[]>(queuePath(filters));
}
