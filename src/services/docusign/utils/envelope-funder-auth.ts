import prisma from '../../../config/prismaClient';
import {
  getFunderProfileById,
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
    if (String(o.envelopeId ?? '').trim() === eid) {
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
      if (funderName) return { funderName };
    }
  }

  return null;
}

function candidateKey(c: EnvelopeFunderAuthCandidate): string {
  const id = String(c.funderProfileId ?? '').trim();
  if (id) return `id:${id}`;
  const name = String(c.funderName ?? '')
    .trim()
    .toLowerCase();
  const state = String(c.contractState ?? '')
    .trim()
    .toLowerCase();
  return `name:${name}|${state}`;
}

function pushCandidate(
  list: EnvelopeFunderAuthCandidate[],
  seen: Set<string>,
  candidate: EnvelopeFunderAuthCandidate | null | undefined,
): void {
  if (!candidate) return;
  const funderName = String(candidate.funderName ?? '').trim();
  const funderProfileId = String(candidate.funderProfileId ?? '').trim();
  if (!funderName && !funderProfileId) return;
  const key = candidateKey(candidate);
  if (seen.has(key)) return;
  seen.add(key);
  list.push({
    ...(funderName ? { funderName } : {}),
    ...(funderProfileId ? { funderProfileId } : {}),
    ...(candidate.contractState
      ? { contractState: String(candidate.contractState).trim() }
      : {}),
  });
}

/** Resolve envelope-specific funder DocuSign auth (not always the contract's current funder). */
export async function resolveEnvelopeFunderAuthHints(
  envelopeId: string,
  explicit?: Partial<EnvelopeFunderAuthHints>,
): Promise<EnvelopeFunderAuthHints> {
  const eid = String(envelopeId || '').trim();
  const out: EnvelopeFunderAuthHints = {
    funderName: String(explicit?.funderName ?? '').trim() || null,
    funderProfileId: String(explicit?.funderProfileId ?? '').trim() || null,
    contractState: String(explicit?.contractState ?? '').trim() || null,
    applicationId: String(explicit?.applicationId ?? '').trim() || null,
    contractId:
      Number.isFinite(Number(explicit?.contractId)) && Number(explicit?.contractId) > 0
        ? Number(explicit?.contractId)
        : null,
  };

  if (out.funderProfileId || out.funderName) return out;

  if (eid) {
    const achHints = await findAchEnvelopeAuthHints(eid);
    if (achHints) {
      out.applicationId = out.applicationId || achHints.applicationId;
      out.contractId = out.contractId || achHints.contractId;
      out.funderName = out.funderName || achHints.funderName;
      if (achHints.funderProfileId) {
        out.funderProfileId = achHints.funderProfileId;
      }
      if (out.funderName || out.funderProfileId) return out;
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
      if (fromPrefill?.funderProfileId) out.funderProfileId = fromPrefill.funderProfileId;
      if (fromPrefill?.funderName) out.funderName = fromPrefill.funderName;
      if (!out.funderName) out.funderName = row.funderName;
      if (out.funderName || out.funderProfileId) return out;
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

  if (eid) {
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
      if (fromPrefill?.funderProfileId) out.funderProfileId = fromPrefill.funderProfileId;
      if (fromPrefill?.funderName) out.funderName = fromPrefill.funderName;
      if (!out.funderName) out.funderName = linked.funderName;
    }
  }

  return out;
}

/**
 * Ordered DocuSign JWT candidates for an envelope — try each until the sender matches.
 * Prevents USER_NOT_ENVELOPE_SENDER when ACH uses a different funder account than the contract.
 */
export async function listEnvelopeFunderAuthCandidates(
  envelopeId: string,
  explicit?: Partial<EnvelopeFunderAuthHints>,
): Promise<EnvelopeFunderAuthCandidate[]> {
  const hints = await resolveEnvelopeFunderAuthHints(envelopeId, explicit);
  const candidates: EnvelopeFunderAuthCandidate[] = [];
  const seen = new Set<string>();

  pushCandidate(candidates, seen, {
    funderProfileId: hints.funderProfileId,
    funderName: hints.funderName,
    contractState: hints.contractState,
  });

  if (hints.contractId) {
    const row = await prisma.contract.findUnique({
      where: { id: hints.contractId },
      select: { funderName: true, state: true, contractPrefillOverrides: true },
    });
    if (row) {
      pushCandidate(candidates, seen, {
        funderName: row.funderName,
        contractState: row.state,
      });
      pushCandidate(
        candidates,
        seen,
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
      pushCandidate(candidates, seen, {
        funderName: row.funderName,
        contractState: row.state,
      });
      pushCandidate(
        candidates,
        seen,
        parseFunderFromPrefillBlob(row.contractPrefillOverrides, envelopeId),
      );
    }
  }

  const funders = await listFunderProfiles({ activeOnly: true });
  for (const funder of funders) {
    if (!isPersistedFunderProfileId(funder.id)) continue;
    const profile = await getFunderProfileById(funder.id);
    if (!profile?.docusignAccountProfileId) continue;
    pushCandidate(candidates, seen, {
      funderProfileId: funder.id,
      funderName: funder.name,
    });
  }

  return candidates;
}

export function isDocuSignUserNotEnvelopeSenderError(err: unknown): boolean {
  const msg = String(
    (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
      (err as { message?: string })?.message ??
      err ??
      '',
  );
  return /USER_NOT_ENVELOPE_SENDER|not the sender of the envelope/i.test(msg);
}
