/**
 * Uploads a report photo to protected storage (LS-08; RC-09, RC-10).
 *
 * 1. Ask the backend for permission. It validates the type and size, chooses
 *    where the file goes, and returns a signed link for that one file.
 * 2. Send the file straight to storage using that link.
 *
 * The app never holds storage credentials and cannot choose the destination.
 * Any failure is reported as a failure: this function either resolves with
 * the uploaded photo's id or throws an UploadError the screen can show.
 */
import { ApiError, apiPost } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { ReportPhoto } from '@/report/photo';

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

type UploadTicket = {
  media_id: string;
  bucket: string;
  object_path: string;
  upload_token: string;
};

const TRY_AGAIN = 'The photo could not be uploaded. Check your connection and try again.';

async function readPhoto(photo: ReportPhoto): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  let bytes: ArrayBuffer;
  let detectedType: string | null;
  try {
    const blob = await (await fetch(photo.uri)).blob();
    detectedType = blob.type || null;
    bytes = await new Response(blob).arrayBuffer();
  } catch {
    throw new UploadError('The photo could not be read from your device. Choose it again.');
  }
  const contentType = photo.mimeType ?? detectedType;
  if (!contentType) {
    throw new UploadError('The photo type could not be determined. Choose a different photo.');
  }
  if (bytes.byteLength === 0) {
    throw new UploadError('The photo is empty. Choose a different photo.');
  }
  return { bytes, contentType };
}

/** Upload the photo and return the id to attach to the report. */
export async function uploadReportPhoto(photo: ReportPhoto): Promise<string> {
  if (!supabase) {
    throw new UploadError('Photo upload is not set up for this app.');
  }
  const { bytes, contentType } = await readPhoto(photo);

  let ticket: UploadTicket;
  try {
    ticket = await apiPost<UploadTicket>('/media/uploads', {
      content_type: contentType,
      size_bytes: bytes.byteLength,
    });
  } catch (error) {
    // 413/415: the server explains what is wrong with this photo.
    if (error instanceof ApiError && (error.status === 413 || error.status === 415) && error.detail) {
      throw new UploadError(error.detail);
    }
    if (error instanceof ApiError && error.status === 403) {
      throw new UploadError('Your account cannot submit reports.');
    }
    throw new UploadError(TRY_AGAIN);
  }

  try {
    const { error } = await supabase.storage
      .from(ticket.bucket)
      .uploadToSignedUrl(ticket.object_path, ticket.upload_token, bytes, { contentType });
    if (error) {
      throw new UploadError(TRY_AGAIN);
    }
  } catch (error) {
    throw error instanceof UploadError ? error : new UploadError(TRY_AGAIN);
  }
  return ticket.media_id;
}
