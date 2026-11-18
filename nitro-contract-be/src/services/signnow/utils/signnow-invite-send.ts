import { randomUUID } from 'crypto';
import prisma from '../../../config/prismaClient';

export const SIGNNOW_SEND_NOT_SENT = 'NOT_SENT';
export const SIGNNOW_SEND_SENDING = 'SENDING';
export const SIGNNOW_SEND_SENT = 'SENT';
export const SIGNNOW_SEND_FAILED = 'FAILED';

/** Stale SENDING locks (timeouts, crashed process) can be reclaimed after this. */
export const STALE_SENDING_MS = 3 * 60 * 1000;

export type SignNowSendStatus =
  | typeof SIGNNOW_SEND_NOT_SENT
  | typeof SIGNNOW_SEND_SENDING
  | typeof SIGNNOW_SEND_SENT
  | typeof SIGNNOW_SEND_FAILED;

export type SignNowInviteSendRow = {
  id: string;
  envelopeId: string;
  applicationId: string | null;
  contractId: number | null;
  sendStatus: string;
  inviteId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  requestId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ClaimInviteSendResult =
  | { kind: 'claimed'; row: SignNowInviteSendRow; attemptNumber: number }
  | { kind: 'already_sent'; row: SignNowInviteSendRow }
  | { kind: 'in_progress'; row: SignNowInviteSendRow };

export function isStaleSending(status: string, startedAt: Date | null, now = Date.now()): boolean {
  if (status !== SIGNNOW_SEND_SENDING) return false;
  if (!startedAt) return true;
  return now - startedAt.getTime() >= STALE_SENDING_MS;
}

export function canClaimSendStatus(status: string, startedAt: Date | null, now = Date.now()): boolean {
  if (status === SIGNNOW_SEND_SENT) return false;
  if (status === SIGNNOW_SEND_NOT_SENT || status === SIGNNOW_SEND_FAILED) return true;
  return isStaleSending(status, startedAt, now);
}

export function parseRetryAfterMs(header: string | number | undefined, fallbackMs = 5_000): number {
  if (header == null || header === '') return fallbackMs;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(60_000, Math.max(250, Math.ceil(seconds * 1000)));
  }
  const at = Date.parse(String(header));
  if (Number.isFinite(at)) {
    return Math.min(60_000, Math.max(250, at - Date.now()));
  }
  return fallbackMs;
}

export function isUnknownInviteOutcome(status: number | null): boolean {
  if (status == null) return true;
  return status === 408 || status === 429 || status >= 500;
}

function mapRow(row: Record<string, unknown>): SignNowInviteSendRow {
  return {
    id: String(row.id),
    envelopeId: String(row.envelopeId),
    applicationId: row.applicationId ? String(row.applicationId) : null,
    contractId:
      row.contractId == null || row.contractId === ''
        ? null
        : Number(row.contractId),
    sendStatus: String(row.sendStatus),
    inviteId: row.inviteId ? String(row.inviteId) : null,
    attemptCount: Number(row.attemptCount || 0),
    lastErrorCode: row.lastErrorCode ? String(row.lastErrorCode) : null,
    requestId: row.requestId ? String(row.requestId) : null,
    startedAt: row.startedAt ? new Date(row.startedAt as string | Date) : null,
    completedAt: row.completedAt ? new Date(row.completedAt as string | Date) : null,
    createdAt: new Date(row.createdAt as string | Date),
    updatedAt: new Date(row.updatedAt as string | Date),
  };
}

async function loadRow(envelopeId: string): Promise<SignNowInviteSendRow | null> {
  const found = await prisma.signNowInviteSend.findUnique({ where: { envelopeId } });
  return found ? mapRow(found as unknown as Record<string, unknown>) : null;
}

/**
 * Atomically claim the right to POST SignNow groupinvite for this document group.
 * Concurrent callers: only one receives `claimed` (pg advisory lock + unique envelopeId).
 */
export async function claimSignNowInviteSend(options: {
  envelopeId: string;
  applicationId?: string | null;
  contractId?: number | null;
  requestId?: string;
}): Promise<ClaimInviteSendResult> {
  const envelopeId = String(options.envelopeId || '').trim();
  if (!envelopeId) {
    throw new Error('Missing SignNow envelope id for invite claim');
  }
  const requestId = String(options.requestId || randomUUID()).trim();
  const applicationId = options.applicationId ? String(options.applicationId).trim() || null : null;
  const contractId =
    Number.isFinite(Number(options.contractId)) && Number(options.contractId) > 0
      ? Number(options.contractId)
      : null;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${envelopeId}))`;
    let row = await tx.signNowInviteSend.findUnique({ where: { envelopeId } });
    if (!row) {
      row = await tx.signNowInviteSend.create({
        data: {
          envelopeId,
          applicationId,
          contractId,
          sendStatus: SIGNNOW_SEND_SENDING,
          attemptCount: 1,
          requestId,
          startedAt: new Date(),
        },
      });
      return {
        kind: 'claimed' as const,
        row: mapRow(row as unknown as Record<string, unknown>),
        attemptNumber: 1,
      };
    }
    const mapped = mapRow(row as unknown as Record<string, unknown>);
    if (mapped.sendStatus === SIGNNOW_SEND_SENT) {
      return { kind: 'already_sent' as const, row: mapped };
    }
    if (!canClaimSendStatus(mapped.sendStatus, mapped.startedAt)) {
      return { kind: 'in_progress' as const, row: mapped };
    }
    const updated = await tx.signNowInviteSend.update({
      where: { envelopeId },
      data: {
        sendStatus: SIGNNOW_SEND_SENDING,
        attemptCount: { increment: 1 },
        requestId,
        startedAt: new Date(),
        completedAt: null,
        lastErrorCode: null,
        applicationId: applicationId || mapped.applicationId,
        contractId: contractId ?? mapped.contractId,
      },
    });
    const next = mapRow(updated as unknown as Record<string, unknown>);
    return { kind: 'claimed' as const, row: next, attemptNumber: next.attemptCount };
  });
}

export async function markSignNowInviteSent(options: {
  envelopeId: string;
  inviteId?: string | null;
  requestId?: string;
}): Promise<void> {
  const envelopeId = String(options.envelopeId || '').trim();
  if (!envelopeId) return;
  const inviteId = options.inviteId ? String(options.inviteId).trim() : undefined;
  const requestId = options.requestId ? String(options.requestId) : undefined;
  await prisma.signNowInviteSend.upsert({
    where: { envelopeId },
    create: {
      envelopeId,
      sendStatus: SIGNNOW_SEND_SENT,
      inviteId,
      requestId,
      attemptCount: 1,
      startedAt: new Date(),
      completedAt: new Date(),
    },
    update: {
      sendStatus: SIGNNOW_SEND_SENT,
      inviteId,
      completedAt: new Date(),
      lastErrorCode: null,
      requestId,
    },
  });
}

export async function markSignNowInviteFailed(options: {
  envelopeId: string;
  errorCode?: string | null;
  requestId?: string;
}): Promise<void> {
  const envelopeId = String(options.envelopeId || '').trim();
  if (!envelopeId) return;
  await prisma.signNowInviteSend.updateMany({
    where: { envelopeId, sendStatus: { not: SIGNNOW_SEND_SENT } },
    data: {
      sendStatus: SIGNNOW_SEND_FAILED,
      lastErrorCode: options.errorCode ? String(options.errorCode).slice(0, 80) : null,
      completedAt: new Date(),
      requestId: options.requestId ? String(options.requestId) : undefined,
    },
  });
}

export async function getSignNowInviteSend(envelopeId: string): Promise<SignNowInviteSendRow | null> {
  return loadRow(String(envelopeId || '').trim());
}

export async function listSignNowInviteSendsForApplication(
  applicationId: string,
): Promise<SignNowInviteSendRow[]> {
  const appId = String(applicationId || '').trim();
  if (!appId) return [];
  const rows = await prisma.signNowInviteSend.findMany({
    where: { applicationId: appId },
    orderBy: { updatedAt: 'desc' },
    take: 25,
  });
  return rows.map((row) => mapRow(row as unknown as Record<string, unknown>));
}

export function logSignNowSend(event: string, fields?: Record<string, unknown>) {
  const safe = { ...(fields ?? {}) };
  delete safe.accessToken;
  delete safe.token;
  delete safe.password;
  delete safe.authorization;
  console.info(`[SignNow] ${event}`, safe);
}
