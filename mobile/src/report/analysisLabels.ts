/**
 * Words for AI analysis results (LS-14; RC-02, RC-07, RC-11). Every state has
 * a text label and a symbol, so nothing depends on color alone.
 */
import type { Analysis } from '@/report/tracking';

type Priority = NonNullable<Analysis['priority']>;

const PRIORITY: Record<Priority, { symbol: string; label: string }> = {
  high: { symbol: '▲', label: 'High' },
  medium: { symbol: '■', label: 'Medium' },
  low: { symbol: '▼', label: 'Low' },
};

export function priorityLabel(priority: Priority): { symbol: string; text: string } {
  const { symbol, label } = PRIORITY[priority];
  return { symbol, text: `${label} priority (suggested)` };
}

const FAILURE_REASON: Record<string, string> = {
  timeout: 'The AI service took too long to answer.',
  unavailable: 'The AI service was unavailable.',
  rate_limited: 'The AI service was busy.',
  not_authorized: 'The AI service is not set up correctly.',
  rejected: 'The AI service rejected the request.',
  declined: 'The AI service declined to analyze this report.',
  invalid_response: 'The AI gave an answer that could not be used.',
  unsupported_category: 'The AI suggested a category that is not in use.',
  unsupported_image: 'The photo could not be read.',
  photo_missing: 'The report has no photo to analyze.',
  photo_unavailable: 'The photo could not be loaded for analysis.',
};

export function failureReason(code: string | null): string {
  return (code && FAILURE_REASON[code]) || 'The analysis failed.';
}

export function confidenceLabel(confidence: number): string {
  return `AI confidence: ${Math.round(confidence * 100)}%`;
}
