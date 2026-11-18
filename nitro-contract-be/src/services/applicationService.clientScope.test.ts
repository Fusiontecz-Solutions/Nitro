/**
 * Gmail auto-create from an Agent's mailbox must only reuse that Agent's clients:
 * a matching EIN on another Agent's client is not attached to (or merged into).
 */
const clientFindFirst = jest.fn(async (_args: any): Promise<any> => null);
const ownerFindFirst = jest.fn(async (_args: any): Promise<any> => null);
jest.mock('../config/prismaClient', () => ({
    __esModule: true,
    default: {
        client: { findFirst: (a: any) => clientFindFirst(a) },
        clientOwner: { findFirst: (a: any) => ownerFindFirst(a) },
    },
}));

import { buildAgentAllApplicationsWhere } from './applicationWorkflowService';
import { buildAgentApplicationVisibilityWhere, canUserAccessApplication, findExistingClientFromPdfExtract } from './applicationService';

const business = { business_ein_number: '12-3456789', business_name: 'ACME LLC', business_email: 'a@acme.com' };
const owner = { owner_first_name: 'Jane', owner_last_name: 'Doe', owner_ssn: '123-45-6789' };

describe('findExistingClientFromPdfExtract owner scope', () => {
    it("adds the Agent's ownership filter to every candidate lookup", async () => {
        await findExistingClientFromPdfExtract(business, owner, 'agent-1');
        const scope = { AND: [{ OR: [{ createdById: 'agent-1' }, { assignedToId: 'agent-1' }] }] };
        expect(clientFindFirst.mock.calls.length).toBeGreaterThanOrEqual(4);
        for (const [args] of clientFindFirst.mock.calls) expect(args.where).toMatchObject(scope);
        for (const [args] of ownerFindFirst.mock.calls) expect(args.where.client).toMatchObject(scope);
    });

    it('keeps the global match when no owner is given', async () => {
        await findExistingClientFromPdfExtract(business, owner);
        for (const [args] of clientFindFirst.mock.calls) expect(args.where.AND).toBeUndefined();
    });
});

describe('Agent visibility of an auto-created deal', () => {
    // Auto-create sets referringAgentId = createdById = the mailbox owner.
    const app = {
        referringAgentId: 'agent-1',
        createdById: 'agent-1',
        currentQueue: 'Underwriter',
        approvedByUnderwriterId: null,
        assignedUnderwriterId: null,
    };

    it('is visible to the mailbox Agent and hidden from other Agents', () => {
        expect(canUserAccessApplication(app as any, { id: 'agent-1', role: 'AGENT' })).toBe(true);
        expect(canUserAccessApplication(app as any, { id: 'agent-2', role: 'AGENT' })).toBe(false);
        expect(buildAgentApplicationVisibilityWhere('agent-2')).toEqual({
            OR: [{ referringAgentId: 'agent-2' }, { createdById: 'agent-2' }],
        });
    });

    it("only lists the Agent's own deals under All Applications", () => {
        const where = JSON.stringify(buildAgentAllApplicationsWhere('agent-2'));
        expect(where).toContain('"createdById":"agent-2"');
        expect(where).not.toContain('agent-1');
    });
});
