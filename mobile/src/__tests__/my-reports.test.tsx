import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import MyReportsScreen from '@/app/(app)/my-reports';
import { fetchMyReports, type ReportSummary } from '@/report/tracking';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn() },
    // Run the focus effect once, as when the screen first comes into view.
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/report/tracking', () => ({ fetchMyReports: jest.fn() }));

const fetchMine = jest.mocked(fetchMyReports);

const REPORTS: ReportSummary[] = [
  {
    id: 'r-2',
    reference_code: 'RPT-000002',
    status: 'in_progress',
    location: { id: 'l-1', name: 'Dining Commons', location_type: 'building' },
    created_at: '2026-11-17T18:00:00Z',
    updated_at: '2026-11-17T19:00:00Z',
  },
  {
    id: 'r-1',
    reference_code: 'RPT-000001',
    status: 'submitted',
    location: { id: 'l-2', name: 'Engineering Building', location_type: 'building' },
    created_at: '2026-11-17T17:44:00Z',
    updated_at: '2026-11-17T17:44:00Z',
  },
];

beforeEach(() => jest.clearAllMocks());

describe('My reports', () => {
  it('shows a loading state, then each report with its number, location, date, and status', async () => {
    fetchMine.mockResolvedValue(REPORTS);
    await render(<MyReportsScreen />);

    expect(await screen.findByText('RPT-000002')).toBeOnTheScreen();
    expect(screen.getByText('RPT-000001')).toBeOnTheScreen();
    expect(screen.getByText('Dining Commons')).toBeOnTheScreen();
    expect(screen.getAllByText(/^Submitted .*2026/)).toHaveLength(2);
    // Status in words, not colour alone.
    expect(screen.getByText('In progress')).toBeOnTheScreen();
    expect(screen.getByLabelText('Status: In progress')).toBeOnTheScreen();
    expect(screen.getByText('2 reports. Pull down to refresh.')).toBeOnTheScreen();
  });

  it('opens a report’s details', async () => {
    fetchMine.mockResolvedValue(REPORTS);
    await render(<MyReportsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: /Report RPT-000001/ }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/reports/[id]', params: { id: 'r-1' } });
  });

  it('describes each report fully for screen readers', async () => {
    fetchMine.mockResolvedValue([REPORTS[1]]);
    await render(<MyReportsScreen />);
    const card = await screen.findByRole('button', { name: /Report RPT-000001/ });
    expect(card.props.accessibilityLabel).toMatch(
      /^Report RPT-000001, Engineering Building, submitted .*2026.*, status Submitted$/,
    );
  });

  it('says so when there are no reports, and offers to make one', async () => {
    fetchMine.mockResolvedValue([]);
    await render(<MyReportsScreen />);
    expect(await screen.findByText('No reports yet')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Snap & Report' }));
    expect(router.push).toHaveBeenCalledWith('/report/new');
  });

  it('shows an honest error with a retry', async () => {
    fetchMine.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(REPORTS);
    await render(<MyReportsScreen />);

    expect(await screen.findByText(/could not be loaded/)).toBeOnTheScreen();
    expect(screen.queryByText('No reports yet')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('RPT-000002')).toBeOnTheScreen();
  });
});
