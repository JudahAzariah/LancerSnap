/**
 * Manual review (LS-17; RC-02, RC-03, RC-10). For administrators and staff on
 * the manual-review team; the backend enforces who may see and act.
 */
import { apiFetch, apiPost } from '@/lib/api';

export type ReviewReason =
  | 'ai_failed'
  | 'ai_unavailable'
  | 'uncertain'
  | 'no_category'
  | 'no_matching_rule';

export type ReviewItem = {
  id: string;
  reference_code: string;
  status: string;
  location_name: string;
  note: string | null;
  created_at: string;
  review_reason: ReviewReason;
  team_name: string | null;
  ai: {
    processing_status: 'pending' | 'succeeded' | 'failed';
    category: string | null;
    uncertainty_reason: string | null;
    error: string | null;
  } | null;
};

export type Option = { id: string; name: string };

const REASONS: Record<ReviewReason, string> = {
  ai_failed: 'The AI analysis failed.',
  ai_unavailable: 'There is no AI analysis for this report.',
  uncertain: 'The AI was not sure about this report.',
  no_category: 'The AI suggested no category.',
  no_matching_rule: 'No routing rule matches the suggested category.',
};

export function reviewReasonText(reason: string): string {
  return REASONS[reason as ReviewReason] ?? 'It needs a person to review it.';
}

export async function fetchReviewQueue(): Promise<{
  items: ReviewItem[];
  categories: Option[];
  teams: Option[];
}> {
  const [items, categories, teams] = await Promise.all([
    apiFetch<ReviewItem[]>('/review-queue'),
    apiFetch<Option[]>('/categories'),
    apiFetch<Option[]>('/teams'),
  ]);
  return { items, categories, teams };
}

export function routeReport(reportId: string, categoryId: string, teamId: string): Promise<unknown> {
  return apiPost(`/reports/${encodeURIComponent(reportId)}/route`, {
    category_id: categoryId,
    team_id: teamId,
  });
}

/** Send a report for AI analysis again (LS-11). */
export function retryAnalysis(reportId: string): Promise<unknown> {
  return apiPost(`/reports/${encodeURIComponent(reportId)}/analysis`, {});
}
