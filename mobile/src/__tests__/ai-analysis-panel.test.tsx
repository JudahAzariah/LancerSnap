import { fireEvent, render, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';

import ReportDetailsScreen from '@/app/(app)/reports/[id]';
import { type Role, useProfile } from '@/auth/ProfileProvider';
import { AiAnalysisPanel } from '@/components/AiAnalysisPanel';
import { priorityLabel } from '@/report/analysisLabels';
import {
  type Analysis,
  fetchAnalysis,
  fetchPhotoUrl,
  fetchReport,
  type ReportDetails,
} from '@/report/tracking';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useLocalSearchParams: jest.fn(),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('@/report/tracking', () => ({
  fetchReport: jest.fn(),
  fetchPhotoUrl: jest.fn(),
  fetchAnalysis: jest.fn(),
}));
jest.mock('@/auth/ProfileProvider', () => ({ useProfile: jest.fn() }));

const getAnalysis = jest.mocked(fetchAnalysis);

const SUCCEEDED: Analysis = {
  id: 'a-1',
  processing_status: 'succeeded',
  category: { id: 'c-1', name: 'Facilities / maintenance issue' },
  summary: 'A floor outlet cover is open.',
  details: ['Wiring visible inside the box', 'Cable across the carpet'],
  priority: 'high',
  potential_safety_hazard: true,
  confidence: 0.7,
  uncertain: true,
  uncertainty_reason: 'Could also be an IT problem.',
  error: null,
  created_at: '2026-11-18T18:23:15Z',
  completed_at: '2026-11-18T18:23:20Z',
};

const REPORT: ReportDetails = {
  id: 'r-1',
  reference_code: 'RPT-000002',
  status: 'submitted',
  location: { id: 'l-1', name: 'Engineering Building', location_type: 'building' },
  created_at: '2026-11-18T17:32:39Z',
  updated_at: '2026-11-18T17:32:39Z',
  note: null,
  media_id: null,
  category: null,
  history: [],
};

function signedInAs(role: Role) {
  jest.mocked(useProfile).mockReturnValue({
    status: 'ready',
    profile: { id: 'u-1', email: null, role, team_ids: [] },
    retry: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'r-1' });
  jest.mocked(fetchReport).mockResolvedValue(REPORT);
  jest.mocked(fetchPhotoUrl).mockResolvedValue('https://storage.test/p.jpg');
});

describe('AI analysis panel', () => {
  it('states priority, hazard, and uncertainty in words, not color alone', async () => {
    getAnalysis.mockResolvedValue(SUCCEEDED);
    await render(<AiAnalysisPanel reportId="r-1" />);

    expect(await screen.findByText('AI analysis (suggestion only)')).toBeOnTheScreen();
    expect(screen.getByText('▲ High priority (suggested)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Suggested priority: High priority (suggested)')).toBeOnTheScreen();
    expect(
      screen.getByText('⚠ Potential safety hazard: needs human attention'),
    ).toBeOnTheScreen();
    expect(screen.getByText(/does not contact emergency services/)).toBeOnTheScreen();
    expect(screen.getByText('? Uncertain result')).toBeOnTheScreen();
    expect(screen.getByText('Could also be an IT problem.')).toBeOnTheScreen();
    expect(screen.getByText('AI confidence: 70%')).toBeOnTheScreen();
    expect(screen.getByText('Facilities / maintenance issue')).toBeOnTheScreen();
    expect(screen.getByText('• Wiring visible inside the box')).toBeOnTheScreen();
  });

  it('gives every priority its own symbol and word', () => {
    const labels = (['low', 'medium', 'high'] as const).map(priorityLabel);
    expect(labels.map((label) => label.text)).toEqual([
      'Low priority (suggested)',
      'Medium priority (suggested)',
      'High priority (suggested)',
    ]);
    expect(new Set(labels.map((label) => label.symbol)).size).toBe(3);
  });

  it('shows a confident, non-hazard result without hazard or uncertainty notes', async () => {
    getAnalysis.mockResolvedValue({
      ...SUCCEEDED,
      priority: 'low',
      potential_safety_hazard: false,
      uncertain: false,
      uncertainty_reason: null,
      confidence: 0.9,
    });
    await render(<AiAnalysisPanel reportId="r-1" />);
    expect(await screen.findByText('▼ Low priority (suggested)')).toBeOnTheScreen();
    expect(screen.queryByText(/Potential safety hazard/)).toBeNull();
    expect(screen.queryByText('? Uncertain result')).toBeNull();
  });

  it('makes a failure visible and never shows it as "no priority"', async () => {
    getAnalysis.mockResolvedValue({
      ...SUCCEEDED,
      processing_status: 'failed',
      error: 'timeout',
      category: null,
      summary: null,
      details: null,
      priority: null,
      potential_safety_hazard: null,
      confidence: null,
      uncertain: false,
      uncertainty_reason: null,
    });
    await render(<AiAnalysisPanel reportId="r-1" />);
    expect(await screen.findByText('✕ AI analysis failed')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'The AI service took too long to answer. No priority or category was suggested, so a person needs to review this report.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/priority \(suggested\)/)).toBeNull();
  });

  it('says when the report was never analyzed, or is still being analyzed', async () => {
    getAnalysis.mockResolvedValueOnce(null);
    await render(<AiAnalysisPanel reportId="r-1" />);
    expect(await screen.findByText('○ Not analyzed by AI')).toBeOnTheScreen();

    getAnalysis.mockResolvedValueOnce({ ...SUCCEEDED, processing_status: 'pending' });
    await render(<AiAnalysisPanel reportId="r-2" />);
    expect(await screen.findByText('… AI analysis in progress')).toBeOnTheScreen();
  });

  it('offers a retry when the analysis cannot be loaded', async () => {
    getAnalysis.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(SUCCEEDED);
    await render(<AiAnalysisPanel reportId="r-1" />);
    expect(await screen.findByText('The AI analysis could not be loaded.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('▲ High priority (suggested)')).toBeOnTheScreen();
  });
});

describe('Who sees the AI analysis on report details', () => {
  it.each<Role>(['staff', 'administrator'])('%s sees the analysis panel', async (role) => {
    signedInAs(role);
    getAnalysis.mockResolvedValue(SUCCEEDED);
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('▲ High priority (suggested)')).toBeOnTheScreen();
    expect(getAnalysis).toHaveBeenCalledWith('r-1');
  });

  it('a student does not see priority or the analysis panel', async () => {
    signedInAs('student');
    await render(<ReportDetailsScreen />);
    await screen.findByText('RPT-000002');
    expect(screen.queryByText('AI analysis (suggestion only)')).toBeNull();
    expect(getAnalysis).not.toHaveBeenCalled();
  });
});
