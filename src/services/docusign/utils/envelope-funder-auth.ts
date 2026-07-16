import prisma from '../../../config/prismaClient';
import {
  isPersistedFunderProfileId,
  listFunderProfiles,
} from '../../funderProfileService';
import {
  ACH_AUTHORIZATION_DOCUSIGN_KEY,
  findAchEnvelopeAuthHints,
  parseAchAuthorizationDocuSignFromPrefill,
} from './ach-authorization-docusign';
import { STANDALONE_PACKAGE_DOCUSIGN_KEY } from './standalone-package-docusign';

export type EnvelopeFunderAuthHints = {
  funderName?: string | null;
  funderProfileId?: string | null;
  contractState?: string | null;
  applicationId?: string | null;
  contractId?: number | null;
};

export type EnvelopeFunderAuthCandidate = {
  funderName?: string | null;
  funderProfileId?: string | null;
  contractState?: string | null;
  /** Platform JWT from env (DOCUSIGN_IMPERSONATED_USER_ID) — try last. */
  usePlatformDefault?: boolean;
  /** DocuSignAccountProfile.id — used to dedupe JWT attempts. */
  docusignAccountProfileId?: string | null;
};

const LAST_ACH_SENT_FUNDER_KEY = 'lastAchSentFunder';
const DOCUMENT_SEND_HISTORY_KEY = 'documentSendHistory';

function parseFunderFromPrefillBlob(
  prefill: unknown,
  envelopeId: string,
): EnvelopeFunderAuthCandidate | null {
  if (prefill == null || typeof prefill !== 'object' || Array.isArray(prefill)) return null;
  const raw = prefill as Record<string, unknown>;
  const eid = String(envelopeId || '').trim();
  if (!eid) return null;

  const history = raw[DOCUMENT_SEND_HISTORY_KEY];
  if (Array.isArray(history)) {
    for (const row of history) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      if (String(r.envelopeId ?? '').trim() !== eid) continue;
      const funderName = String(r.funderName ?? '').trim();
      const funderProfileId = String(r.funderProfileId ?? '').trim();
      if (funderName || funderProfileId) {
        return {
          ...(funderName ? { funderName } : {}),
          ...(funderProfileId ? { funderProfileId } : {}),
        };
      }
    }
  }

  const lastAch = raw[LAST_ACH_SENT_FUNDER_KEY];
  if (lastAch && typeof lastAch === 'object' && !Array.isArray(lastAch)) {
    const o = lastAch as Record<string, unknown>;
    // Prefer exact envelope match; otherwise use last ACH funder when this is the ACH envelope.
    const lastEid = String(o.envelopeId ?? '').trim();
    if (!lastEid || lastEid === eid) {
      const funderName = String(o.funderName ?? '').trim();
      const funderProfileId = String(o.funderProfileId ?? '').trim();
      if (funderName || funderProfileId) {
        return {
          ...(funderName ? { funderName } : {}),
          ...(funderProfileId ? { funderProfileId } : {}),
        };
      }
    }
  }

  const ach = parseAchAuthorizationDocuSignFromPrefill(prefill);
  if (ach?.envelopeId === eid) {
    const blob = raw[ACH_AUTHORIZATION_DOCUSIGN_KEY];
    if (blob && typeof blob === 'object' && !Array.isArray(blob)) {
      const funderName = String((blob as Record<string, unknown>).funderName ?? '').trim();
      const funderProfileId = String(
        (blob as Record<string, unknown>).funderProfileId ?? '',
      ).trim();
      if (funderName || funderProfileId) {
        return {
          ...(funderName ? { funderName } : {}),
          ...(funderProfileId ? { funderProfileId } : {}),
        };
      }
    }
  }

  return null;
}

function pushCandidate(
  list: EnvelopeFunderAuthCandidate[],
  seenKeys: Set<string>,
  seenDsProfiles: Set<string>,
  candidate: EnvelopeFunderAuthCandidate | null | undefined,
): void {
  if (!candidate) return;
  if (candidate.usePlatformDefault) {
    if (seenKeys.has('platform-default')) return;
    seenKeys.add('platform-default');
    list.push({ usePlatformDefault: true });
    return;
  }

  const funderName = String(candidate.funderName ?? '').trim();
  const funderProfileId = String(candidate.funderProfileId ?? '').trim();
  const dsProfileId = String(candidate.docusignAccountProfileId ?? '').trim();
  if (!funderName && !funderProfileId && !dsProfileId) return;

  // Skip duplicate DocuSign JWT accounts (many funders may share one profile).
  if (dsProfileId) {
    if (seenDsProfiles.has(dsProfileId)) return;
    seenDsProfiles.add(dsProfileId);
  }

  const key = funderProfileId
    ? `id:${funderProfileId}`
    : `name:${funderName.toLowerCase()}|${String(candidate.contractState ?? '')
        .trim()
        .toLowerCase()}`;
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  list.push({
    ...(funderName ? { funderName } : {}),
    ...(funderProfileId ? { funderProfileId } : {}),
    ...(candidate.contractState
      ? { contractState: String(candidate.contractState).trim() }
      : {}),
    ...(dsProfileId ? { docusignAccountProfileId: dsProfileId } : {}),
  });
}

/**
 * Resolve envelope-specific funder DocuSign auth.
 * Envelope-stored ACH/send-history funder wins over FE "current contract funder".
 */
export async function resolveEnvelopeFunderAuthHints(
  envelopeId: string,
  explicit?: Partial<EnvelopeFunderAuthHints>,
): Promise<EnvelopeFunderAuthHints> {
  const eid = String(envelopeId || '').trim();
  const out: EnvelopeFunderAuthHints = {
    funderName: null,
    funderProfileId: null,
    contractState: String(explicit?.contractState ?? '').trim() || null,
    applicationId: String(explicit?.applicationId ?? '').trim() || null,
    contractId:
      Number.isFinite(Number(explicit?.contractId)) && Number(explicit?.contractId) > 0
        ? Number(explicit?.contractId)
        : null,
  };

  // 1) Envelope-specific ACH / send-history funder (highest priority).
  if (eid) {
    const achHints = await findAchEnvelopeAuthHints(eid);
    if (achHints) {
      out.applicationId = out.applicationId || achHints.applicationId;
      out.contractId = out.contractId || achHints.contractId;
      out.funderName = achHints.funderName;
      out.funderProfileId = achHints.funderProfileId;
    }
  }

  const contractIdHint = out.contractId;
  if (contractIdHint) {
    const row = await prisma.contract.findUnique({
      where: { id: contractIdHint },
      select: {
        funderName: true,
        state: true,
        applicationId: true,
        contractPrefillOverrides: true,
      },
    });
    if (row) {
      out.applicationId = out.applicationId || String(row.applicationId ?? '').trim() || null;
      out.contractState = out.contractState || row.state;
      const fromPrefill = parseFunderFromPrefillBlob(row.contractPrefillOverrides, eid);
      if (fromPrefill?.funderProfileId && !out.funderProfileId) {
        out.funderProfileId = fromPrefill.funderProfileId;
      }
      if (fromPrefill?.funderName && !out.funderName) {
        out.funderName = fromPrefill.funderName;
      }
      // Contract funder only if envelope did not store a sender funder.
      if (!out.funderName && !out.funderProfileId) {
        out.funderName = row.funderName;
      }
    }
  }

  let appId = out.applicationId;
  if (!appId && eid) {
    const doc = await prisma.document.findFirst({
      where: { envelopeId: eid },
      select: { applicationId: true },
    });
    appId = String(doc?.applicationId ?? '').trim() || null;
    out.applicationId = appId;
  }

  if (eid && (!out.funderName || !out.funderProfileId)) {
    const linked = await prisma.contract.findFirst({
      where: {
        OR: [
          {
            contractPrefillOverrides: {
              path: [ACH_AUTHORIZATION_DOCUSIGN_KEY, 'envelopeId'],
              equals: eid,
            },
          },
          {
            contractPrefillOverrides: {
              path: [STANDALONE_PACKAGE_DOCUSIGN_KEY, 'envelopeId'],
              equals: eid,
            },
          },
          ...(appId ? [{ applicationId: appId }] : []),
        ],
      },
      select: {
        id: true,
        funderName: true,
        state: true,
        applicationId: true,
        contractPrefillOverrides: true,
      },
      orderBy: { id: 'desc' },
    });
    if (linked) {
      out.contractId = out.contractId || linked.id;
      out.applicationId =
        out.applicationId || String(linked.applicationId ?? '').trim() || null;
      out.contractState = out.contractState || linked.state;
      const fromPrefill = parseFunderFromPrefillBlob(linked.contractPrefillOverrides, eid);
      if (fromPrefill?.funderProfileId && !out.funderProfileId) {
        out.funderProfileId = fromPrefill.funderProfileId;
      }
      if (fromPrefill?.funderName && !out.funderName) {
        out.funderName = fromPrefill.funderName;
      }
      if (!out.funderName && !out.funderProfileId) {
        out.funderName = linked.funderName;
      }
    }
  }

  // 2) Explicit FE hints only fill gaps — never override envelope-stored ACH sender.
  const explicitProfileId = String(explicit?.funderProfileId ?? '').trim();
  const explicitFunderName = String(explicit?.funderName ?? '').trim();
  if (!out.funderProfileId && explicitProfileId) out.funderProfileId = explicitProfileId;
  if (!out.funderName && explicitFunderName) out.funderName = explicitFunderName;

  return out;
}

/**
 * Ordered DocuSign JWT candidates for an envelope — try each unique DocuSign
 * account until the sender matches (USER_NOT_ENVELOPE_SENDER → next).
 */
export async function listEnvelopeFunderAuthCandidates(
  envelopeId: string,
  explicit?: Partial<EnvelopeFunderAuthHints>,
): Promise<EnvelopeFunderAuthCandidate[]> {
  const hints = await resolveEnvelopeFunderAuthHints(envelopeId, explicit);
  const candidates: EnvelopeFunderAuthCandidate[] = [];
  const seenKeys = new Set<string>();
  const seenDsProfiles = new Set<string>();

  // Envelope-resolved sender first.
  pushCandidate(candidates, seenKeys, seenDsProfiles, {
    funderProfileId: hints.funderProfileId,
    funderName: hints.funderName,
    contractState: hints.contractState,
  });

  // Explicit FE funder next (may differ from envelope-resolved).
  pushCandidate(candidates, seenKeys, seenDsProfiles, {
    funderProfileId: explicit?.funderProfileId,
    funderName: explicit?.funderName,
    contractState: explicit?.contractState ?? hints.contractState,
  });

  if (hints.contractId) {
    const row = await prisma.contract.findUnique({
      where: { id: hints.contractId },
      select: { funderName: true, state: true, contractPrefillOverrides: true },
    });
    if (row) {
      pushCandidate(candidates, seenKeys, seenDsProfiles, {
        funderName: row.funderName,
        contractState: row.state,
      });
      pushCandidate(
        candidates,
        seenKeys,
        seenDsProfiles,
        parseFunderFromPrefillBlob(row.contractPrefillOverrides, envelopeId),
      );
    }
  }

  if (hints.applicationId) {
    const row = await prisma.contract.findFirst({
      where: { applicationId: hints.applicationId },
      select: { funderName: true, state: true, contractPrefillOverrides: true },
      orderBy: { id: 'desc' },
    });
    if (row) {
      pushCandidate(candidates, seenKeys, seenDsProfiles, {
        funderName: row.funderName,
        contractState: row.state,
      });
      pushCandidate(
        candidates,
        seenKeys,
        seenDsProfiles,
        parseFunderFromPrefillBlob(row.contractPrefillOverrides, envelopeId),
      );
    }
  }

  // Every active funder that has a linked DocuSign account (deduped by DS profile).
  const funders = await listFunderProfiles({ activeOnly: true });
  for (const funder of funders) {
    if (!isPersistedFunderProfileId(funder.id)) continue;
    const dsId = String(funder.docusignAccountProfileId ?? '').trim();
    if (!dsId) continue;
    pushCandidate(candidates, seenKeys, seenDsProfiles, {
      funderProfileId: funder.id,
      funderName: funder.name,
      docusignAccountProfileId: dsId,
    });
  }

  // Platform/default JWT last — envelopes sent before funder-linked accounts.
  pushCandidate(candidates, seenKeys, seenDsProfiles, { usePlatformDefault: true });

  return candidates;
}

export function isDocuSignUserNotEnvelopeSenderError(err: unknown): boolean {
  const ax = err as {
    response?: { data?: { message?: string; errorCode?: string } };
    message?: string;
  };
  const errorCode = String(ax?.response?.data?.errorCode ?? '').trim();
  if (/USER_NOT_ENVELOPE_SENDER/i.test(errorCode)) return true;
  const msg = String(
    ax?.response?.data?.message ?? ax?.message ?? err ?? '',
  );
  return /USER_NOT_ENVELOPE_SENDER|not the sender of the envelope/i.test(msg);
}
