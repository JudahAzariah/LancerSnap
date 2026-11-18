/** Reading a student's own reports back from the server (LS-10; US-03). */
import { ApiError, apiFetch } from '@/lib/api';
import type { CampusLocation } from '@/report/locations';

export type ReportSummary = {
  id: string;
  reference_code: string;
  status: string;
  location: CampusLocation;
  created_at: string;
  updated_at: string;
};

export type StatusChange = {
  from_status: string | null;
  to_status: string;
  note: string | null;
  created_at: string;
};

/**
 * The report's category and where it came from (LS-13; US-02). An
 * "ai_suggestion" is not confirmed and must be shown labelled as such.
 */
export type ReportCategory = {
  name: string;
  source: 'staff' | 'ai_suggestion';
  uncertain: boolean;
};

export type ReportDetails = ReportSummary & {
  note: string | null;
  media_id: string | null;
  category: ReportCategory | null;
  history: StatusChange[];
};

export function fetchMyReports(): Promise<ReportSummary[]> {
  return apiFetch<ReportSummary[]>('/reports/mine');
}

export function fetchReport(id: string): Promise<ReportDetails> {
  return apiFetch<ReportDetails>(`/reports/${encodeURIComponent(id)}`);
}

/**
 * The newest AI analysis attempt of a report, for staff and administrators
 * (LS-11 to LS-14). Suggestion fields are filled only when it succeeded.
 */
export type Analysis = {
  id: string;
  processing_status: 'pending' | 'succeeded' | 'failed';
  category: { id: string; name: string } | null;
  summary: string | null;
  details: string[] | null;
  priority: 'low' | 'medium' | 'high' | null;
  potential_safety_hazard: boolean | null;
  confidence: number | null;
  uncertain: boolean;
  uncertainty_reason: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

/** The current analysis, or null if the report has never been analyzed. */
export async function fetchAnalysis(reportId: string): Promise<Analysis | null> {
  try {
    return await apiFetch<Analysis>(`/reports/${encodeURIComponent(reportId)}/analysis`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** A short-lived link to the report's photo (LS-08). */
export async function fetchPhotoUrl(mediaId: string): Promise<string> {
  const { url } = await apiFetch<{ url: string; expires_in: number }>(
    `/media/${encodeURIComponent(mediaId)}/url`,
  );
  return url;
}
