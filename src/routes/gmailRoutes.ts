import express, { type Request, type Response } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import { PERMISSIONS } from '../constants/rolePermissions';
import {
    buildGmailConnectUrl,
    completeGmailConnect,
    disconnectGmail,
    getGmailConnectionStatus,
} from '../services/gmail/gmailOAuthService';

/**
 * Per-user Gmail connection.
 *   GET    /google/callback        (public — Google redirects here; identity comes from signed `state`)
 *   GET    /gmail/connect-url      → { url }   start OAuth for the signed-in user
 *   GET    /gmail/me               → connection status
 *   DELETE /gmail/connection       → revoke + clear
 */
export const googleOAuthCallbackRouter = express.Router();

googleOAuthCallbackRouter.get('/callback', async (req: Request, res: Response) => {
    const redirectTo = await completeGmailConnect(req.query.code, req.query.state, req.query.error);
    return res.redirect(302, redirectTo);
});

const gmailRouter = express.Router();
gmailRouter.use(authenticateToken, requirePermission(PERMISSIONS.EMAIL_CONNECT));

gmailRouter.get('/connect-url', (req: Request, res: Response) => {
    try {
        const url = buildGmailConnectUrl(req.user!.id, String(req.query.returnPath ?? ''));
        return res.status(200).json({ success: true, data: { url } });
    } catch (error: any) {
        return res.status(503).json({ success: false, message: error?.message || 'Gmail connect unavailable' });
    }
});

gmailRouter.get('/me', async (req: Request, res: Response) => {
    try {
        const status = await getGmailConnectionStatus(req.user!.id, String(req.query.probe ?? '') === '1');
        return res.status(200).json({ success: true, data: status });
    } catch (error) {
        console.error('Gmail status error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

gmailRouter.delete('/connection', async (req: Request, res: Response) => {
    try {
        await disconnectGmail(req.user!.id);
        return res.status(200).json({ success: true, message: 'Gmail disconnected' });
    } catch (error) {
        console.error('Gmail disconnect error:', error);
        return res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

export default gmailRouter;
