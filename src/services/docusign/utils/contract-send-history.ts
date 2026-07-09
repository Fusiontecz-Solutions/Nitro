import type { Prisma } from '@prisma/client';
import prisma from '../../../config/prismaClient';

/** Prior main-contract DocuSign sends — stored on `Contract.contractPrefillOverrides`. */
export const CONTRACT_SEND_HISTORY_KEY = 'contractSendHistory';

export type ContractSendHistoryEntry = {
  envelopeId: string;
  status: string;
  sentAt?: string | null;
  completedAt?: string | null;
  archivedAt: string;
};

const COMPLETED_ENVELOPE_STATUSES = new Set([
  'completed',
  'signed',
  'complete',
  'done',
]);

/** Normalize DocuSign document status or Prisma contract status for send-history rows. */
export function resolveArchivedMainContractEnvelopeStatus(
  documentStatus: unknown,
  contractStatus?: unknown,
): string {
  const doc = String(documentStatus ?? '')
    .trim()
    .toLowerCase();
  const contract = String(contractStatus ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  if (COMPLETED_ENVELOPE_STATUSES.has(doc) || contract === 'COMPLETED' || contract === 'SIGNED') {
    return 'completed';
  }
  if (doc) return doc;
  if (contract) return contract.toLowerCase();
  return 'draft';
}

export function isCompletedEnvelopeStatus(
  documentStatus: unknown,
  contractStatus?: unknown,
): boolean {
  return resolveArchivedMainContractEnvelopeStatus(documentStatus, contractStatus) === 'completed';
}

export function parseContractSendHistoryFromPrefill(raw: unknown): ContractSendHistoryEntry[] {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const list = (raw as Record<string, unknown>)[CONTRACT_SEND_HISTORY_KEY];
  if (!Array.isArray(list)) return [];
  const out: ContractSendHistoryEntry[] = [];
  for (const item of list) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const envelopeId = String(o.envelopeId ?? '').trim();
    if (!envelopeId) continue;
    out.push({
      envelopeId,
      status: String(o.status ?? 'draft').trim().toLowerCase(),
      sentAt: o.sentAt != null ? String(o.sentAt) : null,
      completedAt: o.completedAt != null ? String(o.completedAt) : null,
      archivedAt: String(o.archivedAt ?? new Date(0).toISOString()),
    });
  }
  return out;
}

export function appendContractSendHistoryEntry(
  baseRaw: unknown,
  entry: Omit<ContractSendHistoryEntry, 'archivedAt'> & { archivedAt?: string },
): Record<string, unknown> {
  const base =
    baseRaw && typeof baseRaw === 'object' && !Array.isArray(baseRaw)
      ? { ...(baseRaw as Record<string, unknown>) }
      : {};
  const prior = parseContractSendHistoryFromPrefill(base);
  const envelopeId = String(entry.envelopeId ?? '').trim();
  if (!envelopeId) return base;
  if (prior.some((row) => row.envelopeId === envelopeId)) return base;

  const next: ContractSendHistoryEntry = {
    envelopeId,
    status: String(entry.status ?? 'draft').trim().toLowerCase(),
    sentAt: entry.sentAt ?? null,
    completedAt: entry.completedAt ?? null,
    archivedAt: entry.archivedAt ?? new Date().toISOString(),
  };

  return {
    ...base,
    [CONTRACT_SEND_HISTORY_KEY]: [...prior, next],
  };
}

export function updateContractSendHistoryEntryStatus(
  baseRaw: unknown,
  envelopeId: string,
  status: string,
  patch?: { sentAt?: string | null; completedAt?: string | null },
): Record<string, unknown> {
  const base =
    baseRaw && typeof baseRaw === 'object' && !Array.isArray(baseRaw)
      ? { ...(baseRaw as Record<string, unknown>) }
      : {};
  const prior = parseContractSendHistoryFromPrefill(base);
  const eid = String(envelopeId || '').trim();
  if (!eid || !prior.length) return base;

  const normalized = String(status || 'draft').trim().toLowerCase();
  const nextHistory = prior.map((entry) => {
    if (entry.envelopeId !== eid) return entry;
    return {
      ...entry,
      status: normalized,
      sentAt: patch?.sentAt !== undefined ? patch.sentAt : entry.sentAt,
      completedAt:
        patch?.completedAt !== undefined ? patch.completedAt : entry.completedAt,
    };
  });

  return {
    ...base,
    [CONTRACT_SEND_HISTORY_KEY]: nextHistory,
  };
}

export async function updateArchivedContractSendHistoryStatus(
  applicationId: string,
  envelopeId: string,
  status: string,
  patch?: { sentAt?: string | null; completedAt?: string | null },
): Promise<boolean> {
  const appId = String(applicationId || '').trim();
  const eid = String(envelopeId || '').trim();
  if (!appId || !eid) return false;

  const contract = await prisma.contract.findUnique({
    where: { applicationId: appId },
    select: { id: true, contractPrefillOverrides: true },
  });
  if (!contract) return false;

  const prior = parseContractSendHistoryFromPrefill(contract.contractPrefillOverrides);
  if (!prior.some((row) => row.envelopeId === eid)) return false;

  const merged = updateContractSendHistoryEntryStatus(
    contract.contractPrefillOverrides,
    eid,
    status,
    patch,
  );

  await prisma.contract.update({
    where: { id: contract.id },
    data: { contractPrefillOverrides: merged as Prisma.InputJsonValue },
  });
  return true;
}

export async function archiveMainContractEnvelopeToHistory(
  applicationId: string,
  snapshot: {
    envelopeId: string;
    status: string;
    sentAt?: Date | string | null;
    completedAt?: Date | string | null;
  },
): Promise<boolean> {
  const appId = String(applicationId || '').trim();
  const envelopeId = String(snapshot.envelopeId || '').trim();
  if (!appId || !envelopeId) return false;

  const contract = await prisma.contract.findUnique({
    where: { applicationId: appId },
    select: { id: true, contractPrefillOverrides: true },
  });
  if (!contract) return false;

  const merged = appendContractSendHistoryEntry(contract.contractPrefillOverrides, {
    envelopeId,
    status: snapshot.status,
    sentAt: snapshot.sentAt ? new Date(snapshot.sentAt).toISOString() : null,
    completedAt: snapshot.completedAt ? new Date(snapshot.completedAt).toISOString() : null,
    archivedAt: new Date().toISOString(),
  });

  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      contractPrefillOverrides: merged as Prisma.InputJsonValue,
      status: 'DRAFT',
    },
  });
  return true;
}
