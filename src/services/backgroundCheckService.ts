import prisma from '../config/prismaClient';
import { resolveExistingApplicationId } from '../utils/resolveExistingApplicationId';
import uploadService from './uploadService';

/**
 * Background Check module — due-diligence checklist on a deal (Application).
 * Manual entry this pass. Contract create/send is NOT gated on approval.
 */
const db = prisma as any;

export const CHECK_TYPES = ['TLO', 'OPENCORPORATES', 'SOS', 'NY_COURT', 'DATAMERCH', 'GOOGLE', 'NOTES'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];

const OPTIONAL_BY_DEFAULT = new Set<CheckType>(['TLO', 'DATAMERCH', 'NOTES']);
const isOptionalByDefault = (checkType: string) => OPTIONAL_BY_DEFAULT.has(checkType as CheckType);

export const DECIDER_ROLES = ['UNDERWRITER', 'FINAL_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN'];
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

async function getOrCreateForApplication(applicationRef: string, actor: Actor) {
    const applicationId = await resolveExistingApplicationId(applicationRef);
    if (!applicationId) throw new BackgroundCheckError('Application not found', 404);

    const existing = await getByApplication(applicationId);
    if (existing) {
        let mutated = false;
        const items = (existing.items as any[] | undefined) ?? [];
        const retiredRequired = items.filter(
            (item) =>
                item.required &&
                (item.checkType === 'TLO' || item.checkType === 'DATAMERCH'),
        );
        for (const item of retiredRequired) {
            await db.backgroundCheckItem.update({
                where: { id: item.id },
                data: { required: false },
            });
            mutated = true;
        }

        const existingTypes = new Set(items.map((item) => item.checkType as string));
        const missingTypes = CHECK_TYPES.filter((checkType) => !existingTypes.has(checkType));
        for (const checkType of missingTypes) {
            await db.backgroundCheckItem.create({
                data: {
                    backgroundCheckId: existing.id,
                    checkType,
                    required: !isOptionalByDefault(checkType),
                },
            });
            mutated = true;
        }

        if (mutated) {
            await recomputeStatus(existing.id, actor?.id);
            return getByApplication(applicationId);
        }
        return existing;
    }

    const created = await db.backgroundCheck.create({
        data: {
            applicationId,
            createdById: actor?.id ?? null,
            items: {
                create: CHECK_TYPES.map((checkType) => ({
                    checkType,
                    required: !isOptionalByDefault(checkType),
                })),
            },
        },
    });
    await logEvent(created.id, 'created', { actorId: actor?.id });
    return getByApplication(applicationId);
}

async function recomputeStatus(backgroundCheckId: string, actorId?: string) {
    const check = await db.backgroundCheck.findUnique({
        where: { id: backgroundCheckId },
        include: { items: true, decision: true },
    });
    if (!check) return;
    if (check.decision) return;

    const items = check.items as any[];
    const isRetiredCheck = (checkType: string) =>
        checkType === 'TLO' || checkType === 'DATAMERCH';
    const requiredItems = items.filter((i) => i.required && !isRetiredCheck(i.checkType));
    const allRequiredComplete = requiredItems.length > 0 && requiredItems.every((i) => i.status === 'COMPLETE');
    const anyStarted = items.some(
        (i) => !isRetiredCheck(i.checkType) && (i.status !== 'NOT_STARTED' || i.result),
    );

    const next = allRequiredComplete ? 'READY_FOR_DECISION' : anyStarted ? 'IN_PROGRESS' : 'NOT_STARTED';
    if (next !== check.status) {
        await db.backgroundCheck.update({ where: { id: backgroundCheckId }, data: { status: next } });
        await logEvent(backgroundCheckId, 'status_recomputed', { fromStatus: check.status, toStatus: next, actorId });
    }
}

async function updateItem(
    itemId: string,
    body: { result?: string | null; notes?: string; status?: string; required?: boolean; metadata?: Record<string, unknown> | null },
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
    if (body.metadata !== undefined) {
        data.metadata = body.metadata === null
            ? null
            : {
                ...(item.metadata && typeof item.metadata === 'object' ? item.metadata : {}),
                ...body.metadata,
            };
    }
    if (body.status !== undefined) {
        const s = String(body.status).trim().toUpperCase();
        if (!ITEM_STATUSES.includes(s)) throw new BackgroundCheckError(`Invalid status. Allowed: ${ITEM_STATUSES.join(', ')}`);
        data.status = s;
    }

    const effectiveResult = data.result !== undefined ? data.result : item.result;
    const effectiveStatus = data.status ?? item.status;
    if (effectiveStatus === 'COMPLETE' && !effectiveResult) {
        throw new BackgroundCheckError('A check cannot be completed without a result.');
    }

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

async function runAutomatedItem(_itemId: string, _actor: Actor) {
    throw new BackgroundCheckError('This background check does not support automated execution.');
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
    if (att.publicId) {
        const deleted = await uploadService.deleteFile(att.publicId, 'raw');
        if (!deleted?.success) {
            console.error('[backgroundCheck] Cloudinary delete failed:', deleted?.error || deleted?.message);
        }
    }
    await logEvent(att.item.backgroundCheckId, 'attachment_removed', {
        itemId: att.itemId,
        detail: { originalName: att.originalName },
        actorId: actor?.id,
    });
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

    const hasFail = (check.items as any[]).some(
        (i) => i.checkType !== 'TLO' && i.checkType !== 'DATAMERCH' && i.result === 'FAIL',
    );
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

/** Contract create/send is not gated on background-check approval. */
async function isContractEligible(_applicationRef: string): Promise<boolean> {
    return true;
}

export const backgroundCheckService = {
    CHECK_TYPES,
    DECIDER_ROLES,
    OVERRIDE_ROLES,
    getByApplication,
    getOrCreateForApplication,
    getCheck,
    updateItem,
    runAutomatedItem,
    addAttachment,
    removeAttachment,
    setRequiredFlags,
    recordDecision,
    reopen,
    isContractEligible,
};
export default backgroundCheckService;
