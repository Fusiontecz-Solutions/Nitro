import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import { hasContractsLogAccess, normalizeRoleValue } from '../constants/roles';
import { getGmailAccessTokenForUser } from '../services/gmail/gmailOAuthService';
import { runGmailAutoCreateForUser } from '../services/gmail/gmailAutoCreateService';

/**
 * Gmail PDF auto-create settings.
 *   GET   /gmail/auto-create                        own mailbox switch
 *   PATCH /gmail/auto-create            {enabled}   switch own mailbox on/off
 *   POST  /gmail/auto-create/run                    sweep own mailbox now
 *   GET   /gmail/health[?verify=false]              every mailbox (admins / SA gateway)
 *   PATCH /gmail/health/mailboxes/:userId/auto-create {enabled}  (admins / SA gateway)
 */

const AUTO_CREATE_SELECT = { id: true, gmailAutoCreateEnabled: true, gmailAutoCreateEnabledAt: true } as const;

function isPrivileged(req: Request): boolean {
    const role = normalizeRoleValue(req.user?.role);
    return req.isSuperAdminProxy === true || hasContractsLogAccess(role) || role === 'ADMIN';
}

/** Switching on stamps `gmailAutoCreateEnabledAt`: mail that arrived while off never becomes a deal. */
async function setAutoCreate(userId: string, enabled: boolean) {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: AUTO_CREATE_SELECT });
    if (!existing) return null;
    const updated =
        existing.gmailAutoCreateEnabled === enabled
            ? existing
            : await prisma.user.update({
                  where: { id: userId },
                  data: enabled
                      ? { gmailAutoCreateEnabled: true, gmailAutoCreateEnabledAt: new Date() }
                      : { gmailAutoCreateEnabled: false },
                  select: AUTO_CREATE_SELECT,
              });
    return {
        userId: updated.id,
        autoCreateEnabled: updated.gmailAutoCreateEnabled,
        autoCreateEnabledAt: updated.gmailAutoCreateEnabledAt,
    };
}

export async function getMyGmailAutoCreate(req: Request, res: Response) {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: AUTO_CREATE_SELECT });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        return res.status(200).json({
            success: true,
            data: { autoCreateEnabled: user.gmailAutoCreateEnabled, autoCreateEnabledAt: user.gmailAutoCreateEnabledAt },
        });
    } catch (error: any) {
        console.error('getMyGmailAutoCreate:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

export async function setMyGmailAutoCreate(req: Request, res: Response) {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, message: 'Boolean "enabled" is required' });
    }
    try {
        const data = await setAutoCreate(req.user!.id, enabled);
        if (!data) return res.status(404).json({ success: false, message: 'User not found' });
        return res.status(200).json({ success: true, data });
    } catch (error: any) {
        console.error('setMyGmailAutoCreate:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

const RUN_REFUSALS: Record<'disabled' | 'not_connected' | 'busy', [number, string]> = {
    disabled: [400, 'Auto-create is switched off for your mailbox'],
    not_connected: [400, 'Gmail is not connected (or needs reconnecting)'],
    busy: [409, 'Your mailbox is already being scanned'],
};

/** Runs the same sweep as the cron, for the caller's own mailbox only. */
export async function runMyGmailAutoCreate(req: Request, res: Response) {
    try {
        const outcome = await runGmailAutoCreateForUser(req.user!.id);
        if (outcome.status !== 'ok') {
            const [status, message] = RUN_REFUSALS[outcome.status];
            return res.status(status).json({ success: false, message });
        }
        return res.status(200).json({
            success: true,
            message: `Created ${outcome.created.length} application(s) from email`,
            total: outcome.created.length,
            data: outcome.created,
        });
    } catch (error: any) {
        console.error('runMyGmailAutoCreate:', error);
        // 400, not 401: a Gmail auth failure must not sign the user out of the CRM.
        return res.status(400).json({ success: false, message: error?.message || 'Gmail auto-create failed' });
    }
}

/**
 * Health of every connected mailbox. "Connected" is verified by minting an access
 * token (the same call the cron makes) — a revoked grant otherwise looks healthy
 * while the cron silently stops producing deals. `?verify=false` skips Google calls.
 */
export async function getGmailHealth(req: Request, res: Response) {
    if (!isPrivileged(req)) return res.status(403).json({ success: false, message: 'Forbidden' });
    try {
        const verify = String(req.query.verify ?? 'true').toLowerCase() !== 'false';
        const users = await prisma.user.findMany({
            where: { googleRefreshToken: { not: null } },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                googleEmail: true,
                googleConnectedAt: true,
                gmailAutoCreateEnabled: true,
                gmailAutoCreateEnabledAt: true,
            },
            orderBy: { email: 'asc' },
        });

        const mailboxes = await Promise.all(
            users.map(async (user) => {
                const base = {
                    userId: user.id,
                    crmEmail: user.email,
                    userName: `${user.firstName || ''} ${user.lastName || ''}`.trim() || null,
                    role: user.role,
                    gmailEmail: user.googleEmail ?? null,
                    connectedAt: user.googleConnectedAt ?? null,
                    autoCreateEnabled: user.gmailAutoCreateEnabled,
                    autoCreateEnabledAt: user.gmailAutoCreateEnabledAt,
                };
                if (!verify) return { ...base, healthy: true, verified: false, error: null };
                try {
                    const token = await getGmailAccessTokenForUser(user.id);
                    if (!token) throw new Error('Gmail needs reconnecting (token missing or from another OAuth client)');
                    return { ...base, healthy: true, verified: true, error: null };
                } catch (err: any) {
                    return {
                        ...base,
                        healthy: false,
                        verified: true,
                        error: err?.response?.data?.error_description || err?.message || 'Could not mint an access token',
                    };
                }
            }),
        );

        const healthy = mailboxes.filter((m) => m.healthy).length;
        const broken = mailboxes.length - healthy;
        return res.status(200).json({
            success: true,
            data: {
                connected: mailboxes.length > 0 && broken === 0,
                status:
                    mailboxes.length === 0 ? 'not_connected' : broken === 0 ? 'ok' : healthy > 0 ? 'degraded' : 'broken',
                mailboxCount: mailboxes.length,
                healthyCount: healthy,
                brokenCount: broken,
                verified: verify,
                checkedAt: new Date().toISOString(),
                mailboxes,
            },
        });
    } catch (error: any) {
        console.error('getGmailHealth:', error);
        return res.status(500).json({ success: false, message: error?.message || 'Failed to resolve Gmail health' });
    }
}

export async function setGmailAutoCreateForUser(req: Request, res: Response) {
    if (!isPrivileged(req)) return res.status(403).json({ success: false, message: 'Forbidden' });
    const userId = String(req.params.userId || '').trim();
    const enabled = req.body?.enabled;
    if (!userId || typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, message: 'userId and boolean "enabled" are required' });
    }
    try {
        const data = await setAutoCreate(userId, enabled);
        if (!data) return res.status(404).json({ success: false, message: 'User not found' });
        return res.status(200).json({ success: true, data });
    } catch (error: any) {
        console.error('setGmailAutoCreateForUser:', error);
        return res.status(500).json({ success: false, message: error?.message || 'Failed to update auto-create setting' });
    }
}
