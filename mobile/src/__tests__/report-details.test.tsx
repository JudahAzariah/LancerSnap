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
  category: null,
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

  it('labels an AI-suggested category as an AI suggestion, not a fact', async () => {
    getReport.mockResolvedValue({
      ...REPORT,
      category: { name: 'Facilities / maintenance issue', source: 'ai_suggestion', uncertain: false },
    });
    await render(<ReportDetailsScreen />);

    expect(await screen.findByText('AI suggestion')).toBeOnTheScreen();
    expect(screen.getByText('Facilities / maintenance issue')).toBeOnTheScreen();
    expect(screen.getByText('Campus staff will confirm or change it.')).toBeOnTheScreen();
    expect(
      screen.getByLabelText(
        'Category: Facilities / maintenance issue. AI suggestion. Campus staff will confirm or change it.',
      ),
    ).toBeOnTheScreen();
  });

  it('renders the suggestion from the server response exactly as sent', async () => {
    // Shape captured from GET /reports/{id} for a real analyzed report.
    const fromServer = JSON.parse(
      '{"id": "574dd433", "reference_code": "RPT-000002", "status": "submitted",' +
        ' "location": {"id": "l", "name": "Engineering Building", "location_type": "building"},' +
        ' "created_at": "2026-11-18T17:32:39.282875Z", "updated_at": "2026-11-18T17:32:39.282875Z",' +
        ' "note": "broken charger station at 229", "media_id": "m",' +
        ' "category": {"name": "Facilities / maintenance issue", "source": "ai_suggestion", "uncertain": true},' +
        ' "history": [{"from_status": null, "to_status": "submitted", "note": null,' +
        ' "created_at": "2026-11-18T17:32:39.282875Z"}]}',
    ) as ReportDetails;
    getReport.mockResolvedValue(fromServer);
    await render(<ReportDetailsScreen />);

    expect(await screen.findByText('AI suggestion')).toBeOnTheScreen();
    expect(screen.getByText('Facilities / maintenance issue')).toBeOnTheScreen();
    expect(
      screen.getByText('The AI was not sure about this. Campus staff will confirm or change it.'),
    ).toBeOnTheScreen();
  });

  it('shows the category before the photo, near the top of the screen', async () => {
    getReport.mockResolvedValue({
      ...REPORT,
      category: { name: 'Facilities / maintenance issue', source: 'ai_suggestion', uncertain: true },
    });
    await render(<ReportDetailsScreen />);
    await screen.findByText('AI suggestion');

    const labels = screen
      .getAllByText(/^(Current status|Category|Photo|Location|Note)$/)
      .map((node) => node.props.children);
    expect(labels).toEqual(['Current status', 'Category', 'Photo', 'Location', 'Note']);
  });

  it('says when the AI was not sure', async () => {
    getReport.mockResolvedValue({
      ...REPORT,
      category: { name: 'IT / technology problem', source: 'ai_suggestion', uncertain: true },
    });
    await render(<ReportDetailsScreen />);
    expect(
      await screen.findByText('The AI was not sure about this. Campus staff will confirm or change it.'),
    ).toBeOnTheScreen();
  });

  it('shows a staff-confirmed category without the AI label', async () => {
    getReport.mockResolvedValue({
      ...REPORT,
      category: { name: 'IT / technology problem', source: 'staff', uncertain: false },
    });
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('Confirmed by campus staff.')).toBeOnTheScreen();
    expect(screen.queryByText('AI suggestion')).toBeNull();
  });

  it('shows no category section before there is one', async () => {
    getReport.mockResolvedValue(REPORT);
    await render(<ReportDetailsScreen />);
    await screen.findByText('RPT-000001');
    expect(screen.queryByText('Category')).toBeNull();
  });

  it('handles a report without a note', async () => {
    getReport.mockResolvedValue({ ...REPORT, note: null });
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('No note added.')).toBeOnTheScreen();
  });
});
