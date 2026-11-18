jest.mock('../config/prismaClient', () => ({
  __esModule: true,
  default: {
    contract: { findUnique: jest.fn() },
    docuSignAccountProfile: { findUnique: jest.fn() },
  },
}));

jest.mock('../services/funderProfileService', () => ({
  resolveFunderProfile: jest.fn(),
}));

jest.mock('../services/docusign/utils/docusign-client', () => ({
  DOCUSIGN_DEFAULT_CC_EMAIL: 'platform-default@example.com',
}));

import prisma from '../config/prismaClient';
import { resolveFunderProfile } from '../services/funderProfileService';
import { resolveSignedNoticeFunderCcEmails } from './contractCcDefaults';

const contractFind = prisma.contract.findUnique as jest.Mock;
const docusignFind = prisma.docuSignAccountProfile.findUnique as jest.Mock;
const funderResolve = resolveFunderProfile as jest.Mock;

describe('resolveSignedNoticeFunderCcEmails', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    contractFind.mockImplementation(async ({ where }: any) =>
      where.id != null
        ? { funderName: 'Nitro Advance', state: 'NY' }
        : { id: 42 },
    );
  });

  it("returns only the selected funder's CC, not extras typed at send", async () => {
    // Send-time CC was subs@ + admin@ + Mark@; only the funder's subs@ gets the signed notice.
    funderResolve.mockResolvedValue({ defaultCcEmail: 'subs@nitroadvance.com' });

    await expect(resolveSignedNoticeFunderCcEmails('app-1')).resolves.toEqual([
      'subs@nitroadvance.com',
    ]);
  });

  it("prefers the funder's linked DocuSign account CC", async () => {
    funderResolve.mockResolvedValue({
      defaultCcEmail: 'subs@nitroadvance.com',
      docusignAccountProfileId: 'ds-1',
    });
    docusignFind.mockResolvedValue({ defaultCcEmail: 'contracts@funder.com; ops@funder.com' });

    await expect(resolveSignedNoticeFunderCcEmails('app-1')).resolves.toEqual([
      'contracts@funder.com',
      'ops@funder.com',
    ]);
  });

  it('does not fall back to the platform default when the funder has no CC', async () => {
    funderResolve.mockResolvedValue({ defaultCcEmail: null });

    await expect(resolveSignedNoticeFunderCcEmails('app-1')).resolves.toEqual([]);
  });

  it('returns nothing without an application or contract', async () => {
    await expect(resolveSignedNoticeFunderCcEmails('')).resolves.toEqual([]);
    contractFind.mockResolvedValue(null);
    await expect(resolveSignedNoticeFunderCcEmails('app-missing')).resolves.toEqual([]);
  });
});
