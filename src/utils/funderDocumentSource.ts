import {
  isTexasFundingGroupFunderProfile,
  isWoodmereFunderProfile,
} from "./funderProfileResolver";

export const FUNDER_DOCUMENTS_SOURCES = ["platform", "own", "shared"] as const;
export type FunderDocumentsSource = (typeof FUNDER_DOCUMENTS_SOURCES)[number];

export type FunderDocumentKind = "addendum" | "disclosure";

export type ResolveDisclosureLayoutFunderOptions = {
  /** Harbor View Capital funder id that owns the shared platform disclosure uploads. */
  platformDisclosureFunderId?: string | null;
};

function normalizeToken(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

export function normalizeFunderDocumentsSource(
  value?: string | null,
): FunderDocumentsSource {
  const token = normalizeToken(value);
  if (token === "platform" || token === "shared") return token;
  return "own";
}

export function isWoodmereFinancialFunderName(
  name?: string | null,
  displayName?: string | null,
): boolean {
  const n = normalizeToken(name);
  const d = normalizeToken(displayName);
  const isPlatformBrand = (t: string) =>
    (t.includes("harbor view") || t.includes("woodmere")) && !t.includes("texas");
  return isPlatformBrand(n) || isPlatformBrand(d);
}

export function isTexasFundingGroupFunderName(
  name?: string | null,
  displayName?: string | null,
): boolean {
  return isTexasFundingGroupFunderProfile({ name, displayName });
}

export function inferDefaultFunderDocumentsSource(input: {
  name?: string | null;
  displayName?: string | null;
  mainContractLayoutKey?: string | null;
}): FunderDocumentsSource {
  if (isWoodmereFinancialFunderName(input.name, input.displayName)) return "platform";
  return "own";
}

type DocumentsSourceProfile = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  mainContractLayoutKey?: string | null;
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
  documentsSource?: string | null;
  sharedDocumentsFunderId?: string | null;
  addendumDocumentsSource?: string | null;
  disclosureDocumentsSource?: string | null;
  sharedAddendumFunderId?: string | null;
  sharedDisclosureFunderId?: string | null;
};

/** Addendum/ACH PDF source — falls back to legacy documentsSource. */
export function resolveAddendumDocumentsSource(
  profile: Pick<
    DocumentsSourceProfile,
    "documentsSource" | "addendumDocumentsSource"
  >,
): FunderDocumentsSource {
  const dedicated = String(profile.addendumDocumentsSource ?? "").trim();
  if (dedicated) return normalizeFunderDocumentsSource(dedicated);
  return normalizeFunderDocumentsSource(profile.documentsSource);
}

/**
 * State disclosure PDF source.
 * Unset dedicated source → platform (common shared pack for all states).
 * Do not inherit documentsSource "own" from contract uploads — that breaks
 * every state for funders that share the common disclosure funder set.
 */
export function resolveDisclosureDocumentsSource(
  profile: Pick<
    DocumentsSourceProfile,
    "documentsSource" | "disclosureDocumentsSource"
  >,
): FunderDocumentsSource {
  const dedicated = String(profile.disclosureDocumentsSource ?? "").trim();
  if (dedicated) return normalizeFunderDocumentsSource(dedicated);
  const legacy = String(profile.documentsSource ?? "")
    .trim()
    .toLowerCase();
  if (legacy === "shared") return "shared";
  return "platform";
}

function resolveSharedFunderIdForKind(
  profile: DocumentsSourceProfile,
  kind: FunderDocumentKind,
): string {
  if (kind === "addendum") {
    return (
      String(profile.sharedAddendumFunderId || "").trim() ||
      String(profile.sharedDocumentsFunderId || "").trim()
    );
  }
  return (
    String(profile.sharedDisclosureFunderId || "").trim() ||
    String(profile.sharedDocumentsFunderId || "").trim()
  );
}

function resolveLayoutFunderIdForSource(
  profile: DocumentsSourceProfile,
  source: FunderDocumentsSource,
  kind: FunderDocumentKind,
): string | null {
  if (isTexasFundingGroupFunderProfile(profile)) {
    if (source === "shared") {
      return resolveSharedFunderIdForKind(profile, kind) || profile.id;
    }
    // Honor "Platform defaults" — use Woodmere platform disclosure/addendum rows.
    if (source === "platform") return null;
    return profile.id;
  }
  if (source === "platform") return null;
  if (source === "shared") {
    return resolveSharedFunderIdForKind(profile, kind) || profile.id;
  }
  return profile.id;
}

/** Funder id for addendum/ACH layout keys; null = platform templates. */
export function resolveAddendumDocumentsLayoutFunderId(
  profile: DocumentsSourceProfile,
): string | null {
  return resolveLayoutFunderIdForSource(
    profile,
    resolveAddendumDocumentsSource(profile),
    "addendum",
  );
}

/**
 * Funder id for disclosure layout keys.
 * Platform source → Harbor View Capital's id (shared common disclosures), not null.
 * Null only when platform owner id is unknown and the profile is not Woodmere.
 */
export function resolveDisclosureDocumentsLayoutFunderId(
  profile: DocumentsSourceProfile,
  options?: ResolveDisclosureLayoutFunderOptions,
): string | null {
  const source = resolveDisclosureDocumentsSource(profile);
  const platformOwner = String(options?.platformDisclosureFunderId ?? "").trim();
  // Platform = the shared Harbor View Capital disclosure set (not non-funder_ rows).
  // Both funders reuse those uploads for every disclosure state.
  if (source === "platform") {
    if (isWoodmereFunderProfile(profile)) {
      return String(profile.id || "").trim() || null;
    }
    return platformOwner || null;
  }
  if (source === "shared") {
    const sharedId = resolveSharedFunderIdForKind(profile, "disclosure");
    // Missing share target → common platform pack (all states), not this funder's empty scope.
    return sharedId || platformOwner || profile.id;
  }
  // "own" on a non-platform funder (e.g. Clear Capital) still consumes the
  // common Harbor View disclosure pack. Own contract PDFs must not hide
  // state disclosures that were only uploaded under the platform funder.
  if (!isWoodmereFunderProfile(profile) && platformOwner) {
    return platformOwner;
  }
  return resolveLayoutFunderIdForSource(profile, source, "disclosure");
}

/**
 * @deprecated Prefer resolveAddendumDocumentsLayoutFunderId /
 * resolveDisclosureDocumentsLayoutFunderId. Kept for older call sites (addendum).
 */
export function resolveDocumentsLayoutFunderId(
  profile: DocumentsSourceProfile,
): string | null {
  return resolveAddendumDocumentsLayoutFunderId(profile);
}

export function canManageFunderAddendums(
  profile: Pick<
    DocumentsSourceProfile,
    | "id"
    | "documentsSource"
    | "addendumDocumentsSource"
    | "sharedDocumentsFunderId"
    | "sharedAddendumFunderId"
    | "name"
    | "displayName"
    | "mainContractLayoutKey"
    | "organization"
    | "legalName"
    | "contactEmail"
  >,
): boolean {
  const source = resolveAddendumDocumentsSource(profile);
  if (source === "platform") return false;
  const layoutFunderId = resolveAddendumDocumentsLayoutFunderId(profile);
  return layoutFunderId === profile.id;
}

export function canManageFunderDisclosures(
  profile: Pick<
    DocumentsSourceProfile,
    | "id"
    | "documentsSource"
    | "disclosureDocumentsSource"
    | "sharedDocumentsFunderId"
    | "sharedDisclosureFunderId"
    | "name"
    | "displayName"
    | "mainContractLayoutKey"
    | "organization"
    | "legalName"
    | "contactEmail"
  >,
): boolean {
  // Harbor View Capital owns the shared disclosure pack used by every funder.
  if (isWoodmereFunderProfile(profile)) return true;
  const source = resolveDisclosureDocumentsSource(profile);
  if (source === "platform") return false;
  const layoutFunderId = resolveDisclosureDocumentsLayoutFunderId(profile);
  return layoutFunderId === profile.id;
}

/** True when either addendums or disclosures can be uploaded on this funder. */
export function canManageFunderDocuments(
  profile: DocumentsSourceProfile,
): boolean {
  return canManageFunderAddendums(profile) || canManageFunderDisclosures(profile);
}

const SUPPLEMENTAL_GENERIC_DISPLAY_NAMES: Record<string, string> = {
  addendum_p: "Addendum P (REFI)",
  addendum_ca: "Addendum CA",
  addendum_ny: "Addendum NY",
  addendum_va: "Addendum VA",
  ach_authorization: "ACH Authorization",
  ach_authorization_standalone: "ACH Authorization",
  ach_authorization_texas: "ACH Authorization",
  // Legacy types (older uploads may still exist)
  flex_addendum: "Flex Addendum",
  pre_payment_addendum: "Pre-Payment Addendum",
  balance_transfer: "Balance Transfer Sheet",
  case_takeover_addendum: "Case Takeover Balance Transfer",
  case_takeover_balance_transfer: "Case Takeover Balance Transfer",
};

/** Display name for funder-owned supplemental PDFs (strip legacy brand prefixes from platform labels). */
export function resolveFunderSupplementalDocumentDisplayName(
  supplementalType: string,
  profile: {
    name?: string | null;
    displayName?: string | null;
    documentsSource?: string | null;
    addendumDocumentsSource?: string | null;
  } | null | undefined,
  uploadedName?: string | null,
  platformDefaultName?: string | null,
): string {
  const type = String(supplementalType || "").trim();
  const uploaded = String(uploadedName ?? "").trim();
  const usesPlatform =
    !profile || resolveAddendumDocumentsSource(profile) === "platform";
  if (usesPlatform) {
    return uploaded || String(platformDefaultName ?? "").trim() || type;
  }
  const looksLikeLegacyBrand = (s: string) =>
    /woodmere|texas\s+funding\s+group|alliance\s+bridge/i.test(s);
  if (uploaded && !looksLikeLegacyBrand(uploaded)) {
    return uploaded;
  }
  const generic =
    SUPPLEMENTAL_GENERIC_DISPLAY_NAMES[type] ||
    String(platformDefaultName ?? "")
      .replace(/^(Woodmere|Texas Funding Group|Alliance Bridge)[^ ]*\s+/i, "")
      .trim() ||
    type;
  const funderLabel = String(profile?.displayName || profile?.name || "").trim();
  return funderLabel ? `${funderLabel} ${generic}` : generic;
}

/**
 * Balance transfer label: bold FunderName ("DEALPREFIX").
 * Example: Harbor View Capital ("WM")
 */
export function formatFunderNameWithDealIdPrefix(
  funderName?: string | null,
  dealIdPrefix?: string | null,
  displayName?: string | null,
): string {
  const name = String(displayName || funderName || "").trim();
  const prefix = String(dealIdPrefix || "").trim();
  if (!name && !prefix) return "";
  if (!name) return `("${prefix}")`;
  if (!prefix) return name;
  return `${name} ("${prefix}")`;
}
