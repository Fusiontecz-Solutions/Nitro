/**
 * SignNow's `GET /documentgroup/{id}` payload has no top-level `state` field —
 * only the older single-document endpoints do. Reading `data.state` therefore
 * always came back `undefined`, every group mapped to "draft", and CRM never
 * learned that a merchant had finished signing: the contract row stayed `SENT`
 * and the application stayed on Contract Generated / Contract Sent forever.
 *
 * These helpers derive the group status from the signals SignNow actually
 * returns — the group invite status and the per-document / per-role signing
 * statuses — while still honouring an explicit `state` when one is present.
 */

export type SignNowGroupStatus = 'completed' | 'voided' | 'sent' | 'draft';

const COMPLETED_TOKENS = new Set(['completed', 'fulfilled', 'signed', 'finished', 'done']);
const VOIDED_TOKENS = new Set([
  'declined',
  'canceled',
  'cancelled',
  'voided',
  'void',
  'expired',
  'deleted',
]);
const PENDING_TOKENS = new Set([
  'pending',
  'created',
  'sent',
  'in_progress',
  'inprogress',
  'active',
  'viewed',
  'opened',
]);

const norm = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const asArray = (value: unknown): any[] => (Array.isArray(value) ? value : []);

/** Map a single SignNow status/state token onto a CRM group status, if it is meaningful. */
export function mapSignNowStatusToken(token: unknown): SignNowGroupStatus | null {
  const s = norm(token);
  if (!s) return null;
  if (COMPLETED_TOKENS.has(s)) return 'completed';
  if (VOIDED_TOKENS.has(s)) return 'voided';
  if (PENDING_TOKENS.has(s)) return 'sent';
  return null;
}

/**
 * Signer-action statuses inside a `groupinvite` payload.
 *
 * Only `invite_actions` / `actions` describe what a *signer* did. A step's
 * `invite_emails` rows carry email *delivery* statuses ("created", "sent",
 * "delivered") that never become "fulfilled", and its `documents` rows carry no
 * signing signal at all. Mixing those into the completion check meant
 * `actions.every(fulfilled)` was false even after every signer had finished, so
 * a completed SignNow group was reported as "sent" forever and the CRM
 * application stayed on Contract Sent.
 */
export function collectGroupInviteActionStatuses(invitePayload: unknown): string[] {
  const root = (invitePayload || {}) as Record<string, unknown>;
  const invite = ((root as any).invite ?? (root as any).data ?? root) as Record<string, unknown>;
  const statuses: string[] = [];

  for (const step of asArray((invite as any).steps)) {
    if (!step || typeof step !== 'object') continue;
    let stepHasActions = false;
    for (const key of ['invite_actions', 'actions'] as const) {
      for (const action of asArray((step as any)[key])) {
        if (!action || typeof action !== 'object') continue;
        const status = norm(action.status ?? action.state ?? action.action_status);
        if (status) {
          statuses.push(status);
          stepHasActions = true;
        }
      }
    }
    // Only fall back to the step's own status when it lists no signer actions.
    if (!stepHasActions) {
      const stepStatus = norm((step as any).status ?? (step as any).state);
      if (stepStatus) statuses.push(stepStatus);
    }
  }

  return statuses;
}

/**
 * Status of the group invite itself. `fulfilled` means every signer finished;
 * `canceled` means the invite was cancelled/voided.
 */
export function resolveGroupInviteStatus(invitePayload: unknown): SignNowGroupStatus | null {
  const root = (invitePayload || {}) as Record<string, unknown>;
  const invite = ((root as any).invite ?? (root as any).data ?? root) as Record<string, unknown>;
  if (!invite || typeof invite !== 'object') return null;

  const direct = mapSignNowStatusToken(
    (invite as any).status ?? (invite as any).state ?? (invite as any).invite_status,
  );

  const actions = collectGroupInviteActionStatuses(invitePayload);
  if (actions.length) {
    if (actions.some((s) => VOIDED_TOKENS.has(s))) return 'voided';
    if (actions.every((s) => COMPLETED_TOKENS.has(s))) return 'completed';
    // Some signers are still outstanding — an explicit "fulfilled" on the
    // envelope would be stale, so the outstanding actions win.
    return 'sent';
  }

  return direct;
}

/** Per-document signing signals inside a `GET /documentgroup/{id}` payload. */
export function resolveGroupDocumentsStatus(groupPayload: unknown): SignNowGroupStatus | null {
  const root = (groupPayload || {}) as Record<string, unknown>;
  const data = ((root as any).data ?? root) as Record<string, unknown>;
  const documents = asArray((data as any).documents);
  if (!documents.length) return null;

  const perDocument: SignNowGroupStatus[] = [];

  for (const doc of documents) {
    if (!doc || typeof doc !== 'object') continue;
    const statuses: string[] = [];

    for (const key of ['signature_status', 'status', 'state', 'document_status'] as const) {
      const token = norm((doc as any)[key]);
      if (token) statuses.push(token);
    }

    const inviteStatuses: string[] = [];
    for (const key of ['field_invites', 'invites', 'requests', 'roles'] as const) {
      for (const row of asArray((doc as any)[key])) {
        if (!row || typeof row !== 'object') continue;
        const token = norm(row.status ?? row.state ?? row.field_status ?? row.signing_status);
        if (token) inviteStatuses.push(token);
      }
    }

    if (inviteStatuses.length) {
      if (inviteStatuses.some((s) => VOIDED_TOKENS.has(s))) perDocument.push('voided');
      else if (inviteStatuses.every((s) => COMPLETED_TOKENS.has(s))) perDocument.push('completed');
      else perDocument.push('sent');
      continue;
    }

    const mapped = statuses.map(mapSignNowStatusToken).filter(Boolean) as SignNowGroupStatus[];
    if (mapped.includes('voided')) perDocument.push('voided');
    else if (mapped.includes('completed')) perDocument.push('completed');
    else if (mapped.includes('sent')) perDocument.push('sent');
  }

  if (!perDocument.length) return null;
  if (perDocument.includes('voided')) return 'voided';
  if (perDocument.every((s) => s === 'completed')) return 'completed';
  return 'sent';
}

/**
 * Derive the group status from everything available. `state` is honoured first
 * for the legacy single-document payloads that do carry it; otherwise the group
 * invite wins, and per-document signals are the last resort.
 *
 * Returns `draft` only when nothing in either payload says the group has moved.
 */
export function resolveSignNowGroupStatus(
  groupPayload: unknown,
  invitePayload?: unknown,
): SignNowGroupStatus {
  const root = (groupPayload || {}) as Record<string, unknown>;
  const data = ((root as any).data ?? root) as Record<string, unknown>;

  const explicit = mapSignNowStatusToken(
    (data as any)?.state ?? (root as any).state ?? (data as any)?.document_group_state,
  );
  if (explicit === 'completed' || explicit === 'voided') return explicit;

  const fromInvite = invitePayload ? resolveGroupInviteStatus(invitePayload) : null;
  if (fromInvite === 'completed' || fromInvite === 'voided') return fromInvite;

  const fromDocuments = resolveGroupDocumentsStatus(groupPayload);
  if (fromDocuments === 'completed' || fromDocuments === 'voided') return fromDocuments;

  if (explicit === 'sent' || fromInvite === 'sent' || fromDocuments === 'sent') return 'sent';
  return 'draft';
}
