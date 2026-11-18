const findUnique = jest.fn();
const upsert = jest.fn();
const deleteMany = jest.fn();

jest.mock('../../../config/prismaClient', () => ({
  __esModule: true,
  default: {
    signNowTemplatePdf: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      upsert: (...args: unknown[]) => upsert(...args),
      deleteMany: (...args: unknown[]) => deleteMany(...args),
    },
  },
}));

const fetchStoredSignedPdfBuffer = jest.fn();
jest.mock('../../docusign/utils/archive-signed-envelope-pdf', () => ({
  __esModule: true,
  fetchStoredSignedPdfBuffer: (...args: unknown[]) => fetchStoredSignedPdfBuffer(...args),
}));

const uploadPdfBufferToCloudinary = jest.fn();
jest.mock('../../docusign/utils/cloudinary-pdf-upload', () => ({
  __esModule: true,
  uploadPdfBufferToCloudinary: (...args: unknown[]) => uploadPdfBufferToCloudinary(...args),
}));

import {
  archiveTemplatePdf,
  readStoredTemplatePdfArchive,
  resolveTemplatePdf,
} from './signnow-template-pdf-archive';

const TEMPLATE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1';

function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    signnowTemplateId: TEMPLATE_ID,
    pdfUrl: 'https://res.cloudinary.com/demo/image/upload/exhibit_c.pdf',
    pdfPublicId: 'ih-crm/signnow-template-pdfs/addendum/exhibit_c',
    layoutKey: 'exhibit_c',
    name: 'Exhibit C',
    type: 'addendum',
    byteSize: 4,
    fetchedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  findUnique.mockReset();
  upsert.mockReset();
  deleteMany.mockReset();
  fetchStoredSignedPdfBuffer.mockReset();
  uploadPdfBufferToCloudinary.mockReset();
});

describe('template PDF archive', () => {
  it('serves an archived template from Cloudinary without touching SignNow', async () => {
    findUnique.mockResolvedValue(storedRow());
    fetchStoredSignedPdfBuffer.mockResolvedValue(Buffer.from('%PDF'));
    const fetchFromSignNow = jest.fn();

    const pdf = await resolveTemplatePdf({
      identity: { signnowTemplateId: TEMPLATE_ID, layoutKey: 'exhibit_c' },
      fetchFromSignNow,
    });

    expect(pdf.toString()).toBe('%PDF');
    expect(fetchFromSignNow).not.toHaveBeenCalled();
    expect(uploadPdfBufferToCloudinary).not.toHaveBeenCalled();
  });

  it('fetches from SignNow once on a cold archive and stores the result', async () => {
    findUnique.mockResolvedValue(null);
    uploadPdfBufferToCloudinary.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/exhibit_c.pdf',
      publicId: 'public-id',
      byteSize: 4,
    });
    upsert.mockResolvedValue(storedRow());
    const fetchFromSignNow = jest
      .fn()
      .mockResolvedValue({ pdf: Buffer.from('%PDF'), originDocumentId: 'doc-1' });

    const pdf = await resolveTemplatePdf({
      identity: {
        signnowTemplateId: TEMPLATE_ID,
        layoutKey: 'exhibit_c',
        name: 'Exhibit C',
        type: 'addendum',
      },
      fetchFromSignNow,
    });

    expect(pdf.toString()).toBe('%PDF');
    expect(fetchFromSignNow).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0].create).toMatchObject({
      signnowTemplateId: TEMPLATE_ID,
      originDocumentId: 'doc-1',
      layoutKey: 'exhibit_c',
      type: 'addendum',
    });
  });

  it('coalesces concurrent cold previews onto a single SignNow fetch', async () => {
    findUnique.mockResolvedValue(null);
    uploadPdfBufferToCloudinary.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/exhibit_c.pdf',
      publicId: 'public-id',
      byteSize: 4,
    });
    upsert.mockResolvedValue(storedRow());
    const fetchFromSignNow = jest
      .fn()
      .mockResolvedValue({ pdf: Buffer.from('%PDF'), originDocumentId: 'doc-1' });

    const identity = { signnowTemplateId: TEMPLATE_ID, type: 'addendum' };
    const [a, b] = await Promise.all([
      resolveTemplatePdf({ identity, fetchFromSignNow }),
      resolveTemplatePdf({ identity, fetchFromSignNow }),
    ]);

    expect(a.toString()).toBe('%PDF');
    expect(b.toString()).toBe('%PDF');
    expect(fetchFromSignNow).toHaveBeenCalledTimes(1);
  });

  it('re-fetches when the stored URL no longer resolves', async () => {
    findUnique.mockResolvedValue(storedRow());
    fetchStoredSignedPdfBuffer.mockResolvedValue(null);
    uploadPdfBufferToCloudinary.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/exhibit_c.pdf',
      publicId: 'public-id',
      byteSize: 4,
    });
    upsert.mockResolvedValue(storedRow());
    const fetchFromSignNow = jest.fn().mockResolvedValue({ pdf: Buffer.from('%PDF') });

    await resolveTemplatePdf({
      identity: { signnowTemplateId: TEMPLATE_ID },
      fetchFromSignNow,
    });

    expect(fetchFromSignNow).toHaveBeenCalledTimes(1);
  });

  it('still serves the preview when archiving fails', async () => {
    findUnique.mockResolvedValue(null);
    uploadPdfBufferToCloudinary.mockResolvedValue(null);
    const fetchFromSignNow = jest.fn().mockResolvedValue({ pdf: Buffer.from('%PDF') });

    const pdf = await resolveTemplatePdf({
      identity: { signnowTemplateId: TEMPLATE_ID },
      fetchFromSignNow,
    });

    expect(pdf.toString()).toBe('%PDF');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('is idempotent: an existing archive is not re-uploaded', async () => {
    findUnique.mockResolvedValue(storedRow());

    const result = await archiveTemplatePdf({
      identity: { signnowTemplateId: TEMPLATE_ID },
      pdf: Buffer.from('%PDF'),
    });

    expect(result?.pdfUrl).toContain('exhibit_c.pdf');
    expect(uploadPdfBufferToCloudinary).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('replaces the archive when a refresh is forced', async () => {
    findUnique.mockResolvedValue(storedRow());
    uploadPdfBufferToCloudinary.mockResolvedValue({
      url: 'https://res.cloudinary.com/demo/image/upload/exhibit_c_v2.pdf',
      publicId: 'public-id-2',
      byteSize: 4,
    });
    upsert.mockResolvedValue(
      storedRow({ pdfUrl: 'https://res.cloudinary.com/demo/image/upload/exhibit_c_v2.pdf' }),
    );

    const result = await archiveTemplatePdf({
      identity: { signnowTemplateId: TEMPLATE_ID },
      pdf: Buffer.from('%PDF'),
      replaceExisting: true,
    });

    expect(uploadPdfBufferToCloudinary).toHaveBeenCalledTimes(1);
    expect(result?.pdfUrl).toContain('exhibit_c_v2.pdf');
  });

  it('never throws when the archive table is unreachable', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    await expect(readStoredTemplatePdfArchive(TEMPLATE_ID)).resolves.toBeNull();
  });
});
