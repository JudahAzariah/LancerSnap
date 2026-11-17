import { ApiError, apiPost } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { ReportPhoto } from '@/report/photo';
import { UploadError, uploadReportPhoto } from '@/report/upload';

jest.mock('@/lib/api', () => ({ ...jest.requireActual('@/lib/api'), apiPost: jest.fn() }));

const mockUploadToSignedUrl = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: jest.fn(() => ({ uploadToSignedUrl: mockUploadToSignedUrl })) } },
}));

const post = jest.mocked(apiPost);

const PHOTO: ReportPhoto = {
  uri: 'file:///photos/issue.jpg',
  mimeType: 'image/jpeg',
  fileSize: 4,
  width: 10,
  height: 10,
};

const TICKET = {
  media_id: 'media-1',
  bucket: 'report-media',
  object_path: 'user-1/random.jpg',
  upload_token: 'signed-token',
};

function mockFile(bytes: number[], type = 'image/jpeg') {
  // A fresh response each time, as reading a real file would give.
  globalThis.fetch = jest
    .fn()
    .mockImplementation(async () => new Response(new Blob([new Uint8Array(bytes)], { type })));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFile([1, 2, 3, 4]);
  post.mockResolvedValue(TICKET);
  mockUploadToSignedUrl.mockResolvedValue({ data: { path: TICKET.object_path }, error: null });
});

describe('uploadReportPhoto', () => {
  it('asks the backend for a ticket, then uploads to the path the backend chose', async () => {
    await expect(uploadReportPhoto(PHOTO)).resolves.toBe('media-1');

    // The app declares the real type and size, and nothing about the destination.
    expect(post).toHaveBeenCalledWith('/media/uploads', {
      content_type: 'image/jpeg',
      size_bytes: 4,
    });
    expect(jest.mocked(supabase!.storage.from)).toHaveBeenCalledWith('report-media');
    const [path, token, body, options] = mockUploadToSignedUrl.mock.calls[0];
    expect(path).toBe('user-1/random.jpg');
    expect(token).toBe('signed-token');
    expect(body.byteLength).toBe(4);
    expect(options).toEqual({ contentType: 'image/jpeg' });
  });

  it('uses the file’s own type when the picker did not report one', async () => {
    mockFile([1, 2], 'image/png');
    await uploadReportPhoto({ ...PHOTO, mimeType: null });
    expect(post).toHaveBeenCalledWith('/media/uploads', { content_type: 'image/png', size_bytes: 2 });
  });

  it('shows the server’s reason when the photo is too large or the wrong type', async () => {
    post.mockRejectedValue(new ApiError(413, 'Photo is too large. The limit is 10 MB.'));
    await expect(uploadReportPhoto(PHOTO)).rejects.toThrow('Photo is too large. The limit is 10 MB.');

    post.mockRejectedValue(new ApiError(415, 'Unsupported photo type.'));
    await expect(uploadReportPhoto(PHOTO)).rejects.toThrow('Unsupported photo type.');
    expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('fails clearly when the backend is unreachable or storage is down', async () => {
    post.mockRejectedValue(new ApiError(502, 'Photo storage is unavailable. Please try again.'));
    await expect(uploadReportPhoto(PHOTO)).rejects.toThrow(/could not be uploaded/);

    post.mockRejectedValue(new TypeError('Network request failed'));
    await expect(uploadReportPhoto(PHOTO)).rejects.toBeInstanceOf(UploadError);
    expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('fails, and never reports success, when the file transfer fails', async () => {
    mockUploadToSignedUrl.mockResolvedValue({ data: null, error: { message: 'expired' } });
    await expect(uploadReportPhoto(PHOTO)).rejects.toThrow(/could not be uploaded/);

    mockUploadToSignedUrl.mockRejectedValue(new Error('socket hang up'));
    await expect(uploadReportPhoto(PHOTO)).rejects.toBeInstanceOf(UploadError);
  });

  it('tells a non-student account it cannot submit reports', async () => {
    post.mockRejectedValue(new ApiError(403, 'Not permitted'));
    await expect(uploadReportPhoto(PHOTO)).rejects.toThrow('Your account cannot submit reports.');
  });

  it('rejects an unreadable or empty photo before contacting the backend', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('missing file'));
    await expect(uploadReportPhoto(PHOTO)).rejects.toThrow(/could not be read/);

    mockFile([]);
    await expect(uploadReportPhoto(PHOTO)).rejects.toThrow(/photo is empty/);
    expect(post).not.toHaveBeenCalled();
  });
});
