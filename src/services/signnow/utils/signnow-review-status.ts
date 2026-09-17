/**
 * Did the preparer finish Owner Review on a SignNow document group?
 *
 * The CRM used to infer this entirely from the review iframe: either a
 * postMessage from the `/embedded-complete` redirect, or a "the iframe
 * navigated again" heuristic. Both signals get lost — SignNow omits the
 * redirect when the CRM origin is not publicly reachable, and the heuristic
 * misfires on SignNow's own in-app navigations. Whenever the finish went
 * unnoticed the footer stayed on "Review in SignNow" and the next click
 * rebuilt the whole package from the start instead of sending it.
 *
 * Reading the group's embedded invites answers the same question without a
 * signal that can go missing.
 */

const FINISHED_TOKENS = new Set(['fulfilled', 'completed', 'signed', 'finished', 'done']);

function statusOf(row: Record<string, unknown>): string {
  return String(row.status || row.state || row.invite_status || '')
    .trim()
    .toLowerCase();
}

function objectRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object',
    );
  }
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

/**
 * Every invite row in a `GET /v2/document-groups/{id}/embedded-invites` body.
 *
 * SignNow answers this listing in several shapes depending on the group, so
 * this is deliberately as permissive as `collectInviteSigners` in
 * `signnow-portal-send.service` — an earlier version only understood
 * `data.invites[]` and returned "still in review" forever on the `data[]` and
 * `data[].invites[]` shapes the live API actually returns for a first send,
 * which is what kept the UI showing "Review in SignNow" after Finish.
 */
function inviteRows(payload: unknown): Array<Record<string, unknown>> {
  const root = (payload || {}) as Record<string, unknown>;
  const data = root.data ?? root;
  const top = Array.isArray(data)
    ? objectRows(data)
    : Array.isArray((data as { invites?: unknown }).invites)
      ? objectRows((data as { invites: unknown }).invites)
      : objectRows(data);
  const rows: Array<Record<string, unknown>> = [];
  for (const row of top) {
    rows.push(row);
    // `data[].invites[].signers[]` — the nested shape a document group with
    // more than one signing order comes back in.
    for (const nested of objectRows(row.invites)) rows.push(nested);
  }
  return rows;
}

/** True when this signer's own row, or every document assigned to it, is done. */
function signerIsFinished(signer: Record<string, unknown>): boolean {
  if (FINISHED_TOKENS.has(statusOf(signer))) return true;
  // Deliberately stricter than the fulfilled-role scan used when building the
  // outgoing email invite, which counts a single fulfilled document. SignNow
  // reports a document as fulfilled for a role that simply has no widgets on
  // it — common on addenda and disclosures — so one fulfilled document would
  // tell the Review UI the preparer had clicked Finish the moment the iframe
  // opened. Requiring *every* assigned document, as the portal's
  // `signerHasFinished` does, cannot trip on those: the agreement itself
  // always carries Owner widgets.
  const documents = objectRows(signer.documents);
  return documents.length > 0 && documents.every((doc) => FINISHED_TOKENS.has(statusOf(doc)));
}

/** Signers whose invite says they are done, named by role (or email). */
export function collectFinishedEmbeddedSigners(payload: unknown): string[] {
  const names: string[] = [];
  for (const invite of inviteRows(payload)) {
    for (const signer of objectRows(invite.signers)) {
      if (!signerIsFinished(signer)) continue;
      const name = String(signer.role || signer.role_name || signer.email || '').trim();
      if (name && !names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Roles that have an actually-filled signature or initials widget somewhere in a
 * document-group payload.
 *
 * A second, independent answer to "did the preparer click Finish?", used when
 * the embedded-invite listing is still inconclusive. It deliberately ignores
 * `field_invites` statuses, which SignNow marks fulfilled for a role that has no
 * widgets on a document at all — the same trap that would otherwise report
 * review complete the moment the iframe opened. Filled signature data cannot
 * appear before somebody signed, and during Owner review the preparer is the
 * only party holding the package.
 */
export function collectSignedRoleNames(payload: unknown): string[] {
  const names: string[] = [];
  const root = (payload || {}) as Record<string, unknown>;
  const documents = objectRows((root.data as { documents?: unknown })?.documents ?? root.documents);
  for (const doc of documents) {
    for (const container of ['signatures', 'initials'] as const) {
      for (const field of objectRows(doc[container])) {
        const attrs = (field.json_attributes || {}) as Record<string, unknown>;
        if (!field.data && !field.signature_id && !attrs.data && !attrs.signature_id) continue;
        const name = String(
          field.role || field.signer || attrs.role || attrs.role_name || attrs.signer || '',
        ).trim();
        if (name && !names.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
          names.push(name);
        }
      }
    }
  }
  return names;
}

export type SignNowReviewStatus = {
  reviewComplete: boolean;
  fulfilledRoles: string[];
  status: 'review_complete' | 'in_review';
};

export function resolveSignNowReviewStatus(payload: unknown): SignNowReviewStatus {
  const fulfilledRoles = collectFinishedEmbeddedSigners(payload);
  return {
    reviewComplete: fulfilledRoles.length > 0,
    fulfilledRoles,
    status: fulfilledRoles.length ? 'review_complete' : 'in_review',
  };
}
