/** Reading a student's own reports back from the server (LS-10; US-03). */
import { apiFetch } from '@/lib/api';
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

export type ReportDetails = ReportSummary & {
  note: string | null;
  media_id: string | null;
  history: StatusChange[];
};

export function fetchMyReports(): Promise<ReportSummary[]> {
  return apiFetch<ReportSummary[]>('/reports/mine');
}

export function fetchReport(id: string): Promise<ReportDetails> {
  return apiFetch<ReportDetails>(`/reports/${encodeURIComponent(id)}`);
}

/** A short-lived link to the report's photo (LS-08). */
export async function fetchPhotoUrl(mediaId: string): Promise<string> {
  const { url } = await apiFetch<{ url: string; expires_in: number }>(
    `/media/${encodeURIComponent(mediaId)}/url`,
  );
  return url;
}
