/**
 * The merchant publish must never take text off a SignNow page.
 *
 * It used to clear the page first with `DELETE /document/{id}/text/{textId}`
 * (which removed every text element) and then stamp the deal's values. Since
 * 2026-11-12 SignNow answers that delete with 400 "internal api error" and the
 * document stays unreadable (404) for minutes; the stamping PUT made meanwhile
 * is answered 200 and lost. Every funder's contract went out blank.
 *
 * Now the page's own stamps stand — on a first send those are the Owner's
 * Finish values, i.e. what was reviewed — and the publish writes only where
 * the page is still empty. It reads the page back and fails the send when the
 * values are not there.
 *
 * `signnow.service` reaches puppeteer through its PDF helpers (stubbed, as in the
 * other service tests).
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { signNowService } from './signnow.service';
import {
  bakedTextsForStampedPage,
  collectCommittedSignNowTexts,
} from './utils/signnow-prefill-put';

const service = signNowService as any;
const DOC = 'doc-agreement';

/** An agreement after the Owner's Finish: the review values are page text. */
function finishedAgreement() {
  return {
    id: DOC,
    document_name: 'Agreement - Nitro Advance',
    page_count: '1',
    pages: [{ page_number: 0 }],
    roles: [{ name: 'Recipient 1' }],
    fields: [
      {
        id: 'sig',
        type: 'signature',
        name: 'merchant_signature',
        role: 'Recipient 1',
        page_number: 0,
        x: 10,
        y: 200,
        width: 120,
        height: 20,
      },
    ],
    texts: [
      { id: 't-legal', data: 'C. R1 CONSTRUCTION IIC', page_number: 0, x: 10, y: 10 },
      { id: 't-price', data: '20,000.00', page_number: 0, x: 10, y: 30 },
    ],
  };
}

/** Like SignNow today: texts only append, and nothing here may delete one. */
function fakeSignNow(remote: any, opts: { lose?: boolean; notFound?: boolean } = {}) {
  const calls: string[] = [];
  const client = {
    get: jest.fn(async (path: string) => {
      calls.push(`GET ${path}`);
      return opts.notFound ? { status: 404, data: { 404: 'Document not found' } } : { status: 200, data: remote };
    }),
    post: jest.fn(async () => ({ status: 200, data: {} })),
    put: jest.fn(async (path: string, body?: any) => {
      calls.push(`PUT ${path}`);
      if (/^\/document\//.test(path) && Array.isArray(body?.texts) && !opts.lose) {
        remote.texts = [...remote.texts, ...body.texts.map((t: any, i: number) => ({ id: `new-${i}`, ...t }))];
      }
      if (opts.lose) remote.texts = [];
      return { status: 200, data: {} };
    }),
    delete: jest.fn(async (path: string) => {
      calls.push(`DELETE ${path}`);
      return { status: 400, data: { errors: [{ code: 65536, message: 'internal api error' }] } };
    }),
  };
  return { client, calls };
}

describe('bakedTextsForStampedPage', () => {
  const committed = collectCommittedSignNowTexts(finishedAgreement());

  it('skips a value the page already carries and one whose spot is taken', () => {
    const out = bakedTextsForStampedPage(
      [
        { data: 'C. R1 CONSTRUCTION IIC', page_number: 0, x: 10, y: 10 }, // same value
        { data: '19,975.00', page_number: 0, x: 11, y: 31 }, // spot taken: reviewed value stands
        { data: 'C.R1 CONSTRUCTION LLC', page_number: 0, x: 10, y: 60 }, // empty spot
      ],
      committed,
    );
    expect(out.texts.map((t) => t.data)).toEqual(['C.R1 CONSTRUCTION LLC']);
    expect(out.occupied).toEqual([{ page: 0, onPage: '20,000.00', skipped: '19,975.00' }]);
  });

  it('writes everything on a page with no stamps', () => {
    const baked = [{ data: 'A', page_number: 0, x: 1, y: 1 }];
    expect(bakedTextsForStampedPage(baked, []).texts).toEqual(baked);
  });
});

describe('merchant publish on an Owner-finished agreement', () => {
  const values = {
    client_legal_name: 'C. R1 CONSTRUCTION IIC',
    purchase_price: '20,000.00',
  };

  it('never deletes page text and keeps the reviewed values on the page', async () => {
    const remote = finishedAgreement();
    const { client, calls } = fakeSignNow(remote);
    await service.prefillDocument(client, DOC, values, { exposeToMerchant: true, keepParty2: false });
    expect(calls.some((c) => c.startsWith('DELETE'))).toBe(false);
    const onPage = remote.texts.map((t: any) => t.data);
    expect(onPage).toEqual(expect.arrayContaining(['C. R1 CONSTRUCTION IIC', '20,000.00']));
  });

  it('fails the send when the page reads back without its values', async () => {
    const remote = finishedAgreement();
    const { client } = fakeSignNow(remote, { lose: true });
    await expect(
      service.prefillDocument(client, DOC, values, { exposeToMerchant: true, keepParty2: false }),
    ).rejects.toThrow(/did not stay on/);
  });
});

describe('bakedTextShortfall', () => {
  it('treats a document SignNow cannot load as a failed write', async () => {
    const { client } = fakeSignNow(finishedAgreement(), { notFound: true });
    await expect(service.bakedTextShortfall(client, DOC, 2)).resolves.toBe(
      'SignNow cannot load the document',
    );
  });

  it('passes a page that carries every value', async () => {
    const { client } = fakeSignNow(finishedAgreement());
    await expect(service.bakedTextShortfall(client, DOC, 2)).resolves.toBeNull();
  });

  it('does not fail a write it could not read back for another reason', async () => {
    const client = { get: jest.fn(async () => ({ status: 500, data: null })) };
    await expect(service.bakedTextShortfall(client, DOC, 10)).resolves.toBeNull();
  });
});
