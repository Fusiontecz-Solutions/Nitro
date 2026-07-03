import { isAllianceBridgeFunder } from '../services/docusign/utils/resolve-main-contract-layout';
import { isAllianceFunderProfile } from './funderProfileResolver';
import { resolveFunderProfile } from '../services/funderProfileService';

export const KATAN_CONTRACT_CC_EMAIL = 'subs@katancapital.com';
export const ALLIANCE_CONTRACT_CC_EMAIL = 'subs@alliancebridgecapital.com';

/** @deprecated Use resolveDefaultContractCcEmailForFunder */
export const DEFAULT_CONTRACT_CC_EMAIL = KATAN_CONTRACT_CC_EMAIL;

export function resolveDefaultContractCcEmailForFunderProfile(profile?: {
  name?: string | null;
  displayName?: string | null;
  mainContractLayoutKey?: string | null;
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
} | null): string {
  if (profile && isAllianceFunderProfile(profile)) {
    return ALLIANCE_CONTRACT_CC_EMAIL;
  }
  return KATAN_CONTRACT_CC_EMAIL;
}

export function resolveDefaultContractCcEmailForFunder(
  funderName?: string | null,
): string {
  const name = String(funderName ?? '').trim();
  if (name && isAllianceBridgeFunder(name)) {
    return ALLIANCE_CONTRACT_CC_EMAIL;
  }
  return KATAN_CONTRACT_CC_EMAIL;
}

export async function resolveDefaultContractCcEmailForContract(options: {
  funderName?: string | null;
  contractState?: string | null;
  contractId?: number;
}): Promise<string> {
  const profile = await resolveFunderProfile({
    funderName: options.funderName,
    state: options.contractState,
  });
  if (profile) {
    return resolveDefaultContractCcEmailForFunderProfile(profile);
  }
  return resolveDefaultContractCcEmailForFunder(options.funderName);
}

export function isDefaultContractCcEmail(email: string): boolean {
  const key = String(email || '').trim().toLowerCase();
  return key === KATAN_CONTRACT_CC_EMAIL.toLowerCase() ||
    key === ALLIANCE_CONTRACT_CC_EMAIL.toLowerCase();
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

/** When the caller already merged a platform default, keep that brand instead of forcing Katan. */
export function inferDefaultContractCcFromEmailList(
  emails?: string[] | null,
): string | null {
  const keys = dedupeContractCcEmails(emails).map((e) => e.toLowerCase());
  const hasAlliance = keys.includes(ALLIANCE_CONTRACT_CC_EMAIL.toLowerCase());
  const hasKatan = keys.includes(KATAN_CONTRACT_CC_EMAIL.toLowerCase());
  if (hasAlliance && !hasKatan) return ALLIANCE_CONTRACT_CC_EMAIL;
  if (hasKatan && !hasAlliance) return KATAN_CONTRACT_CC_EMAIL;
  return null;
}

export function resolveDefaultContractCcEmailFromHints(hints: {
  funderName?: string | null;
  emails?: string[] | null;
}): string {
  const fromFunder = resolveDefaultContractCcEmailForFunder(hints.funderName);
  const fromEmails = inferDefaultContractCcFromEmailList(hints.emails);
  if (fromEmails && fromFunder.toLowerCase() !== fromEmails.toLowerCase()) {
    return fromEmails;
  }
  return fromFunder;
}

function mergeWithDefaultContractCc(
  emails: string[] | undefined | null,
  defaultCc: string,
): string[] {
  const out: string[] = [defaultCc];
  const seen = new Set<string>([defaultCc.toLowerCase()]);
  for (const raw of emails || []) {
    const email = String(raw ?? '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    if (
      key === KATAN_CONTRACT_CC_EMAIL.toLowerCase() ||
      key === ALLIANCE_CONTRACT_CC_EMAIL.toLowerCase()
    ) {
      continue;
    }
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** Funder-specific default CC first, then any user-supplied addresses (deduped). */
export function mergeDefaultContractCcEmails(
  emails?: string[] | null,
  funderName?: string | null,
): string[] {
  const defaultCc = resolveDefaultContractCcEmailFromHints({ funderName, emails });
  return mergeWithDefaultContractCc(emails, defaultCc);
}

export async function mergeDefaultContractCcEmailsForSend(
  emails?: string[] | null,
  hints?: {
    funderName?: string | null;
    funderProfileId?: string | null;
    contractState?: string | null;
    contractId?: number;
  },
): Promise<string[]> {
  const fromEmails = inferDefaultContractCcFromEmailList(emails);
  let defaultCc = fromEmails;
  if (!defaultCc) {
    const profile = await resolveFunderProfile({
      funderProfileId: hints?.funderProfileId,
      funderName: hints?.funderName,
      state: hints?.contractState,
    });
    if (profile) {
      defaultCc = resolveDefaultContractCcEmailForFunderProfile(profile);
    } else {
      defaultCc = await resolveDefaultContractCcEmailForContract({
        funderName: hints?.funderName,
        contractState: hints?.contractState,
        contractId: hints?.contractId,
      });
    }
  }
  return mergeWithDefaultContractCc(emails, defaultCc);
}
