/**
 * Owner review must show each Exhibit C copy its own values.
 *
 * Every copy is made from one template, so `Exhibit C (2)` carries the same
 * widget names as `Exhibit C`, and SignNow links same-named widgets across the
 * group in the Owner's review session — the copy rendered the first Exhibit C's
 * values over its own prefill. A unique label did not break the link (and
 * showed as a `name (copy 2)` placeholder); a unique name does. Send never
 * showed it, because it bakes values as page text, and it writes the original
 * names back.
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
      // Like SignNow: texts sent with the document PUT are kept on the page,
      // which the merchant publish reads back before it reports success.
      if (/^\/document\//.test(path) && Array.isArray(body?.texts)) {
        remote.texts = [...(remote.texts || []), ...body.texts];
      }
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
  it('renames a copy so SignNow cannot link it to the first Exhibit C', async () => {
    const puts = await review('Exhibit C (2)');
    const fieldPut = fieldPuts(puts)[0];
    expect(fieldPut).toBeDefined();
    const byName = new Map<string, any>(
      fieldPut.body.fields.map((field: any) => [String(field.name), field]),
    );
    expect(byName.has('business_name')).toBe(false);
    expect(byName.get('business_name__copy2')?.prefilled_text).toBe('SECOND ENTITY LLC');
    expect(byName.get('bank_name__copy2')?.prefilled_text).toBe('SECOND BANK');
    // No `(copy 2)` label for SignNow to show as a placeholder.
    expect(String(byName.get('bank_name__copy2')?.label || '')).not.toMatch(/\(copy \d+\)/);
    expect(byName.get('merchant_signature')).toBeDefined();
    // prefill-texts would address the old names; the field PUT carries the values.
    expect(puts.some((call) => /prefill-text/.test(call.path))).toBe(false);
  });

  it('removes a (copy 2) label an earlier build left on the copy', async () => {
    const remote = exhibitCDocument('doc-exhibit-c', 'Exhibit C (2)');
    for (const field of remote.fields as any[]) {
      if (field.type === 'text') field.label = `${field.name} (copy 2)`;
    }
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

  it('keeps the first Exhibit C on prefill-texts only', async () => {
    const puts = await review('Exhibit C');
    expect(puts.some((call) => /prefill-text/.test(call.path))).toBe(true);
    expect(fieldPuts(puts)).toHaveLength(0);
  });

  it('keeps the original names on the merchant send, which bakes page text', async () => {
    const remote = exhibitCDocument('doc-exhibit-c', 'Exhibit C (2)');
    const { client, puts } = makeClient(remote);
    await (signNowService as any).prefillDocument(client as any, remote.id, VALUES, {
      exposeToMerchant: true,
      remote,
    });
    expect(fieldPuts(puts).length).toBeGreaterThan(0);
    for (const call of fieldPuts(puts)) {
      for (const field of call.body.fields) {
        expect(String(field.label || '')).not.toMatch(/\(copy \d+\)/);
        expect(String(field.name || '')).not.toMatch(/__copy\d+$/);
      }
    }
  });
});
