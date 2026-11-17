import * as ImagePicker from 'expo-image-picker';

import { photoProblem, type ReportPhoto, resolveMimeType } from '@/report/photo';

export type PickResult =
  | { status: 'picked'; photo: ReportPhoto }
  | { status: 'cancelled' }
  /** The user has not allowed access; `message` says what to do about it. */
  | { status: 'denied'; message: string }
  /** The photo cannot be used, or the picker failed; `message` says why. */
  | { status: 'rejected'; message: string };

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  // Photographs only: the report flow has no use for video.
  mediaTypes: ['images'],
  allowsMultipleSelection: false,
  quality: 0.8,
  // Photo metadata (which can include where the photo was taken) is not
  // requested. Location comes only from the campus location the student picks.
  exif: false,
};

function toResult(result: ImagePicker.ImagePickerResult): PickResult {
  if (result.canceled || result.assets.length === 0) {
    return { status: 'cancelled' };
  }
  const asset = result.assets[0];
  const photo: ReportPhoto = {
    uri: asset.uri,
    mimeType: resolveMimeType(asset.mimeType, asset.uri),
    fileSize: asset.fileSize ?? null,
    width: asset.width,
    height: asset.height,
  };
  const problem = photoProblem(photo);
  return problem ? { status: 'rejected', message: problem } : { status: 'picked', photo };
}

/** Open the camera to take a new photo. Asks for camera access if needed. */
export async function takePhoto(): Promise<PickResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return {
        status: 'denied',
        message: permission.canAskAgain
          ? 'Camera access is needed to take a photo. Allow access and try again, or choose a photo from your library instead.'
          : 'Camera access is turned off for LancerSnap. Turn it on in your device settings, or choose a photo from your library instead.',
      };
    }
    return toResult(await ImagePicker.launchCameraAsync(PICKER_OPTIONS));
  } catch {
    return {
      status: 'rejected',
      message:
        'The camera could not be opened on this device. Choose a photo from your library instead.',
    };
  }
}

/** Open the system photo picker to choose an existing photo. */
export async function choosePhoto(): Promise<PickResult> {
  try {
    // The system picker needs no permission prompt: the app only receives the
    // one photo the user selects.
    return toResult(await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS));
  } catch {
    return { status: 'rejected', message: 'Your photo library could not be opened. Try again.' };
  }
}
