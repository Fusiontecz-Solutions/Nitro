/**
 * A value already on a SignNow widget must never outrank the value this send
 * carries for it.
 *
 * `collectExistingSignNowFieldValues` reads the document into the prefill map
 * keyed by each widget's OWN name (`total_fees_p2`, `business_address_p1`), and
 * `resolveSignNowPrefillValue` tries the widget name before any CRM alias — so
 * layering the CRM values on top of that map did not actually let them win.
 * Whatever the `structureOnly` pre-warm had stamped therefore survived the
 * Review that followed it: the package opened showing the warm's placeholder
 * amounts, and a "$25 wire fee" switched off after the warm was still printed.
 * The second Review only looked right because the changed values had by then
 * forced the group to be rebuilt from the template.
 *
 * `signnow.service` reaches puppeteer through the funder/PDF helpers it imports
 * and Jest cannot parse that package's ESM build, so it is stubbed; the template
 * store is stubbed so the restore path never touches the database.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { signNowService } from './signnow.service';

const DOC_ID = 'doc-agreement';

/** The document as the pre-warm left it: stale money, a placeholder title. */
function warmedDocument() {
  return {
    id: DOC_ID,
    document_name: 'Agreement - Nitro Advance',
    page_count: '1',
    pages: [{ page_number: 0 }],
    roles: [{ name: 'Owner' }, { name: 'Recipient 1' }],
    fields: [
      {
        id: 'f1',
        type: 'text',
        name: 'total_fees_p2',
        role: 'Owner',
        page_number: 0,
        x: 10,
        y: 10,
        width: 120,
        height: 12,
        prefilled_text: '1,025.00',
      },
      {
        id: 'f2',
        type: 'text',
        name: 'net_to_merchant_p2',
        role: 'Owner',
        page_number: 0,
        x: 10,
        y: 30,
        width: 120,
        height: 12,
        prefilled_text: '8,975.00',
      },
      {
        id: 'f3',
        type: 'text',
        name: 'business_address_p1',
        role: 'Owner',
        page_number: 0,
        x: 10,
        y: 50,
        width: 120,
        height: 12,
        prefilled_text: '1 OLD STREET',
      },
      {
        // Nothing in the CRM map fills this — the merchant types it in SignNow.
        id: 'f4',
        type: 'text',
        name: 'ach_username_p20',
        role: 'Recipient 1',
        page_number: 0,
        x: 10,
        y: 70,
        width: 120,
        height: 12,
        prefilled_text: 'mary.irvin',
      },
      {
        id: 'f5',
        type: 'signature',
        name: 'sig_1',
        role: 'Recipient 1',
        page_number: 0,
        x: 10,
        y: 90,
        width: 120,
        height: 20,
      },
    ],
    texts: [],
  };
}

/** Review's own values: the wire fee has since been switched off. */
const CRM_VALUES: Record<string, string> = {
  purchase_price: '10,000.00',
  purchase_amount: '10,000.00',
  appendix_underwriting_fees: '1,000.00',
  total_fees: '1,000.00',
  net_to_merchant: '9,000.00',
  business_address: '218 LAUREL WOODS',
};

function makeClient() {
  const puts: Array<{ path: string; body: any }> = [];
  const client = {
    get: jest.fn(async () => ({ status: 200, data: warmedDocument() })),
    post: jest.fn(async () => ({ status: 200, data: {} })),
    put: jest.fn(async (path: string, body?: any) => {
      puts.push({ path, body });
      return { status: 200, data: {} };
    }),
    delete: jest.fn(async () => ({ status: 200, data: {} })),
  };
  return { client, puts };
}

async function prefill(): Promise<Record<string, string>> {
  const { client, puts } = makeClient();
  await (signNowService as any).prefillDocument(client as any, DOC_ID, CRM_VALUES);
  const written: Record<string, string> = {};
  for (const call of puts) {
    for (const field of Array.isArray(call.body?.fields) ? call.body.fields : []) {
      const name = String(field?.name || '');
      const text = String(field?.prefilled_text ?? '');
      if (name && text) written[name] = text;
    }
    for (const field of Array.isArray(call.body?.fields) ? call.body.fields : []) {
      const name = String(field?.name || '');
      if (name && !String(field?.prefilled_text ?? '').trim()) delete written[name];
    }
  }
  return written;
}

describe('a Review landing on a document the pre-warm already stamped', () => {
  it('replaces the stale total with the one this send carries', async () => {
    const written = await prefill();
    expect(written.total_fees_p2).toBe('1,000.00');
  });

  it('replaces the stale net amount', async () => {
    const written = await prefill();
    expect(written.net_to_merchant_p2).toBe('9,000.00');
  });

  it('replaces a stale address', async () => {
    const written = await prefill();
    expect(written.business_address_p1).toBe('218 LAUREL WOODS');
  });

  it('leaves a merchant-typed value the CRM has nothing for', async () => {
    const written = await prefill();
    expect(written.ach_username_p20).toBe('mary.irvin');
  });
});
