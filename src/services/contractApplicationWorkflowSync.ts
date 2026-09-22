import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { invalidateAllApplicationStatsCache } from './applicationStatsCache';

/** Approved deal awaiting contract generation. */
export const APPLICATION_QUEUE_CONTRACT_PENDING = 'Contract Pending';
export const APPLICATION_STATE_CONTRACT_PENDING = 'CONTRACT_PENDING';

/** Contract draft created in CRM (not yet sent for signature). */
export const APPLICATION_QUEUE_CONTRACT_GENERATED = 'Contract Generated';
export const APPLICATION_STATE_CONTRACT_GENERATED = 'CONTRACT_GENERATED';

/** Envelope sent to signer(s); awaiting signature. */
export const APPLICATION_QUEUE_CONTRACT_SENT = 'Contract Sent';
export const APPLICATION_STATE_CONTRACT_SENT = 'CONTRACT_SENT';

/** Envelope voided / revoked / declined / expired. */
export const APPLICATION_QUEUE_CONTRACT_CANCELLED = 'Contract Cancelled';
export const APPLICATION_STATE_CONTRACT_CANCELLED = 'CONTRACT_CANCELLED';

/** Stored in `Application.currentQueue` when the linked contract is fully signed (BoldSign COMPLETED). */
export const APPLICATION_QUEUE_CONTRACT_SIGNED = 'Contract Signed';

/**
 * Stored in `Application.currentState` — matches operations filters (`Signed_Contracts` /
 * `operationsStatus=Contract_Signed`) and legacy signed-contract spellings.
 */
export const APPLICATION_STATE_CONTRACT_SIGNED = 'Signed_Contracts';

type PrismaLike = typeof prisma | Prisma.TransactionClient;

/**
 * Grace period before broadcasting a stage move that was written inside a
 * transaction, so listeners that refetch on the event do not read rows the
 * transaction has not committed yet.
 */
const POST_COMMIT_BROADCAST_DELAY_MS = 1_000;

export type ContractWorkflowSyncMeta = {
  source: string;
  contractId?: number;
  contractStatusPrevious?: string | null;
  contractStatusNew?: string | null;
};

const CONTRACT_SIGNED_QUEUE_VARIANTS = new Set(
  [
    APPLICATION_QUEUE_CONTRACT_SIGNED,
    'Contract_Signed',
    'Signed Contracts',
    'Signed_Contracts',
    'SignedContracts',
  ].map((v) => v.toLowerCase().replace(/[\s_-]+/g, '')),
);

const CONTRACT_SIGNED_STATE_VARIANTS = new Set(
  [
    APPLICATION_STATE_CONTRACT_SIGNED,
    APPLICATION_QUEUE_CONTRACT_SIGNED,
    'SIGNED_CONTRACTS',
    'Signed Contracts',
    'Signed_Contracts',
  ].map((v) => v.toLowerCase().replace(/[\s_-]+/g, '')),
);

/** Normalize API / DB contract status strings to uppercase Prisma enum values. */
export function normalizeContractStatus(status: unknown): string | null {
  if (status === null || status === undefined) return null;
  const raw = String(status).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    COMPLETE: 'COMPLETED',
    DONE: 'COMPLETED',
    COMPLETED: 'COMPLETED',
    DRAFT: 'DRAFT',
    SENT: 'SENT',
    VIEWED: 'VIEWED',
    SIGNED: 'SIGNED',
    DECLINED: 'DECLINED',
    REVOKED: 'REVOKED',
    EXPIRED: 'EXPIRED',
  };
  return aliases[upper] ?? upper;
}

function normalizeWorkflowToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

export function isApplicationAtContractSignedStage(app: {
  currentQueue?: string | null;
  currentState?: string | null;
}): boolean {
  const queueNorm = normalizeWorkflowToken(app.currentQueue);
  const stateNorm = normalizeWorkflowToken(app.currentState);
  return (
    CONTRACT_SIGNED_QUEUE_VARIANTS.has(queueNorm) ||
    CONTRACT_SIGNED_STATE_VARIANTS.has(stateNorm)
  );
}

export function contractSignedApplicationUpdateData(): {
  currentQueue: string;
  currentState: string;
} {
  return {
    currentQueue: APPLICATION_QUEUE_CONTRACT_SIGNED,
    currentState: APPLICATION_STATE_CONTRACT_SIGNED,
  };
}

export function contractPendingApplicationUpdateData(): {
  currentQueue: string;
  currentState: string;
} {
  return {
    currentQueue: APPLICATION_QUEUE_CONTRACT_PENDING,
    currentState: APPLICATION_STATE_CONTRACT_PENDING,
  };
}

export function contractGeneratedApplicationUpdateData(): {
  currentQueue: string;
  currentState: string;
} {
  return {
    currentQueue: APPLICATION_QUEUE_CONTRACT_GENERATED,
    currentState: APPLICATION_STATE_CONTRACT_GENERATED,
  };
}

export function contractSentApplicationUpdateData(): {
  currentQueue: string;
  currentState: string;
} {
  return {
    currentQueue: APPLICATION_QUEUE_CONTRACT_SENT,
    currentState: APPLICATION_STATE_CONTRACT_SENT,
  };
}

export function contractCancelledApplicationUpdateData(): {
  currentQueue: string;
  currentState: string;
} {
  return {
    currentQueue: APPLICATION_QUEUE_CONTRACT_CANCELLED,
    currentState: APPLICATION_STATE_CONTRACT_CANCELLED,
  };
}

const POST_CONTRACT_SENT_QUEUE_KEYS = new Set([
  'contractsigned',
  'signedcontracts',
  'final',
  'fundingcall',
  'disbursment',
  'disbursement',
  'funded',
]);

function isPostContractSentQueue(queue: string | null | undefined): boolean {
  return POST_CONTRACT_SENT_QUEUE_KEYS.has(normalizeWorkflowToken(queue));
}

/** Deal has already moved past Contract Signed (Final, Funding Call, Disbursement, etc.). */
function isApplicationPastContractSignedStage(app: {
  currentQueue?: string | null;
  currentState?: string | null;
}): boolean {
  return (
    isApplicationAtContractSignedStage(app) || isPostContractSentQueue(app.currentQueue)
  );
}

/**
 * Envelope-ish status token broadcast with a stage move, so CRM screens that
 * key off `contract:signing-status` see the same vocabulary the DocuSign /
 * BoldSign webhooks already push.
 */
const STAGE_BROADCAST_STATUS: Record<string, string> = {
  [APPLICATION_QUEUE_CONTRACT_PENDING]: 'pending',
  [APPLICATION_QUEUE_CONTRACT_GENERATED]: 'generated',
  [APPLICATION_QUEUE_CONTRACT_SENT]: 'sent',
  [APPLICATION_QUEUE_CONTRACT_SIGNED]: 'completed',
  [APPLICATION_QUEUE_CONTRACT_CANCELLED]: 'revoked',
};

function providerFromSyncSource(source: string): 'docusign' | 'boldsign' | 'signnow' | 'crm' {
  const prefix = String(source || '').toLowerCase();
  if (prefix.startsWith('signnow')) return 'signnow';
  if (prefix.startsWith('boldsign')) return 'boldsign';
  if (prefix.startsWith('docusign')) return 'docusign';
  return 'crm';
}

/**
 * Push a stage move to every CRM user watching the deal.
 *
 * Without this, only DocuSign emitted realtime status: a SignNow webhook (or
 * any in-CRM stage move) updated the database and busted the server-side stats
 * cache, but open browsers learned about it on their next 45s safety poll or
 * the next remount — which is why the Applications table's CURRENT STATE
 * column looked like it updated minutes late.
 *
 * Fire-and-forget: a socket fan-out must never fail or slow the DB write that
 * caused it. When the write ran inside a transaction the emit is held back
 * briefly, so a browser that refetches on the event reads committed rows
 * rather than the pre-commit snapshot.
 */
function broadcastStageChange(
  prismaClient: PrismaLike,
  applicationId: string,
  newQueue: string,
  previousQueue: string | null | undefined,
  meta: ContractWorkflowSyncMeta,
): void {
  const status = STAGE_BROADCAST_STATUS[newQueue] ?? 'updated';
  const inTransaction = prismaClient !== prisma;
  const delayMs = inTransaction ? POST_COMMIT_BROADCAST_DELAY_MS : 0;

  setTimeout(() => {
    void import('./contractSigningStatusEffects')
      .then(({ emitContractSigningStatusRealtime }) =>
        emitContractSigningStatusRealtime({
          applicationId,
          status,
          priorStatus: previousQueue ? STAGE_BROADCAST_STATUS[previousQueue] ?? null : null,
          provider: providerFromSyncSource(meta.source),
        }),
      )
      .catch((err) => {
        console.warn('[Contract→Application Sync] realtime stage broadcast failed', {
          applicationId,
          newQueue,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, delayMs).unref?.();
}

async function syncApplicationWorkflowStage(
  prismaClient: PrismaLike,
  applicationId: string,
  updateData: { currentQueue: string; currentState: string },
  meta: ContractWorkflowSyncMeta,
  skipIfAlready?: (app: { currentQueue?: string | null; currentState?: string | null }) => boolean,
): Promise<boolean> {
  const application = await prismaClient.application.findUnique({
    where: { id: applicationId },
    select: { id: true, applicationId: true, currentQueue: true, currentState: true },
  });

  if (!application) {
    console.log('[Contract→Application Sync]', {
      event: 'sync_skip',
      reason: 'application_not_found',
      applicationId,
      ...meta,
    });
    return false;
  }

  if (skipIfAlready?.(application)) {
    console.log('[Contract→Application Sync]', {
      event: 'sync_skip',
      reason: 'already_at_target_stage',
      applicationId,
      currentQueue: application.currentQueue,
      currentState: application.currentState,
      ...meta,
    });
    return false;
  }

  const updated = await prismaClient.application.update({
    where: { id: applicationId },
    data: updateData,
    select: {
      id: true,
      applicationId: true,
      currentQueue: true,
      currentState: true,
    },
  });

  // Webhook-driven stage moves (signed/completed) never pass through the
  // application controller, so the dashboard cache must be busted here or the
  // sidebar/state-card counts stay stale for the whole cache TTL.
  invalidateAllApplicationStatsCache();

  // Same reason the cache is busted here: open CRM tabs need a push, not a poll.
  broadcastStageChange(
    prismaClient,
    applicationId,
    updated.currentQueue,
    application.currentQueue,
    meta,
  );

  console.log('[Contract→Application Sync]', {
    event: 'sync_applied',
    applicationId,
    applicationNumericId: updated.applicationId,
    previousQueue: application.currentQueue,
    previousState: application.currentState,
    newQueue: updated.currentQueue,
    newState: updated.currentState,
    ...meta,
  });

  return true;
}

/**
 * After Create & Save Offer — deal is ready for contract generation.
 * Does not move deals that are already Contract Signed / Funded / etc. backwards.
 */
export async function syncApplicationToContractPending(
  prismaClient: PrismaLike,
  applicationId: string,
  meta: ContractWorkflowSyncMeta,
): Promise<boolean> {
  return syncApplicationWorkflowStage(
    prismaClient,
    applicationId,
    contractPendingApplicationUpdateData(),
    meta,
    (app) =>
      normalizeWorkflowToken(app.currentQueue) === 'contractpending' ||
      normalizeWorkflowToken(app.currentState) === 'contractpending' ||
      isApplicationPastContractSignedStage(app),
  );
}

/** After contract record is created (DRAFT) — not when the envelope is sent. */
export async function syncApplicationToContractGenerated(
  prismaClient: PrismaLike,
  applicationId: string,
  meta: ContractWorkflowSyncMeta,
  options?: { revertFromSent?: boolean },
): Promise<boolean> {
  return syncApplicationWorkflowStage(
    prismaClient,
    applicationId,
    contractGeneratedApplicationUpdateData(),
    meta,
    (app) => {
      if (isApplicationAtContractSignedStage(app) || isPostContractSentQueue(app.currentQueue)) {
        return true;
      }
      const alreadyGenerated =
        normalizeWorkflowToken(app.currentQueue) === 'contractgenerated' &&
        normalizeWorkflowToken(app.currentState) === 'contractgenerated';
      if (alreadyGenerated) return true;
      // Owner review can wrongly land on Contract Sent. Allow moving back to
      // Contract Generated until the merchant is actually emailed.
      if (options?.revertFromSent) return false;
      return (
        normalizeWorkflowToken(app.currentQueue) === 'contractsent' ||
        normalizeWorkflowToken(app.currentQueue) === 'contractout' ||
        normalizeWorkflowToken(app.currentQueue) === 'contractsout' ||
        normalizeWorkflowToken(app.currentState) === 'contractsent'
      );
    },
  );
}

/**
 * When a new main-contract DocuSign envelope replaces a prior send (resend after signed, etc.),
 * move the deal back to Contract Generated so downstream sent/completed webhooks can advance it again.
 */
export async function syncApplicationOnMainContractResend(
  prismaClient: PrismaLike,
  applicationId: string,
  meta: ContractWorkflowSyncMeta,
): Promise<boolean> {
  return syncApplicationWorkflowStage(
    prismaClient,
    applicationId,
    contractGeneratedApplicationUpdateData(),
    meta,
  );
}

/** After envelope is sent / viewed / partially signed — awaiting completion. */
export async function syncApplicationToContractSent(
  prismaClient: PrismaLike,
  applicationId: string,
  meta: ContractWorkflowSyncMeta,
): Promise<boolean> {
  return syncApplicationWorkflowStage(
    prismaClient,
    applicationId,
    contractSentApplicationUpdateData(),
    meta,
    (app) =>
      isApplicationAtContractSignedStage(app) || isPostContractSentQueue(app.currentQueue),
  );
}

/** After envelope is voided / revoked / declined / expired. */
export async function syncApplicationToContractCancelled(
  prismaClient: PrismaLike,
  applicationId: string,
  meta: ContractWorkflowSyncMeta,
): Promise<boolean> {
  return syncApplicationWorkflowStage(
    prismaClient,
    applicationId,
    contractCancelledApplicationUpdateData(),
    meta,
    (app) => isApplicationAtContractSignedStage(app) || isPostContractSentQueue(app.currentQueue),
  );
}

/**
 * Maps DocuSign / BoldSign envelope status to the application workflow stage.
 * - DRAFT → Contract Generated (if a contract row exists)
 * - SENT / VIEWED / SIGNED → Contract Sent
 * - COMPLETED → Contract Signed
 * - DECLINED / REVOKED / EXPIRED → Contract Cancelled
 */
export async function syncApplicationWorkflowFromContractEnvelopeStatus(
  prismaClient: PrismaLike,
  applicationId: string,
  envelopeStatus: unknown,
  meta: ContractWorkflowSyncMeta,
): Promise<boolean> {
  const statusNorm = normalizeContractStatus(envelopeStatus);
  if (!statusNorm) return false;

  if (statusNorm === 'COMPLETED') {
    return syncApplicationToContractSignedWhenContractCompleted(
      prismaClient,
      applicationId,
      meta,
    );
  }

  if (['DECLINED', 'REVOKED', 'EXPIRED'].includes(statusNorm)) {
    return syncApplicationToContractCancelled(prismaClient, applicationId, meta);
  }

  if (['SENT', 'VIEWED', 'SIGNED'].includes(statusNorm)) {
    return syncApplicationToContractSent(prismaClient, applicationId, meta);
  }

  if (statusNorm === 'DRAFT') {
    return syncApplicationToContractGenerated(prismaClient, applicationId, meta);
  }

  return false;
}

/**
 * When `Contract.status` is COMPLETED, move the linked application to the Contract Signed stage.
 * Idempotent: skips if the application is already in a signed-contract queue/state.
 */
export async function syncApplicationToContractSignedWhenContractCompleted(
  prismaClient: PrismaLike,
  applicationId: string,
  meta: ContractWorkflowSyncMeta,
): Promise<boolean> {
  const application = await prismaClient.application.findUnique({
    where: { id: applicationId },
    select: { id: true, applicationId: true, currentQueue: true, currentState: true },
  });

  if (!application) {
    console.log('[Contract→Application Sync]', {
      event: 'sync_skip',
      reason: 'application_not_found',
      applicationId,
      ...meta,
    });
    return false;
  }

  if (isApplicationPastContractSignedStage(application)) {
    console.log('[Contract→Application Sync]', {
      event: 'sync_skip',
      reason: 'already_at_or_past_contract_signed',
      applicationId,
      currentQueue: application.currentQueue,
      currentState: application.currentState,
      ...meta,
    });
    return false;
  }

  const updateData = contractSignedApplicationUpdateData();
  const updated = await prismaClient.application.update({
    where: { id: applicationId },
    data: updateData,
    select: {
      id: true,
      applicationId: true,
      currentQueue: true,
      currentState: true,
    },
  });

  invalidateAllApplicationStatsCache();

  console.log('[Contract→Application Sync]', {
    event: 'sync_applied',
    applicationId,
    applicationNumericId: updated.applicationId,
    previousQueue: application.currentQueue,
    previousState: application.currentState,
    newQueue: updated.currentQueue,
    newState: updated.currentState,
    ...meta,
  });

  return true;
}

/** Backfill sync when reading a contract that is already COMPLETED. */
export async function maybeSyncApplicationFromCompletedContract(
  prismaClient: PrismaLike,
  contract: { id?: number; applicationId?: string | null; status?: unknown },
  source: string,
): Promise<boolean> {
  const statusNorm = normalizeContractStatus(contract.status);
  if (statusNorm !== 'COMPLETED') return false;

  const applicationId = contract.applicationId ? String(contract.applicationId).trim() : '';
  if (!applicationId) {
    console.log('[Contract→Application Sync]', {
      event: 'maybeSync_skip',
      reason: 'contract_has_no_applicationId',
      contractId: contract.id ?? null,
      source,
      contractStatus: statusNorm,
    });
    return false;
  }

  return syncApplicationToContractSignedWhenContractCompleted(prismaClient, applicationId, {
    source,
    contractId: contract.id,
    contractStatusNew: statusNorm,
  });
}

function isSigningCompletedDocumentStatus(status: unknown): boolean {
  const s = String(status ?? '')
    .trim()
    .toLowerCase();
  return s === 'completed' || s === 'signed';
}

/**
 * Ensures GET application responses reflect a completed contract even if the webhook
 * missed the application update. Mutates `applicationRecord` in place when a sync runs.
 *
 * SignNow currently updates Document.status to `completed` without always writing
 * Contract.status=COMPLETED first — treat either as signed.
 */
function queueLooksLikeAwaitingSignature(queue: string | null | undefined): boolean {
  const q = String(queue || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  return (
    q === 'contract sent' ||
    q === 'contract out' ||
    q === 'contracts out' ||
    q === 'contracted' ||
    // A SignNow signing-portal send used to leave the deal on Contract
    // Generated, so a contract signed from that state must self-heal too —
    // otherwise it stays stuck behind this guard forever.
    q === 'contract generated'
  );
}

/** Document statuses that mean the envelope is out for signature but unfinished. */
function isSigningSentDocumentStatus(status: unknown): boolean {
  const s = String(status || '')
    .trim()
    .toLowerCase();
  return s === 'sent' || s === 'viewed' || s === 'delivered';
}

/** Move to Contract Sent and mirror the new stage onto the in-memory record. */
async function syncApplicationToContractSentFromRecord(
  prismaClient: PrismaLike,
  applicationRecord: {
    id: string;
    currentQueue?: string | null;
    currentState?: string | null;
  },
  source: string,
): Promise<boolean> {
  const synced = await syncApplicationToContractSent(prismaClient, applicationRecord.id, {
    source: `${source}:envelope-sent-backfill`,
    contractStatusPrevious: applicationRecord.currentQueue ?? null,
    contractStatusNew: 'SENT',
  });
  if (synced) {
    applicationRecord.currentQueue = APPLICATION_QUEUE_CONTRACT_SENT;
    applicationRecord.currentState = APPLICATION_STATE_CONTRACT_SENT;
  }
  return synced;
}

export async function applyContractCompletedSyncToApplicationRecord(
  prismaClient: PrismaLike,
  applicationRecord: {
    id: string;
    currentQueue?: string | null;
    currentState?: string | null;
  },
  source: string,
): Promise<boolean> {
  if (isApplicationPastContractSignedStage(applicationRecord)) {
    return false;
  }
  // Skip extra contract/document lookups on Application / Contract Generated / etc.
  // Only Contract Sent (and legacy sent aliases) can still need a completed-envelope sync on GET.
  if (!queueLooksLikeAwaitingSignature(applicationRecord.currentQueue)) {
    return false;
  }

  const [contract, document] = await Promise.all([
    prismaClient.contract.findFirst({
      where: { applicationId: applicationRecord.id },
      select: { id: true, applicationId: true, status: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prismaClient.document.findUnique({
      where: { applicationId: applicationRecord.id },
      select: { status: true, sentAt: true },
    }),
  ]);

  const documentCompleted = isSigningCompletedDocumentStatus(document?.status);

  /**
   * SignNow has no webhook, so a contract can be out for signature with only the
   * Document / Contract row marked `sent` while the application still reads
   * Contract Generated. Promote it here so the summary header matches the
   * Contracts Generated table without waiting for a manual refresh.
   */
  if (!documentCompleted) {
    const envelopeOut =
      isSigningSentDocumentStatus(document?.status) ||
      Boolean(document?.sentAt) ||
      ['SENT', 'VIEWED', 'SIGNED'].includes(normalizeContractStatus(contract?.status) || '');
    if (!envelopeOut) return false;
    return syncApplicationToContractSentFromRecord(prismaClient, applicationRecord, source);
  }

  if (
    documentCompleted &&
    contract &&
    normalizeContractStatus(contract.status) !== 'COMPLETED'
  ) {
    await prismaClient.contract.update({
      where: { id: contract.id },
      data: { status: 'COMPLETED' as any },
    });
    contract.status = 'COMPLETED';
  }

  const payload = contract
    ? contract
    : documentCompleted
      ? { applicationId: applicationRecord.id, status: 'COMPLETED' }
      : null;

  if (!payload) return false;

  const synced = await maybeSyncApplicationFromCompletedContract(
    prismaClient,
    payload,
    source,
  );

  if (synced) {
    const fresh = await prismaClient.application.findUnique({
      where: { id: applicationRecord.id },
      select: { currentQueue: true, currentState: true },
    });
    if (fresh) {
      applicationRecord.currentQueue = fresh.currentQueue;
      applicationRecord.currentState = fresh.currentState;
    }
  }

  return synced;
}
