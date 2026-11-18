import { Router } from 'express';
import { handleSignNowWebhook } from '../controllers/signnowWebhookController';

/**
 * SignNow event callbacks.
 *
 * Public URL: {API_BASE}/api/v1/signnow/webhook
 *
 * Register it once per event with `npx ts-node src/scripts/registerSignNowWebhooks.ts`.
 * SignNow retries on non-2xx, so the handler answers 200 for anything it can
 * parse and only surfaces 4xx/5xx for genuinely malformed or failed deliveries.
 */
const router = Router();

router.post('/webhook', handleSignNowWebhook);
router.get('/webhook', (_req, res) => {
  res.status(200).json({ success: true, message: 'SignNow event webhook is live' });
});

export default router;
