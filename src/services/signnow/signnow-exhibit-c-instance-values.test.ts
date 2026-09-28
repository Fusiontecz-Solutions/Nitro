/**
 * Every Exhibit C copy must reach SignNow with its own CRM record.
 *
 * All copies are made from one template, so `Exhibit C`, `Exhibit C (2)` and
 * `Exhibit C (3)` carry identical widget names; only the document name says
 * which entity slot a copy belongs to. Two writes used to leak Exhibit C #1's
 * values onto the extra copies:
 *
 *  - the structure-only warm prefilled every copy from the package map with no
 *    entities, seeding `Exhibit C (2)` with the first copy's merchant and bank;
 *  - Review then replaced only the widgets the copy's own record fills, so any
 *    widget that record leaves blank kept the warm's (copy #1's) text.
 *
 * Stubs mirror `signnow-prewarm-prefill.test.ts`.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { signNowService } from './signnow.service';

/** The named Exhibit C layout (Nitro / Tiberian), with optional stale values. */
function exhibitCDocument(id: string, documentName: string, stale: Record<string, string> = {}) {
  const text = (fid: string, name: string, y: number) => ({
    id: fid,
    type: 'text',
    name,
    label: name,
    role: 'Owner',
    page_number: 0,
    x: 40,
    y,
    width: 220,
    height: 12,
    ...(stale[name] ? { prefilled_text: stale[name] } : {}),
  });
  return {
    id,
    document_name: documentName,
    page_count: '1',
    pages: [{ page_number: 0 }],
    roles: [{ name: 'Owner' }, { name: 'Recipient 1' }],
    fields: [
      text(`${id}-1`, 'agreement_date_p1', 64),
      text(`${id}-2`, 'client_legal_name_p1', 79),
      text(`${id}-3`, 'ach_account_holder_name_p1', 334),
      text(`${id}-4`, 'ach_account_holder_dba_p1', 358),
      text(`${id}-5`, 'ach_account_holder_address_p1', 386),
      text(`${id}-6`, 'ach_bank_name_p1', 468),
      text(`${id}-7`, 'ach_bank_account_p1', 519),
      text(`${id}-8`, 'ach_bank_routing_p1', 546),
      {
        id: `${id}-9`,
        type: 'initials',
        name: 'initial_g1_p1',
        role: 'Recipient 1',
        page_number: 0,
        x: 40,
        y: 722,
        width: 60,
        height: 20,
      },
    ],
    texts: [],
  };
}

/** Package-wide CRM values: the deal's own merchant, i.e. Exhibit C #1. */
const PACKAGE_VALUES: Record<string, string> = {
  client_legal_name: 'MERCHANT A LLC',
  client_name: 'MARY IRVIN',
  ach_account_holder_name: 'MERCHANT A LLC',
  ach_account_holder_dba: 'MERCHANT A',
  ach_account_holder_address: '12 Main St, Austin, TX 78701',
  ach_bank_name: 'CHASE',
  ach_bank_account: '1111111111',
  ach_bank_routing: '111000614',
  agreement_date: '09/28/2026',
};

const ENTITY_2 = {
  accountHolderName: 'MERCHANT B LLC',
  accountHolderDba: 'MERCHANT B',
  bankName: 'WELLS FARGO',
  bankAccount: '2222222222',
  bankRouting: '121000248',
};

const ENTITY_3 = {
  accountHolderName: 'MERCHANT C LLC',
  bankName: 'BANK OF AMERICA',
  bankAccount: '3333333333',
  // No DBA, address or routing: optional values left empty in the CRM.
};

function makeClient(remotes: Record<string, any>) {
  const prefillTexts: Record<string, Record<string, string>> = {};
  const fieldPuts: Record<string, any[]> = {};
  const idFromPath = (path: string) =>
    String(path.match(/\/(?:document|documents)\/([^/]+)/)?.[1] || '');
  const client = {
    get: jest.fn(async (path: string) => ({ status: 200, data: remotes[idFromPath(path)] })),
    post: jest.fn(async () => ({ status: 200, data: {} })),
    put: jest.fn(async (path: string, body?: any) => {
      const id = idFromPath(path);
      if (/prefill-text/.test(path) && Array.isArray(body?.fields)) {
        prefillTexts[id] = prefillTexts[id] || {};
        for (const row of body.fields) prefillTexts[id][row.field_name] = row.prefilled_text;
      } else if (Array.isArray(body?.fields)) {
        (fieldPuts[id] = fieldPuts[id] || []).push(body.fields);
        // A renamed Exhibit C copy writes its values in the field PUT instead.
        for (const field of body.fields) {
          const value = String(field.prefilled_text || '').trim();
          if (!value) continue;
          prefillTexts[id] = prefillTexts[id] || {};
          prefillTexts[id][baseName(field.name)] = value;
        }
      }
      return { status: 200, data: {} };
    }),
    delete: jest.fn(async () => ({ status: 200, data: {} })),
  };
  return { client, prefillTexts, fieldPuts };
}

/** Widget name without the Review-only `__copyN` suffix. */
const baseName = (name: unknown) => String(name || '').replace(/__copy\d+$/, '');

/** The last field PUT for a document, by original widget name. */
function lastFieldPut(fieldPuts: Record<string, any[]>, id: string): Map<string, any> {
  const calls = fieldPuts[id] || [];
  const last = calls[calls.length - 1] || [];
  return new Map(last.map((field: any) => [baseName(field.name), field]));
}

async function warm(documentNames: string[], entities: unknown[]) {
  const remotes: Record<string, any> = {};
  const documents = documentNames.map((name, i) => {
    const id = `doc-${i + 1}`;
    remotes[id] = exhibitCDocument(id, name);
    return { id, document_name: name, roles: [] };
  });
  const { client, prefillTexts, fieldPuts } = makeClient(remotes);
  await (signNowService as any).prepareOwnerReviewFieldRoles(
    client as any,
    documents,
    '', // no application id — keeps the draft-group cache out of this
    '',
    `fingerprint-${Math.random()}`,
    PACKAGE_VALUES,
    [],
    entities,
  );
  return { prefillTexts, fieldPuts };
}

describe('the warm prefills each Exhibit C copy from its own entity', () => {
  it('keeps a single Exhibit C on the package values', async () => {
    const { prefillTexts } = await warm(['Exhibit C'], []);
    expect(prefillTexts['doc-1'].ach_account_holder_name_p1).toBe('MERCHANT A LLC');
    expect(prefillTexts['doc-1'].ach_bank_name_p1).toBe('CHASE');
  });

  it('gives Exhibit C (2) its own values, not Exhibit C #1', async () => {
    const { prefillTexts } = await warm(['Exhibit C', 'Exhibit C (2)'], [{}, ENTITY_2]);
    expect(prefillTexts['doc-1'].ach_bank_name_p1).toBe('CHASE');
    expect(prefillTexts['doc-1'].ach_bank_account_p1).toBe('1111111111');
    expect(prefillTexts['doc-2'].ach_account_holder_name_p1).toBe('MERCHANT B LLC');
    expect(prefillTexts['doc-2'].ach_account_holder_dba_p1).toBe('MERCHANT B');
    expect(prefillTexts['doc-2'].ach_bank_name_p1).toBe('WELLS FARGO');
    expect(prefillTexts['doc-2'].ach_bank_account_p1).toBe('2222222222');
    expect(prefillTexts['doc-2'].ach_bank_routing_p1).toBe('121000248');
  });

  it('keeps three copies apart and leaves an unset optional value blank', async () => {
    const { prefillTexts, fieldPuts } = await warm(
      ['Exhibit C', 'Exhibit C (2)', 'Exhibit C (3)'],
      [{}, ENTITY_2, ENTITY_3],
    );
    expect(prefillTexts['doc-1'].ach_bank_account_p1).toBe('1111111111');
    expect(prefillTexts['doc-2'].ach_bank_account_p1).toBe('2222222222');
    expect(prefillTexts['doc-3'].ach_bank_account_p1).toBe('3333333333');
    expect(prefillTexts['doc-3'].ach_bank_name_p1).toBe('BANK OF AMERICA');
    // Copy 3 set no DBA or routing: never Exhibit C #1's (or #2's).
    expect(prefillTexts['doc-3'].ach_account_holder_dba_p1).toBeUndefined();
    expect(prefillTexts['doc-3'].ach_bank_routing_p1).toBeUndefined();
    const copy3 = lastFieldPut(fieldPuts, 'doc-3');
    expect(copy3.get('ach_account_holder_dba_p1')?.prefilled_text).toBeUndefined();
    expect(copy3.get('ach_bank_routing_p1')?.prefilled_text).toBeUndefined();
    // Duplicate widget names are told apart by a per-copy name in Review.
    expect(fieldPuts['doc-3'].at(-1)?.some((f: any) => f.name === 'ach_bank_name_p1__copy3')).toBe(true);
    expect(copy3.get('ach_bank_name_p1')?.prefilled_text).toBe('BANK OF AMERICA');
    expect(copy3.get('initial_g1_p1')).toBeDefined();
  });

  it('fills an extra copy with no entity of its own from the deal merchant', async () => {
    const { prefillTexts } = await warm(['Exhibit C', 'Exhibit C (2)'], [{}, {}]);
    expect(prefillTexts['doc-2'].ach_bank_name_p1).toBe('CHASE');
    expect(prefillTexts['doc-2'].ach_account_holder_name_p1).toBe('MERCHANT A LLC');
  });
});

describe('Review clears what an earlier write left on a copy with its own entity', () => {
  /** Exhibit C (2) as the warm used to leave it: holding copy #1's values. */
  const STALE_FROM_COPY_1 = {
    ach_account_holder_dba_p1: 'MERCHANT A',
    ach_account_holder_address_p1: '12 Main St, Austin, TX 78701',
    ach_bank_routing_p1: '111000614',
    ach_bank_name_p1: 'CHASE',
  };

  async function reviewCopy(ignoreExistingFieldValues: boolean) {
    const remote = exhibitCDocument('doc-2', 'Exhibit C (2)', STALE_FROM_COPY_1);
    const { client, fieldPuts } = makeClient({ 'doc-2': remote });
    const values = {
      ...PACKAGE_VALUES,
      client_legal_name: 'MERCHANT A LLC',
      ach_account_holder_name: 'MERCHANT C LLC',
      ach_account_holder_dba: '',
      ach_account_holder_address: '',
      ach_bank_name: 'BANK OF AMERICA',
      ach_bank_account: '3333333333',
      ach_bank_routing: '',
    };
    await (signNowService as any).prefillDocument(client as any, remote.id, values, {
      exposeToMerchant: false,
      remote,
      ignoreExistingFieldValues,
    });
    return lastFieldPut(fieldPuts, 'doc-2');
  }

  it('drops copy #1 text from widgets the copy leaves blank', async () => {
    const put = await reviewCopy(true);
    expect(put.get('ach_bank_name_p1')?.prefilled_text).toBe('BANK OF AMERICA');
    expect(put.get('ach_account_holder_name_p1')?.prefilled_text).toBe('MERCHANT C LLC');
    expect(put.get('ach_account_holder_dba_p1')?.prefilled_text).toBeUndefined();
    expect(put.get('ach_account_holder_address_p1')?.prefilled_text).toBeUndefined();
    expect(put.get('ach_bank_routing_p1')?.prefilled_text).toBeUndefined();
    expect(put.get('initial_g1_p1')).toBeDefined();
  });

  it('writes the initials widget in Times New Roman 12', async () => {
    const initials = (await reviewCopy(true)).get('initial_g1_p1');
    expect(initials?.font).toBe('Times New Roman');
    expect(initials?.size).toBe(12);
    expect(initials?.font_size).toBe(12);
  });

  it('keeps what is on the widget for a copy that is not its own entity', async () => {
    const put = await reviewCopy(false);
    expect(put.get('ach_bank_routing_p1')?.prefilled_text).toBe('111000614');
  });

  it('does not borrow the deal business name for a blank holder or DBA line', async () => {
    const put = await reviewCopy(true);
    // `client_legal_name` (the page's top line) is still the deal's merchant…
    expect(put.get('client_legal_name_p1')?.prefilled_text).toBe('MERCHANT A LLC');
    // …but the copy's own DBA is blank in the CRM, so it stays blank here.
    expect(put.get('ach_account_holder_dba_p1')?.prefilled_text).toBeUndefined();
  });
});
