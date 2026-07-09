import prisma from '../config/prismaClient';

/**
 * Background Check module — due-diligence checks on a deal (Application) that
 * gate contract sending. Manual entry this pass. All status/result/decision
 * changes are audited in BackgroundCheckEvent (append-only).
 *
 * Loosely-typed prisma handle to avoid generated-enum-type lag in local dev.
 */
const db = prisma as any;

export const CHECK_TYPES = ['TLO', 'OPENCORPORATES', 'SOS', 'NY_COURT', 'DATAMERCH', 'GOOGLE'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

/** Roles allowed to record a decision. */
export const DECIDER_ROLES = ['UNDERWRITER', 'FINAL_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN'];
/** Roles allowed to override a FAIL and to reopen/configure. */
export const OVERRIDE_ROLES = ['ADMIN', 'SUPER_ADMIN'];

const RESULTS = ['PASS', 'FAIL', 'FLAG', 'NA'];
const ITEM_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETE'];

export class BackgroundCheckError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
    }
}

type Actor = { id?: string; role?: string } | undefined;
const norm = (r?: string) => String(r || '').trim().toUpperCase().replace(/-/g, '_');

const fullInclude = {
    items: { include: { attachments: true }, orderBy: { checkType: 'asc' as const } },
    decision: true,
    events: { orderBy: { createdAt: 'desc' as const }, take: 100 },
};

async function logEvent(
    backgroundCheckId: string,
    action: string,
    opts: { itemId?: string; fromStatus?: string; toStatus?: string; detail?: any; actorId?: string } = {},
) {
    await db.backgroundCheckEvent.create({
        data: {
            backgroundCheckId,
            itemId: opts.itemId ?? null,
            action,
            fromStatus: opts.fromStatus ?? null,
            toStatus: opts.toStatus ?? null,
            detail: opts.detail ?? undefined,
            actorId: opts.actorId ?? null,
        },
    });
}

async function getByApplication(applicationId: string) {
    return db.backgroundCheck.findUnique({ where: { applicationId }, include: fullInclude });
}

/** Get the check for a deal, lazily creating it + the 6 items the first time. */
async function getOrCreateForApplication(applicationId: string, actor: Actor) {
    const existing = await getByApplication(applicationId);
    if (existing) return existing;

    const app = await db.application.findUnique({ where: { id: applicationId }, select: { id: true } });
    if (!app) throw new BackgroundCheckError('Application not found', 404);

    const created = await db.backgroundCheck.create({
        data: {
            applicationId,
            createdById: actor?.id ?? null,
            items: { create: CHECK_TYPES.map((checkType) => ({ checkType, required: true })) },
        },
    });
    await logEvent(created.id, 'created', { actorId: actor?.id });
    return getByApplication(applicationId);
}

/** READY_FOR_DECISION once all required items are COMPLETE; locked once decided. */
async function recomputeStatus(backgroundCheckId: string, actorId?: string) {
    const check = await db.backgroundCheck.findUnique({
        where: { id: backgroundCheckId },
        include: { items: true, decision: true },
    });
    if (!check) return;
    if (check.decision) return; // APPROVED/DECLINED is terminal until reopened

    const items = check.items as any[];
    const requiredItems = items.filter((i) => i.required);
    const allRequiredComplete = requiredItems.length > 0 && requiredItems.every((i) => i.status === 'COMPLETE');
    const anyStarted = items.some((i) => i.status !== 'NOT_STARTED' || i.result);

    const next = allRequiredComplete ? 'READY_FOR_DECISION' : anyStarted ? 'IN_PROGRESS' : 'NOT_STARTED';
    if (next !== check.status) {
        await db.backgroundCheck.update({ where: { id: backgroundCheckId }, data: { status: next } });
        await logEvent(backgroundCheckId, 'status_recomputed', { fromStatus: check.status, toStatus: next, actorId });
    }
}

async function updateItem(
    itemId: string,
    body: { result?: string | null; notes?: string; status?: string; required?: boolean },
    actor: Actor,
) {
    const item = await db.backgroundCheckItem.findUnique({ where: { id: itemId } });
    if (!item) throw new BackgroundCheckError('Check item not found', 404);

    const data: any = {};
    if (body.result !== undefined) {
        if (body.result === null || body.result === '') data.result = null;
        else {
            const r = String(body.result).trim().toUpperCase();
            if (!RESULTS.includes(r)) throw new BackgroundCheckError(`Invalid result. Allowed: ${RESULTS.join(', ')}`);
            data.result = r;
        }
    }
    if (body.notes !== undefined) data.notes = String(body.notes);
    if (body.required !== undefined) data.required = Boolean(body.required);
    if (body.status !== undefined) {
        const s = String(body.status).trim().toUpperCase();
        if (!ITEM_STATUSES.includes(s)) throw new BackgroundCheckError(`Invalid status. Allowed: ${ITEM_STATUSES.join(', ')}`);
        data.status = s;
    }

    // Rule: a check cannot be marked COMPLETE without a result.
    const effectiveResult = data.result !== undefined ? data.result : item.result;
    const effectiveStatus = data.status ?? item.status;
    if (effectiveStatus === 'COMPLETE' && !effectiveResult) {
        throw new BackgroundCheckError('A check cannot be completed without a result.');
    }

    // Stamp performer/time whenever a result is recorded.
    if (data.result) {
        data.performedById = actor?.id ?? null;
        data.performedAt = new Date();
    }

    const updated = await db.backgroundCheckItem.update({ where: { id: itemId }, data });
    await logEvent(item.backgroundCheckId, 'item_updated', {
        itemId,
        fromStatus: item.status,
        toStatus: updated.status,
        detail: { checkType: item.checkType, result: updated.result },
        actorId: actor?.id,
    });
    await recomputeStatus(item.backgroundCheckId, actor?.id);
    return getCheck(item.backgroundCheckId);
}

async function getCheck(backgroundCheckId: string) {
    return db.backgroundCheck.findUnique({ where: { id: backgroundCheckId }, include: fullInclude });
}

async function addAttachment(
    itemId: string,
    file: { url: string; publicId?: string; originalName?: string },
    actor: Actor,
) {
    const item = await db.backgroundCheckItem.findUnique({ where: { id: itemId } });
    if (!item) throw new BackgroundCheckError('Check item not found', 404);
    if (!file?.url) throw new BackgroundCheckError('Attachment url is required');
    await db.backgroundCheckAttachment.create({
        data: { itemId, url: file.url, publicId: file.publicId ?? null, originalName: file.originalName ?? null, uploadedById: actor?.id ?? null },
    });
    await logEvent(item.backgroundCheckId, 'attachment_added', { itemId, detail: { originalName: file.originalName }, actorId: actor?.id });
    return getCheck(item.backgroundCheckId);
}

async function removeAttachment(attachmentId: string, actor: Actor) {
    const att = await db.backgroundCheckAttachment.findUnique({ where: { id: attachmentId }, include: { item: true } });
    if (!att) throw new BackgroundCheckError('Attachment not found', 404);
    await db.backgroundCheckAttachment.delete({ where: { id: attachmentId } });
    await logEvent(att.item.backgroundCheckId, 'attachment_removed', { itemId: att.itemId, actorId: actor?.id });
    return getCheck(att.item.backgroundCheckId);
}

async function setRequiredFlags(backgroundCheckId: string, flags: Record<string, boolean>, actor: Actor) {
    if (!OVERRIDE_ROLES.includes(norm(actor?.role))) {
        throw new BackgroundCheckError('Only an Admin can configure required checks.', 403);
    }
    const items = await db.backgroundCheckItem.findMany({ where: { backgroundCheckId } });
    for (const item of items as any[]) {
        if (flags[item.checkType] !== undefined) {
            await db.backgroundCheckItem.update({ where: { id: item.id }, data: { required: Boolean(flags[item.checkType]) } });
        }
    }
    await logEvent(backgroundCheckId, 'required_updated', { detail: flags, actorId: actor?.id });
    await recomputeStatus(backgroundCheckId, actor?.id);
    return getCheck(backgroundCheckId);
}

async function recordDecision(
    backgroundCheckId: string,
    body: { outcome?: string; reasonCode?: string; reasonText?: string; conditionsText?: string; overrideFail?: boolean },
    actor: Actor,
) {
    const role = norm(actor?.role);
    if (!DECIDER_ROLES.includes(role)) {
        throw new BackgroundCheckError('You are not authorized to decide background checks.', 403);
    }
    const outcome = String(body.outcome || '').trim().toUpperCase();
    if (outcome !== 'APPROVED' && outcome !== 'DECLINED') {
        throw new BackgroundCheckError('outcome must be APPROVED or DECLINED');
    }
    const reasonText = String(body.reasonText || '').trim();
    if (!reasonText) throw new BackgroundCheckError('A reason is required to record a decision.');

    const check = await db.backgroundCheck.findUnique({
        where: { id: backgroundCheckId },
        include: { items: true, decision: true },
    });
    if (!check) throw new BackgroundCheckError('Background check not found', 404);
    if (check.decision) throw new BackgroundCheckError('A decision already exists. Reopen the check to change it.');
    if (check.status !== 'READY_FOR_DECISION') {
        throw new BackgroundCheckError('All required checks must be completed before a decision.');
    }

    const hasFail = (check.items as any[]).some((i) => i.result === 'FAIL');
    let overrodeFail = false;
    if (outcome === 'APPROVED' && hasFail) {
        if (!OVERRIDE_ROLES.includes(role) || !body.overrideFail) {
            throw new BackgroundCheckError('A failed check blocks approval. Only a Manager can override, with a reason.', 403);
        }
        overrodeFail = true;
    }

    await db.backgroundCheckDecision.create({
        data: {
            backgroundCheckId,
            outcome,
            reasonCode: body.reasonCode ? String(body.reasonCode) : null,
            reasonText,
            conditionsText: body.conditionsText ? String(body.conditionsText) : null,
            overrodeFail,
            decidedById: actor?.id ?? null,
        },
    });
    await db.backgroundCheck.update({ where: { id: backgroundCheckId }, data: { status: outcome } });
    await logEvent(backgroundCheckId, 'decision', {
        fromStatus: 'READY_FOR_DECISION',
        toStatus: outcome,
        detail: { reasonText, overrodeFail, hasFail },
        actorId: actor?.id,
    });
    return getCheck(backgroundCheckId);
}

async function reopen(backgroundCheckId: string, actor: Actor) {
    if (!OVERRIDE_ROLES.includes(norm(actor?.role))) {
        throw new BackgroundCheckError('Only an Admin can reopen a decided check.', 403);
    }
    const check = await db.backgroundCheck.findUnique({ where: { id: backgroundCheckId }, include: { decision: true } });
    if (!check) throw new BackgroundCheckError('Background check not found', 404);
    if (check.decision) await db.backgroundCheckDecision.delete({ where: { id: check.decision.id } });
    await db.backgroundCheck.update({ where: { id: backgroundCheckId }, data: { status: 'IN_PROGRESS' } });
    await logEvent(backgroundCheckId, 'reopened', { fromStatus: check.status, toStatus: 'IN_PROGRESS', actorId: actor?.id });
    await recomputeStatus(backgroundCheckId, actor?.id);
    return getCheck(backgroundCheckId);
}

/** The contract gate: true only when the deal's background check is APPROVED. */
async function isContractEligible(applicationId: string): Promise<boolean> {
    const check = await db.backgroundCheck.findUnique({
        where: { applicationId },
        select: { status: true },
    });
    return check?.status === 'APPROVED';
}

export const backgroundCheckService = {
    CHECK_TYPES,
    DECIDER_ROLES,
    OVERRIDE_ROLES,
    getByApplication,
    getOrCreateForApplication,
    getCheck,
    updateItem,
    addAttachment,
    removeAttachment,
    setRequiredFlags,
    recordDecision,
    reopen,
    isContractEligible,
};
export default backgroundCheckService;
