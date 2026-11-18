const userFindMany = jest.fn();
const userFindUnique = jest.fn();
const notificationCreate = jest.fn();
const emitToUser = jest.fn();

jest.mock('../config/prismaClient', () => ({
    __esModule: true,
    default: {
        user: { findMany: (...a: unknown[]) => userFindMany(...a), findUnique: (...a: unknown[]) => userFindUnique(...a) },
        notification: { create: (...a: unknown[]) => notificationCreate(...a) },
    },
}));
jest.mock('../socket', () => ({ emitToUser: (...a: unknown[]) => emitToUser(...a) }));

import {
    notifyAdminAssignedApplicationToUnderwriter,
    notifyApplicationAmountChanged,
} from './applicationStageNotificationService';

const app = {
    id: 'app-uuid',
    applicationId: 328,
    currentQueue: 'Underwriter',
    currentState: 'In Progress',
    referringAgentId: 'agent-1',
    createdById: 'agent-1',
    salesRepresentativeId: 'rep-1',
    assignedUnderwriterId: 'uw-1',
    client: { businessName: 'Re-New-It Renovations, LLC' },
};

const sentTo = () =>
    notificationCreate.mock.calls.map(([arg]: any[]) => ({
        recipientId: arg.data.recipientId,
        title: arg.data.title,
    }));

beforeEach(() => {
    jest.clearAllMocks();
    userFindMany.mockResolvedValue([
        { id: 'sa-1', email: null, firstName: 'Super', lastName: 'Admin' },
        { id: 'uw-1', email: null, firstName: 'Also', lastName: 'Contracts' },
    ]);
    userFindUnique.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id }));
    notificationCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: `n-${data.recipientId}`, ...data }));
});

describe('notifyApplicationAmountChanged', () => {
    it('notifies the deal team and every Super Admin, skipping the actor', async () => {
        await notifyApplicationAmountChanged({
            application: app,
            label: 'Offer amount',
            previousAmount: 6000,
            newAmount: 90000,
            actorId: 'uw-1',
            actorName: 'Una Writer',
        });

        const ids = sentTo().map((r) => r.recipientId).sort();
        expect(ids).toEqual(['agent-1', 'rep-1', 'sa-1']);
        expect(userFindMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { role: { in: ['SUPER_ADMIN', 'CONTRACTS_LOG'] }, isActive: true } }),
        );
        const msg = notificationCreate.mock.calls[0][0].data.message as string;
        expect(msg).toContain('$6,000.00');
        expect(msg).toContain('$90,000.00');
        expect(emitToUser).toHaveBeenCalledTimes(3);
    });

    it('does nothing when the amount did not change', async () => {
        await notifyApplicationAmountChanged({
            application: app,
            label: 'Requested amount',
            previousAmount: '90000',
            newAmount: 90000,
        });
        expect(notificationCreate).not.toHaveBeenCalled();
    });
});

describe('Super Admin oversight copy', () => {
    it('keeps "to you" wording for the assignee and third-person wording for Super Admins', async () => {
        userFindMany.mockResolvedValue([{ id: 'sa-1', email: null, firstName: 'Super', lastName: 'Admin' }]);
        await notifyAdminAssignedApplicationToUnderwriter({
            application: app,
            recipientId: 'uw-1',
            actorId: 'sa-2',
            actorName: 'Puneet',
        });

        const rows = sentTo();
        expect(rows).toEqual(
            expect.arrayContaining([
                { recipientId: 'uw-1', title: 'Admin Sent a Application To you' },
                { recipientId: 'sa-1', title: 'Application #328 assigned to an Underwriter' },
            ]),
        );
        expect(rows).toHaveLength(2);
    });
});
