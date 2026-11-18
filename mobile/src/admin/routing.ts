/**
 * Routing configuration for administrators (LS-16; US-11, RC-04, RC-05).
 * The backend allows these calls for administrators only.
 */
import { apiFetch, apiPatch, apiPost } from '@/lib/api';

export type NamedRef = { id: string; name: string };

export type Team = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  member_count: number;
};

export type RoutingRule = {
  id: string;
  category: NamedRef;
  /** Null: the rule applies at every location. */
  location: NamedRef | null;
  team: NamedRef;
  is_active: boolean;
  updated_at: string;
};

export type Category = { id: string; name: string; description: string | null };
export type Location = { id: string; name: string; location_type: string };

export type RoutingConfig = {
  rules: RoutingRule[];
  teams: Team[];
  categories: Category[];
  locations: Location[];
};

export async function fetchRoutingConfig(): Promise<RoutingConfig> {
  const [rules, teams, categories, locations] = await Promise.all([
    apiFetch<RoutingRule[]>('/admin/routing-rules'),
    apiFetch<Team[]>('/admin/teams'),
    apiFetch<Category[]>('/categories'),
    apiFetch<Location[]>('/locations'),
  ]);
  return { rules, teams, categories, locations };
}

export function createRule(rule: {
  category_id: string;
  location_id: string | null;
  team_id: string;
}): Promise<RoutingRule> {
  return apiPost<RoutingRule>('/admin/routing-rules', rule);
}

export function updateRule(
  id: string,
  changes: { team_id?: string; is_active?: boolean },
): Promise<RoutingRule> {
  return apiPatch<RoutingRule>(`/admin/routing-rules/${encodeURIComponent(id)}`, changes);
}

export function createTeam(name: string): Promise<Team> {
  return apiPost<Team>('/admin/teams', { name });
}

export function updateTeam(id: string, changes: { is_active?: boolean }): Promise<Team> {
  return apiPatch<Team>(`/admin/teams/${encodeURIComponent(id)}`, changes);
}

/** Example configuration seeded from the SDD is named "(example, unverified)" (OQ-01). */
export function isUnverifiedExample(name: string): boolean {
  return name.includes('(example, unverified)');
}
