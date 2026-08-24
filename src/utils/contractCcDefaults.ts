import prisma from '../config/prismaClient';
import { DOCUSIGN_DEFAULT_CC_EMAIL } from '../services/docusign/utils/docusign-client';
import { resolveFunderProfile } from '../services/funderProfileService';

/**
 * Parse a comma/semicolon/newline-separated CC list into unique trimmed emails.
 */
export function parseContractCcEmailList(value?: string | null): string[] {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[,;\n]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

export function dedupeContractCcEmails(emails?: string[] | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of emails || []) {
    const email = String(raw ?? '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** Tenant platform default from env (per-deployment); never hardcode brand emails here. */
export function getTenantPlatformDefaultCcEmail(): string | null {
  const email = String(DOCUSIGN_DEFAULT_CC_EMAIL || '').trim();
  return email || null;
}

export type ContractCcDefaultsPayload = {
  defaultCcEmail: string | null;
  resolvedCcEmail: string | null;
  ccEmails: string[];
  /** Where resolved CCs came from for the selected funder. */
  source: 'docusign' | 'funder' | 'platform' | 'none';
};

/**
 * Resolve tenant platform default CC + DocuSign-account / funder-profile override.
 * Priority: linked DocuSign account defaultCcEmail → funder defaultCcEmail → platform env.
 * Used by GET /integration-settings/contract-cc-defaults (CRM + Super Admin proxy).
 */
export async function resolveContractCcDefaultsForApi(options: {
  funderName?: string | null;
  state?: string | null;
  funderProfileId?: string | null;
  contractId?: number | null;
}): Promise<ContractCcDefaultsPayload> {
  let funderName = String(options.funderName ?? '').trim() || null;
  let state = String(options.state ?? '').trim() || null;
  const funderProfileId = String(options.funderProfileId ?? '').trim() || null;

  const contractId = Number(options.contractId);
  if (Number.isFinite(contractId) && contractId > 0) {
    const row = await prisma.contract.findUnique({
      where: { id: contractId },
      select: { funderName: true, state: true },
    });
    if (row) {
      if (!funderName) funderName = String(row.funderName ?? '').trim() || null;
      if (!state) state = String(row.state ?? '').trim() || null;
    }
  }

  const defaultCcEmail = getTenantPlatformDefaultCcEmail();

  const profile = await resolveFunderProfile({
    funderProfileId,
    funderName,
    state,
  });

  let docusignCcRaw: string | null = null;
  const docusignAccountProfileId = String(profile?.docusignAccountProfileId ?? '').trim();
  if (docusignAccountProfileId) {
    const ds = await prisma.docuSignAccountProfile.findUnique({
      where: { id: docusignAccountProfileId },
      select: { defaultCcEmail: true },
    });
    docusignCcRaw = String(ds?.defaultCcEmail ?? '').trim() || null;
  }

  const docusignCcs = parseContractCcEmailList(docusignCcRaw);
  const funderCcRaw = String(profile?.defaultCcEmail ?? '').trim() || null;
  const funderCcs = parseContractCcEmailList(funderCcRaw);

  let ccEmails: string[] = [];
  let source: ContractCcDefaultsPayload['source'] = 'none';
  if (docusignCcs.length) {
    ccEmails = docusignCcs;
    source = 'docusign';
  } else if (funderCcs.length) {
    ccEmails = funderCcs;
    source = 'funder';
  } else if (defaultCcEmail) {
    ccEmails = [defaultCcEmail];
    source = 'platform';
  }

  const resolvedCcEmail = ccEmails[0] ?? null;

  return {
    defaultCcEmail,
    resolvedCcEmail,
    ccEmails,
    source,
  };
}

export function isDefaultContractCcEmail(
  email: string,
  defaults?: ContractCcDefaultsPayload | null,
): boolean {
  const key = String(email || '')
    .trim()
    .toLowerCase();
  if (!key) return false;
  if (defaults?.ccEmails?.length) {
    return defaults.ccEmails.some((e) => e.trim().toLowerCase() === key);
  }
  const platform = getTenantPlatformDefaultCcEmail();
  return Boolean(platform && platform.toLowerCase() === key);
}

export function mergeDefaultContractCcEmails(
  emails?: string[] | null,
  defaults?: ContractCcDefaultsPayload | null,
): string[] {
  const seeds = defaults?.ccEmails?.length
    ? defaults.ccEmails
    : (() => {
        const platform = getTenantPlatformDefaultCcEmail();
        return platform ? [platform] : [];
      })();
  const reserved = new Set(seeds.map((e) => e.toLowerCase()));
  const out = [...seeds];
  for (const raw of emails || []) {
    const email = String(raw ?? '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (reserved.has(key) || out.some((e) => e.toLowerCase() === key)) continue;
    out.push(email);
  }
  return out;
}

/** @deprecated Prefer resolveContractCcDefaultsForApi / mergeDefaultContractCcEmails */
export async function mergeDefaultContractCcEmailsForSend(
  emails?: string[] | null,
  hints?: {
    funderName?: string | null;
    funderProfileId?: string | null;
    contractState?: string | null;
    contractId?: number;
  },
): Promise<string[]> {
  const defaults = await resolveContractCcDefaultsForApi({
    funderName: hints?.funderName,
    state: hints?.contractState,
    funderProfileId: hints?.funderProfileId,
    contractId: hints?.contractId,
  });
  return mergeDefaultContractCcEmails(emails, defaults);
}
