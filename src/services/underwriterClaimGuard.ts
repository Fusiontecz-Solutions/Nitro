import type { Application } from '@prisma/client';
import type { AuthenticatedUser } from './applicationService';

function normalizeQueueToken(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

/** True when `currentQueue` is the primary Scrubbing inbox queue (`Scrubbing`). */
export function isApplicationInUnderwriterQueue(currentQueue: string | null | undefined): boolean {
    return normalizeQueueToken(currentQueue ?? '') === 'SCRUBBING';
}

/** True when `currentQueue` is the final Underwriter review queue (`Underwriter`). */
export function isApplicationInFinalUnderwriterQueue(currentQueue: string | null | undefined): boolean {
    return normalizeQueueToken(currentQueue ?? '') === 'UNDERWRITER';
}

export type UnderwriterClaimMutationDenial = { status: number; message: string };

/**
 * Scrubbing queue: only the claiming scrubber may mutate the deal.
 * Underwriter queue: only the assigned underwriter may mutate the deal.
 */
export function getUnderwriterClaimMutationDenial(
    user: AuthenticatedUser | null | undefined,
    app: (Pick<Application, 'currentQueue'> & {
        claimedByUnderwriterId?: string | null;
        assignedUnderwriterId?: string | null;
    }) | null,
): UnderwriterClaimMutationDenial | null {
    if (!app || !user?.id) return null;

    const roleUpper = user.role ? String(user.role).toUpperCase().replace(/-/g, '_') : '';

    if (roleUpper === 'SCRUBBING' && isApplicationInUnderwriterQueue(app.currentQueue)) {
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
                message: 'This deal is claimed by another scrubber. You can only review the overview.',
            };
        }
        return null;
    }

    if (roleUpper === 'UNDERWRITER' && isApplicationInFinalUnderwriterQueue(app.currentQueue)) {
        const assignId = app.assignedUnderwriterId ?? null;
        if (!assignId) {
            return {
                status: 403,
                message:
                    'Claim this application before making changes. Until then, you can only review the application overview.',
            };
        }
        if (assignId !== user.id) {
            return {
                status: 403,
                message:
                    'This application is claimed by another underwriter. You can only review the overview.',
            };
        }
    }

    return null;
}
