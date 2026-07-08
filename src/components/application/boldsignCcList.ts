import {
  findFunderProfile,
  isAllianceFunderProfile,
} from "@/hooks/useFunderProfiles";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import { normalizeFunderDocumentsSource } from "@/utils/funderDocumentSource";

/** User-added contract CC emails — stored on `Contract.contractPrefillOverrides`. */
export const CONTRACT_CC_EMAILS_PREFILL_KEY = "contractCcEmails";

export const KATAN_CONTRACT_CC_EMAIL = "subs@katancapital.com";
export const ALLIANCE_CONTRACT_CC_EMAIL = "subs@alliancebridgecapital.com";

/** @deprecated Use resolveDefaultContractCcEmailForFunder */
export const DEFAULT_CONTRACT_CC_EMAIL = KATAN_CONTRACT_CC_EMAIL;

function profileUsesAllianceContractCc(
  profile: FunderProfile | undefined,
  funders?: FunderProfile[],
): boolean {
  if (!profile) return false;
  if (isAllianceFunderProfile(profile)) return true;
  const source = normalizeFunderDocumentsSource(profile.documentsSource);
  if (source !== "shared") return false;
  const sharedId = String(profile.sharedDocumentsFunderId ?? "").trim();
  if (!sharedId || !funders?.length) return false;
  const shared = funders.find((f) => f.id === sharedId);
  return Boolean(shared && isAllianceFunderProfile(shared));
}

export function resolveDefaultContractCcEmailForFunder(
  funderName?: string | null,
  funders?: FunderProfile[],
  state?: string | null,
): string {
  if (funders?.length) {
    const profile = findFunderProfile(funders, funderName, state);
    if (profileUsesAllianceContractCc(profile, funders)) {
      return ALLIANCE_CONTRACT_CC_EMAIL;
    }
  }

  const name = String(funderName ?? "").trim().toLowerCase();
  if (
    name.includes("alliance bridge") ||
    name.includes("alliance bridge capital")
  ) {
    return ALLIANCE_CONTRACT_CC_EMAIL;
  }
  return KATAN_CONTRACT_CC_EMAIL;
}

export function isDefaultContractCcEmail(email: string): boolean {
  const key = email.trim().toLowerCase();
  return (
    key === KATAN_CONTRACT_CC_EMAIL.toLowerCase() ||
    key === ALLIANCE_CONTRACT_CC_EMAIL.toLowerCase()
  );
}

/** Funder-specific default CC first, then user-supplied addresses (deduped). */
export function mergeContractCcEmailList(
  emails?: string[] | null,
  funderName?: string | null,
  funders?: FunderProfile[],
  state?: string | null,
): string[] {
  const defaultCc = resolveDefaultContractCcEmailForFunder(
    funderName,
    funders,
    state,
  );
  const out: string[] = [defaultCc];
  const seen = new Set<string>([defaultCc.toLowerCase()]);
  for (const raw of emails || []) {
    const email = String(raw ?? "").trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    if (isDefaultContractCcEmail(email)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

export function parseContractCcEmailsFromPrefill(raw: unknown): string[] {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return [];
  const list = (raw as Record<string, unknown>)[CONTRACT_CC_EMAILS_PREFILL_KEY];
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry === "string" && entry.trim()) {
      out.push(entry.trim());
    }
  }
  return [...new Set(out.map((e) => e.toLowerCase()))].map(
    (lower) => out.find((e) => e.toLowerCase() === lower) || lower,
  );
}

export function mergeContractPrefillWithCcEmails(
  baseRaw: unknown,
  userEmails: string[],
): Record<string, unknown> {
  const base =
    baseRaw != null && typeof baseRaw === "object" && !Array.isArray(baseRaw)
      ? { ...(baseRaw as Record<string, unknown>) }
      : {};
  const normalized = [
    ...new Set(
      userEmails
        .map((e) => String(e ?? "").trim())
        .filter(Boolean)
        .filter((e) => !isDefaultContractCcEmail(e)),
    ),
  ];
  if (!normalized.length) {
    const next = { ...base };
    delete next[CONTRACT_CC_EMAILS_PREFILL_KEY];
    return next;
  }
  return {
    ...base,
    [CONTRACT_CC_EMAILS_PREFILL_KEY]: normalized,
  };
}

/**
 * Load CC chips: funder default + user emails from contract DB (`contractPrefillOverrides`).
 */
export function loadContractCcEmailList(
  funderName?: string | null,
  funders?: FunderProfile[],
  state?: string | null,
  contractPrefillOverrides?: unknown | null,
): string[] {
  const userEmails = parseContractCcEmailsFromPrefill(contractPrefillOverrides);
  return mergeContractCcEmailList(userEmails, funderName, funders, state);
}

/** @deprecated Use loadContractCcEmailList — reads contract DB prefill, not localStorage. */
export function loadBoldSignCcEmailList(
  funderName?: string | null,
  funders?: FunderProfile[],
  state?: string | null,
  contractPrefillOverrides?: unknown | null,
): string[] {
  return loadContractCcEmailList(
    funderName,
    funders,
    state,
    contractPrefillOverrides,
  );
}

/** @deprecated CC list is persisted via persistContractCcEmails (contract DB). */
export function saveBoldSignCcEmailList(
  _emails: string[],
  _applicationId?: string | null,
): void {
  /* no-op — use persistContractCcEmails */
}
