/**
 * Subscribe this environment's callback URL to the SignNow events that tell the
 * CRM a contract finished signing.
 *
 * Run once per environment (the subscription lives in the SignNow account, not
 * in this repo):
 *
 *   SIGNNOW_WEBHOOK_URL=https://api.example.com/api/v1/signnow/webhook \
 *     npx ts-node src/scripts/registerSignNowWebhooks.ts
 *
 * Re-running is safe: existing subscriptions for the same event + URL are left
 * alone. Pass `--list` to print the current subscriptions without changing them.
 */
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

/**
 * Group-level events drive the CRM status; the document-level ones are kept as
 * a fallback because some SignNow plans only emit those.
 */
const EVENTS = [
  'document_group.complete',
  'document_group.update',
  'document.complete',
  'document.update',
] as const;

async function main(): Promise<void> {
  const callback = String(process.env.SIGNNOW_WEBHOOK_URL || '').trim();
  const listOnly = process.argv.includes('--list');
  if (!callback && !listOnly) {
    throw new Error('Set SIGNNOW_WEBHOOK_URL to the public /api/v1/signnow/webhook URL');
  }

  const client = await createSignNowApiClient();

  const existingRes = await client.get('/api/v2/events', { validateStatus: () => true });
  const existing = Array.isArray((existingRes.data as any)?.data)
    ? ((existingRes.data as any).data as any[])
    : [];
  console.log(`[SignNow] ${existing.length} existing subscription(s)`);
  for (const row of existing) {
    console.log('  -', row?.event, '→', row?.attributes?.callback || row?.callback || '(none)');
  }
  if (listOnly) return;

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
      action: 'callback',
      attributes: {
        callback,
        use_tls_12: true,
        integration_id: 'nitro-crm',
        ...(secret ? { headers: { 'X-SignNow-Signature': secret } } : {}),
      },
    };
    const res = await client.post('/api/v2/events', body, { validateStatus: () => true });
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
