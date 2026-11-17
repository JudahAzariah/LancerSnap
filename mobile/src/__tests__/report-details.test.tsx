import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import ReportDetailsScreen from '@/app/(app)/reports/[id]';
import { ApiError } from '@/lib/api';
import { fetchPhotoUrl, fetchReport, type ReportDetails } from '@/report/tracking';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useLocalSearchParams: jest.fn(),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('@/report/tracking', () => ({ fetchReport: jest.fn(), fetchPhotoUrl: jest.fn() }));

const getReport = jest.mocked(fetchReport);
const getPhoto = jest.mocked(fetchPhotoUrl);

const REPORT: ReportDetails = {
  id: 'r-1',
  reference_code: 'RPT-000001',
  status: 'in_progress',
  location: { id: 'l-1', name: 'Engineering Building', location_type: 'building' },
  created_at: '2026-11-17T17:44:00Z',
  updated_at: '2026-11-17T19:00:00Z',
  note: 'Broken charger point, room 301',
  media_id: 'm-1',
  history: [
    { from_status: null, to_status: 'submitted', note: null, created_at: '2026-11-17T17:44:00Z' },
    {
      from_status: 'submitted',
      to_status: 'in_progress',
      note: 'A technician is on the way.',
      created_at: '2026-11-17T19:00:00Z',
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'r-1' });
  getPhoto.mockResolvedValue('https://storage.test/signed/photo.jpg');
});

describe('Report details', () => {
  it('shows the current status in words with an explanation', async () => {
    getReport.mockResolvedValue(REPORT);
    await render(<ReportDetailsScreen />);

    expect(await screen.findByText('RPT-000001')).toBeOnTheScreen();
    expect(getReport).toHaveBeenCalledWith('r-1');
    expect(screen.getByLabelText('Status: In progress')).toBeOnTheScreen();
    expect(screen.getByText('Campus staff are working on the issue.')).toBeOnTheScreen();
  });

  it('shows the location, note, and the photo through a signed link', async () => {
    getReport.mockResolvedValue(REPORT);
    await render(<ReportDetailsScreen />);

    expect(await screen.findByText('Engineering Building (Building)')).toBeOnTheScreen();
    expect(screen.getByText('Broken charger point, room 301')).toBeOnTheScreen();
    const photo = await screen.findByLabelText('The photo submitted with this report');
    expect(photo.props.source).toEqual({ uri: 'https://storage.test/signed/photo.jpg' });
    expect(getPhoto).toHaveBeenCalledWith('m-1');
  });

  it('lists the status history newest first, with staff update notes', async () => {
    getReport.mockResolvedValue(REPORT);
    await render(<ReportDetailsScreen />);
    await screen.findByText('Status history');

    const entries = screen.getAllByText(/^(Submitted|In progress)$/).map((node) => node.props.children);
    // The badge shows "In progress" first, then the history: newest, oldest.
    expect(entries).toEqual(['In progress', 'In progress', 'Submitted']);
    expect(screen.getByText('A technician is on the way.')).toBeOnTheScreen();
  });

  it('keeps the report visible when only the photo fails, and offers a retry', async () => {
    getReport.mockResolvedValue(REPORT);
    getPhoto.mockRejectedValueOnce(new Error('expired')).mockResolvedValueOnce('https://storage.test/b.jpg');
    await render(<ReportDetailsScreen />);

    expect(await screen.findByText('The photo could not be loaded.')).toBeOnTheScreen();
    expect(screen.getByText('RPT-000001')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(
      (await screen.findByLabelText('The photo submitted with this report')).props.source,
    ).toEqual({ uri: 'https://storage.test/b.jpg' });
  });

  it('says plainly when the report is not available to this user', async () => {
    getReport.mockRejectedValue(new ApiError(404, 'Report not found'));
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('This report could not be found.')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows an honest error with a retry when loading fails', async () => {
    getReport.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(REPORT);
    await render(<ReportDetailsScreen />);

    expect(await screen.findByText(/could not be loaded/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('RPT-000001')).toBeOnTheScreen();
  });

  it('handles a report without a note', async () => {
    getReport.mockResolvedValue({ ...REPORT, note: null });
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('No note added.')).toBeOnTheScreen();
  });
});
