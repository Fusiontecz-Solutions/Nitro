import { Router } from 'express';
import { sendPaymentMail } from '../controllers/mail.controller';
import { authenticateToken } from '../middleware/authMiddleware';

const router = Router();

/**
 * POST /api/mail/send — payment letters/templates via SendGrid only (not Gmail).
 */
router.post('/send', authenticateToken, sendPaymentMail);

export default router;
