import { MAX_PHOTO_BYTES, photoProblem, resolveMimeType } from '@/report/photo';

describe('resolveMimeType', () => {
  it('prefers the type the picker reported', () => {
    expect(resolveMimeType('IMAGE/JPEG', 'file:///a/b.png')).toBe('image/jpeg');
  });

  it('falls back to the file extension', () => {
    expect(resolveMimeType(null, 'file:///photos/IMG_0001.HEIC')).toBe('image/heic');
    expect(resolveMimeType(undefined, 'file:///photos/pic.jpg?x=1')).toBe('image/jpeg');
  });

  it('reports an unrecognised extension so it can be rejected', () => {
    expect(resolveMimeType(null, 'file:///docs/report.pdf')).toBe('unknown/pdf');
  });

  it('returns null when nothing can be determined', () => {
    expect(resolveMimeType(null, 'blob:http://localhost/1234')).toBeNull();
  });
});

describe('photoProblem', () => {
  it('accepts supported photo types within the size limit', () => {
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) {
      expect(photoProblem({ mimeType, fileSize: 1_000_000 })).toBeNull();
    }
    expect(photoProblem({ mimeType: 'image/jpeg', fileSize: MAX_PHOTO_BYTES })).toBeNull();
  });

  it('rejects unsupported types with a clear message', () => {
    for (const mimeType of ['application/pdf', 'video/mp4', 'image/gif', 'unknown/pdf']) {
      expect(photoProblem({ mimeType, fileSize: 1000 })).toMatch(/not supported/);
    }
  });

  it('rejects photos over 10 MB', () => {
    expect(photoProblem({ mimeType: 'image/jpeg', fileSize: MAX_PHOTO_BYTES + 1 })).toMatch(
      /larger than 10 MB/,
    );
  });

  it('leaves unknown type or size for the server to check', () => {
    expect(photoProblem({ mimeType: null, fileSize: null })).toBeNull();
  });
});
