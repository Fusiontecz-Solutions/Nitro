/**
 * Subscribe this environment's callback URL to the SignNow events that tell the
 * CRM a contract finished signing.
 *
 * Run once per environment (the subscription lives in the SignNow account, not
 * in this repo). The URL must be publicly reachable — SignNow's servers cannot
 * call `localhost`; use a tunnel (ngrok / cloudflared) for local testing:
 *
 *   SIGNNOW_WEBHOOK_URL=https://api.example.com/api/v1/signnow/webhook \
 *     npx ts-node src/scripts/registerSignNowWebhooks.ts
 *
 * Re-running is safe: existing subscriptions for the same event + URL are left
 * alone. Pass `--list` to print the current subscriptions without changing them.
 */
import { loadBackendEnv } from '../config/loadEnv';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

loadBackendEnv();

/**
 * Account-wide (`user.*`) events, keyed to the API user, so every document
 * group the CRM sends is covered. The bare `document_group.*` events need the
 * id of one specific group and cannot be subscribed account-wide.
 */
const EVENTS = [
  'user.document_group.complete',
  'user.document_group.invite.signer.complete',
  'user.document_group.invite.declined',
] as const;

async function main(): Promise<void> {
  const callback = String(process.env.SIGNNOW_WEBHOOK_URL || '').trim();
  const listOnly = process.argv.includes('--list');
  if (!callback && !listOnly) {
    throw new Error('Set SIGNNOW_WEBHOOK_URL to the public /api/v1/signnow/webhook URL');
  }
  if (/localhost|127\.0\.0\.1/i.test(callback)) {
    throw new Error('SIGNNOW_WEBHOOK_URL must be public — SignNow cannot reach localhost');
  }

  const client = await createSignNowApiClient();

  const existingRes = await client.get('/v2/dashboard/event-subscriptions', {
    validateStatus: () => true,
  });
  const existing = Array.isArray((existingRes.data as any)?.data)
    ? ((existingRes.data as any).data as any[])
    : [];
  console.log(`[SignNow] ${existing.length} existing subscription(s)`);
  for (const row of existing) {
    console.log('  -', row?.event, '→', row?.attributes?.callback || row?.callback || '(none)');
  }
  if (listOnly) return;

  const userRes = await client.get('/user', { validateStatus: () => true });
  const userId = String((userRes.data as any)?.id || '').trim();
  if (!userId) {
    throw new Error(`Could not read the SignNow user id (GET /user → ${userRes.status})`);
  }

  const secret = String(process.env.SIGNNOW_WEBHOOK_SECRET || '').trim();

  for (const event of EVENTS) {
    const already = existing.some(
      (row) =>
        String(row?.event || '') === event &&
        String(row?.attributes?.callback || row?.callback || '') === callback,
    );
    if (already) {
      console.log(`[SignNow] ${event} already points at this URL; skipping`);
      continue;
    }
    const body: Record<string, unknown> = {
      event,
      entity_id: userId,
      action: 'callback',
      attributes: {
        callback,
        use_tls_12: true,
        retry_count: 5,
        // SignNow signs each callback as X-SignNow-Signature = HMAC-SHA256(body).
        ...(secret ? { secret_key: secret } : {}),
      },
    };
    const res = await client.post('/v2/event-subscriptions', body, { validateStatus: () => true });
    if (res.status < 400) {
      console.log(`[SignNow] subscribed ${event} → ${callback}`);
    } else {
      console.warn(
        `[SignNow] could not subscribe ${event}:`,
        res.status,
        JSON.stringify(res.data || {}).slice(0, 400),
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[SignNow] webhook registration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
