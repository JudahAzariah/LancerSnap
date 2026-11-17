import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { type ReactNode, useEffect } from 'react';
import { Text } from 'react-native';

import ReviewStepScreen from '@/app/(app)/report/review';
import { ReportDraftProvider, useReportDraft } from '@/report/ReportDraftProvider';
import { SubmitError, submitReport } from '@/report/submit';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('@/report/submit', () => ({
  ...jest.requireActual('@/report/submit'),
  submitReport: jest.fn(),
}));

const submit = jest.mocked(submitReport);

const PHOTO = { uri: 'file:///p.jpg', mimeType: 'image/jpeg', fileSize: 10, width: 1, height: 1 };
const LOCATION = { id: 'loc-1', name: 'Yeager Center', location_type: 'building' };

function Seed({ children, complete = true }: { children: ReactNode; complete?: boolean }) {
  const draft = useReportDraft();
  useEffect(() => {
    draft.setPhoto(PHOTO);
    if (complete) draft.setLocation(LOCATION);
    draft.setNote('Door will not close');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return children;
}

function DraftProbe() {
  const { photo, uploadedMediaId } = useReportDraft();
  return <Text>{`draft:${photo ? 'photo' : 'empty'}:${uploadedMediaId ?? 'none'}`}</Text>;
}

async function renderScreen(complete = true) {
  await render(
    <ReportDraftProvider>
      <Seed complete={complete}>
        <ReviewStepScreen />
        <DraftProbe />
      </Seed>
    </ReportDraftProvider>,
  );
}

const submitButton = () => screen.getByRole('button', { name: /Submit report|Try again/ });

beforeEach(() => jest.clearAllMocks());

describe('Review and submit', () => {
  it('shows the photo, location, and note to check before submitting', async () => {
    await renderScreen();
    expect(screen.getByLabelText('The photo for your report')).toBeOnTheScreen();
    expect(screen.getByText('Yeager Center (Building)')).toBeOnTheScreen();
    expect(screen.getByText('Door will not close')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Submit report' })).toBeEnabled();
  });

  it('cannot submit without a location', async () => {
    await renderScreen(false);
    expect(screen.getByText(/needs a photo and a location/)).toBeOnTheScreen();
    expect(submitButton()).toBeDisabled();
  });

  it('shows the receipt screen only after the server confirms, and clears the draft', async () => {
    submit.mockImplementation(async (_draft, hooks) => {
      hooks.onStage('uploading');
      hooks.onUploaded('media-1');
      hooks.onStage('submitting');
      return {
        id: 'r-1',
        reference_code: 'RPT-000042',
        status: 'submitted',
        location: LOCATION,
        note: 'Door will not close',
        media_id: 'media-1',
        created_at: '2026-11-17T00:00:00Z',
      };
    });
    await renderScreen();
    await fireEvent.press(submitButton());

    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/report/submitted',
      params: { reference: 'RPT-000042', location: 'Yeager Center' },
    });
    expect(screen.getByText('draft:empty:none')).toBeOnTheScreen();
  });

  it('shows progress while working and blocks a second submit', async () => {
    let finish: (() => void) | undefined;
    submit.mockImplementation(
      (_draft, hooks) =>
        new Promise((_, reject) => {
          hooks.onStage('uploading');
          finish = () => reject(new SubmitError('Your report was not submitted. Try again.', false));
        }),
    );
    await renderScreen();
    // Not awaited: the submission is held open until finish() is called.
    const pressed = fireEvent.press(submitButton());

    expect(await screen.findByText('Uploading your photo…')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Submitting…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    void fireEvent.press(screen.getByRole('button', { name: 'Submitting…' }));
    expect(submit).toHaveBeenCalledTimes(1);

    await act(async () => finish?.());
    await pressed;
    expect(await screen.findByText('Your report was not submitted. Try again.')).toBeOnTheScreen();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('shows an honest failure, never the receipt, and lets the student retry', async () => {
    submit.mockRejectedValueOnce(
      new SubmitError('Your report was not submitted. Check your connection and try again.', false),
    );
    await renderScreen();
    await fireEvent.press(submitButton());

    expect(screen.getByText(/Your report was not submitted/)).toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/received/i)).toBeNull();
    // Nothing the student entered is lost.
    expect(screen.getByText('Door will not close')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });

  it('passes an already-uploaded photo to the retry and drops it when the server rejects it', async () => {
    submit.mockImplementationOnce(async (_draft, hooks) => {
      hooks.onUploaded('media-1');
      throw new SubmitError('Your report was not submitted. Try again.', false);
    });
    await renderScreen();
    await fireEvent.press(submitButton());
    expect(screen.getByText('draft:photo:media-1')).toBeOnTheScreen();

    submit.mockRejectedValueOnce(new SubmitError('Your report was not submitted. Add the photo again.', true));
    await fireEvent.press(submitButton());
    expect(submit.mock.calls[1][0].uploadedMediaId).toBe('media-1');
    expect(screen.getByText('draft:photo:none')).toBeOnTheScreen();
  });
});
