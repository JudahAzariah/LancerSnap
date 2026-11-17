import { ApiError, apiPost } from '@/lib/api';
import type { ReportPhoto } from '@/report/photo';
import { SubmitError, submitReport } from '@/report/submit';
import { UploadError, uploadReportPhoto } from '@/report/upload';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), apiPost: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: null }));
jest.mock('@/report/upload', () => ({
  ...jest.requireActual('@/report/upload'),
  uploadReportPhoto: jest.fn(),
}));

const post = jest.mocked(apiPost);
const upload = jest.mocked(uploadReportPhoto);

const PHOTO: ReportPhoto = { uri: 'file:///p.jpg', mimeType: 'image/jpeg', fileSize: 10, width: 1, height: 1 };
const LOCATION = { id: 'loc-1', name: 'Yeager Center', location_type: 'building' };
const RECEIPT = {
  id: 'r-1',
  reference_code: 'RPT-000042',
  status: 'submitted',
  location: LOCATION,
  note: null,
  media_id: 'media-1',
  created_at: '2026-11-17T00:00:00Z',
};

function draft(overrides: Partial<Parameters<typeof submitReport>[0]> = {}) {
  return { photo: PHOTO, location: LOCATION, note: '', uploadedMediaId: null, ...overrides };
}

function hooks() {
  return { onStage: jest.fn(), onUploaded: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  upload.mockResolvedValue('media-1');
  post.mockResolvedValue(RECEIPT);
});

describe('submitReport', () => {
  it('uploads the photo, then submits the report, and returns the receipt', async () => {
    const h = hooks();
    await expect(submitReport(draft({ note: '  Broken door  ' }), h)).resolves.toEqual(RECEIPT);

    expect(upload).toHaveBeenCalledWith(PHOTO);
    expect(h.onUploaded).toHaveBeenCalledWith('media-1');
    expect(post).toHaveBeenCalledWith('/reports', {
      media_id: 'media-1',
      location_id: 'loc-1',
      note: 'Broken door',
    });
    expect(h.onStage.mock.calls.map(([stage]) => stage)).toEqual(['uploading', 'submitting']);
  });

  it('sends no note when the note is blank', async () => {
    await submitReport(draft({ note: '   ' }), hooks());
    expect(post).toHaveBeenCalledWith('/reports', expect.objectContaining({ note: null }));
  });

  it('does not upload again when the photo is already in storage', async () => {
    const h = hooks();
    await submitReport(draft({ uploadedMediaId: 'media-earlier' }), h);
    expect(upload).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/reports', expect.objectContaining({ media_id: 'media-earlier' }));
    expect(h.onStage.mock.calls.map(([stage]) => stage)).toEqual(['submitting']);
  });

  it('stops before submitting when the upload fails, with the reason', async () => {
    upload.mockRejectedValue(new UploadError('Photo is too large. The limit is 10 MB.'));
    const error = await submitReport(draft(), hooks()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SubmitError);
    expect((error as SubmitError).message).toBe(
      'Your report was not submitted. Photo is too large. The limit is 10 MB.',
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the server’s reason for a rejected report and starts the photo over', async () => {
    post.mockRejectedValue(new ApiError(422, 'Choose a supported campus location.'));
    const error = (await submitReport(draft(), hooks()).catch((e: unknown) => e)) as SubmitError;
    expect(error.message).toBe('Your report was not submitted. Choose a supported campus location.');
    expect(error.discardUpload).toBe(true);
  });

  it('keeps the uploaded photo for a retry when the outcome is unknown', async () => {
    post.mockRejectedValue(new TypeError('Network request failed'));
    const error = (await submitReport(draft(), hooks()).catch((e: unknown) => e)) as SubmitError;
    expect(error.message).toMatch(/was not submitted.*try again/);
    expect(error.discardUpload).toBe(false);
  });

  it('passes on the server’s storage-outage message', async () => {
    post.mockRejectedValue(
      new ApiError(502, 'Photo storage is unavailable, so the report was not submitted. Try again.'),
    );
    await expect(submitReport(draft(), hooks())).rejects.toThrow(
      'Photo storage is unavailable, so the report was not submitted. Try again.',
    );
  });

  it('never resolves without a server receipt', async () => {
    post.mockRejectedValue(new ApiError(500, null));
    await expect(submitReport(draft(), hooks())).rejects.toBeInstanceOf(SubmitError);
  });
});
