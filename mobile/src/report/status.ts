/**
 * Report status wording (SDD v0.2 section 6.4, RC-12).
 *
 * Status is always shown as words. Colour, where used, only repeats what the
 * words already say (RC-11).
 */

export type ReportStatus =
  | 'submitted'
  | 'assigned'
  | 'in_progress'
  | 'resolved'
  | 'reopened'
  | 'closed';

const LABELS: Record<ReportStatus, string> = {
  submitted: 'Submitted',
  assigned: 'Assigned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  reopened: 'Reopened',
  closed: 'Closed',
};

const DESCRIPTIONS: Record<ReportStatus, string> = {
  submitted: 'Your report has been received.',
  assigned: 'Your report has been sent to a campus team.',
  in_progress: 'Campus staff are working on the issue.',
  resolved: 'Campus staff have marked the issue as resolved.',
  reopened: 'The report has been reopened for another review.',
  closed: 'The report is closed.',
};

function isKnown(status: string): status is ReportStatus {
  return status in LABELS;
}

export function statusLabel(status: string): string {
  return isKnown(status) ? LABELS[status] : status;
}

export function statusDescription(status: string): string {
  return isKnown(status) ? DESCRIPTIONS[status] : '';
}

/** "17 Nov 2026, 9:44 AM", in the device's own locale and time zone. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
