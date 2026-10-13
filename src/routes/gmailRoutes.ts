import express, { type Request, type Response } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { requirePermission } from '../middleware/requirePermission';
import { PERMISSIONS } from '../constants/rolePermissions';
import { requireSuperAdminOrAgent } from '../middleware/requireSuperAdmin';
import {
    deleteMailboxDraft,
    findMailboxDraft,
    getLabels,
    getMailboxAttachment,
    getMailboxThread,
    listMailbox,
    markMailboxInCrm,
    modifyMailbox,
    patchLabel,
    postLabel,
    removeLabel,
    saveMailboxDraft,
    sendMailbox,
    trashMailbox,
    untrashMailbox,
} from '../controllers/gmailMailbox.controller';
import {
    buildGmailConnectUrl,
    completeGmailConnect,
    disconnectGmail,
    getGmailConnectionStatus,
} from '../services/gmail/gmailOAuthService';
import { completeFunderGmailConnect, isFunderGmailState } from '../services/gmail/funderGmailOAuthService';
import {
    getGmailHealth,
    getMyGmailAutoCreate,
    runMyGmailAutoCreate,
    setGmailAutoCreateForUser,
    setMyGmailAutoCreate,
} from '../controllers/gmailAutoCreate.controller';

/**
 * Per-user Gmail connection.
 *   GET    /google/callback        (public — Google redirects here; identity comes from signed `state`;
 *                                   also completes funder connections, state purpose `funder_gmail_connect`)
 *   GET    /gmail/connect-url      → { url }   start OAuth for the signed-in user
 *   GET    /gmail/me               → connection status
 *   DELETE /gmail/connection       → revoke + clear
 *   /gmail/auto-create[/run]       → own mailbox PDF→deal auto-create switch / run now
 *   /gmail/health                  → every mailbox's health (admins / Super Admin gateway)
 *   /gmail/mailbox/*               → Gmail workspace page (Super Admin + Agent)
 */
export const googleOAuthCallbackRouter = express.Router();

googleOAuthCallbackRouter.get('/callback', async (req: Request, res: Response) => {
    // One registered redirect URI for every Google connection; the signed state picks the flow.
    const redirectTo = isFunderGmailState(req.query.state)
        ? await completeFunderGmailConnect(req.query.code, req.query.state, req.query.error)
        : await completeGmailConnect(req.query.code, req.query.state, req.query.error);
    return res.redirect(302, redirectTo);
});

const gmailRouter = express.Router();
// Book-wide mailbox health (admins / Super Admin gateway) — registered before the EMAIL_CONNECT gate.
gmailRouter.get('/health', authenticateToken, getGmailHealth);
gmailRouter.patch('/health/mailboxes/:userId/auto-create', authenticateToken, setGmailAutoCreateForUser);
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

/** Auto-create deals from this user's own inbox (cron does this every minute). */
gmailRouter.get('/auto-create', getMyGmailAutoCreate);
gmailRouter.patch('/auto-create', setMyGmailAutoCreate);
gmailRouter.post('/auto-create/run', runMyGmailAutoCreate);

/**
 * Gmail workspace page: labels, star, archive, trash, threads, reply/forward,
 * drafts and "Send to CRM". Always acts on the signed-in user's own mailbox.
 */
const mailboxRouter = express.Router();
mailboxRouter.use(requireSuperAdminOrAgent);
mailboxRouter.get('/labels', getLabels);
mailboxRouter.post('/labels', postLabel);
mailboxRouter.patch('/labels/:labelId', patchLabel);
mailboxRouter.delete('/labels/:labelId', removeLabel);
mailboxRouter.post('/list', listMailbox);
mailboxRouter.get('/threads/:threadId', getMailboxThread);
mailboxRouter.post('/modify', modifyMailbox);
mailboxRouter.post('/trash', trashMailbox);
mailboxRouter.post('/untrash', untrashMailbox);
mailboxRouter.post('/in-crm', markMailboxInCrm);
mailboxRouter.get('/messages/:messageId/attachments/:attachmentId', getMailboxAttachment);
mailboxRouter.post('/send', sendMailbox);
mailboxRouter.post('/drafts', saveMailboxDraft);
mailboxRouter.delete('/drafts/:draftId', deleteMailboxDraft);
mailboxRouter.get('/drafts/by-message/:messageId', findMailboxDraft);
gmailRouter.use('/mailbox', mailboxRouter);

export default gmailRouter;
