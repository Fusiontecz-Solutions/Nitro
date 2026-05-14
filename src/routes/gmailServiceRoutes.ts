import { Router } from 'express';
import {
  syncGmail,
  getEmailDetails,
  getAttachment,
  autoCreateFromEmails,
  sendCompose,
  getGmailLinkedAccount,
} from '../controllers/gmail.controller';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

/**
 * GET /api/v1/gmail/me — connected Gmail mailbox for the logged-in CRM user
 */
router.get('/me', authenticateToken, getGmailLinkedAccount);

/**
 * POST /api/gmail/sync
 */
router.post('/sync', syncGmail);

/**
 * GET /api/gmail/message/:messageId
 */
router.get('/message/:messageId', getEmailDetails);

/**
 * GET /api/gmail/message/:messageId/attachment/:attachmentId
 */
// router.get(
//   '/attachment',
//   getAttachment
// );

router.post(
  '/attachment',
  getAttachment
);

/**
 * POST /api/gmail/auto-create-applications
 * Scans INBOX for PDF attachments → extracts data → creates Client + Application
 */
router.post('/auto-create-applications', authenticateToken, autoCreateFromEmails);

/**
 * POST /api/gmail/send
 * Compose and send an email via Gmail
 */
router.post('/send', sendCompose);

export default router;