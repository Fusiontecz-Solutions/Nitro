import type { Prisma } from '@prisma/client';
import { CANONICAL_WORKFLOW_QUEUES } from '../utils/workflowQueueStorage';
import { excludeSoftDeletedWhere } from './operationsStatusFilter';

/** Canonical labels persisted on `Application.underwriterAction`. */
export const UNDERWRITER_ACTION_APPROVED = 'Approved By UW' as const;
export const UNDERWRITER_ACTION_DECLINED = 'Decline by UW' as const;
export const UNDERWRITER_ACTION_FINAL_APPROVED = 'Final Approved by UW' as const;

export const FINAL_APPROVAL_QUEUE = 'Final Approval' as const;

export const UNDERWRITER_PIPELINE_FILTERS = [
    'unclaimed',
    'claimed',
    'approved-by-uw',
    'declined-by-uw',
    'final-approval',
    'final-approved-by-uw',
    'iso-query',
    'on-hold',
] as const;

/** Comment type posted by ISO from the approval portal. */
export const ISO_COMMENT_TYPE = 'ISO Comment' as const;

export type UnderwriterPipelineFilter =
    (typeof UNDERWRITER_PIPELINE_FILTERS)[number];

export function normalizeUnderwriterPipelineParam(
    raw: unknown,
): UnderwriterPipelineFilter | null {
    if (raw == null) return null;
    const value = String(Array.isArray(raw) ? raw[0] : raw)
        .trim()
        .toLowerCase();
    return (UNDERWRITER_PIPELINE_FILTERS as readonly string[]).includes(value)
        ? (value as UnderwriterPipelineFilter)
        : null;
}

/** Deals credited to the viewing underwriter (assigned or approved-by). */
function linkedToUnderwriter(viewerId: string): Prisma.ApplicationWhereInput {
    return {
        OR: [
            { approvedByUnderwriterId: viewerId },
            { assignedUnderwriterId: viewerId },
        ],
    };
}

export function buildUnderwriterPipelineWhere(
    pipeline: UnderwriterPipelineFilter,
    viewerId: string,
): Prisma.ApplicationWhereInput {
    switch (pipeline) {
        case 'unclaimed':
            return {
                currentQueue: CANONICAL_WORKFLOW_QUEUES.UNDERWRITER,
                assignedUnderwriterId: null,
            };
        case 'claimed':
            return {
                currentQueue: CANONICAL_WORKFLOW_QUEUES.UNDERWRITER,
                assignedUnderwriterId: viewerId,
            };
        case 'approved-by-uw':
            return {
                underwriterAction: UNDERWRITER_ACTION_APPROVED,
                ...linkedToUnderwriter(viewerId),
            };
        case 'declined-by-uw':
            return {
                underwriterAction: UNDERWRITER_ACTION_DECLINED,
                ...linkedToUnderwriter(viewerId),
            };
        case 'final-approval':
            return {
                currentQueue: FINAL_APPROVAL_QUEUE,
                ...linkedToUnderwriter(viewerId),
            };
        case 'final-approved-by-uw':
            return {
                underwriterAction: UNDERWRITER_ACTION_FINAL_APPROVED,
                ...linkedToUnderwriter(viewerId),
            };
        case 'iso-query':
            // Deals the underwriter is linked to that have unresolved ISO comments.
            return {
                AND: [
                    linkedToUnderwriter(viewerId),
                    { isoQueryResolved: false },
                    {
                        comments: {
                            some: {
                                type: ISO_COMMENT_TYPE,
                                isDeleted: false,
                            },
                        },
                    },
                ],
            };
        case 'on-hold':
            return {
                AND: [
                    {
                        OR: [
                            { currentQueue: { in: ['On Hold', 'On_Hold'] } },
                            { currentState: { in: ['On Hold', 'On_Hold'] } },
                        ],
                    },
                    linkedToUnderwriter(viewerId),
                ],
            };
        default:
            return {};
    }
}

export async function countUnderwriterPipelineDeals(
    prisma: { application: { count: (args: { where: Prisma.ApplicationWhereInput }) => Promise<number> } },
    viewerId: string,
): Promise<Record<UnderwriterPipelineFilter, number>> {
    const entries = await Promise.all(
        UNDERWRITER_PIPELINE_FILTERS.map(async (pipeline) => {
            const count = await prisma.application.count({
                where: {
                    AND: [
                        buildUnderwriterPipelineWhere(pipeline, viewerId),
                        excludeSoftDeletedWhere(),
                    ],
                },
            });
            return [pipeline, count] as const;
        }),
    );
    return Object.fromEntries(entries) as Record<UnderwriterPipelineFilter, number>;
}
