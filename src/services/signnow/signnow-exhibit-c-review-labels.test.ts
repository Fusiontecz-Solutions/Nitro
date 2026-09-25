/**
 * Owner review must show each Exhibit C copy its own values.
 *
 * Every copy is made from one template, so `Exhibit C (2)` carries the same
 * widget labels as `Exhibit C`, and SignNow links same-label widgets inside the
 * Owner's review session — the copy rendered the first Exhibit C's values over
 * its own prefill. Send never showed it, because it bakes values as page text.
 * Review now relabels a copy's widgets (names untouched) and writes them with
 * the field PUT it would otherwise skip.
 *
 * Stubs mirror `signnow-stale-document-values.test.ts`.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { signNowService } from './signnow.service';

function exhibitCDocument(id: string, documentName: string) {
  const text = (fid: string, name: string, y: number) => ({
    id: fid,
    type: 'text',
    name,
    label: name,
    role: 'Owner',
    page_number: 0,
    x: 10,
    y,
    width: 160,
    height: 12,
  });
  return {
    id,
    document_name: documentName,
    page_count: '1',
    pages: [{ page_number: 0 }],
    roles: [{ name: 'Owner' }, { name: 'Recipient 1' }],
    fields: [
      text('f1', 'business_name', 10),
      text('f2', 'bank_name', 30),
      {
        id: 'f3',
        type: 'signature',
        name: 'merchant_signature',
        role: 'Recipient 1',
        page_number: 0,
        x: 10,
        y: 60,
        width: 120,
        height: 20,
      },
    ],
    texts: [],
  };
}

const VALUES: Record<string, string> = {
  business_name: 'SECOND ENTITY LLC',
  bank_name: 'SECOND BANK',
};

function makeClient(remote: any) {
  const puts: Array<{ path: string; body: any }> = [];
  const client = {
    get: jest.fn(async () => ({ status: 200, data: remote })),
    post: jest.fn(async () => ({ status: 200, data: {} })),
    put: jest.fn(async (path: string, body?: any) => {
      puts.push({ path, body });
      return { status: 200, data: {} };
    }),
    delete: jest.fn(async () => ({ status: 200, data: {} })),
  };
  return { client, puts };
}

const fieldPuts = (puts: Array<{ path: string; body: any }>) =>
  puts.filter((call) => !/prefill-text/.test(call.path) && Array.isArray(call.body?.fields));

async function review(documentName: string) {
  const remote = exhibitCDocument('doc-exhibit-c', documentName);
  const { client, puts } = makeClient(remote);
  await (signNowService as any).prefillDocument(client as any, remote.id, VALUES, {
    exposeToMerchant: false,
    remote,
  });
  return puts;
}

describe('Owner review of Exhibit C copies', () => {
  it('relabels a copy so SignNow cannot link it to the first Exhibit C', async () => {
    const puts = await review('Exhibit C (2)');
    const fieldPut = fieldPuts(puts)[0];
    expect(fieldPut).toBeDefined();
    const byName = new Map<string, any>(
      fieldPut.body.fields.map((field: any) => [String(field.name), field]),
    );
    expect(byName.get('business_name')?.label).toBe('business_name (copy 2)');
    expect(byName.get('bank_name')?.label).toBe('bank_name (copy 2)');
    // The copy's own values still ride on the unchanged widget names.
    expect(byName.get('business_name')?.prefilled_text).toBe('SECOND ENTITY LLC');
    expect(byName.get('merchant_signature')).toBeDefined();
  });

  it('keeps the first Exhibit C on prefill-texts only', async () => {
    const puts = await review('Exhibit C');
    expect(puts.some((call) => /prefill-text/.test(call.path))).toBe(true);
    expect(fieldPuts(puts)).toHaveLength(0);
  });

  it('does not relabel on the merchant send, which bakes page text', async () => {
    const remote = exhibitCDocument('doc-exhibit-c', 'Exhibit C (2)');
    const { client, puts } = makeClient(remote);
    await (signNowService as any).prefillDocument(client as any, remote.id, VALUES, {
      exposeToMerchant: true,
      remote,
    });
    for (const call of fieldPuts(puts)) {
      for (const field of call.body.fields) {
        expect(String(field.label || '')).not.toMatch(/\(copy \d+\)/);
      }
    }
  });
});
