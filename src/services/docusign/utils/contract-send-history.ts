import type { Prisma } from '@prisma/client';
import prisma from '../../../config/prismaClient';

/** Prior main-contract DocuSign sends — stored on `Contract.contractPrefillOverrides`. */
export const CONTRACT_SEND_HISTORY_KEY = 'contractSendHistory';

/** Contract terms captured when a main-contract envelope is archived. */
export type ContractSendHistoryTermsSnapshot = {
  approvedAmount?: number | null;
  totalAmount?: number | null;
  contractLength?: number | null;
  term?: string | null;
  position?: string | null;
  buyRate?: number | null;
  factorRate?: number | null;
  paymentAmount?: number | null;
  paybackAmount?: number | null;
  percentOfGross?: number | null;
};

export type ContractSendHistoryEntry = {
  envelopeId: string;
  status: string;
  sentAt?: string | null;
  completedAt?: string | null;
  archivedAt: string;
  termsSnapshot?: ContractSendHistoryTermsSnapshot | null;
  /** Documents included in this main-contract envelope (for separate table rows). */
  package?: {
    includeMainContract?: boolean;
    includeAddendum?: boolean;
    includeDisclosure?: boolean;
  } | null;
  /** DocuSign sender funder at send time — required when contract funder later changes. */
  funderName?: string | null;
  funderProfileId?: string | null;
  /** Durable Cloudinary URL for this prior send (survives Document.envelopeId replace). */
  signedPdfUrl?: string | null;
  signedPdfPublicId?: string | null;
};

export const MAIN_CONTRACT_SEND_PACKAGE_KEY = 'mainContractSendPackage';

function parseTermsSnapshotFromUnknown(
  raw: unknown,
): ContractSendHistoryTermsSnapshot | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const snapshot: ContractSendHistoryTermsSnapshot = {
    approvedAmount: toSnapshotNumber(o.approvedAmount),
    totalAmount: toSnapshotNumber(o.totalAmount),
    contractLength: toSnapshotNumber(o.contractLength),
    term: o.term != null ? String(o.term) : null,
    position: o.position != null ? String(o.position) : null,
    buyRate: toSnapshotNumber(o.buyRate),
    factorRate: toSnapshotNumber(o.factorRate),
    paymentAmount: toSnapshotNumber(o.paymentAmount),
    paybackAmount: toSnapshotNumber(o.paybackAmount),
    percentOfGross: toSnapshotNumber(o.percentOfGross),
  };
  const hasAny = Object.values(snapshot).some((v) => v != null && v !== '');
  return hasAny ? snapshot : null;
}

/** Terms captured on mainContractSendPackage / documentSendHistory at send time. */
export function resolveTermsSnapshotFromContractPrefill(
  raw: unknown,
  envelopeId: string,
): ContractSendHistoryTermsSnapshot | null {
  const eid = String(envelopeId || '').trim();
  if (!eid || raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const o = raw as Record<string, unknown>;

  for (const key of [CONTRACT_SEND_HISTORY_KEY, 'documentSendHistory']) {
    const list = o[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      if (String(row.envelopeId ?? '').trim() !== eid) continue;
      const snap = parseTermsSnapshotFromUnknown(row.termsSnapshot);
      if (snap) return snap;
    }
  }

  const pkg = o[MAIN_CONTRACT_SEND_PACKAGE_KEY];
  if (pkg && typeof pkg === 'object' && !Array.isArray(pkg)) {
    const b = pkg as Record<string, unknown>;
    if (String(b.envelopeId ?? '').trim() === eid) {
      const snap = parseTermsSnapshotFromUnknown(b.termsSnapshot);
      if (snap) return snap;
    }
  }

  return null;
}

function parseMainContractSendPackageFromPrefill(
  raw: unknown,
  envelopeId?: string | null,
): ContractSendHistoryEntry['package'] | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const blob = (raw as Record<string, unknown>)[MAIN_CONTRACT_SEND_PACKAGE_KEY];
  if (blob == null || typeof blob !== 'object' || Array.isArray(blob)) return null;
  const o = blob as Record<string, unknown>;
  const storedEnvelopeId = String(o.envelopeId ?? '').trim();
  const expected = String(envelopeId ?? '').trim();
  if (expected && storedEnvelopeId && storedEnvelopeId !== expected) return null;
  return {
    includeMainContract: o.includeMainContract !== false,
    includeAddendum: Boolean(o.includeAddendum),
    includeDisclosure: Boolean(o.includeDisclosure),
  };
}

/** Coerce Prisma Decimal / numeric strings into plain numbers for JSON snapshots. */
function toSnapshotNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object' && value !== null && 'toNumber' in value) {
    const n = Number((value as { toNumber: () => number }).toNumber());
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildContractSendHistoryTermsSnapshot(
  contract: Record<string, unknown> | null | undefined,
): ContractSendHistoryTermsSnapshot | undefined {
  if (!contract) return undefined;
  const terms = Array.isArray(contract.termsOffers)
    ? (contract.termsOffers[0] as Record<string, unknown> | undefined)
    : undefined;
  const offer =
    contract.offer != null && typeof contract.offer === 'object'
      ? (contract.offer as Record<string, unknown>)
      : null;
  return {
    approvedAmount:
      toSnapshotNumber(contract.approvedAmount) ??
      toSnapshotNumber(terms?.approvedAmount) ??
      toSnapshotNumber(offer?.offer),
    totalAmount:
      toSnapshotNumber(contract.totalAmount) ??
      toSnapshotNumber(terms?.paybackAmount) ??
      toSnapshotNumber(offer?.totalRemit),
    contractLength:
      toSnapshotNumber(contract.contractLenght) ?? toSnapshotNumber(terms?.termLength),
    term: offer?.term != null ? String(offer.term) : null,
    position: terms?.position != null ? String(terms.position) : null,
    buyRate: toSnapshotNumber(terms?.buyRate) ?? toSnapshotNumber(offer?.rate),
    factorRate: toSnapshotNumber(terms?.factorRate),
    paymentAmount:
      toSnapshotNumber(terms?.paymentAmount) ?? toSnapshotNumber(offer?.repayPerPeriod),
    paybackAmount:
      toSnapshotNumber(terms?.paybackAmount) ?? toSnapshotNumber(offer?.totalRemit),
    percentOfGross: toSnapshotNumber(terms?.percentOfGross),
  };
}

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

/**
 * True when `envelopeId` appears on this contract's DocuSign prefill meta:
 * current capsules or any send-history array (main / ACH / standalone / document).
 * Also deep-walks JSON so mapping-id maps / nested blobs still count.
 */
export function contractPrefillContainsEnvelopeId(
  raw: unknown,
  envelopeId: string,
): boolean {
  const eid = String(envelopeId || '').trim().toLowerCase();
  if (!eid) return false;

  let root: unknown = raw;
  if (typeof root === 'string') {
    const trimmed = root.trim();
    if (!trimmed) return false;
    try {
      root = JSON.parse(trimmed);
    } catch {
      return trimmed.toLowerCase().includes(eid);
    }
  }
  if (root == null || typeof root !== 'object') return false;

  const o = root as Record<string, unknown>;

  for (const key of [
    CONTRACT_SEND_HISTORY_KEY,
    'documentSendHistory',
    'standalonePackageSendHistory',
    'achSendHistory',
  ]) {
    const list = o[key];
    if (!Array.isArray(list)) continue;
    if (
      list.some(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          String((entry as Record<string, unknown>).envelopeId ?? '')
            .trim()
            .toLowerCase() === eid,
      )
    ) {
      return true;
    }
  }

  for (const key of [
    MAIN_CONTRACT_SEND_PACKAGE_KEY,
    'achAuthorizationDocuSign',
    'standalonePackageDocuSign',
  ]) {
    const blob = o[key];
    if (blob == null || typeof blob !== 'object' || Array.isArray(blob)) continue;
    if (
      String((blob as Record<string, unknown>).envelopeId ?? '')
        .trim()
        .toLowerCase() === eid
    ) {
      return true;
    }
  }

  const byMapping = o.documentTemplateEnvelopeByMappingId;
  if (byMapping && typeof byMapping === 'object' && !Array.isArray(byMapping)) {
    for (const meta of Object.values(byMapping as Record<string, unknown>)) {
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue;
      if (
        String((meta as Record<string, unknown>).envelopeId ?? '')
          .trim()
          .toLowerCase() === eid
      ) {
        return true;
      }
    }
  }

  // Deep walk: any nested envelopeId (covers future keys / nested package meta).
  const stack: unknown[] = [root];
  const seen = new Set<unknown>();
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    const rec = cur as Record<string, unknown>;
    if (String(rec.envelopeId ?? '').trim().toLowerCase() === eid) {
      return true;
    }
    for (const val of Object.values(rec)) {
      if (val && typeof val === 'object') stack.push(val);
    }
  }

  // Last resort: UUID literally present in serialized prefill (history wipe-resistant when
  // envelope id still appears in signedPdfUrl / misc blobs).
  try {
    return JSON.stringify(root).toLowerCase().includes(eid);
  } catch {
    return false;
  }
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
        const rawSnapshot = o.termsSnapshot;
        const termsSnapshot =
          rawSnapshot != null &&
          typeof rawSnapshot === 'object' &&
          !Array.isArray(rawSnapshot)
            ? (rawSnapshot as ContractSendHistoryTermsSnapshot)
            : null;
        out.push({
            envelopeId,
            status: String(o.status ?? 'draft').trim().toLowerCase(),
            sentAt: o.sentAt != null ? String(o.sentAt) : null,
            completedAt: o.completedAt != null ? String(o.completedAt) : null,
            archivedAt: String(o.archivedAt ?? new Date(0).toISOString()),
            termsSnapshot,
            package:
              o.package != null && typeof o.package === 'object' && !Array.isArray(o.package)
                ? {
                    includeMainContract:
                      (o.package as Record<string, unknown>).includeMainContract !== false,
                    includeAddendum: Boolean(
                      (o.package as Record<string, unknown>).includeAddendum,
                    ),
                    includeDisclosure: Boolean(
                      (o.package as Record<string, unknown>).includeDisclosure,
                    ),
                  }
                : null,
            funderName: String(o.funderName ?? '').trim() || null,
            funderProfileId: String(o.funderProfileId ?? '').trim() || null,
            signedPdfUrl: String(o.signedPdfUrl ?? '').trim() || null,
            signedPdfPublicId: String(o.signedPdfPublicId ?? '').trim() || null,
        });
  }
  return out;
}

export function appendContractSendHistoryEntry(
  baseRaw: unknown,
  entry: Omit<ContractSendHistoryEntry, 'archivedAt'> & {
    archivedAt?: string;
    termsSnapshot?: ContractSendHistoryTermsSnapshot | null;
    package?: ContractSendHistoryEntry['package'];
    funderName?: string | null;
    funderProfileId?: string | null;
    signedPdfUrl?: string | null;
    signedPdfPublicId?: string | null;
  },
): Record<string, unknown> {
  const base =
    baseRaw && typeof baseRaw === 'object' && !Array.isArray(baseRaw)
      ? { ...(baseRaw as Record<string, unknown>) }
      : {};
  const prior = parseContractSendHistoryFromPrefill(base);
  const envelopeId = String(entry.envelopeId ?? '').trim();
  if (!envelopeId) return base;
  const upsert = prior.find((row) => row.envelopeId === envelopeId);
  const next: ContractSendHistoryEntry = {
    envelopeId,
    status: String(entry.status ?? 'draft').trim().toLowerCase(),
    sentAt: entry.sentAt !== undefined ? entry.sentAt : (upsert?.sentAt ?? null),
    completedAt: entry.completedAt !== undefined ? entry.completedAt : (upsert?.completedAt ?? null),
    archivedAt: entry.archivedAt ?? upsert?.archivedAt ?? new Date().toISOString(),
    termsSnapshot: entry.termsSnapshot !== undefined ? entry.termsSnapshot : (upsert?.termsSnapshot ?? null),
    package: entry.package !== undefined ? entry.package : (upsert?.package ?? null),
    funderName:
      entry.funderName !== undefined
        ? String(entry.funderName ?? '').trim() || null
        : (upsert?.funderName ?? null),
    funderProfileId:
      entry.funderProfileId !== undefined
        ? String(entry.funderProfileId ?? '').trim() || null
        : (upsert?.funderProfileId ?? null),
    signedPdfUrl:
      entry.signedPdfUrl !== undefined
        ? String(entry.signedPdfUrl ?? '').trim() || null
        : (upsert?.signedPdfUrl ?? null),
    signedPdfPublicId:
      entry.signedPdfPublicId !== undefined
        ? String(entry.signedPdfPublicId ?? '').trim() || null
        : (upsert?.signedPdfPublicId ?? null),
  };
  if (upsert) {
    return {
      ...base,
      [CONTRACT_SEND_HISTORY_KEY]: prior.map((row) =>
        row.envelopeId === envelopeId ? next : row,
      ),
    };
  }

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
    termsSnapshot?: ContractSendHistoryTermsSnapshot | null;
    package?: ContractSendHistoryEntry['package'];
    funderName?: string | null;
    funderProfileId?: string | null;
    signedPdfUrl?: string | null;
    signedPdfPublicId?: string | null;
    /**
     * When true (default), reset Contract.status to DRAFT for a replacement draft.
     * When false (void), keep Contract.status so Contracts Generated still shows Voided.
     */
    resetContractToDraft?: boolean;
  },
): Promise<boolean> {
  const appId = String(applicationId || '').trim();
  const envelopeId = String(snapshot.envelopeId || '').trim();
  if (!appId || !envelopeId) return false;

  const contract = await prisma.contract.findUnique({
    where: { applicationId: appId },
    select: { id: true, funderName: true, contractPrefillOverrides: true },
  });
  if (!contract) return false;

  const packageMeta =
    snapshot.package ??
    parseMainContractSendPackageFromPrefill(contract.contractPrefillOverrides, envelopeId);

  const fromPrefill = resolveFunderFromContractPrefill(
    contract.contractPrefillOverrides,
    envelopeId,
  );
  const funderName =
    String(snapshot.funderName ?? '').trim() ||
    fromPrefill.funderName ||
    String(contract.funderName ?? '').trim() ||
    null;
  const funderProfileId =
    String(snapshot.funderProfileId ?? '').trim() || fromPrefill.funderProfileId || null;
  const signedPdfUrl = String(snapshot.signedPdfUrl ?? '').trim() || null;
  const signedPdfPublicId = String(snapshot.signedPdfPublicId ?? '').trim() || null;

  // Prefer send-time snapshot (stored on package/history) over live contract terms —
  // contract may already have been edited for the replacement send.
  const termsSnapshot =
    snapshot.termsSnapshot ??
    resolveTermsSnapshotFromContractPrefill(
      contract.contractPrefillOverrides,
      envelopeId,
    ) ??
    null;

  const merged = appendContractSendHistoryEntry(contract.contractPrefillOverrides, {
    envelopeId,
    status: snapshot.status,
    sentAt: snapshot.sentAt ? new Date(snapshot.sentAt).toISOString() : null,
    completedAt: snapshot.completedAt ? new Date(snapshot.completedAt).toISOString() : null,
    archivedAt: new Date().toISOString(),
    termsSnapshot,
    package: packageMeta,
    funderName,
    funderProfileId,
    signedPdfUrl,
    signedPdfPublicId,
  });

  const resetToDraft = snapshot.resetContractToDraft !== false;
  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      contractPrefillOverrides: merged as Prisma.InputJsonValue,
      ...(resetToDraft ? { status: 'DRAFT' as const } : {}),
    },
  });
  return true;
}

/** Look up a durable PDF URL stored on contract send history for a prior envelope. */
export async function findSignedPdfUrlInContractSendHistory(
  envelopeId: string,
): Promise<{ url: string; status: string | null; publicId: string | null } | null> {
  const eid = String(envelopeId || '').trim();
  if (!eid) return null;

  const hits = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT c.id
    FROM "Contract" c
    WHERE c."contractPrefillOverrides" IS NOT NULL
      AND c."contractPrefillOverrides"::text LIKE ${'%' + eid + '%'}
    ORDER BY c.id DESC
    LIMIT 10
  `;
  for (const hit of hits) {
    const row = await prisma.contract.findUnique({
      where: { id: hit.id },
      select: { contractPrefillOverrides: true },
    });
    const history = parseContractSendHistoryFromPrefill(row?.contractPrefillOverrides);
    const match = history.find((entry) => entry.envelopeId === eid);
    const url = String(match?.signedPdfUrl ?? '').trim();
    if (!url) continue;
    return {
      url,
      status: match?.status != null ? String(match.status) : null,
      publicId: String(match?.signedPdfPublicId ?? '').trim() || null,
    };
  }
  return null;
}

/** Resolve sender funder stored on prefill capsules / history for an envelope. */
export function resolveFunderFromContractPrefill(
  raw: unknown,
  envelopeId: string,
): { funderName: string | null; funderProfileId: string | null } {
  const eid = String(envelopeId || '').trim();
  if (!eid || raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { funderName: null, funderProfileId: null };
  }
  const o = raw as Record<string, unknown>;

  for (const key of [
    CONTRACT_SEND_HISTORY_KEY,
    'documentSendHistory',
    'standalonePackageSendHistory',
    'achSendHistory',
  ]) {
    const list = o[key];
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      if (String(row.envelopeId ?? '').trim() !== eid) continue;
      const funderName = String(row.funderName ?? '').trim() || null;
      const funderProfileId = String(row.funderProfileId ?? '').trim() || null;
      if (funderName || funderProfileId) return { funderName, funderProfileId };
    }
  }

  for (const key of [
    MAIN_CONTRACT_SEND_PACKAGE_KEY,
    'achAuthorizationDocuSign',
    'standalonePackageDocuSign',
  ]) {
    const blob = o[key];
    if (blob == null || typeof blob !== 'object' || Array.isArray(blob)) continue;
    const b = blob as Record<string, unknown>;
    if (String(b.envelopeId ?? '').trim() !== eid) continue;
    const funderName = String(b.funderName ?? '').trim() || null;
    const funderProfileId = String(b.funderProfileId ?? '').trim() || null;
    if (funderName || funderProfileId) return { funderName, funderProfileId };
  }

  return { funderName: null, funderProfileId: null };
}

/** Persist which documents were included in the current main-contract envelope. */
export async function persistMainContractSendPackage(
  applicationId: string,
  envelopeId: string,
  sendPackage?: {
    includeMainContract?: boolean;
    includeAddendum?: boolean;
    includeDisclosure?: boolean;
  } | null,
  contractId?: number,
  funderMeta?: {
    funderName?: string | null;
    funderProfileId?: string | null;
  },
): Promise<boolean> {
  const appId = String(applicationId || '').trim();
  const eid = String(envelopeId || '').trim();
  if (!appId || !eid || !sendPackage) return false;

  const contractSelect = {
    id: true,
    funderName: true,
    approvedAmount: true,
    totalAmount: true,
    contractLenght: true,
    contractPrefillOverrides: true,
    offer: {
      select: {
        offer: true,
        term: true,
        totalRemit: true,
        repayPerPeriod: true,
        rate: true,
      },
    },
    termsOffers: {
      take: 1,
      orderBy: { createdAt: 'desc' as const },
      select: {
        approvedAmount: true,
        paybackAmount: true,
        termLength: true,
        position: true,
        buyRate: true,
        factorRate: true,
        paymentAmount: true,
        percentOfGross: true,
        commissionPercent: true,
      },
    },
  };

  const contract =
    Number.isFinite(Number(contractId)) && Number(contractId) > 0
      ? await prisma.contract.findUnique({
          where: { id: Number(contractId) },
          select: contractSelect,
        })
      : await prisma.contract.findUnique({
          where: { applicationId: appId },
          select: contractSelect,
        });
  if (!contract) return false;

  const funderName =
    String(funderMeta?.funderName ?? '').trim() ||
    String(contract.funderName ?? '').trim() ||
    null;
  const funderProfileId = String(funderMeta?.funderProfileId ?? '').trim() || null;
  const termsSnapshot =
    buildContractSendHistoryTermsSnapshot(contract as unknown as Record<string, unknown>) ??
    null;

  const base =
    contract.contractPrefillOverrides &&
    typeof contract.contractPrefillOverrides === 'object' &&
    !Array.isArray(contract.contractPrefillOverrides)
      ? { ...(contract.contractPrefillOverrides as Record<string, unknown>) }
      : {};

  const historyRaw = base.documentSendHistory;
  let documentSendHistory = Array.isArray(historyRaw) ? [...historyRaw] : [];
  let historyMatched = false;
  documentSendHistory = documentSendHistory.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const row = item as Record<string, unknown>;
    if (String(row.envelopeId ?? '').trim() !== eid) return item;
    historyMatched = true;
    return {
      ...row,
      envelopeId: eid,
      documentKind: row.documentKind ?? 'contract',
      ...(funderName ? { funderName } : {}),
      ...(funderProfileId ? { funderProfileId } : {}),
      ...(termsSnapshot ? { termsSnapshot } : {}),
    };
  });
  if (!historyMatched) {
    documentSendHistory.push({
      envelopeId: eid,
      documentKind: 'contract',
      ...(funderName ? { funderName } : {}),
      ...(funderProfileId ? { funderProfileId } : {}),
      ...(termsSnapshot ? { termsSnapshot } : {}),
    });
  }

  const next = {
    ...base,
    documentSendHistory,
    [MAIN_CONTRACT_SEND_PACKAGE_KEY]: {
      envelopeId: eid,
      includeMainContract: sendPackage.includeMainContract !== false,
      includeAddendum: Boolean(sendPackage.includeAddendum),
      includeDisclosure: Boolean(sendPackage.includeDisclosure),
      ...(funderName ? { funderName } : {}),
      ...(funderProfileId ? { funderProfileId } : {}),
      ...(termsSnapshot ? { termsSnapshot } : {}),
    },
  };

  await prisma.contract.update({
    where: { id: contract.id },
    data: { contractPrefillOverrides: next as Prisma.InputJsonValue },
  });
  return true;
}
