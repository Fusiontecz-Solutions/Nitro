import {
  clearCloudinaryAssetCache,
  fetchCloudinaryAssetBuffer,
} from './cloudinaryAssetDownload';

jest.mock('../config/cloudinary', () => ({
  cloudinary: {
    config: jest.fn(),
    utils: { private_download_url: jest.fn(() => 'https://api.cloudinary.com/dl') },
  },
}));

const URL_OURS = 'https://res.cloudinary.com/ourcloud/image/upload/v1/contracts/template.pdf';

function okResponse(text: string): Response {
  return new Response(Buffer.from(text), { status: 200 });
}

describe('fetchCloudinaryAssetBuffer', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    clearCloudinaryAssetCache();
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    process.env.CLOUD_NAME = 'ourcloud';
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
  });

  async function run(url: string): Promise<Buffer> {
    const p = fetchCloudinaryAssetBuffer(url);
    await jest.runAllTimersAsync();
    return p;
  }

  it('retries a transient 502 on the public URL', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockResolvedValueOnce(okResponse('%PDF-ok'));
    const buf = await run(URL_OURS);
    expect(buf.toString()).toBe('%PDF-ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the authenticated download when the public fetch keeps throwing', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse('%PDF-auth'));
    const buf = await run(URL_OURS);
    expect(buf.toString()).toBe('%PDF-auth');
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.cloudinary.com/dl', expect.anything());
  });

  it('does not retry a 401 and goes straight to the authenticated download', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(okResponse('%PDF-auth'));
    const buf = await run(URL_OURS);
    expect(buf.toString()).toBe('%PDF-auth');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('serves repeat requests for the same URL from cache', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('%PDF-ok'));
    await run(URL_OURS);
    const again = await run(URL_OURS);
    expect(again.toString()).toBe('%PDF-ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
