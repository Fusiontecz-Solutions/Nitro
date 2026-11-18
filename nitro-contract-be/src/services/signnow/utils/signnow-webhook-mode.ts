/**
 * True when SignNow webhooks are signed with `SIGNNOW_WEBHOOK_SECRET`.
 *
 * In that mode the webhook is the only source of signing status: nothing in
 * the CRM reads status from the SignNow API on its own (no background sweep,
 * no portal-return checks, no per-event re-reads), so the account's hourly API
 * limit is left for sending contracts. A manual refresh / eye click still reads
 * SignNow, because a person asked for it.
 */
export function signNowWebhooksVerified(): boolean {
  return Boolean(String(process.env.SIGNNOW_WEBHOOK_SECRET || '').trim());
}
