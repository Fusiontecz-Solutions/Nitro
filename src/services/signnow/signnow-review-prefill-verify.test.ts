/**
 * Review in SignNow must not open until every document reads back prefilled.
 *
 * The first Review on a fresh package used to open with Disclosure / Contract /
 * Addendum widgets empty, and a second Review filled them. The prefill was
 * planned from a `GET /document/{id}` snapshot taken while SignNow was still
 * attaching the copy's widgets, so the ones that arrived later were never
 * written — and nothing checked before the review link was minted.
 *
 * These tests drive the gate against a fake SignNow document whose widgets
 * really change when prefill-texts writes to them.
 *
 * `signnow.service` reaches puppeteer through the funder/PDF helpers it imports
 * and Jest cannot parse that package's ESM build, so it is stubbed; the template
 * store is stubbed so the restore path never touches the database.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { signNowService } from './signnow.service';

const DOC_ID = 'doc-agreement';

type Widget = Record<string, any>;

const widget = (id: string, name: string, y: number): Widget => ({
  id,
  type: 'text',
  name,
  role: 'Owner',
  page_number: 0,
  x: 10,
  y,
  width: 120,
  height: 12,
});

const signature = (): Widget => ({
  id: 'sig',
  type: 'signature',
  name: 'sig_1',
  role: 'Recipient 1',
  page_number: 0,
  x: 10,
  y: 200,
  width: 120,
  height: 20,
});

function payload(fields: Widget[], extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    id: DOC_ID,
    document_name: 'Agreement - Nitro Advance',
    page_count: '1',
    pages: [{ page_number: 0 }],
    roles: [{ name: 'Owner' }, { name: 'Recipient 1' }],
    fields,
    texts: [],
  };
}

/** A SignNow document whose widgets hold what prefill-texts wrote to them. */
function fakeSignNow(
  options: {
    persistWrites?: boolean;
    live?: Widget[];
    /** Template the copy was made from, served at `/document/{id}`. */
    origin?: { id: string; fields: Widget[] };
  } = {},
) {
  const persist = options.persistWrites !== false;
  const live: Widget[] = options.live ?? [
    widget('f1', 'client_name', 10),
    widget('f3', 'business_address', 50),
    widget('f4', 'remittance', 70),
    signature(),
  ];
  const origin = options.origin;
  const extra = origin ? { origin_document_id: origin.id } : {};
  const client = {
    get: jest.fn(async (path: string) => {
      if (path === `/document/${DOC_ID}`) {
        return { status: 200, data: payload(live.map((w) => ({ ...w })), extra) };
      }
      if (origin && path === `/document/${origin.id}`) {
        return { status: 200, data: { ...payload(origin.fields), id: origin.id } };
      }
      return { status: 404, data: {} };
    }),
    post: jest.fn(async () => ({ status: 200, data: {} })),
    put: jest.fn(async (path: string, body?: any) => {
      if (persist && path.includes('/prefill-text') && Array.isArray(body?.fields)) {
        for (const row of body.fields) {
          const target = live.find((w) => w.name === row.field_name);
          if (target) target.prefilled_text = row.prefilled_text;
        }
      }
      return { status: 200, data: {} };
    }),
    delete: jest.fn(async () => ({ status: 200, data: {} })),
  };
  const value = (name: string) => live.find((w) => w.name === name)?.prefilled_text;
  const readBacks = () =>
    client.get.mock.calls.filter(([path]) => path === `/document/${DOC_ID}`).length;
  return { client, live, value, readBacks };
}

const CRM_VALUES: Record<string, string> = {
  client_name: 'MARY IRVIN',
  business_address: '3273 Cove Creek Road',
  remittance: '2,248.50',
};

const SIGNERS = [{ name: 'Mary Irvin', email: 'mary@example.com', roleName: 'Recipient 1' }];

async function prefillThenVerify(
  client: any,
  documents: Array<Record<string, unknown>>,
) {
  const prefill = await (signNowService as any).prefillDocumentsForReview(
    client,
    documents,
    { ...CRM_VALUES },
    SIGNERS,
  );
  return (signNowService as any).ensureReviewPrefillComplete(client, 'group-1', prefill.outcomes, {
    requireFields: true,
  });
}

describe('Review in SignNow waits until the documents read back prefilled', () => {
  it('re-prefills widgets a stale snapshot missed, then lets Review open', async () => {
    const signNow = fakeSignNow();
    // The snapshot the group hydrate took before SignNow attached the address
    // and remittance widgets — the first-click state.
    const stale = payload([widget('f1', 'client_name', 10), signature()]);
    const result = await prefillThenVerify(signNow.client, [
      { id: DOC_ID, document_name: 'Agreement - Nitro Advance', remote: stale },
    ]);

    expect(result).toEqual({ rounds: 2, repaired: 1 });
    expect(signNow.value('client_name')).toBe('MARY IRVIN');
    expect(signNow.value('business_address')).toBe('3273 COVE CREEK ROAD');
    expect(signNow.value('remittance')).toBe('2,248.50');
  });

  it('opens on the first read-back when every widget already took its value', async () => {
    const signNow = fakeSignNow();
    const result = await prefillThenVerify(signNow.client, [
      { id: DOC_ID, document_name: 'Agreement - Nitro Advance' },
    ]);

    expect(result).toEqual({ rounds: 1, repaired: 0 });
    expect(signNow.value('business_address')).toBe('3273 COVE CREEK ROAD');
  });

  it('refuses to open Review when the values never land', async () => {
    // SignNow accepts the write but the document keeps coming back empty.
    const signNow = fakeSignNow({ persistWrites: false });
    await expect(
      prefillThenVerify(signNow.client, [{ id: DOC_ID, document_name: 'Agreement - Nitro Advance' }]),
    ).rejects.toThrow(/not opened.*Agreement - Nitro Advance \(3 fields empty\)/);
    // Three read-backs, with a fresh re-prefill between each.
    expect(signNow.readBacks()).toBeGreaterThanOrEqual(3);
  }, 15_000);

  it('refuses to open Review on a document that cannot be read back', async () => {
    const signNow = fakeSignNow();
    const prefill = await (signNowService as any).prefillDocumentsForReview(
      signNow.client,
      [{ id: DOC_ID, document_name: 'Agreement - Nitro Advance' }],
      { ...CRM_VALUES },
      SIGNERS,
    );
    signNow.client.get.mockImplementation(async () => ({ status: 503, data: {} }));
    await expect(
      (signNowService as any).ensureReviewPrefillComplete(signNow.client, 'group-1', prefill.outcomes, {
        requireFields: true,
      }),
    ).rejects.toThrow(/could not be read back/);
  }, 15_000);

  it('holds Review back while a fresh copy has not received its widgets yet', async () => {
    // SignNow never attaches the template's widgets to this copy.
    const signNow = fakeSignNow({
      live: [],
      origin: { id: 'tpl-with-widgets', fields: [widget('t1', 'client_name', 10), signature()] },
    });
    await expect(
      prefillThenVerify(signNow.client, [{ id: DOC_ID, document_name: 'Agreement - Nitro Advance' }]),
    ).rejects.toThrow(/Agreement - Nitro Advance \(fields not loaded yet\)/);
  }, 15_000);

  it('does not hold Review back on a document whose template has no widgets', async () => {
    // An information-only page is complete as it is.
    const signNow = fakeSignNow({ live: [], origin: { id: 'tpl-without-widgets', fields: [] } });
    const result = await prefillThenVerify(signNow.client, [
      { id: DOC_ID, document_name: 'Agreement - Nitro Advance' },
    ]);
    expect(result).toEqual({ rounds: 1, repaired: 0 });
  });
});
