import { formatDateTime, statusDescription, statusLabel } from '@/report/status';

describe('status wording', () => {
  it('names every SDD 6.4 status in words', () => {
    expect(
      ['submitted', 'assigned', 'in_progress', 'resolved', 'reopened', 'closed'].map(statusLabel),
    ).toEqual(['Submitted', 'Assigned', 'In progress', 'Resolved', 'Reopened', 'Closed']);
  });

  it('explains each status', () => {
    expect(statusDescription('submitted')).toBe('Your report has been received.');
    expect(statusDescription('in_progress')).toMatch(/working on the issue/);
  });

  it('shows an unknown status as-is rather than hiding it', () => {
    expect(statusLabel('escalated')).toBe('escalated');
    expect(statusDescription('escalated')).toBe('');
  });

  it('formats dates, and never shows "Invalid Date"', () => {
    expect(formatDateTime('2026-11-17T17:44:00Z')).toMatch(/2026/);
    expect(formatDateTime('not a date')).toBe('');
  });
});
