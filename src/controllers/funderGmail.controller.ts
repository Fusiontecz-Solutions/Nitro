import type { Request, Response } from 'express';
import { resolveTenantUserId } from '../middleware/authMiddleware';
import {
    FunderGmailError,
    buildFunderGmailConnectUrl,
    disconnectFunderGmail,
    getFunderGmailStatus,
    verifyFunderMailbox,
} from '../services/gmail/funderGmailOAuthService';

/**
 * Funder Gmail connection (Settings → Funders). Mounted behind authenticateToken +
 * requireSuperAdmin — the same rule that guards editing the funder itself.
 * Responses carry addresses, status and timestamps only; tokens never leave the server.
 */
function sendError(res: Response, error: unknown, fallback: string) {
    if (error instanceof FunderGmailError) {
        return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    }
    console.error(`[funder-gmail] ${fallback}:`, (error as Error)?.message);
    return res.status(500).json({ success: false, message: fallback });
}

/** GET /integration-settings/funders/:id/gmail  (?probe=1 for a live token check) */
export const getFunderGmail = async (req: Request, res: Response) => {
    try {
        const data = await getFunderGmailStatus(String(req.params.id), { probe: String(req.query.probe ?? '') === '1' });
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return sendError(res, error, 'Could not load Gmail status');
    }
};

/** POST /integration-settings/funders/:id/gmail/connect (also used to reconnect) → { url } */
export const connectFunderGmail = async (req: Request, res: Response) => {
    try {
        // The callback re-checks the connecting user against the tenant User table, and
        // FunderMailbox.connectedById is a FK — a synthetic Super Admin proxy principal cannot connect.
        const userId = resolveTenantUserId(req);
        if (!userId) {
            return res.status(403).json({
                success: false,
                code: 'TENANT_USER_REQUIRED',
                message: 'Connect a funder Gmail account from the CRM while signed in with a tenant admin account.',
            });
        }
        const url = await buildFunderGmailConnectUrl({
            funderProfileId: String(req.params.id),
            userId,
            returnPath: typeof req.body?.returnPath === 'string' ? req.body.returnPath : undefined,
        });
        return res.status(200).json({ success: true, data: { url } });
    } catch (error) {
        return sendError(res, error, 'Could not start Gmail connection');
    }
};

/** POST /integration-settings/funders/:id/gmail/verify → live check, returns status */
export const verifyFunderGmail = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        const ok = await verifyFunderMailbox(id);
        const data = await getFunderGmailStatus(id);
        return res.status(200).json({ success: true, data: { ...data, verified: ok } });
    } catch (error) {
        return sendError(res, error, 'Could not verify Gmail connection');
    }
};

/** DELETE /integration-settings/funders/:id/gmail → revoke, clear, provider back to SendGrid */
export const disconnectFunderGmailHandler = async (req: Request, res: Response) => {
    try {
        const id = String(req.params.id);
        await disconnectFunderGmail(id);
        const data = await getFunderGmailStatus(id);
        return res.status(200).json({ success: true, message: 'Gmail disconnected', data });
    } catch (error) {
        return sendError(res, error, 'Could not disconnect Gmail');
    }
};
