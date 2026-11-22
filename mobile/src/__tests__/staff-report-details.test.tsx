import { fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import ReportDetailsScreen from '@/app/(app)/reports/[id]';
import { type Role, useProfile } from '@/auth/ProfileProvider';
import { ApiError } from '@/lib/api';
import { fetchAnalysis, fetchPhotoUrl, fetchReport, type ReportDetails } from '@/report/tracking';
import {
  type DuplicateCandidate,
  duplicateReasons,
  fetchCategories,
  fetchDuplicates,
  reviewDuplicate,
  setCategory,
} from '@/staff/reportActions';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn() },
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
jest.mock('@/staff/reportActions', () => ({
  ...jest.requireActual('@/staff/reportActions'),
  fetchCategories: jest.fn(),
  setCategory: jest.fn(),
  fetchDuplicates: jest.fn(),
  reviewDuplicate: jest.fn(),
}));
jest.mock('@/auth/ProfileProvider', () => ({ useProfile: jest.fn() }));

function signedInAs(role: Role) {
  jest.mocked(useProfile).mockReturnValue({
    status: 'ready',
    profile: { id: 'u-1', email: null, role, team_ids: [] },
    retry: jest.fn(),
  });
}

const REPORT: ReportDetails = {
  id: 'r-1',
  reference_code: 'RPT-000003',
  status: 'assigned',
  location: { id: 'l-1', name: 'Engineering Building', location_type: 'building' },
  created_at: '2026-11-18T17:44:00Z',
  updated_at: '2026-11-18T17:44:00Z',
  note: 'Charger sparking',
  media_id: 'm-1',
  category: { name: 'Facilities / maintenance issue', source: 'ai_suggestion', uncertain: true },
  history: [
    { from_status: null, to_status: 'submitted', note: null, created_at: '2026-11-18T17:44:00Z' },
  ],
};

const CANDIDATE: DuplicateCandidate = {
  id: 'd-1',
  other_report: {
    id: 'r-2',
    reference_code: 'RPT-000002',
    status: 'assigned',
    location_name: 'Engineering Building',
    created_at: '2026-11-18T17:32:00Z',
  },
  signals: {
    rule: 'similar_text_location_time',
    same_location: true,
    same_category: null,
    hours_apart: 0.2,
    text_similarity: 0.4,
  },
  review_state: 'pending',
  reviewed_at: null,
};

const getReport = jest.mocked(fetchReport);
const getDuplicates = jest.mocked(fetchDuplicates);
const decide = jest.mocked(reviewDuplicate);
const saveCategory = jest.mocked(setCategory);

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'r-1' });
  jest.mocked(fetchPhotoUrl).mockResolvedValue('https://storage.test/signed/photo.jpg');
  jest.mocked(fetchAnalysis).mockResolvedValue(null);
  jest.mocked(fetchCategories).mockResolvedValue([
    { id: 'c-fac', name: 'Facilities / maintenance issue' },
    { id: 'c-it', name: 'IT / technology problem' },
  ]);
  getReport.mockResolvedValue(REPORT);
  getDuplicates.mockResolvedValue([CANDIDATE]);
  signedInAs('staff');
});

describe('Staff report details', () => {
  it('shows the photo, note, and AI information labelled as suggestions', async () => {
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('AI suggestion')).toBeOnTheScreen();
    expect(screen.getByText('AI analysis (suggestion only)')).toBeOnTheScreen();
    expect(screen.getByText('Possible duplicates (suggestion only)')).toBeOnTheScreen();
    expect(screen.getByText('Charger sparking')).toBeOnTheScreen();
    // The student-worded status explanation is not shown to staff.
    expect(screen.queryByText(/^Your report/)).toBeNull();
    expect(await screen.findByLabelText('The photo submitted with this report')).toBeOnTheScreen();
  });

  it('saves a corrected category as a staff decision and shows it as confirmed', async () => {
    saveCategory.mockResolvedValue({ name: 'IT / technology problem', source: 'staff', uncertain: false });
    await render(<ReportDetailsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm or change category' }));
    expect(await screen.findByText('Set the category (staff decision)')).toBeOnTheScreen();
    // Starts from the current category.
    expect(
      screen.getByRole('radio', { name: 'Facilities / maintenance issue' }).props.accessibilityState,
    ).toMatchObject({ checked: true });

    getReport.mockResolvedValue({
      ...REPORT,
      category: { name: 'IT / technology problem', source: 'staff', uncertain: false },
    });
    await fireEvent.press(screen.getByRole('radio', { name: 'IT / technology problem' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save category' }));

    expect(saveCategory).toHaveBeenCalledWith('r-1', 'c-it');
    expect(await screen.findByText('Confirmed by campus staff.')).toBeOnTheScreen();
    expect(screen.queryByText('AI suggestion')).toBeNull();
    expect(screen.getByRole('button', { name: 'Change category' })).toBeOnTheScreen();
  });

  it('explains when a category cannot be saved', async () => {
    saveCategory.mockRejectedValue(new ApiError(422, 'Choose an active category.'));
    await render(<ReportDetailsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Confirm or change category' }));
    await screen.findByRole('radio', { name: 'IT / technology problem' });
    await fireEvent.press(screen.getByRole('button', { name: 'Save category' }));
    expect(await screen.findByText('Choose an active category.')).toBeOnTheScreen();
  });

  it('lists possible duplicates with why they were suggested and a link', async () => {
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('Open RPT-000002 →')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Why it was suggested: Same location, Less than an hour apart, Similar wording (40%).',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('? Not reviewed yet')).toBeOnTheScreen();
    expect(screen.getByText(/Both reports stay open and nothing is merged/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('link', { name: /Open RPT-000002/ }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/reports/[id]', params: { id: 'r-2' } });
  });

  it('records a duplicate decision without forcing a merge, and can undo it', async () => {
    decide.mockResolvedValueOnce({ ...CANDIDATE, review_state: 'not_duplicate', reviewed_at: 'x' });
    await render(<ReportDetailsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Not a duplicate' }));
    expect(decide).toHaveBeenCalledWith('r-1', 'd-1', 'not_duplicate');
    expect(await screen.findByText('≠ Marked as not a duplicate')).toBeOnTheScreen();

    decide.mockResolvedValueOnce(CANDIDATE);
    await fireEvent.press(screen.getByRole('button', { name: 'Undo decision' }));
    expect(decide).toHaveBeenLastCalledWith('r-1', 'd-1', 'pending');
    expect(await screen.findByText('? Not reviewed yet')).toBeOnTheScreen();
  });

  it('keeps the decision unchanged and says so when saving fails', async () => {
    decide.mockRejectedValue(new Error('offline'));
    await render(<ReportDetailsScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Same issue' }));
    expect(await screen.findByText('Your decision could not be saved. Try again.')).toBeOnTheScreen();
    expect(screen.getByText('? Not reviewed yet')).toBeOnTheScreen();
  });

  it('says when there are no possible duplicates', async () => {
    getDuplicates.mockResolvedValue([]);
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('No possible duplicates found.')).toBeOnTheScreen();
  });

  it('shows "No category yet" to staff before there is one', async () => {
    getReport.mockResolvedValue({ ...REPORT, category: null });
    await render(<ReportDetailsScreen />);
    expect(await screen.findByText('No category yet.')).toBeOnTheScreen();
  });

  it('shows students none of the staff tools', async () => {
    signedInAs('student');
    await render(<ReportDetailsScreen />);
    await screen.findByText('AI suggestion');
    expect(screen.queryByRole('button', { name: /category/ })).toBeNull();
    expect(screen.queryByText('Possible duplicates (suggestion only)')).toBeNull();
    expect(getDuplicates).not.toHaveBeenCalled();
  });

  it('describes duplicate signals in plain words', () => {
    expect(duplicateReasons({ same_location: true, same_category: true, hours_apart: 5.4 })).toEqual([
      'Same location',
      'Same category',
      'About 5 h apart',
    ]);
    expect(duplicateReasons({})).toEqual([]);
  });
});
