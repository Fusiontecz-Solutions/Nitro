/**
 * The review link must survive a document group whose copied documents have no
 * fields yet — SignNow rejects the embedded invite with "At least one document
 * in document group must contain fields", which reached the CRM as "Could not
 * mint a SignNow review link".
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

const GROUP_ID = 'group-1';
const DOC_ID = 'doc-agreement';
const ORIGIN_ID = 'tpl-agreement';

const EMPTY_FIELDS_ERROR = {
  status: 400,
  data: { error: 'At least one document in document group must contain fields.' },
};

function templateFields() {
  return [
    { id: 'f1', type: 'text', name: 'client_legal_name', role: 'Owner', page_number: 0, x: 10, y: 10, width: 100, height: 12 },
    { id: 'f2', type: 'signature', name: 'sig_1', role: 'Recipient 1', page_number: 0, x: 10, y: 40, width: 100, height: 20 },
  ];
}

function documentPayload(fields: unknown[]) {
  return {
    id: DOC_ID,
    document_name: 'Agreement - Tiberian Funding',
    origin_document_id: ORIGIN_ID,
    page_count: '1',
    pages: [{ page_number: 0 }],
    roles: [{ name: 'Owner' }, { name: 'Recipient 1' }],
    fields,
    texts: [],
  };
}

type Call = { method: string; path: string; body?: any };

/**
 * Minimal SignNow API double. `fieldsAfter` is the number of `GET /document`
 * calls that answer with an empty field set before the copy "finishes"; with
 * `neverFills` the copy stays broken until a PUT writes fields onto it.
 */
function makeClient(options: { emptyGets: number; neverFills?: boolean }) {
  const calls: Call[] = [];
  let documentGets = 0;
  let restored = false;
  const hasFields = () =>
    restored || (!options.neverFills && documentGets > options.emptyGets);
  const client = {
    get: jest.fn(async (path: string) => {
      calls.push({ method: 'get', path });
      if (path === `/document/${ORIGIN_ID}`) {
        return { status: 200, data: { ...documentPayload(templateFields()), id: ORIGIN_ID } };
      }
      if (path.startsWith('/document/')) {
        documentGets += 1;
        return { status: 200, data: documentPayload(hasFields() ? templateFields() : []) };
      }
      if (path.startsWith('/documentgroup/')) {
        return { status: 200, data: { documents: [{ id: DOC_ID, document_name: 'Agreement - Tiberian Funding', origin_document_id: ORIGIN_ID, roles: [] }] } };
      }
      return { status: 200, data: {} };
    }),
    post: jest.fn(async (path: string, body?: any) => {
      calls.push({ method: 'post', path, body });
      if (path.endsWith('/embedded-invites')) {
        return hasFields()
          ? { status: 200, data: { data: { id: 'invite-1' } } }
          : EMPTY_FIELDS_ERROR;
      }
      if (path.endsWith('/link')) {
        return { status: 200, data: { data: { link: 'https://app.signnow.com/webapp/documentgroup/signing?x=1' } } };
      }
      return { status: 200, data: {} };
    }),
    put: jest.fn(async (path: string, body?: any) => {
      calls.push({ method: 'put', path, body });
      if (path === `/document/${DOC_ID}` && Array.isArray(body?.fields) && body.fields.length) {
        restored = true;
      }
      return { status: 200, data: {} };
    }),
    delete: jest.fn(async (path: string) => {
      calls.push({ method: 'delete', path });
      return { status: 200, data: {} };
    }),
  };
  return { client, calls };
}

const ROLES = [
  { roleName: 'Owner', signerName: 'Nitro Owner', signerEmail: 'owner@example.com', signerOrder: 1 },
  { roleName: 'Recipient 1', signerName: 'Mary Irvin', signerEmail: 'signer@example.com', signerOrder: 2 },
];

describe('review link on a group whose documents have no fields yet', () => {
  it('waits for the copy to attach its widgets instead of failing the reviewer', async () => {
    const { client, calls } = makeClient({ emptyGets: 2 });

    const result = await signNowService.getSenderViewUrl(GROUP_ID, {
      roles: ROLES,
      client: client as any,
      documentId: DOC_ID,
    } as any);

    expect(result.url).toContain('app.signnow.com');
    // The invite was only posted once the document reported its fields.
    const inviteCalls = calls.filter((c) => c.method === 'post' && c.path.endsWith('/embedded-invites'));
    expect(inviteCalls.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('rebuilds a broken copy from its origin template, then mints the link', async () => {
    const { client, calls } = makeClient({ emptyGets: 99, neverFills: true });

    const result = await signNowService.getSenderViewUrl(GROUP_ID, {
      roles: ROLES,
      client: client as any,
      documentId: DOC_ID,
    } as any);

    expect(result.url).toContain('app.signnow.com');
    const restorePut = calls.find(
      (c) => c.method === 'put' && c.path === `/document/${DOC_ID}` && c.body?.fields?.length,
    );
    expect(restorePut).toBeDefined();
    // Fields come from the document's own origin template, not a global default.
    expect(calls.some((c) => c.method === 'get' && c.path === `/document/${ORIGIN_ID}`)).toBe(true);
  }, 60_000);
});
