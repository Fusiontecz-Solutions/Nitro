import type { Application } from '@prisma/client';
import type { AuthenticatedUser } from './applicationService';

function normalizeQueueToken(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/** True when `currentQueue` is the primary Underwriter inbomx queue (`Underwriter`). */
export function isApplicationInUnderwriterQueue(currentQueue: string | null | undefined): boolean {
    return normalizeQueueToken(currentQueue ?? '') === 'UNDERWRITER';
}

export type UnderwriterClaimMutationDenial = { status: number; message: string };

/**
 * Underwriter queue: only the claiming underwriter may mutate the deal.
 * Unclaimed (`claimedByUnderwriterId` null): UNDERWRITER may not change anything until they claim.
 * Other roles are not restricted here.
 */
export function getUnderwriterClaimMutationDenial(
    user: AuthenticatedUser | null | undefined,
    app: (Pick<Application, 'currentQueue'> & { claimedByUnderwriterId?: string | null }) | null,
): UnderwriterClaimMutationDenial | null {
    if (!app || !user?.id) return null;

    const roleUpper = user.role ? String(user.role).toUpperCase().replace(/-/g, '_') : '';
    if (roleUpper !== 'UNDERWRITER') return null;

    if (!isApplicationInUnderwriterQueue(app.currentQueue)) return null;

    const claimId = app.claimedByUnderwriterId ?? null;
    if (!claimId) {
        return {
            status: 403,
            message:
                'Claim this deal before making changes. Until then, you can only review the application overview.',
        };
    }
    if (claimId !== user.id) {
        return {
            status: 403,
            message: 'This deal is claimed by another underwriter. You can only review the overview.',
        };
    }
    return null;
}
