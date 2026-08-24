import { Prisma } from '@prisma/client';
import prisma from '../../../config/prismaClient';
import { mergeWithExistingEnvelopeStatus } from './docusign-webhook';

/** Stored on `Contract.contractPrefillOverrides` — separate from main contract envelope. */
export const ACH_AUTHORIZATION_DOCUSIGN_KEY = 'achAuthorizationDocuSign';

/** Prior standalone ACH DocuSign sends — stored on `Contract.contractPrefillOverrides`. */
export const ACH_SEND_HISTORY_KEY = 'achSendHistory';

export type AchAuthorizationDocuSignCapsuleStatus =
  | 'DRAFT'
  | 'SENT'
  | 'VIEWED'
  | 'SIGNED'
  | 'VOIDED';

export type AchAuthorizationDocuSignMeta = {
  envelopeId: string;
  status: AchAuthorizationDocuSignCapsuleStatus;
  sentAt?: string | null;
  updatedAt?: string | null;
  funderName?: string | null;
};

export type AchSendHistoryEntry = {
  envelopeId: string;
  status: AchAuthorizationDocuSignCapsuleStatus;
  sentAt?: string | null;
  archivedAt: string;
  funderName?: string | null;
};

function achCapsuleToInternal(status: AchAuthorizationDocuSignCapsuleStatus): string {
  switch (status) {
    case 'SIGNED':
      return 'completed';
    case 'VIEWED':
      return 'viewed';
    case 'SENT':
      return 'sent';
    case 'VOIDED':
      return 'revoked';
    default:
      return 'draft';
  }
}

export function mapInternalEnvelopeStatusToAchCapsule(
  internalStatus: unknown,
): AchAuthorizationDocuSignCapsuleStatus {
  const k = String(internalStatus ?? '')
    .trim()
    .toLowerCase();
  if (k === 'voided' || k === 'revoked' || k === 'declined' || k === 'expired') {
    return 'VOIDED';
  }
  if (k === 'completed' || k === 'signed') return 'SIGNED';
  if (k === 'viewed' || k === 'delivered') return 'VIEWED';
  if (k === 'sent' || k === 'processing') return 'SENT';
  return 'DRAFT';
}

export function parseAchAuthorizationDocuSignFromPrefill(
  raw: unknown,
): AchAuthorizationDocuSignMeta | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const blob = (raw as Record<string, unknown>)[ACH_AUTHORIZATION_DOCUSIGN_KEY];
  if (blob == null || typeof blob !== 'object' || Array.isArray(blob)) return null;
  const o = blob as Record<string, unknown>;
  const envelopeId = String(o.envelopeId ?? '').trim();
  if (!envelopeId) return null;
  const statusRaw = String(o.status ?? 'DRAFT').trim().toUpperCase();
  const status: AchAuthorizationDocuSignCapsuleStatus =
    statusRaw === 'SENT' ||
    statusRaw === 'VIEWED' ||
    statusRaw === 'SIGNED' ||
    statusRaw === 'VOIDED'
      ? statusRaw
      : 'DRAFT';
  return {
    envelopeId,
    status,
    sentAt: o.sentAt != null ? String(o.sentAt) : null,
    updatedAt: o.updatedAt != null ? String(o.updatedAt) : null,
    funderName: o.funderName != null ? String(o.funderName).trim() || null : null,
  };
}

export function mergeAchAuthorizationDocuSignIntoPrefill(
  baseRaw: unknown,
  patch: Partial<AchAuthorizationDocuSignMeta> & { envelopeId: string },
): Record<string, unknown> {
  const base =
    baseRaw && typeof baseRaw === 'object' && !Array.isArray(baseRaw)
      ? { ...(baseRaw as Record<string, unknown>) }
      : {};
  const prior = parseAchAuthorizationDocuSignFromPrefill(base) ?? {
    envelopeId: patch.envelopeId,
    status: 'DRAFT' as const,
  };
  const status = patch.status ?? prior.status;
  const now = new Date().toISOString();
  const meta: AchAuthorizationDocuSignMeta = {
    envelopeId: String(patch.envelopeId || prior.envelopeId).trim(),
    status,
    sentAt:
      patch.sentAt !== undefined
        ? patch.sentAt
        : status === 'VOIDED'
          ? null
          : status === 'SENT' || status === 'VIEWED' || status === 'SIGNED'
            ? (prior.sentAt ?? now)
            : (prior.sentAt ?? null),
    updatedAt: patch.updatedAt ?? now,
    funderName:
      patch.funderName !== undefined ? patch.funderName : (prior.funderName ?? null),
  };

  // Keep mapping-id envelope blob + documentSendHistory in sync for FE status UI.
  const envelopeMapRaw = base.documentTemplateEnvelopeByMappingId;
  const envelopeMap =
    envelopeMapRaw && typeof envelopeMapRaw === 'object' && !Array.isArray(envelopeMapRaw)
      ? { ...(envelopeMapRaw as Record<string, unknown>) }
      : {};
  const envelopeMeta = {
    envelopeId: meta.envelopeId,
    status: achCapsuleToInternal(meta.status),
    updatedAt: meta.updatedAt,
  };
  envelopeMap.ach_authorization = envelopeMeta;
  for (const [key, value] of Object.entries(envelopeMap)) {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) continue;
    if (String((value as Record<string, unknown>).envelopeId ?? '').trim() === meta.envelopeId) {
      envelopeMap[key] = {
        ...(value as Record<string, unknown>),
        ...envelopeMeta,
      };
    }
  }

  const historyRaw = base.documentSendHistory;
  let documentSendHistory = Array.isArray(historyRaw) ? [...historyRaw] : [];
  let historyTouched = false;
  documentSendHistory = documentSendHistory.map((item) => {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) return item;
    const row = item as Record<string, unknown>;
    if (String(row.envelopeId ?? '').trim() !== meta.envelopeId) return item;
    const kind = String(row.documentKind ?? '').trim().toLowerCase();
    if (kind && kind !== 'ach') return item;
    historyTouched = true;
    return {
      ...row,
      documentKind: 'ach',
      status: achCapsuleToInternal(meta.status),
      updatedAt: meta.updatedAt,
    };
  });
  if (!historyTouched && meta.status !== 'DRAFT') {
    documentSendHistory.push({
      envelopeId: meta.envelopeId,
      documentKind: 'ach',
      label: 'ACH Authorization',
      status: achCapsuleToInternal(meta.status),
      updatedAt: meta.updatedAt,
    });
  }

  return {
    ...base,
    [ACH_AUTHORIZATION_DOCUSIGN_KEY]: meta,
    documentTemplateEnvelopeByMappingId: envelopeMap,
    documentSendHistory,
  };
}

export function parseAchSendHistoryFromPrefill(raw: unknown): AchSendHistoryEntry[] {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const list = (raw as Record<string, unknown>)[ACH_SEND_HISTORY_KEY];
  if (!Array.isArray(list)) return [];
  const out: AchSendHistoryEntry[] = [];
  for (const item of list) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const envelopeId = String(o.envelopeId ?? '').trim();
    if (!envelopeId) continue;
    const statusRaw = String(o.status ?? 'DRAFT').trim().toUpperCase();
    const status: AchAuthorizationDocuSignCapsuleStatus =
      statusRaw === 'SENT' ||
      statusRaw === 'VIEWED' ||
      statusRaw === 'SIGNED' ||
      statusRaw === 'VOIDED'
        ? statusRaw
        : 'DRAFT';
    out.push({
      envelopeId,
      status,
      sentAt: o.sentAt != null ? String(o.sentAt) : null,
      archivedAt: String(o.archivedAt ?? new Date(0).toISOString()),
      funderName: o.funderName != null ? String(o.funderName).trim() || null : null,
    });
  }
  return out;
}

export function appendAchSendHistoryEntry(
  baseRaw: unknown,
  entry: Omit<AchSendHistoryEntry, 'archivedAt'> & { archivedAt?: string },
): Record<string, unknown> {
  const base =
    baseRaw && typeof baseRaw === 'object' && !Array.isArray(baseRaw)
      ? { ...(baseRaw as Record<string, unknown>) }
      : {};
  const prior = parseAchSendHistoryFromPrefill(base);
  const envelopeId = String(entry.envelopeId ?? '').trim();
  if (!envelopeId) return base;
  if (prior.some((row) => row.envelopeId === envelopeId)) return base;

  const next: AchSendHistoryEntry = {
    envelopeId,
    status: entry.status,
    sentAt: entry.sentAt ?? null,
    archivedAt: entry.archivedAt ?? new Date().toISOString(),
    funderName: entry.funderName ?? null,
  };

  return {
    ...base,
    [ACH_SEND_HISTORY_KEY]: [...prior, next],
  };
}

export async function contractHasAchAuthorizationEnvelope(envelopeId: string): Promise<boolean> {
  const eid = String(envelopeId || '').trim();
  if (!eid) return false;
  const count = await prisma.contract.count({
    where: {
      contractPrefillOverrides: {
        path: [ACH_AUTHORIZATION_DOCUSIGN_KEY, 'envelopeId'],
        equals: eid,
      },
    },
  });
  return count > 0;
}

export async function findApplicationIdByAchEnvelopeId(
  envelopeId: string,
): Promise<string | null> {
  const hints = await findAchEnvelopeAuthHints(envelopeId);
  return hints?.applicationId ?? null;
}

export type AchEnvelopeAuthHints = {
  applicationId: string | null;
  contractId: number | null;
  funderName: string | null;
  funderProfileId: string | null;
};

/** Resolve CRM contract + funder for a standalone ACH envelope (not in Document table). */
export async function findAchEnvelopeAuthHints(
  envelopeId: string,
): Promise<AchEnvelopeAuthHints | null> {
  const eid = String(envelopeId || '').trim();
  if (!eid) return null;

  const byCurrent = await prisma.contract.findMany({
    where: {
      contractPrefillOverrides: {
        path: [ACH_AUTHORIZATION_DOCUSIGN_KEY, 'envelopeId'],
        equals: eid,
      },
    },
    select: {
      id: true,
      applicationId: true,
      funderName: true,
      contractPrefillOverrides: true,
    },
    orderBy: { id: 'desc' },
    take: 5,
  });

  for (const row of byCurrent) {
    const ach = parseAchAuthorizationDocuSignFromPrefill(row.contractPrefillOverrides);
    if (ach?.envelopeId !== eid) continue;
    const prefillFunder = parseAchFunderFromPrefill(row.contractPrefillOverrides, eid);
    return {
      applicationId: row.applicationId ? String(row.applicationId).trim() : null,
      contractId: row.id,
      funderName:
        String(ach.funderName ?? prefillFunder.funderName ?? row.funderName ?? '').trim() ||
        null,
      funderProfileId: prefillFunder.funderProfileId,
    };
  }

  const candidates = await prisma.contract.findMany({
    where: {
      contractPrefillOverrides: {
        path: [ACH_SEND_HISTORY_KEY],
        not: Prisma.JsonNull,
      },
    },
    select: {
      id: true,
      applicationId: true,
      funderName: true,
      contractPrefillOverrides: true,
    },
    orderBy: { id: 'desc' },
    take: 50,
  });

  for (const row of candidates) {
    const history = parseAchSendHistoryFromPrefill(row.contractPrefillOverrides);
    const match = history.find((entry) => entry.envelopeId === eid);
    if (!match) continue;
    return {
      applicationId: row.applicationId ? String(row.applicationId).trim() : null,
      contractId: row.id,
      funderName:
        String(match.funderName ?? row.funderName ?? '').trim() || null,
      funderProfileId: null,
    };
  }

  return null;
}

function parseAchFunderFromPrefill(
  prefill: unknown,
  envelopeId: string,
): { funderName: string | null; funderProfileId: string | null } {
  if (prefill == null || typeof prefill !== 'object' || Array.isArray(prefill)) {
    return { funderName: null, funderProfileId: null };
  }
  const raw = prefill as Record<string, unknown>;
  const eid = String(envelopeId || '').trim();

  const history = raw.documentSendHistory;
  if (Array.isArray(history)) {
    for (const row of history) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      if (String(r.envelopeId ?? '').trim() !== eid) continue;
      if (String(r.documentKind ?? '').toLowerCase() !== 'ach') continue;
      const funderName = String(r.funderName ?? '').trim() || null;
      const funderProfileId = String(r.funderProfileId ?? '').trim() || null;
      if (funderName || funderProfileId) return { funderName, funderProfileId };
    }
  }

  const lastAch = raw.lastAchSentFunder;
  if (lastAch && typeof lastAch === 'object' && !Array.isArray(lastAch)) {
    const o = lastAch as Record<string, unknown>;
    if (String(o.envelopeId ?? '').trim() === eid) {
      return {
        funderName: String(o.funderName ?? '').trim() || null,
        funderProfileId: String(o.funderProfileId ?? '').trim() || null,
      };
    }
  }

  return { funderName: null, funderProfileId: null };
}

type AchContractPrefillRow = {
  id: number;
  applicationId: string | null;
  contractPrefillOverrides: unknown;
};

async function loadContractsForAchLink(
  applicationId: string,
  contractId?: number,
): Promise<AchContractPrefillRow[]> {
  const numericContractId = Number(contractId);
  if (Number.isFinite(numericContractId) && numericContractId > 0) {
    const byId = await prisma.contract.findUnique({
      where: { id: numericContractId },
      select: { id: true, applicationId: true, contractPrefillOverrides: true },
    });
    if (byId) return [byId];
  }

  const appId = String(applicationId || '').trim();
  if (!appId) return [];

  return prisma.contract.findMany({
    where: { applicationId: appId },
    select: { id: true, applicationId: true, contractPrefillOverrides: true },
    orderBy: { id: 'desc' },
    take: 1,
  });
}

export async function linkAchAuthorizationEnvelopeToContract(
  applicationId: string,
  envelopeId: string,
  internalStatus = 'draft',
  contractId?: number,
  funderName?: string | null,
): Promise<boolean> {
  const eid = String(envelopeId || '').trim();
  if (!eid) return false;

  const appId = String(applicationId || '').trim();
  if (appId) {
    const mainDoc = await prisma.document.findUnique({
      where: { applicationId: appId },
      select: { envelopeId: true },
    });
    const mainEnvelopeId = String(mainDoc?.envelopeId ?? '').trim();
    if (mainEnvelopeId && mainEnvelopeId === eid) {
      console.warn('[ACH DocuSign] refusing to link main contract envelope as ACH', {
        applicationId: appId,
        envelopeId: eid,
      });
      return false;
    }
  }

  const contracts = await loadContractsForAchLink(applicationId, contractId);
  if (!contracts.length) {
    console.warn('[ACH DocuSign] no contract row to link ACH envelope', {
      applicationId,
      contractId,
      envelopeId: eid,
    });
    return false;
  }

  const capsule = mapInternalEnvelopeStatusToAchCapsule(internalStatus);
  const now = new Date().toISOString();

  for (const contract of contracts) {
    const prior = parseAchAuthorizationDocuSignFromPrefill(contract.contractPrefillOverrides);
    let prefillBase = contract.contractPrefillOverrides;
    if (prior?.envelopeId && prior.envelopeId !== eid) {
      prefillBase = appendAchSendHistoryEntry(prefillBase, {
        envelopeId: prior.envelopeId,
        status: prior.status,
        sentAt: prior.sentAt ?? null,
        archivedAt: now,
        funderName: prior.funderName ?? null,
      });
    }
    const merged = mergeAchAuthorizationDocuSignIntoPrefill(prefillBase, {
      envelopeId: eid,
      status: capsule,
      sentAt: capsule === 'SENT' || capsule === 'VIEWED' || capsule === 'SIGNED' ? now : null,
      updatedAt: now,
      funderName:
        String(funderName ?? prior?.funderName ?? '').trim() || null,
    });
    await prisma.contract.update({
      where: { id: contract.id },
      data: { contractPrefillOverrides: merged as Prisma.InputJsonValue },
    });
  }
  return true;
}

/** Remove ACH envelope metadata when it incorrectly points at a main-contract envelope. */
export async function clearAchAuthorizationIfMatchesMainContract(
  applicationId: string,
  mainContractEnvelopeId: string | string[],
): Promise<boolean> {
  const excludeIds = new Set(
    (Array.isArray(mainContractEnvelopeId)
      ? mainContractEnvelopeId
      : [mainContractEnvelopeId]
    )
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
  const appId = String(applicationId || '').trim();
  if (!excludeIds.size || !appId) return false;

  const contracts = await loadContractsForAchLink(appId);
  let cleared = false;
  for (const contract of contracts) {
    const prior = parseAchAuthorizationDocuSignFromPrefill(contract.contractPrefillOverrides);
    if (!prior || !excludeIds.has(prior.envelopeId)) continue;
    const base =
      contract.contractPrefillOverrides &&
      typeof contract.contractPrefillOverrides === 'object' &&
      !Array.isArray(contract.contractPrefillOverrides)
        ? { ...(contract.contractPrefillOverrides as Record<string, unknown>) }
        : {};
    delete base[ACH_AUTHORIZATION_DOCUSIGN_KEY];
    await prisma.contract.update({
      where: { id: contract.id },
      data: { contractPrefillOverrides: base as Prisma.InputJsonValue },
    });
    cleared = true;
  }
  return cleared;
}

export async function contractRowHasAchEnvelope(
  envelopeId: string,
  hints?: { applicationId?: string; contractId?: number },
): Promise<boolean> {
  const eid = String(envelopeId || '').trim();
  if (!eid) return false;
  if (await contractHasAchAuthorizationEnvelope(eid)) return true;
  if (!hints?.applicationId && !hints?.contractId) return false;
  const rows = await loadContractsForAchLink(hints.applicationId ?? '', hints.contractId);
  return rows.some(
    (row) =>
      parseAchAuthorizationDocuSignFromPrefill(row.contractPrefillOverrides)?.envelopeId === eid,
  );
}

async function findContractsForAchEnvelopeUpdate(
  envelopeId: string,
  hints?: { applicationId?: string; contractId?: number },
): Promise<AchContractPrefillRow[]> {
  const eid = String(envelopeId || '').trim();
  let contracts: AchContractPrefillRow[] = await prisma.contract.findMany({
      where: {
        contractPrefillOverrides: {
          path: [ACH_AUTHORIZATION_DOCUSIGN_KEY, 'envelopeId'],
          equals: eid,
        },
      },
      select: { id: true, applicationId: true, contractPrefillOverrides: true },
    });
  if (!contracts.length && hints && (hints.applicationId || hints.contractId)) {
    const candidates = await loadContractsForAchLink(
      hints.applicationId ?? '',
      hints.contractId,
    );
    contracts = candidates.filter((row) =>
      contractPrefillReferencesAchEnvelope(row.contractPrefillOverrides, eid),
    );
  }
  return contracts;
}

/** True when prefill stores this envelope as ACH (capsule, alias blob, or send history). */
function contractPrefillReferencesAchEnvelope(
  raw: unknown,
  envelopeId: string,
): boolean {
  const eid = String(envelopeId || '').trim();
  if (!eid) return false;
  if (parseAchAuthorizationDocuSignFromPrefill(raw)?.envelopeId === eid) return true;
  if (parseAchSendHistoryFromPrefill(raw).some((h) => h.envelopeId === eid)) return true;
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const o = raw as Record<string, unknown>;

  const docHistory = o.documentSendHistory;
  if (Array.isArray(docHistory)) {
    for (const item of docHistory) {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
      const row = item as Record<string, unknown>;
      if (String(row.envelopeId ?? '').trim() !== eid) continue;
      const kind = String(row.documentKind ?? '').trim().toLowerCase();
      if (kind === 'ach' || kind === '') return true;
    }
  }

  const envelopeMap = o.documentTemplateEnvelopeByMappingId;
  if (envelopeMap && typeof envelopeMap === 'object' && !Array.isArray(envelopeMap)) {
    for (const [key, meta] of Object.entries(envelopeMap as Record<string, unknown>)) {
      if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) continue;
      if (String((meta as Record<string, unknown>).envelopeId ?? '').trim() !== eid) {
        continue;
      }
      const k = String(key ?? '').trim().toLowerCase();
      if (
        k === 'ach_authorization' ||
        k.includes('ach_authorization') ||
        k.endsWith('_ach') ||
        k.includes('ach_form')
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when this envelope is the standalone ACH send — not the main contract envelope.
 * Contract and ACH must keep separate DocuSign envelopes so voiding one does not affect the other.
 */
export async function isStandaloneAchEnvelope(
  envelopeId: string,
  hints?: { applicationId?: string; contractId?: number },
): Promise<boolean> {
  const eid = String(envelopeId || '').trim();
  if (!eid) return false;
  if (!(await contractRowHasAchEnvelope(eid, hints))) return false;

  const appIdHint = String(hints?.applicationId ?? '').trim();
  if (appIdHint) {
    const mainDoc = await prisma.document.findUnique({
      where: { applicationId: appIdHint },
      select: { envelopeId: true },
    });
    return String(mainDoc?.envelopeId ?? '').trim() !== eid;
  }

  const contracts = await findContractsForAchEnvelopeUpdate(eid, hints);
  for (const contract of contracts) {
    const appId = String(contract.applicationId ?? '').trim();
    if (!appId) continue;
    const mainDoc = await prisma.document.findUnique({
      where: { applicationId: appId },
      select: { envelopeId: true },
    });
    if (String(mainDoc?.envelopeId ?? '').trim() === eid) return false;
  }
  return true;
}

export async function updateAchAuthorizationDocuSignStatus(
  envelopeId: string,
  internalStatus: string,
  hints?: { applicationId?: string; contractId?: number },
): Promise<boolean> {
  const eid = String(envelopeId || '').trim();
  if (!eid) return false;

  const incomingCapsule = mapInternalEnvelopeStatusToAchCapsule(internalStatus);
  const now = new Date().toISOString();

  const contracts = await findContractsForAchEnvelopeUpdate(eid, hints);

  if (!contracts.length) return false;

  for (const contract of contracts) {
    const prior = parseAchAuthorizationDocuSignFromPrefill(contract.contractPrefillOverrides);
    const isHistoricalEnvelope = prior?.envelopeId
      ? prior.envelopeId !== eid
      : parseAchSendHistoryFromPrefill(contract.contractPrefillOverrides).some(
          (entry) => entry.envelopeId === eid,
        );
    if (isHistoricalEnvelope) {
      const base =
        contract.contractPrefillOverrides &&
        typeof contract.contractPrefillOverrides === 'object' &&
        !Array.isArray(contract.contractPrefillOverrides)
          ? { ...(contract.contractPrefillOverrides as Record<string, unknown>) }
          : {};
      const history = parseAchSendHistoryFromPrefill(base);
      const nextHistory = history.map((entry) => {
        if (entry.envelopeId !== eid) return entry;
        const mergedStatus = mergeWithExistingEnvelopeStatus(
          achCapsuleToInternal(entry.status),
          internalStatus,
        );
        return {
          ...entry,
          status: mapInternalEnvelopeStatusToAchCapsule(mergedStatus || internalStatus),
        };
      });

      const documentHistoryRaw = base.documentSendHistory;
      const documentSendHistory = Array.isArray(documentHistoryRaw)
        ? documentHistoryRaw.map((item) => {
            if (item == null || typeof item !== 'object' || Array.isArray(item)) return item;
            const row = item as Record<string, unknown>;
            if (
              String(row.envelopeId ?? '').trim() !== eid ||
              String(row.documentKind ?? '').trim().toLowerCase() !== 'ach'
            ) {
              return item;
            }
            const mergedStatus = mergeWithExistingEnvelopeStatus(
              String(row.status ?? ''),
              internalStatus,
            );
            return {
              ...row,
              status: mergedStatus || internalStatus,
              updatedAt: now,
            };
          })
        : [];

      const envelopeMapRaw = base.documentTemplateEnvelopeByMappingId;
      const envelopeMap =
        envelopeMapRaw && typeof envelopeMapRaw === 'object' && !Array.isArray(envelopeMapRaw)
          ? { ...(envelopeMapRaw as Record<string, unknown>) }
          : {};
      for (const [key, value] of Object.entries(envelopeMap)) {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) continue;
        const row = value as Record<string, unknown>;
        if (String(row.envelopeId ?? '').trim() !== eid) continue;
        const mergedStatus = mergeWithExistingEnvelopeStatus(
          String(row.status ?? ''),
          internalStatus,
        );
        envelopeMap[key] = {
          ...row,
          status: mergedStatus || internalStatus,
          updatedAt: now,
        };
      }

      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          contractPrefillOverrides: {
            ...base,
            [ACH_SEND_HISTORY_KEY]: nextHistory,
            documentSendHistory,
            documentTemplateEnvelopeByMappingId: envelopeMap,
          } as Prisma.InputJsonValue,
        },
      });
      continue;
    }
    const priorInternal = prior ? achCapsuleToInternal(prior.status) : null;
    const mergedInternal = mergeWithExistingEnvelopeStatus(priorInternal, internalStatus);
    const status = mergedInternal
      ? mapInternalEnvelopeStatusToAchCapsule(mergedInternal)
      : incomingCapsule;

    const merged = mergeAchAuthorizationDocuSignIntoPrefill(contract.contractPrefillOverrides, {
      envelopeId: eid,
      status,
      updatedAt: now,
    });
    await prisma.contract.update({
      where: { id: contract.id },
      data: { contractPrefillOverrides: merged as Prisma.InputJsonValue },
    });
  }
  return true;
}
