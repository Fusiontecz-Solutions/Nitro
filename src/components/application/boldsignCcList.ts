import {
  findFunderProfile,
  isAllianceFunderProfile,
} from "@/hooks/useFunderProfiles";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import { normalizeFunderDocumentsSource } from "@/utils/funderDocumentSource";

/** Shared contract CC list: PDF viewer reads/writes this storage key before send. */
export const BOLDSIGN_CC_LIST_STORAGE_KEY = "boldsign_cc_list";

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

/**
 * Returns saved user CC emails plus the funder-specific default address.
 */
export function loadBoldSignCcEmailList(
  funderName?: string | null,
  funders?: FunderProfile[],
  state?: string | null,
): string[] {
  if (typeof window === "undefined") {
    return mergeContractCcEmailList([], funderName, funders, state);
  }
  const raw = localStorage.getItem(BOLDSIGN_CC_LIST_STORAGE_KEY);
  if (!raw) {
    return mergeContractCcEmailList([], funderName, funders, state);
  }
  try {
    const saved = JSON.parse(raw) as unknown;
    if (!Array.isArray(saved)) {
      return mergeContractCcEmailList([], funderName, funders, state);
    }
    const userEmails: string[] = [];
    for (const e of saved) {
      if (typeof e === "string" && e.trim() !== "") {
        userEmails.push(e.trim());
      }
    }
    return mergeContractCcEmailList(userEmails, funderName, funders, state);
  } catch {
    return mergeContractCcEmailList([], funderName, funders, state);
  }
}

/** Persist only user-added CC emails (funder default is merged on load). */
export function saveBoldSignCcEmailList(emails: string[]): void {
  if (typeof window === "undefined") {
    return;
  }
  const userOnly = [
    ...new Set(
      emails
        .map((e) => e.trim())
        .filter(Boolean)
        .filter((e) => !isDefaultContractCcEmail(e)),
    ),
  ];
  localStorage.setItem(BOLDSIGN_CC_LIST_STORAGE_KEY, JSON.stringify(userOnly));
}
