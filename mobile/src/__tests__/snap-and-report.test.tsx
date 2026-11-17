import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import SnapAndReportScreen from '@/app/(app)/report/new';
import { ReportDraftProvider } from '@/report/ReportDraftProvider';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));

const picker = jest.mocked(ImagePicker);

function asset(overrides: Partial<ImagePicker.ImagePickerAsset> = {}) {
  return {
    canceled: false as const,
    assets: [
      {
        uri: 'file:///photos/issue.jpg',
        mimeType: 'image/jpeg',
        fileSize: 500_000,
        width: 1200,
        height: 900,
        ...overrides,
      } as ImagePicker.ImagePickerAsset,
    ],
  };
}

const CANCELLED = { canceled: true as const, assets: null };
const GRANTED = { granted: true, canAskAgain: true } as ImagePicker.PermissionResponse;

async function renderScreen() {
  await render(
    <ReportDraftProvider>
      <SnapAndReportScreen />
    </ReportDraftProvider>,
  );
}

function continueButton() {
  return screen.getByRole('button', { name: 'Continue' });
}

beforeEach(() => {
  jest.clearAllMocks();
  picker.requestCameraPermissionsAsync.mockResolvedValue(GRANTED);
});

describe('Snap & Report', () => {
  it('starts with both photo options, no preview, and Continue unavailable', async () => {
    await renderScreen();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Choose from library' })).toBeEnabled();
    expect(screen.queryByLabelText('Preview of the photo for your report')).toBeNull();
    expect(continueButton()).toBeDisabled();
    // The reason is stated in words, not only by a greyed-out button.
    expect(screen.getByText('Add a photo to continue.')).toBeOnTheScreen();
  });

  it('shows the emergency boundary message', async () => {
    await renderScreen();
    expect(screen.getByText('Not for emergencies')).toBeOnTheScreen();
    expect(screen.getByText(/does not contact emergency services/)).toBeOnTheScreen();
    expect(screen.getByText(/call 911/)).toBeOnTheScreen();
  });

  it('never asks the student to choose a responsible office or team', async () => {
    await renderScreen();
    for (const word of [/office/i, /department/i, /team/i, /categor/i]) {
      expect(screen.queryByText(word)).toBeNull();
    }
  });

  it('shows a preview after choosing a photo from the library', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(asset());
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));

    const preview = await screen.findByLabelText('Preview of the photo for your report');
    expect(preview.props.source).toEqual({ uri: 'file:///photos/issue.jpg' });
    expect(continueButton()).toBeEnabled();
    expect(screen.queryByText('Add a photo to continue.')).toBeNull();
    // Photos only, one at a time, and no photo metadata requested.
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: false, exif: false }),
    );
  });

  it('asks for camera access, then shows a preview of the photo taken', async () => {
    picker.launchCameraAsync.mockResolvedValue(asset({ uri: 'file:///camera/new.jpg' }));
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));

    const preview = await screen.findByLabelText('Preview of the photo for your report');
    expect(preview.props.source).toEqual({ uri: 'file:///camera/new.jpg' });
    expect(picker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('lets the student retake or replace the photo', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce(asset());
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));
    await screen.findByLabelText('Preview of the photo for your report');

    picker.launchImageLibraryAsync.mockResolvedValueOnce(asset({ uri: 'file:///photos/better.png', mimeType: 'image/png' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a different photo' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Preview of the photo for your report').props.source).toEqual({
        uri: 'file:///photos/better.png',
      }),
    );

    picker.launchCameraAsync.mockResolvedValueOnce(asset({ uri: 'file:///camera/retake.jpg' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Retake photo' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Preview of the photo for your report').props.source).toEqual({
        uri: 'file:///camera/retake.jpg',
      }),
    );
  });

  it('changes nothing when the picker is cancelled', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(CANCELLED);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));

    await waitFor(() => expect(picker.launchImageLibraryAsync).toHaveBeenCalled());
    expect(screen.queryByLabelText('Preview of the photo for your report')).toBeNull();
    expect(screen.queryByRole('alert', { name: /Photo not added/ })).toBeNull();
    expect(continueButton()).toBeDisabled();
  });

  it('explains what to do when camera access is denied, and does not open the camera', async () => {
    picker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
    } as ImagePicker.PermissionResponse);
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));

    expect(await screen.findByText(/Camera access is turned off/)).toBeOnTheScreen();
    expect(screen.getByText(/choose a photo from your library instead/)).toBeOnTheScreen();
    expect(picker.launchCameraAsync).not.toHaveBeenCalled();
    // The library is still available as a way forward.
    expect(screen.getByRole('button', { name: 'Choose from library' })).toBeEnabled();
  });

  it('rejects an unsupported file type with a clear message', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(
      asset({ uri: 'file:///docs/file.pdf', mimeType: 'application/pdf' }),
    );
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));

    expect(await screen.findByText(/Photo not added: That file type is not supported/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Preview of the photo for your report')).toBeNull();
    expect(continueButton()).toBeDisabled();
  });

  it('rejects a photo over 10 MB', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(asset({ fileSize: 11 * 1024 * 1024 }));
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));

    expect(await screen.findByText(/larger than 10 MB/)).toBeOnTheScreen();
    expect(continueButton()).toBeDisabled();
  });

  it('keeps the current photo when a replacement is rejected', async () => {
    picker.launchImageLibraryAsync.mockResolvedValueOnce(asset());
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));
    await screen.findByLabelText('Preview of the photo for your report');

    picker.launchImageLibraryAsync.mockResolvedValueOnce(asset({ mimeType: 'video/mp4' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a different photo' }));

    expect(await screen.findByText(/not supported/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Preview of the photo for your report').props.source).toEqual({
      uri: 'file:///photos/issue.jpg',
    });
    expect(continueButton()).toBeEnabled();
  });

  it('reports a camera that cannot be opened instead of failing silently', async () => {
    picker.launchCameraAsync.mockRejectedValue(new Error('no camera'));
    await renderScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    expect(await screen.findByText(/camera could not be opened/)).toBeOnTheScreen();
  });

  it('marks the note as optional and does not require it to continue', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(asset());
    await renderScreen();
    expect(screen.getByText('Note (optional)')).toBeOnTheScreen();
    expect(screen.getByText(/You can leave this blank/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));
    await screen.findByLabelText('Preview of the photo for your report');
    // No note typed.
    expect(screen.getByLabelText('Note (optional)').props.value).toBe('');
    await fireEvent.press(continueButton());
    expect(router.push).toHaveBeenCalledWith('/report/location');
  });

  it('accepts a note, counts its length, and keeps it when a photo is added', async () => {
    picker.launchImageLibraryAsync.mockResolvedValue(asset());
    await renderScreen();
    const note = screen.getByLabelText('Note (optional)');
    expect(note.props.maxLength).toBe(2000);

    await fireEvent.changeText(note, 'Water on the floor');
    expect(screen.getByText('18 of 2000 characters')).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Choose from library' }));
    await screen.findByLabelText('Preview of the photo for your report');
    expect(screen.getByLabelText('Note (optional)').props.value).toBe('Water on the floor');
  });

  it('does not move on without a photo', async () => {
    await renderScreen();
    await fireEvent.press(continueButton());
    expect(router.push).not.toHaveBeenCalled();
  });
});
