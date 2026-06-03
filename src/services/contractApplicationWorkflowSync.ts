import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';

/** Stored in `Application.currentQueue` when the linked contract is fully signed (BoldSign COMPLETED). */
export const APPLICATION_QUEUE_CONTRACT_SIGNED = 'Contract Signed';

/**
 * Stored in `Application.currentState` — matches operations filters (`Signed_Contracts` /
 * `operationsStatus=Contract_Signed`) and legacy signed-contract spellings.
 */
export const APPLICATION_STATE_CONTRACT_SIGNED = 'Signed_Contracts';

type PrismaLike = typeof prisma | Prisma.TransactionClient;

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

  if (isApplicationAtContractSignedStage(application)) {
    console.log('[Contract→Application Sync]', {
      event: 'sync_skip',
      reason: 'already_contract_signed',
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

/**
 * Ensures GET application responses reflect a completed contract even if the webhook
 * missed the application update. Mutates `applicationRecord` in place when a sync runs.
 */
export async function applyContractCompletedSyncToApplicationRecord(
  prismaClient: PrismaLike,
  applicationRecord: {
    id: string;
    currentQueue?: string | null;
    currentState?: string | null;
  },
  source: string,
): Promise<boolean> {
  if (isApplicationAtContractSignedStage(applicationRecord)) {
    return false;
  }

  const contract = await prismaClient.contract.findFirst({
    where: { applicationId: applicationRecord.id },
    select: { id: true, applicationId: true, status: true },
    orderBy: { updatedAt: 'desc' },
  });

  if (!contract) return false;

  const synced = await maybeSyncApplicationFromCompletedContract(
    prismaClient,
    contract,
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
