import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { createApplicationActivityLog } from './applicationActivityLogService';
import type { AuthenticatedUser } from './applicationService';
import {
    enqueueApplicationApprovalSideEffects,
    isApplicationApprovalQueueEnabled,
} from '../queues/applicationApprovalQueue';

/* ============================================================================
 * Application Approval domain service
 * ----------------------------------------------------------------------------
 * Single source of truth for moving an Application into the "Approved" state.
 *
 * Why a dedicated service?
 *   - Idempotent: parallel/repeat clicks (e.g. ISO double-tap, retried webhooks,
 *     email-link bots) cannot create duplicate state transitions or duplicate
 *     activity logs.
 *   - Concurrency-safe: the actual write is a single conditional `updateMany`
 *     guarded by the previous (queue,state). Only one transition wins; the
 *     others observe `alreadyApproved=true` and return without side-effects.
 *   - Scalable: side-effects (notifications, emails, analytics, downstream
 *     webhooks) are dispatched through a BullMQ queue when Redis is available
 *     and fall back to non-blocking `setImmediate` otherwise. The HTTP request
 *     never waits on fan-out work.
 *   - Reusable: the controller, future internal automations, scheduled jobs,
 *     or external webhooks can all call `approveApplication()` with the same
 *     guarantees.
 * ==========================================================================*/

/** Canonical labels persisted on `Application.currentQueue` / `currentState`. */
export const APPLICATION_APPROVED_QUEUE = 'Approved' as const;
export const APPLICATION_APPROVED_STATE = 'Approved' as const;

/** Public contract returned to the controller / API. */
export interface ApproveApplicationResult {
    application: any;
    alreadyApproved: boolean;
    previousQueue: string | null;
    previousState: string | null;
}

export interface ApproveApplicationOptions {
    /** Authenticated principal performing the approval (CRM user or ISO public-portal session). */
    actor: AuthenticatedUser | null;
    /** Tag the activity log + worker payload (`'ISO'`, `'CLIENT'`, internal role label, …). */
    actorType?: string | null;
    /** Optional human-readable name of the actor (for activity log + emails). */
    actorName?: string | null;
    /** Optional free-form note/reason the approver supplied (stored in metadata). */
    note?: string | null;
    /**
     * When provided, an in-flight approval with the same key returns the cached
     * result instead of re-running the transition. Lets clients safely retry.
     */
    idempotencyKey?: string | null;
    /** When set, audit rows attribute to a real tenant User (incl. Super Admin proxy fallback). */
    req?: Request | null;
}

/* --------------------------- Idempotency cache ---------------------------- */
/** Bounded in-memory cache so the same retry within ~10 minutes maps to one transition. */
const IDEMPOTENCY_CACHE_TTL_MS = 10 * 60 * 1000;
const IDEMPOTENCY_CACHE_MAX_ENTRIES = 5_000;

type IdempotencyCacheEntry = {
    expiresAt: number;
    promise: Promise<ApproveApplicationResult>;
};

const idempotencyCache = new Map<string, IdempotencyCacheEntry>();

const buildIdempotencyCacheKey = (applicationId: string, idempotencyKey: string): string =>
    `${applicationId}::${idempotencyKey}`;

const pruneExpiredIdempotencyEntries = (now: number): void => {
    if (idempotencyCache.size === 0) return;
    for (const [key, entry] of idempotencyCache.entries()) {
        if (entry.expiresAt <= now) idempotencyCache.delete(key);
    }
    while (idempotencyCache.size > IDEMPOTENCY_CACHE_MAX_ENTRIES) {
        const oldest = idempotencyCache.keys().next();
        if (oldest.done) break;
        idempotencyCache.delete(oldest.value);
    }
};

/* ------------------------------ Helpers ----------------------------------- */
const includeForApiResponse: Prisma.ApplicationInclude = {
    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    client: true,
    iso: true,
    files: true,
};

const isAlreadyApproved = (queue: string | null | undefined, state: string | null | undefined): boolean => {
    const q = String(queue ?? '').trim().toLowerCase();
    const s = String(state ?? '').trim().toLowerCase();
    return q === 'approved' || s === 'approved' || s === 'completed';
};

/* ============================ Core action ================================= */

/**
 * Atomically move an application to the Approved queue/state and dispatch
 * non-blocking side-effects (notifications, ISO/agent emails, activity log).
 *
 * Safe to call concurrently from many sources — only one caller will observe
 * `alreadyApproved=false`; all others get `alreadyApproved=true` and the same
 * canonical record back.
 */
export async function approveApplication(
    where: Prisma.ApplicationWhereUniqueInput,
    options: ApproveApplicationOptions
): Promise<ApproveApplicationResult> {
    const idempotencyKey = options.idempotencyKey?.trim() || '';

    if (idempotencyKey) {
        const now = Date.now();
        pruneExpiredIdempotencyEntries(now);

        const lookupApp = await prisma.application.findUnique({
            where,
            select: { id: true },
        });
        if (lookupApp) {
            const cacheKey = buildIdempotencyCacheKey(lookupApp.id, idempotencyKey);
            const cached = idempotencyCache.get(cacheKey);
            if (cached) return cached.promise;

            const inflight = runApproval(where, options);
            idempotencyCache.set(cacheKey, {
                expiresAt: now + IDEMPOTENCY_CACHE_TTL_MS,
                promise: inflight,
            });
            inflight.catch(() => {
                idempotencyCache.delete(cacheKey);
            });
            return inflight;
        }
    }

    return runApproval(where, options);
}

async function runApproval(
    where: Prisma.ApplicationWhereUniqueInput,
    options: ApproveApplicationOptions
): Promise<ApproveApplicationResult> {
    console.log('[approveApplication] >>> START', {
        where,
        actorId: options.actor?.id ?? null,
        actorRole: options.actor?.role ?? null,
        actorType: options.actorType ?? null,
    });

    const existing = await prisma.application.findUnique({
        where,
        select: {
            id: true,
            applicationId: true,
            currentQueue: true,
            currentState: true,
        },
    });

    if (!existing) {
        console.error('[approveApplication] application not found for where:', where);
        const err = new Error('Application not found') as Error & { statusCode?: number };
        err.statusCode = 404;
        throw err;
    }

    const previousQueue = existing.currentQueue;
    const previousState = existing.currentState;

    console.log('[approveApplication] before update:', {
        applicationDbId: existing.id,
        applicationNumericId: existing.applicationId,
        previousQueue,
        previousState,
    });

    const alreadyApproved = isAlreadyApproved(previousQueue, previousState);

    /**
     * Direct unconditional update by primary key.
     *
     * - Always writes the canonical Approved labels so the column values are
     *   guaranteed to be set, regardless of the prior state.
     * - Uses a single non-interactive query to avoid Prisma interactive
     *   transaction timeout failures (P2028) under DB latency spikes.
     */
    const application = await prisma.application.update({
        where: { id: existing.id },
        data: {
            currentQueue: APPLICATION_APPROVED_QUEUE,
            currentState: APPLICATION_APPROVED_STATE,
        },
        include: includeForApiResponse,
    });

    console.log('[approveApplication] DB write succeeded:', {
        applicationDbId: application.id,
        currentQueue: application.currentQueue,
        currentState: application.currentState,
        updatedAt: application.updatedAt,
    });

    /**
     * Defensive read-back to confirm the row really shows Approved
     * (catches replicas, triggers, or concurrent writers that might revert).
     */
    const readback = await prisma.application.findUnique({
        where: { id: existing.id },
        select: { currentQueue: true, currentState: true },
    });
    console.log('[approveApplication] readback after commit:', readback);

    /**
     * Activity log + side-effects only when this call is the one that
     * actually transitioned the state (avoids spamming on repeat clicks).
     */
    if (!alreadyApproved) {
        try {
            await createApplicationActivityLog({
                applicationId: existing.id,
                user: options.actor ?? null,
                req: options.req,
                actionType: 'APPROVED',
                actionDescription: buildApprovalActivityDescription(options),
                previousStatus: `${previousQueue ?? ''} / ${previousState ?? ''}`,
                currentStatus: `${APPLICATION_APPROVED_QUEUE} / ${APPLICATION_APPROVED_STATE}`,
                metadata: {
                    actorType: options.actorType ?? null,
                    actorName: options.actorName ?? null,
                    actorId: options.actor?.id ?? null,
                    actorRole: options.actor?.role ?? null,
                    note: options.note ?? null,
                    idempotencyKey: options.idempotencyKey ?? null,
                    source: 'approveApplication',
                },
            });
        } catch (logError) {
            console.error('[applicationApprovalService] activity log failed:', logError);
        }

        dispatchApprovalSideEffects({
            applicationId: existing.id,
            applicationNumber: existing.applicationId,
            actorId: options.actor?.id ?? null,
            actorRole: options.actor?.role ? String(options.actor.role) : null,
            actorType: options.actorType ?? null,
            actorName: options.actorName ?? null,
            previousQueue: previousQueue ?? null,
            previousState: previousState ?? null,
        });
    }

    console.log('[approveApplication] <<< DONE', {
        applicationDbId: existing.id,
        alreadyApproved,
    });

    return {
        application,
        alreadyApproved,
        previousQueue,
        previousState,
    };
}

/* ------------------------- Activity description -------------------------- */
function buildApprovalActivityDescription(options: ApproveApplicationOptions): string {
    const actorTypeRaw = String(options.actorType ?? '').trim().toUpperCase();
    const role = String(options.actor?.role ?? '').trim().toUpperCase().replace(/_/g, ' ');
    const name = String(options.actorName ?? '').trim();

    const subject = (() => {
        if (actorTypeRaw === 'ISO') return name ? `ISO ${name}` : 'ISO';
        if (actorTypeRaw === 'CLIENT') return name ? `Client ${name}` : 'Client';
        if (role) return name ? `${role} ${name}` : role;
        return name || 'User';
    })();

    return `${subject} approved the application.`;
}

/* ----------------------- Side-effect dispatcher -------------------------- */
export interface ApprovalSideEffectPayload {
    applicationId: string;
    applicationNumber: number | null | undefined;
    actorId: string | null;
    actorRole: string | null;
    actorType: string | null;
    actorName: string | null;
    previousQueue: string | null;
    previousState: string | null;
}

function dispatchApprovalSideEffects(payload: ApprovalSideEffectPayload): void {
    if (isApplicationApprovalQueueEnabled()) {
        enqueueApplicationApprovalSideEffects(payload).catch((err) => {
            console.error(
                '[applicationApprovalService] enqueue failed; falling back to inline fan-out:',
                err
            );
            void runApprovalSideEffectsInline(payload);
        });
        return;
    }

    setImmediate(() => {
        void runApprovalSideEffectsInline(payload);
    });
}

/**
 * Inline (non-queue) fan-out used when Redis is unavailable. The worker module
 * exports the same function and is the canonical implementation.
 *
 * Imported lazily so the request path never pulls in worker/email modules
 * unless we actually need the inline path.
 */
async function runApprovalSideEffectsInline(payload: ApprovalSideEffectPayload): Promise<void> {
    try {
        const { processApplicationApprovalSideEffects } = await import(
            './applicationApprovalSideEffects'
        );
        await processApplicationApprovalSideEffects(payload);
    } catch (err) {
        console.error('[applicationApprovalService] inline fan-out failed:', err);
    }
}
