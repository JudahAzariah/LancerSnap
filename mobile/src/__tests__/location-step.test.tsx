import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import LocationStepScreen from '@/app/(app)/report/location';
import { apiFetch } from '@/lib/api';
import { ReportDraftProvider, useReportDraft } from '@/report/ReportDraftProvider';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }));

const api = jest.mocked(apiFetch);

const LOCATIONS = [
  { id: 'loc-library', name: 'Annie Gabriel Library', location_type: 'building' },
  { id: 'loc-parking', name: 'Parking Lots', location_type: 'parking' },
  { id: 'loc-garden', name: 'Rose Garden', location_type: 'outdoor_area' },
];

/** Shows what the rest of the flow would receive from the draft. */
function DraftProbe() {
  const { location } = useReportDraft();
  return <Text>{`draft-location:${location ? location.id : 'none'}`}</Text>;
}

async function renderScreen() {
  await render(
    <ReportDraftProvider>
      <LocationStepScreen />
      <DraftProbe />
    </ReportDraftProvider>,
  );
}

function option(name: string) {
  return screen.getByRole('radio', { name });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.mockResolvedValue(LOCATIONS);
});

describe('Location step', () => {
  it('loads the supported locations from the backend', async () => {
    await renderScreen();
    expect(await screen.findByText('Annie Gabriel Library')).toBeOnTheScreen();
    expect(api).toHaveBeenCalledWith('/locations');
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText('3 locations')).toBeOnTheScreen();
    // The type is shown in words.
    expect(screen.getByText('Outdoor area')).toBeOnTheScreen();
  });

  it('says that device location is not used', async () => {
    await renderScreen();
    expect(screen.getByText(/does not use your device's location/)).toBeOnTheScreen();
  });

  it('starts with nothing selected', async () => {
    await renderScreen();
    await screen.findByText('Rose Garden');
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toBeChecked();
    }
    expect(screen.getByText('draft-location:none')).toBeOnTheScreen();
  });

  it('selects a location and marks it in words, not only by colour', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Rose Garden, Outdoor area' }));

    expect(option('Rose Garden, Outdoor area')).toBeChecked();
    expect(option('Parking Lots, Parking')).not.toBeChecked();
    expect(screen.getByText('Outdoor area · Selected')).toBeOnTheScreen();
    expect(screen.getByText('Selected: Rose Garden')).toBeOnTheScreen();
    expect(screen.getByText('draft-location:loc-garden')).toBeOnTheScreen();
  });

  it('allows only one selection at a time', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Rose Garden, Outdoor area' }));
    await fireEvent.press(option('Parking Lots, Parking'));

    expect(option('Parking Lots, Parking')).toBeChecked();
    expect(option('Rose Garden, Outdoor area')).not.toBeChecked();
    expect(screen.getByText('draft-location:loc-parking')).toBeOnTheScreen();
  });

  it('requires a location before continuing, with a message next to the control', async () => {
    await renderScreen();
    await screen.findByText('Rose Garden');
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('Choose a location to continue.')).toBeOnTheScreen();
    expect(router.push).not.toHaveBeenCalled();

    // Choosing one clears the message and lets the student move on.
    await fireEvent.press(option('Annie Gabriel Library, Building'));
    expect(screen.queryByText('Choose a location to continue.')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(router.push).toHaveBeenCalledWith('/report/review');
  });

  it('filters by search and keeps the selection', async () => {
    await renderScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Rose Garden, Outdoor area' }));
    await fireEvent.changeText(screen.getByLabelText('Search locations'), 'park');

    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByText('1 location matching "park"')).toBeOnTheScreen();
    expect(screen.queryByRole('radio', { name: 'Rose Garden, Outdoor area' })).toBeNull();
    // Still selected even though it is filtered out of view.
    expect(screen.getByText('Selected: Rose Garden')).toBeOnTheScreen();
  });

  it('explains when a search matches nothing', async () => {
    await renderScreen();
    await screen.findByText('Rose Garden');
    await fireEvent.changeText(screen.getByLabelText('Search locations'), 'stadium');

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText(/No locations match your search/)).toBeOnTheScreen();
  });

  it('shows a loading state, then an honest error with a retry', async () => {
    api.mockRejectedValueOnce(new Error('network'));
    await renderScreen();

    expect(await screen.findByText(/Locations could not be loaded/)).toBeOnTheScreen();
    expect(screen.getByText(/Your photo and note\s+are kept/)).toBeOnTheScreen();
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    // Continue is unavailable while there is nothing to choose from.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Rose Garden')).toBeOnTheScreen();
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('says so when no locations are available', async () => {
    api.mockResolvedValue([]);
    await renderScreen();
    expect(await screen.findByText(/No campus locations are available/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(router.push).not.toHaveBeenCalled();
  });
});
