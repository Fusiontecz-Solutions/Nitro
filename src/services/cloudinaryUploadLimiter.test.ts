import {
  isCloudinaryRateLimitError,
  mapWithConcurrency,
  runCloudinaryUpload,
} from './cloudinaryUploadLimiter';

function rateLimitError(): Error {
  const err = new Error('Server returned unexpected status code - 429') as Error & {
    http_code: number;
  };
  err.http_code = 429;
  return err;
}

describe('cloudinaryUploadLimiter', () => {
  const originalConcurrency = process.env.CLOUDINARY_MAX_CONCURRENT_UPLOADS;
  const originalAttempts = process.env.CLOUDINARY_UPLOAD_MAX_ATTEMPTS;

  afterEach(() => {
    process.env.CLOUDINARY_MAX_CONCURRENT_UPLOADS = originalConcurrency;
    process.env.CLOUDINARY_UPLOAD_MAX_ATTEMPTS = originalAttempts;
  });

  it('detects Cloudinary rate limit errors by http_code and message', () => {
    expect(isCloudinaryRateLimitError(rateLimitError())).toBe(true);
    expect(isCloudinaryRateLimitError(new Error('Too Many Requests'))).toBe(true);
    expect(isCloudinaryRateLimitError(new Error('invalid signature'))).toBe(false);
  });

  it('runs uploads in parallel but never above the configured concurrency', async () => {
    process.env.CLOUDINARY_MAX_CONCURRENT_UPLOADS = '3';
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        runCloudinaryUpload(`file-${i}`, async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 10));
          active -= 1;
          return i;
        }),
      ),
    );

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it('retries a 429 and resolves once the upload succeeds', async () => {
    process.env.CLOUDINARY_UPLOAD_MAX_ATTEMPTS = '3';
    let calls = 0;

    const result = await runCloudinaryUpload('retry-me', async () => {
      calls += 1;
      if (calls < 2) throw rateLimitError();
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('does not retry non-rate-limit errors', async () => {
    let calls = 0;
    await expect(
      runCloudinaryUpload('fatal', async () => {
        calls += 1;
        throw new Error('invalid image file');
      }),
    ).rejects.toThrow('invalid image file');
    expect(calls).toBe(1);
  });

  it('mapWithConcurrency preserves input order', async () => {
    const out = await mapWithConcurrency([5, 1, 3], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 2;
    });
    expect(out).toEqual([10, 2, 6]);
  });
});
