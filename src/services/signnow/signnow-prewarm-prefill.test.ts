/**
 * The `structureOnly` pre-warm must write the deal, not just the roles.
 *
 * The warm copies the package and prepares every document's Owner field roles so
 * the later Review click only has to prefill and mint a link. It did that by
 * prefilling each document with an EMPTY value map, which writes only what the
 * field resolver can invent with no inputs at all — the agreement date, `OWNER`,
 * `0.00`. A package that was warmed and then reviewed therefore showed the
 * contract and every addendum blank whenever Review's own prefill did not land
 * on top of it, on every funder.
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

/** A slice of the live Nitro agreement: CRM-filled widgets plus a signature. */
function agreementFields() {
  return [
    { id: 'f1', type: 'text', name: 'client_name', role: 'Owner', page_number: 0, x: 10, y: 10, width: 120, height: 12 },
    { id: 'f2', type: 'text', name: 'client_legal_name', role: 'Owner', page_number: 0, x: 10, y: 30, width: 120, height: 12 },
    { id: 'f3', type: 'text', name: 'business_address', role: 'Owner', page_number: 0, x: 10, y: 50, width: 120, height: 12 },
    { id: 'f4', type: 'text', name: 'remittance', role: 'Owner', page_number: 0, x: 10, y: 70, width: 120, height: 12 },
    { id: 'f5', type: 'text', name: 'agreement_date', role: 'Owner', page_number: 0, x: 10, y: 90, width: 120, height: 12 },
    { id: 'f6', type: 'signature', name: 'sig_1', role: 'Recipient 1', page_number: 0, x: 10, y: 110, width: 120, height: 20 },
  ];
}

function documentPayload() {
  return {
    id: DOC_ID,
    document_name: 'Agreement - Nitro Advance',
    page_count: '1',
    pages: [{ page_number: 0 }],
    roles: [{ name: 'Owner' }, { name: 'Recipient 1' }],
    fields: agreementFields(),
    texts: [],
  };
}

function makeClient() {
  const prefillTexts: Array<{ field_name: string; prefilled_text: string }> = [];
  const client = {
    get: jest.fn(async () => ({ status: 200, data: documentPayload() })),
    post: jest.fn(async () => ({ status: 200, data: {} })),
    put: jest.fn(async (path: string, body?: any) => {
      if (path.includes('/prefill-text') && Array.isArray(body?.fields)) {
        prefillTexts.push(...body.fields);
      }
      return { status: 200, data: {} };
    }),
    delete: jest.fn(async () => ({ status: 200, data: {} })),
  };
  return { client, prefillTexts };
}

const CRM_VALUES: Record<string, string> = {
  client_name: 'MARY IRVIN',
  legal_name: 'Re-New-It Renovations, LLC',
  business_address: '3273 Cove Creek Road',
  remittance: '2,248.50',
};

async function warm(values?: Record<string, string>) {
  const { client, prefillTexts } = makeClient();
  const documents = [{ id: DOC_ID, document_name: 'Agreement - Nitro Advance', roles: [] }];
  await (signNowService as any).prepareOwnerReviewFieldRoles(
    client as any,
    documents,
    '', // no application id — keeps the draft-group cache out of this
    '',
    `fingerprint-${Math.random()}`,
    values,
  );
  const byName: Record<string, string> = {};
  for (const row of prefillTexts) byName[row.field_name] = row.prefilled_text;
  return byName;
}

describe('the structure-only pre-warm seeds the documents with the deal', () => {
  it('writes the CRM values onto the warmed document', async () => {
    const written = await warm(CRM_VALUES);
    expect(written.client_name).toBe('MARY IRVIN');
    expect(written.client_legal_name).toBe('Re-New-It Renovations, LLC');
    expect(written.business_address).toBe('3273 Cove Creek Road');
    expect(written.remittance).toBe('2,248.50');
  });

  it('still stamps the values the resolver invents without any inputs', async () => {
    const written = await warm(CRM_VALUES);
    expect(written.agreement_date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it('leaves the CRM widgets blank when it is given no values — the old behaviour', async () => {
    // Guards the regression itself: with an empty map the warm can only stamp
    // the invented date, which is exactly the "blank contract" the CRM reported.
    const written = await warm({});
    expect(written.client_name).toBeUndefined();
    expect(written.client_legal_name).toBeUndefined();
    expect(written.remittance).toBeUndefined();
    expect(written.agreement_date).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});
