/**
 * Staff actions on one report (LS-19; US-08, RC-03, RC-06). The backend
 * checks that the caller handles the report; nothing here is trusted.
 */
import { apiFetch, apiPatch, apiPut } from '@/lib/api';
import type { ReportCategory } from '@/report/tracking';

export type CategoryOption = { id: string; name: string };

export type DuplicateReviewState = 'pending' | 'confirmed_duplicate' | 'not_duplicate';

export type DuplicateSignals = {
  rule?: string;
  same_location?: boolean;
  same_category?: boolean | null;
  hours_apart?: number;
  text_similarity?: number;
};

export type DuplicateCandidate = {
  id: string;
  other_report: {
    id: string;
    reference_code: string;
    status: string;
    location_name: string;
    created_at: string;
  };
  signals: DuplicateSignals;
  review_state: DuplicateReviewState;
  reviewed_at: string | null;
};

export function fetchCategories(): Promise<CategoryOption[]> {
  return apiFetch<CategoryOption[]>('/categories');
}

/** Record the category as a staff decision. The AI suggestion is kept apart. */
export function setCategory(reportId: string, categoryId: string): Promise<ReportCategory> {
  return apiPut<ReportCategory>(`/reports/${encodeURIComponent(reportId)}/category`, {
    category_id: categoryId,
  });
}

export function fetchDuplicates(reportId: string): Promise<DuplicateCandidate[]> {
  return apiFetch<DuplicateCandidate[]>(`/reports/${encodeURIComponent(reportId)}/duplicates`);
}

/** Record a staff decision on a possible duplicate. No report is merged or closed. */
export function reviewDuplicate(
  reportId: string,
  candidateId: string,
  reviewState: DuplicateReviewState,
): Promise<DuplicateCandidate> {
  return apiPatch<DuplicateCandidate>(
    `/reports/${encodeURIComponent(reportId)}/duplicates/${encodeURIComponent(candidateId)}`,
    { review_state: reviewState },
  );
}

/** Why two reports were paired, in plain words. */
export function duplicateReasons(signals: DuplicateSignals): string[] {
  const reasons: string[] = [];
  if (signals.same_location) reasons.push('Same location');
  if (signals.same_category) reasons.push('Same category');
  if (typeof signals.hours_apart === 'number') {
    const hours = signals.hours_apart;
    reasons.push(hours < 1 ? 'Less than an hour apart' : `About ${Math.round(hours)} h apart`);
  }
  if (typeof signals.text_similarity === 'number' && signals.text_similarity > 0) {
    reasons.push(`Similar wording (${Math.round(signals.text_similarity * 100)}%)`);
  }
  return reasons;
}

const STATE_LABEL: Record<DuplicateReviewState, string> = {
  pending: '? Not reviewed yet',
  confirmed_duplicate: '= Marked as a duplicate',
  not_duplicate: '≠ Marked as not a duplicate',
};

export function duplicateStateLabel(state: DuplicateReviewState): string {
  return STATE_LABEL[state];
}
