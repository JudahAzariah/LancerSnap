/**
 * Report submission (LS-09; US-01, RC-10).
 *
 * Uploads the photo to protected storage (unless it already is there from an
 * earlier attempt), then submits the report. Either it resolves with the
 * server's receipt, or it throws a SubmitError with a message the screen can
 * show. It never reports success unless the server stored the report.
 */
import { ApiError, apiPost } from '@/lib/api';
import type { CampusLocation } from '@/report/locations';
import type { ReportPhoto } from '@/report/photo';
import { UploadError, uploadReportPhoto } from '@/report/upload';

export type ReportReceipt = {
  id: string;
  reference_code: string;
  status: string;
  location: CampusLocation;
  note: string | null;
  media_id: string;
  created_at: string;
};

export type SubmitStage = 'uploading' | 'submitting';

export class SubmitError extends Error {
  constructor(
    message: string,
    /** True when the uploaded photo cannot be reused and must be sent again. */
    readonly discardUpload: boolean,
  ) {
    super(message);
    this.name = 'SubmitError';
  }
}

const TRY_AGAIN =
  'Your report was not submitted. Check your connection and try again. Your photo, location, and note are kept.';

type Draft = {
  photo: ReportPhoto;
  location: CampusLocation;
  note: string;
  /** A photo already uploaded by an earlier attempt, if any. */
  uploadedMediaId: string | null;
};

export async function submitReport(
  draft: Draft,
  hooks: {
    onStage: (stage: SubmitStage) => void;
    /** Called as soon as the photo is safely in storage. */
    onUploaded: (mediaId: string) => void;
  },
): Promise<ReportReceipt> {
  let mediaId = draft.uploadedMediaId;
  if (!mediaId) {
    hooks.onStage('uploading');
    try {
      mediaId = await uploadReportPhoto(draft.photo);
    } catch (error) {
      const message = error instanceof UploadError ? error.message : TRY_AGAIN;
      throw new SubmitError(`Your report was not submitted. ${message}`, true);
    }
    hooks.onUploaded(mediaId);
  }

  hooks.onStage('submitting');
  try {
    const note = draft.note.trim();
    return await apiPost<ReportReceipt>('/reports', {
      media_id: mediaId,
      location_id: draft.location.id,
      note: note ? note : null,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 422 && error.detail) {
      // The server rejected something specific; it says what. Start the photo
      // over in case it was the photo that was rejected.
      throw new SubmitError(`Your report was not submitted. ${error.detail}`, true);
    }
    if (error instanceof ApiError && error.status === 403) {
      throw new SubmitError('Your account cannot submit reports.', false);
    }
    if (error instanceof ApiError && error.status === 502 && error.detail) {
      throw new SubmitError(error.detail, false);
    }
    // Unknown outcome (network, server error): the uploaded photo is kept so a
    // retry does not send it again.
    throw new SubmitError(TRY_AGAIN, false);
  }
}
