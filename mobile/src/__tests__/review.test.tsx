import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import ReviewScreen from '@/app/(app)/review';
import { ApiError } from '@/lib/api';
import {
  fetchReviewQueue,
  retryAnalysis,
  type ReviewItem,
  reviewReasonText,
  routeReport,
} from '@/review/review';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('@/review/review', () => ({
  ...jest.requireActual('@/review/review'),
  fetchReviewQueue: jest.fn(),
  routeReport: jest.fn(),
  retryAnalysis: jest.fn(),
}));

const UNCERTAIN: ReviewItem = {
  id: 'r-2',
  reference_code: 'RPT-000002',
  status: 'assigned',
  location_name: 'Engineering Building',
  note: 'broken charger station at 229',
  created_at: '2026-11-18T17:32:39Z',
  review_reason: 'uncertain',
  team_name: 'Manual review (example, unverified)',
  ai: {
    processing_status: 'succeeded',
    category: 'Facilities / maintenance issue',
    uncertainty_reason: 'Could also be an IT problem.',
    error: null,
  },
};

const FAILED: ReviewItem = {
  ...UNCERTAIN,
  id: 'r-9',
  reference_code: 'RPT-000009',
  review_reason: 'ai_failed',
  ai: { processing_status: 'failed', category: null, uncertainty_reason: null, error: 'timeout' },
};

const CATEGORIES = [
  { id: 'c-fac', name: 'Facilities / maintenance issue' },
  { id: 'c-it', name: 'IT / technology problem' },
];
const TEAMS = [
  { id: 't-fac', name: 'Facilities (example, unverified)' },
  { id: 't-it', name: 'IT / Technology Support (example, unverified)' },
];

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(fetchReviewQueue)
    .mockResolvedValue({ items: [UNCERTAIN, FAILED], categories: CATEGORIES, teams: TEAMS });
});

describe('Manual review', () => {
  it('lists each report with the reason it is waiting, in words', async () => {
    await render(<ReviewScreen />);
    expect(await screen.findByText('RPT-000002')).toBeOnTheScreen();
    expect(
      screen.getByText('? Why it is here: The AI was not sure about this report.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('AI suggestion: Facilities / maintenance issue')).toBeOnTheScreen();
    expect(screen.getByText('AI note: Could also be an IT problem.')).toBeOnTheScreen();
    expect(screen.getByText('? Why it is here: The AI analysis failed.')).toBeOnTheScreen();
    expect(screen.getByText('The AI service took too long to answer.')).toBeOnTheScreen();
  });

  it('routes a report with a chosen category and team, starting from the AI suggestion', async () => {
    jest.mocked(routeReport).mockResolvedValue({});
    await render(<ReviewScreen />);
    const [routeFirst] = await screen.findAllByRole('button', { name: 'Route this report' });
    await fireEvent.press(routeFirst);

    // The AI's category is preselected; the reviewer still has to choose a team.
    expect(
      screen.getByRole('radio', { name: 'Facilities / maintenance issue' }),
    ).toBeChecked();
    const confirm = screen.getByRole('button', { name: 'Confirm and route' });
    expect(confirm).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'IT / technology problem' }));
    await fireEvent.press(
      screen.getByRole('radio', { name: 'IT / Technology Support (example, unverified)' }),
    );
    await fireEvent.press(confirm);

    expect(routeReport).toHaveBeenCalledWith('r-2', 'c-it', 't-it');
    expect(await screen.findByText('✓ RPT-000002 was routed.')).toBeOnTheScreen();
    expect(fetchReviewQueue).toHaveBeenCalledTimes(2);
  });

  it('offers to retry the AI only for failed analyses', async () => {
    jest.mocked(retryAnalysis).mockResolvedValue({});
    await render(<ReviewScreen />);
    const retry = await screen.findAllByRole('button', { name: 'Retry AI analysis' });
    expect(retry).toHaveLength(1);
    await fireEvent.press(retry[0]);
    expect(retryAnalysis).toHaveBeenCalledWith('r-9');
    expect(
      await screen.findByText('✓ RPT-000009 was sent for AI analysis again.'),
    ).toBeOnTheScreen();
  });

  it('shows the server’s reason when routing is refused', async () => {
    jest.mocked(routeReport).mockRejectedValue(new ApiError(422, 'Choose an active team.'));
    await render(<ReviewScreen />);
    const [routeFirst] = await screen.findAllByRole('button', { name: 'Route this report' });
    await fireEvent.press(routeFirst);
    await fireEvent.press(
      screen.getByRole('radio', { name: 'Facilities (example, unverified)' }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm and route' }));
    expect(await screen.findByText('✕ Choose an active team.')).toBeOnTheScreen();
  });

  it('opens the full report', async () => {
    await render(<ReviewScreen />);
    const [open] = await screen.findAllByRole('button', { name: 'Open report' });
    await fireEvent.press(open);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/reports/[id]', params: { id: 'r-2' } });
  });

  it('says when nothing is waiting', async () => {
    jest.mocked(fetchReviewQueue).mockResolvedValue({ items: [], categories: [], teams: [] });
    await render(<ReviewScreen />);
    expect(await screen.findByText('✓ Nothing is waiting for review.')).toBeOnTheScreen();
  });

  it('offers a retry when the queue cannot be loaded', async () => {
    jest
      .mocked(fetchReviewQueue)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ items: [], categories: [], teams: [] });
    await render(<ReviewScreen />);
    expect(await screen.findByText('The review queue could not be loaded.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('✓ Nothing is waiting for review.')).toBeOnTheScreen();
  });

  it('words every review reason', () => {
    for (const reason of [
      'ai_failed',
      'ai_unavailable',
      'uncertain',
      'no_category',
      'no_matching_rule',
    ]) {
      expect(reviewReasonText(reason)).not.toBe('It needs a person to review it.');
    }
  });
});
