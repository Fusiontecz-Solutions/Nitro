/**
 * Owner Review of the Nitro agreement must not delete its closing addendums.
 *
 * Review can read a freshly copied 26-page Nitro agreement before SignNow has
 * attached every widget, so the snapshot holds only the first pages' Owner
 * widgets. The template restore skipped Owner text, and the field PUT replaces
 * the whole set — so every Owner widget from page 3 on (Waiver of Personal
 * Service, Notification of Assignment, …) was deleted and those pages opened
 * empty. The Nitro agreement now gets them back from its template; other
 * funders' agreements are unchanged.
 *
 * Stubs mirror `signnow-exhibit-c-review-labels.test.ts`.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { signNowService } from './signnow.service';

const text = (id: string, name: string, page: number, y: number) => ({
  id,
  type: 'text',
  name,
  role: 'Owner',
  page_number: page,
  x: 40,
  y,
  width: 160,
  height: 12,
});
const signature = (id: string, name: string, page: number) => ({
  id,
  type: 'signature',
  name,
  role: 'Recipient 1',
  page_number: page,
  x: 300,
  y: 500,
  width: 120,
  height: 20,
});

function documents(documentName: string) {
  const base = {
    page_count: '3',
    pages: [{ page_number: 0 }, { page_number: 1 }, { page_number: 2 }],
    roles: [{ name: 'Owner' }, { name: 'Recipient 1' }],
    texts: [],
  };
  const template = {
    ...base,
    id: 'tpl-agreement',
    document_name: documentName,
    fields: [
      text('t1', 'client_legal_name', 0, 10),
      text('t2', 'client_legal_name_p23', 2, 10),
      text('t3', 'client_name_p23_g1', 2, 40),
      signature('t4', 'signature_g1_p23', 2),
    ],
  };
  // The partial copy: page-1 widget only, nothing from the addendum page yet.
  const live = {
    ...base,
    id: 'live-agreement',
    document_name: documentName,
    origin_document_id: 'tpl-agreement',
    fields: [text('l1', 'client_legal_name', 0, 10)],
  };
  return { template, live };
}

const VALUES: Record<string, string> = {
  client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
  client_name: 'MARY IRVIN',
};

async function review(documentName: string) {
  const { template, live } = documents(documentName);
  const puts: Array<{ path: string; body: any }> = [];
  const client = {
    get: jest.fn(async (path: string) => ({
      status: 200,
      data: path.includes(template.id) ? template : live,
    })),
    post: jest.fn(async () => ({ status: 200, data: {} })),
    put: jest.fn(async (path: string, body?: any) => {
      puts.push({ path, body });
      return { status: 200, data: {} };
    }),
    delete: jest.fn(async () => ({ status: 200, data: {} })),
  };
  await (signNowService as any).prefillDocument(client as any, live.id, VALUES, {
    exposeToMerchant: false,
    remote: live,
  });
  const fieldPut = puts.find(
    (call) => !/prefill-text/.test(call.path) && Array.isArray(call.body?.fields),
  );
  const prefillTexts = puts.filter((call) => /prefill-text/.test(call.path));
  return { fieldPut, prefillTexts };
}

describe('Nitro agreement Owner Review restore', () => {
  it('puts the missing addendum-page Owner widgets back with their values', async () => {
    const { fieldPut, prefillTexts } = await review('Agreement - Nitro Advance');
    expect(fieldPut).toBeDefined();
    const byName = new Map<string, any>(
      fieldPut!.body.fields.map((field: any) => [String(field.name), field]),
    );
    expect(byName.get('client_legal_name_p23')?.prefilled_text).toBe(
      'RE-NEW-IT RENOVATIONS, LLC',
    );
    expect(byName.get('client_name_p23_g1')?.prefilled_text).toBe('MARY IRVIN');
    expect(byName.get('client_name_p23_g1')?.role).toBe('Owner');
    expect(byName.get('signature_g1_p23')).toBeDefined();
    expect(byName.get('client_legal_name')).toBeDefined();
    // prefill-texts cannot address widgets the PUT has not created yet.
    for (const call of prefillTexts) {
      const names = call.body.fields.map((row: any) => row.field_name);
      expect(names).not.toContain('client_legal_name_p23');
      expect(names).not.toContain('client_name_p23_g1');
    }
  });

  it('leaves another funder agreement on the existing restore', async () => {
    const { fieldPut } = await review('Obsidian Capital Group - Agreement 1');
    const names = (fieldPut?.body.fields || []).map((field: any) => String(field.name));
    expect(names).not.toContain('client_legal_name_p23');
    expect(names).not.toContain('client_name_p23_g1');
  });
});
