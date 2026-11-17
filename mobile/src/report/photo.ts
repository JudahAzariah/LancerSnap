/**
 * Report photo rules shared by the reporting flow.
 *
 * These client-side checks only give the student fast, clear feedback. The
 * backend and the storage bucket enforce the same limits and are the
 * authority (RC-09).
 */

export type ReportPhoto = {
  uri: string;
  /** MIME type when the platform reports one. */
  mimeType: string | null;
  /** Size in bytes when the platform reports one. */
  fileSize: number | null;
  width: number;
  height: number;
};

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MAX_NOTE_LENGTH = 2000;

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const EXTENSION_MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** Best-effort MIME type from what the picker reported, else the file extension. */
export function resolveMimeType(mimeType: string | null | undefined, uri: string): string | null {
  if (mimeType) return mimeType.toLowerCase();
  const match = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(uri);
  if (!match) return null;
  // An extension we do not recognise is reported as-is so it can be rejected.
  return EXTENSION_MIME_TYPES[match[1].toLowerCase()] ?? `unknown/${match[1].toLowerCase()}`;
}

/**
 * Returns a message explaining why the photo cannot be used, or null if it
 * can. When the platform does not report a type or size, the photo is
 * accepted here and checked by the server.
 */
export function photoProblem(photo: Pick<ReportPhoto, 'mimeType' | 'fileSize'>): string | null {
  if (photo.mimeType !== null && !ALLOWED_MIME_TYPES.includes(photo.mimeType)) {
    return 'That file type is not supported. Choose a JPEG, PNG, WebP, or HEIC photo.';
  }
  if (photo.fileSize !== null && photo.fileSize > MAX_PHOTO_BYTES) {
    return 'That photo is larger than 10 MB. Choose a smaller photo.';
  }
  return null;
}
