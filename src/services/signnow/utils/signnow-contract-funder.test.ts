jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

const TIBERIAN_ID = '3628d4b4-b048-4cde-90d2-76f7ac4d52be';
const TIBERIAN_TEMPLATE = '13ab1bd4a6db48ffb7ae8eef453cb9927b82752c';
const NITRO_TEMPLATE = '15308be2450644ada7b86176d42eb4731f76911e';

const funderRows = [
  { id: TIBERIAN_ID, name: 'TIBERIAN FUNDING', isActive: true, signnowContractTemplateLink: TIBERIAN_TEMPLATE },
  {
    id: '2116cca9-c618-4613-9f9c-e4db6f78472d',
    name: 'Obsidian Capital Group',
    isActive: true,
    signnowContractTemplateLink: '1d76c78b52db4dfa8dbdb60d840091ed19d2957b',
  },
  {
    id: 'd9e5b7a2-7911-4b36-abff-349bfc765396',
    name: 'Nitro Advance',
    isActive: true,
    signnowContractTemplateLink: NITRO_TEMPLATE,
  },
];

const contractFindUnique = jest.fn();
const contractFindFirst = jest.fn();

jest.mock('../../../config/prismaClient', () => ({
  __esModule: true,
  default: {
    funderProfile: {
      findMany: jest.fn(async () => funderRows),
      findUnique: jest.fn(async ({ where }: any) => funderRows.find((r) => r.id === where.id) ?? null),
    },
    contract: {
      findUnique: (...args: unknown[]) => contractFindUnique(...args),
      findFirst: (...args: unknown[]) => contractFindFirst(...args),
    },
  },
}));

import {
  assertContractFunderResolved,
  resolveContractFunderProfileId,
  resolveFunderContractTemplateId,
} from './signnow-contract-funder';

describe('resolveContractFunderProfileId', () => {
  beforeEach(() => {
    contractFindUnique.mockReset();
    contractFindFirst.mockReset();
  });

  it('keeps a posted persisted id', async () => {
    const out = await resolveContractFunderProfileId({ funderProfileId: TIBERIAN_ID });
    expect(out.funderProfileId).toBe(TIBERIAN_ID);
  });

  it('resolves the id from the funder name when no id is posted', async () => {
    const out = await resolveContractFunderProfileId({ funderName: 'TIBERIAN FUNDING' });
    expect(out.funderProfileId).toBe(TIBERIAN_ID);
  });

  it('ignores a fallback- placeholder id and uses the name', async () => {
    const out = await resolveContractFunderProfileId({
      funderProfileId: 'fallback-tiberian',
      funderName: 'Tiberian Funding',
    });
    expect(out.funderProfileId).toBe(TIBERIAN_ID);
  });

  it("falls back to the contract's saved funder when the request names none", async () => {
    contractFindUnique.mockResolvedValue({ funderName: 'TIBERIAN FUNDING' });
    const out = await resolveContractFunderProfileId({ contractId: 364 });
    expect(out).toEqual({ funderProfileId: TIBERIAN_ID, funderName: 'TIBERIAN FUNDING' });
  });

  it('returns empty when nothing identifies a funder', async () => {
    contractFindFirst.mockResolvedValue(null);
    const out = await resolveContractFunderProfileId({ applicationId: 'app-1' });
    expect(out.funderProfileId).toBe('');
  });
});

describe('assertContractFunderResolved', () => {
  it('passes when a funder profile id was resolved', () => {
    expect(() =>
      assertContractFunderResolved({ funderProfileId: TIBERIAN_ID, funderName: 'TIBERIAN FUNDING' }),
    ).not.toThrow();
  });

  it('blocks sending when funderProfileId is null and no funder is named', () => {
    expect(() => assertContractFunderResolved({ funderProfileId: '', funderName: '' })).toThrow(
      /Select a funder/,
    );
  });

  it('blocks sending when the named funder has no profile', () => {
    expect(() =>
      assertContractFunderResolved({ funderProfileId: '', funderName: 'Unknown Funder' }),
    ).toThrow(/"Unknown Funder" was not found/);
  });
});

describe('resolveFunderContractTemplateId', () => {
  it("uses the funder's own template", () => {
    expect(
      resolveFunderContractTemplateId({
        funderRow: funderRows[0],
        platformTemplateId: NITRO_TEMPLATE,
      }),
    ).toBe(TIBERIAN_TEMPLATE);
  });

  it('refuses when no funder is selected', () => {
    expect(() => resolveFunderContractTemplateId({ platformTemplateId: NITRO_TEMPLATE })).toThrow(
      /Select a funder/,
    );
  });

  it('uses the platform template for Nitro Advance without its own link', () => {
    expect(
      resolveFunderContractTemplateId({
        funderRow: { name: 'Nitro Advance', signnowContractTemplateLink: null },
        platformTemplateId: NITRO_TEMPLATE,
      }),
    ).toBe(NITRO_TEMPLATE);
  });

  it('refuses to send Nitro paper for another funder with no template link', () => {
    expect(() =>
      resolveFunderContractTemplateId({
        funderRow: { name: 'TIBERIAN FUNDING', signnowContractTemplateLink: '' },
        platformTemplateId: NITRO_TEMPLATE,
      }),
    ).toThrow(/TIBERIAN FUNDING has no SignNow contract template/);
  });

  it('refuses an unknown named funder instead of using Nitro paper', () => {
    expect(() =>
      resolveFunderContractTemplateId({
        requestedFunderName: 'Some Unknown Funder',
        platformTemplateId: NITRO_TEMPLATE,
      }),
    ).toThrow(/not found/);
  });
});
