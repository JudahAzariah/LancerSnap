import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import StaffQueueScreen from '@/app/(app)/staff';
import { DEFAULT_FILTERS, fetchQueue, queuePath, type QueueItem } from '@/staff/queue';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn() },
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('@/staff/queue', () => ({
  ...jest.requireActual('@/staff/queue'),
  fetchQueue: jest.fn(),
}));

const HAZARD: QueueItem = {
  id: 'r-1',
  reference_code: 'RPT-000004',
  status: 'assigned',
  location_name: 'Engineering Building',
  team_name: 'Facilities (example, unverified)',
  category: { name: 'Facilities / maintenance issue', source: 'ai_suggestion' },
  priority: 'high',
  potential_safety_hazard: true,
  ai_uncertain: false,
  in_manual_review: false,
  created_at: '2026-11-18T19:00:00Z',
  updated_at: '2026-11-18T19:00:00Z',
};

const ROUTINE: QueueItem = {
  ...HAZARD,
  id: 'r-2',
  reference_code: 'RPT-000002',
  status: 'in_progress',
  category: { name: 'IT / technology problem', source: 'staff' },
  priority: 'low',
  potential_safety_hazard: false,
  ai_uncertain: true,
  in_manual_review: true,
};

const getQueue = jest.mocked(fetchQueue);

beforeEach(() => {
  jest.clearAllMocks();
  getQueue.mockResolvedValue([HAZARD, ROUTINE]);
});

describe('Staff queue', () => {
  it('lists each report with status, priority, category, location, and time', async () => {
    await render(<StaffQueueScreen />);
    expect(await screen.findByText('2 reports')).toBeOnTheScreen();
    expect(screen.getByText('RPT-000004')).toBeOnTheScreen();
    expect(screen.getByText('▲ High priority (suggested)')).toBeOnTheScreen();
    expect(
      screen.getByText('Category: Facilities / maintenance issue (AI suggestion)'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Category: IT / technology problem (confirmed)')).toBeOnTheScreen();
    expect(screen.getByText('? AI was not sure')).toBeOnTheScreen();
    expect(screen.getByText('★ Waiting in manual review')).toBeOnTheScreen();
    expect(screen.getAllByText(/Engineering Building · Facilities/)).toHaveLength(2);
    expect(screen.getAllByText(/^Submitted /)).toHaveLength(2);
  });

  it('marks safety hazards in words, not color alone', async () => {
    await render(<StaffQueueScreen />);
    expect(await screen.findByText('⚠ Potential safety hazard')).toBeOnTheScreen();
    expect(screen.getAllByText('⚠ Potential safety hazard')).toHaveLength(1);
    const card = screen.getByRole('button', { name: /RPT-000004/ });
    expect(card.props.accessibilityLabel).toContain('potential safety hazard');
    expect(card.props.accessibilityLabel).toContain('High priority (suggested)');
  });

  it('opens the report details', async () => {
    await render(<StaffQueueScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /RPT-000002/ }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/reports/[id]', params: { id: 'r-2' } });
  });

  it('filters and sorts through the server', async () => {
    await render(<StaffQueueScreen />);
    await screen.findByText('2 reports');
    expect(getQueue).toHaveBeenLastCalledWith(DEFAULT_FILTERS);

    await fireEvent.press(screen.getByRole('radio', { name: 'In progress' }));
    await screen.findByText('2 reports');
    expect(getQueue).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, status: 'in_progress' });

    await fireEvent.press(screen.getByRole('radio', { name: 'High' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Only potential safety hazards' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Newest' }));
    await screen.findByText('2 reports');
    expect(getQueue).toHaveBeenLastCalledWith({
      status: 'in_progress',
      priority: 'high',
      hazardsOnly: true,
      sort: 'newest',
    });
  });

  it('loads once when the screen opens', async () => {
    await render(<StaffQueueScreen />);
    await screen.findByText('2 reports');
    expect(getQueue).toHaveBeenCalledTimes(1);
  });

  it('builds the queue request from the filters', () => {
    expect(queuePath(DEFAULT_FILTERS)).toBe('/staff/queue?sort=priority');
    expect(
      queuePath({ status: 'resolved', priority: 'none', hazardsOnly: true, sort: 'oldest' }),
    ).toBe('/staff/queue?sort=oldest&status=resolved&priority=none&hazards_only=true');
  });

  it('explains an empty queue, and an empty filter result', async () => {
    getQueue.mockResolvedValue([]);
    await render(<StaffQueueScreen />);
    expect(await screen.findByText(/No reports in your team queues/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'Resolved' }));
    expect(await screen.findByText('No reports match these filters.')).toBeOnTheScreen();
  });

  it('offers a retry when the queue cannot be loaded', async () => {
    getQueue.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([HAZARD]);
    await render(<StaffQueueScreen />);
    expect(await screen.findByText(/The queue could not be loaded/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 report')).toBeOnTheScreen();
  });
});
