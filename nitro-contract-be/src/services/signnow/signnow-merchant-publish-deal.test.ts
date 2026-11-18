/**
 * The merchant publish must know which deal a SignNow group belongs to, and
 * must never hand the merchant an agreement it had no values for.
 *
 * `Document` keeps one row per application and follows the deal's NEWEST group.
 * After a re-initiate, the group being sent was no longer on that row, so
 * `publishGroupFieldsToMerchant` read no contract values, deleted every Owner
 * widget and stamped nothing — the merchant signed a blank Tiberian agreement
 * (C. R1 Construction, 2026-11-12). The deal now resolves from the caller and
 * from the contract's own send records, and a publish with no deal values is
 * refused before any document is touched.
 *
 * `signnow.service` reaches puppeteer through its PDF helpers (stubbed, as in the
 * other service tests); Prisma and the SignNow client are stubbed so nothing
 * leaves the process.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

const document = { findUnique: jest.fn() };
const queryRaw = jest.fn();
jest.mock('../../config/prismaClient', () => ({
  __esModule: true,
  default: {
    document,
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
}));

const GROUP = 'f98393e1ecc24be1a14a5fe706b48c0a64323919';
const APP = 'addb181d-422a-47ac-bef5-efe9cb296bdf';

const client = {
  get: jest.fn(async (path: string) =>
    path === `/documentgroup/${GROUP}`
      ? { status: 200, data: { documents: [{ id: 'doc-1', document_name: 'CONTRACT TIBERIAN FUNDING (2)' }] } }
      : { status: 200, data: {} },
  ),
};
jest.mock('./utils/signnow-client', () => ({
  createSignNowApiClient: jest.fn(async () => client),
}));

import { signNowService } from './signnow.service';
import {
  hasDealDefiningValues,
  overridesReferenceEnvelope,
  resolveApplicationIdForEnvelope,
} from './utils/signnow-envelope-application';

const service = signNowService as any;

function stubPublishSteps(defaults: Record<string, string>) {
  const loadDefaults = jest
    .spyOn(service, 'loadContractPrefillDefaults')
    .mockResolvedValue({ defaults, offerSource: { values: null, includeWireFee: true } });
  jest
    .spyOn(service, 'waitForDocumentsReady')
    .mockImplementation(async (_c: unknown, docs: unknown) => docs);
  const deleteInvites = jest.spyOn(service, 'deleteEmbeddedInvites').mockResolvedValue(undefined);
  jest.spyOn(service, 'cancelPendingFieldInvites').mockResolvedValue(undefined);
  jest
    .spyOn(service, 'loadGroupDocumentPrefillContext')
    .mockResolvedValue({ entities: [], documentTabValues: [] });
  const prefill = jest.spyOn(service, 'prefillDocument').mockResolvedValue({
    applied: 1,
    attempted: 1,
    matched: 1,
    written: [],
    plannedFieldNames: [],
  });
  return { loadDefaults, deleteInvites, prefill };
}

afterEach(() => {
  jest.restoreAllMocks();
  document.findUnique.mockReset();
  queryRaw.mockReset();
});

describe('resolveApplicationIdForEnvelope', () => {
  it("uses the group's own Document row first", async () => {
    document.findUnique.mockResolvedValue({ applicationId: 'from-row' });
    await expect(resolveApplicationIdForEnvelope(GROUP, 'hint')).resolves.toBe('from-row');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('falls back to the deal the caller is sending once a newer group took the row', async () => {
    document.findUnique.mockResolvedValue(null);
    await expect(resolveApplicationIdForEnvelope(GROUP, APP)).resolves.toBe(APP);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("finds the deal from the contract's record of the group when nobody else can", async () => {
    document.findUnique.mockResolvedValue(null);
    queryRaw.mockResolvedValue([
      // A LIKE hit that only mentions the id in passing is not a match.
      { applicationId: 'other-deal', contractPrefillOverrides: { note: `copied ${GROUP}` } },
      {
        applicationId: APP,
        contractPrefillOverrides: {
          documentSendHistory: [{ envelopeId: 'older' }, { envelopeId: GROUP }],
        },
      },
    ]);
    await expect(resolveApplicationIdForEnvelope(GROUP)).resolves.toBe(APP);
  });

  it('returns null when nothing names the group', async () => {
    document.findUnique.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);
    await expect(resolveApplicationIdForEnvelope(GROUP)).resolves.toBeNull();
  });
});

describe('overridesReferenceEnvelope / hasDealDefiningValues', () => {
  it('reads every record a contract keeps of its groups', () => {
    expect(overridesReferenceEnvelope({ mainContractSendPackage: { envelopeId: GROUP } }, GROUP)).toBe(true);
    expect(overridesReferenceEnvelope({ portalSigningQueue: { envelopeId: GROUP } }, GROUP)).toBe(true);
    expect(overridesReferenceEnvelope({ contractSendHistory: [{ envelopeId: GROUP }] }, GROUP)).toBe(true);
    expect(overridesReferenceEnvelope({ contractSendHistory: [{ envelopeId: 'x' }] }, GROUP)).toBe(false);
    expect(overridesReferenceEnvelope(null, GROUP)).toBe(false);
  });

  it('does not count signer names as deal values', () => {
    expect(hasDealDefiningValues({ client_name: 'RODOLFO', client_email: 'a@b.co' })).toBe(false);
    expect(hasDealDefiningValues({ purchase_price: '20,000.00' })).toBe(true);
  });
});

describe('publishGroupFieldsToMerchant', () => {
  it('refuses, before touching any document, when no deal values resolve', async () => {
    document.findUnique.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);
    const { deleteInvites, prefill } = stubPublishSteps({});

    await expect(
      signNowService.publishGroupFieldsToMerchant(GROUP, {
        roles: [{ roleName: 'Recipient 1', signerName: 'Rodolfo', signerEmail: 'r@example.com' }] as never,
      }),
    ).rejects.toThrow(/could not be loaded/);
    expect(deleteInvites).not.toHaveBeenCalled();
    expect(prefill).not.toHaveBeenCalled();
  });

  it("reads the deal's values through the caller's application id when the row moved on", async () => {
    document.findUnique.mockResolvedValue(null);
    const { loadDefaults, prefill } = stubPublishSteps({
      purchase_price: '20,000.00',
      client_legal_name: 'C. R1 CONSTRUCTION IIC',
    });
    jest.spyOn(service, 'mintGroupEmbeddedInviteLink').mockResolvedValue(undefined);

    const result = await signNowService.publishGroupFieldsToMerchant(GROUP, {
      applicationId: APP,
    });

    expect(loadDefaults).toHaveBeenCalledWith(GROUP, APP);
    expect(prefill).toHaveBeenCalledTimes(1);
    const values = prefill.mock.calls[0][2] as Record<string, string>;
    expect(values.purchase_price).toBe('20,000.00');
    expect(values.client_legal_name).toBe('C. R1 CONSTRUCTION IIC');
    expect(result.failed).toEqual([]);
  });
});
