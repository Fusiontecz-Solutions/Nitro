import type {
  FunderProfile,
  SignNowTemplateLinkItem,
} from "@/types/integrationSettingsTypes";
import {
  SIGNNOW_ACH_DAILY_LAYOUT_KEY,
  SIGNNOW_ACH_DAILY_TEMPLATE_ID,
  SIGNNOW_ACH_WEEKLY_LAYOUT_KEY,
  SIGNNOW_ACH_WEEKLY_TEMPLATE_ID,
  SIGNNOW_ADDENDUM_TEMPLATE_OPTIONS,
  SIGNNOW_DISCLOSURE_LAYOUT_KEY,
  SIGNNOW_DISCLOSURE_TEMPLATE_ID,
  SIGNNOW_EPA_LAYOUT_KEY,
  SIGNNOW_EPA_TEMPLATE_ID,
  SIGNNOW_EXHIBIT_A_LAYOUT_KEY,
  SIGNNOW_EXHIBIT_A_TEMPLATE_ID,
  SIGNNOW_EXHIBIT_C_LAYOUT_KEY,
  SIGNNOW_EXHIBIT_C_TEMPLATE_ID,
  SIGNNOW_FLEX_ADDENDUM_LAYOUT_KEY,
  SIGNNOW_FLEX_ADDENDUM_TEMPLATE_ID,
  SIGNNOW_MONTHLY_FEE_LAYOUT_KEY,
  SIGNNOW_MONTHLY_FEE_TEMPLATE_ID,
  SIGNNOW_PAYOFF_ADDENDUM_LAYOUT_KEY,
  SIGNNOW_PAYOFF_ADDENDUM_TEMPLATE_ID,
} from "@/components/application/contractdata/signnowAddendumTemplates";

/** SignNow document / template ids are 40-char hex. */
const SIGNNOW_ID_RE = /[a-f0-9]{40}/i;

const KNOWN_SIGNNOW_TEMPLATE_ID_LABELS: Record<string, string> = {
  [SIGNNOW_ACH_DAILY_TEMPLATE_ID]: "ACH Daily",
  [SIGNNOW_ACH_WEEKLY_TEMPLATE_ID]: "ACH Weekly",
  [SIGNNOW_EXHIBIT_A_TEMPLATE_ID]: "Exhibit A",
  [SIGNNOW_EXHIBIT_C_TEMPLATE_ID]: "Exhibit C",
  [SIGNNOW_FLEX_ADDENDUM_TEMPLATE_ID]: "Flex Addendum",
  [SIGNNOW_PAYOFF_ADDENDUM_TEMPLATE_ID]: "PayOff Addendum (Refi)",
  [SIGNNOW_EPA_TEMPLATE_ID]: "EPA Nitro Advance",
  [SIGNNOW_MONTHLY_FEE_TEMPLATE_ID]: "Monthly Fee",
  [SIGNNOW_DISCLOSURE_TEMPLATE_ID]: "State Disclosure",
};

const KNOWN_SIGNNOW_LAYOUT_LABELS: Record<string, string> = {
  [SIGNNOW_ACH_DAILY_LAYOUT_KEY]: "ACH Daily",
  [SIGNNOW_ACH_WEEKLY_LAYOUT_KEY]: "ACH Weekly",
  [SIGNNOW_EXHIBIT_A_LAYOUT_KEY]: "Exhibit A",
  [SIGNNOW_EXHIBIT_C_LAYOUT_KEY]: "Exhibit C",
  [SIGNNOW_FLEX_ADDENDUM_LAYOUT_KEY]: "Flex Addendum",
  [SIGNNOW_PAYOFF_ADDENDUM_LAYOUT_KEY]: "PayOff Addendum (Refi)",
  [SIGNNOW_EPA_LAYOUT_KEY]: "EPA Nitro Advance",
  [SIGNNOW_MONTHLY_FEE_LAYOUT_KEY]: "Monthly Fee",
  [SIGNNOW_DISCLOSURE_LAYOUT_KEY]: "State Disclosure",
  ...Object.fromEntries(
    SIGNNOW_ADDENDUM_TEMPLATE_OPTIONS.map((opt) => [opt.layoutKey, opt.label]),
  ),
};

export function extractSignNowTemplateId(linkOrId?: string | null): string {
  const raw = String(linkOrId ?? "").trim();
  if (!raw) return "";
  if (/^[a-f0-9]{40}$/i.test(raw)) return raw.toLowerCase();
  const match = raw.match(SIGNNOW_ID_RE);
  return match ? match[0].toLowerCase() : "";
}

function slugifyTemplateName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/** Map common Settings names back to the layout keys Create Contract already knows. */
const KNOWN_ADDENDUM_NAME_KEYS: Record<string, string> = {
  ach_daily: "ach_daily",
  ach_weekly: "ach_weekly",
  exhibit_a: "exhibit_a",
  exhibit_c: "exhibit_c",
  flex_addendum: "flex_addendum",
  payoff_addendum_refi: "payoff_addendum",
  payoff_addendum: "payoff_addendum",
  epa_nitro_advance: "epa",
  epa: "epa",
  monthly_fee: "monthly_fee",
};

const KNOWN_DISCLOSURE_NAME_KEYS: Record<string, string> = {
  state_disclosure: "signnow_disclosure",
  disclosure: "signnow_disclosure",
  signnow_disclosure: "signnow_disclosure",
};

/** Fuzzy match Settings labels (e.g. "ACH Weekly Authorization") to known layout keys. */
function knownLayoutKeyFromName(
  name: string,
  kind: "addendum" | "disclosure",
): string {
  const slug = slugifyTemplateName(name);
  if (!slug) return "";
  if (kind === "disclosure") {
    return KNOWN_DISCLOSURE_NAME_KEYS[slug] || "";
  }
  if (KNOWN_ADDENDUM_NAME_KEYS[slug]) return KNOWN_ADDENDUM_NAME_KEYS[slug];
  // ACH Daily/Weekly before Exhibit C — names like "Extra Exhibit C (ACH Daily)"
  // must not collapse into exhibit_c.
  if (slug.includes("ach") && slug.includes("daily") && !slug.includes("weekly")) {
    return "ach_daily";
  }
  if (slug.includes("ach") && slug.includes("weekly")) return "ach_weekly";
  if (slug.includes("exhibit_c") || (slug.includes("exhibit") && slug.includes("ach"))) {
    return "exhibit_c";
  }
  if (slug.includes("exhibit_a")) return "exhibit_a";
  if (slug.includes("flex") && slug.includes("addendum")) return "flex_addendum";
  if (slug.includes("payoff") && slug.includes("addendum")) return "payoff_addendum";
  if (slug.includes("monthly") && slug.includes("fee")) return "monthly_fee";
  if (slug === "epa" || (slug.includes("epa") && !slug.includes("discover"))) {
    return "epa";
  }
  return "";
}

/**
 * Stable option/mapping key for Settings → Funders SignNow links.
 * Prefer the unique SignNow template id so Obsidian/etc. do not collide with
 * Nitro's shared catalog keys (`ach_weekly`, `exhibit_c`, …) and get wiped.
 */
function layoutKeyForTemplate(
  item: SignNowTemplateLinkItem,
  kind: "addendum" | "disclosure",
): string {
  const id = extractSignNowTemplateId(item.link);
  const known = knownLayoutKeyFromName(item.name, kind);
  const slug = slugifyTemplateName(item.name);
  if (kind === "addendum") {
    return id || known || slug || "template";
  }
  return known || id || slug || "template";
}

/** Known prefill kind key from a Settings display name (e.g. Exhibit C → exhibit_c). */
export function knownAddendumLayoutKeyFromName(name?: string | null): string {
  return knownLayoutKeyFromName(String(name ?? ""), "addendum");
}

/** Match a linked mapping / BoldSign row back to Settings → Funders SignNow addendum. */
export function matchFunderSignNowAddendumOption(
  template:
    | {
        id?: string | null;
        name?: string | null;
        layoutKey?: string | null;
        templateId?: string | null;
      }
    | null
    | undefined,
  options: FunderSignNowTemplateOption[],
): FunderSignNowTemplateOption | null {
  if (!template || !options.length) return null;
  const layoutKey = String(template.layoutKey ?? "").trim().toLowerCase();
  const templateId = extractSignNowTemplateId(
    template.templateId || template.id || "",
  );
  const nameSlug = slugifyTemplateName(String(template.name ?? ""));

  // 1) Exact SignNow template id — never claim another funder's copy via layout key.
  if (templateId) {
    const byId = options.find((opt) => {
      const optId = extractSignNowTemplateId(opt.templateId || opt.link);
      const optKey = String(opt.layoutKey || "").trim().toLowerCase();
      return Boolean(
        (optId && optId === templateId) || (optKey && optKey === templateId),
      );
    });
    if (byId) return byId;
  }

  // 2) Layout key only when the mapping is not tied to a different SignNow id.
  if (layoutKey) {
    const byKey = options.find((opt) => {
      const optKey = String(opt.layoutKey || "").trim().toLowerCase();
      const optId = extractSignNowTemplateId(opt.templateId || opt.link);
      if (!optKey || optKey !== layoutKey) return false;
      if (templateId && optId && templateId !== optId) return false;
      return true;
    });
    if (byKey) return byKey;
  }

  if (!nameSlug || nameSlug === "addendum" || nameSlug === "template") return null;
  const known = knownLayoutKeyFromName(String(template.name ?? ""), "addendum");
  return (
    options.find((opt) => {
      const optSlug = slugifyTemplateName(opt.name);
      const optKnown = knownLayoutKeyFromName(opt.name, "addendum");
      const optId = extractSignNowTemplateId(opt.templateId || opt.link);
      if (templateId && optId && templateId !== optId) return false;
      if (nameSlug && optSlug === nameSlug) return true;
      if (known && (opt.layoutKey === known || optKnown === known)) return true;
      return false;
    }) ?? null
  );
}

/** True when this mapping/ref belongs to the selected funder's Settings addendum links. */
export function funderOwnsSignNowAddendumRef(
  ref: string | null | undefined,
  options: FunderSignNowTemplateOption[],
  template?: {
    id?: string | null;
    name?: string | null;
    layoutKey?: string | null;
    templateId?: string | null;
  } | null,
): boolean {
  if (!options.length) return false;
  const token = String(ref ?? "")
    .trim()
    .replace(/^bs:/i, "");
  const tokenId = extractSignNowTemplateId(token);
  const rowId = extractSignNowTemplateId(
    template?.templateId || template?.id || "",
  );
  const rowLk = String(template?.layoutKey ?? "")
    .trim()
    .toLowerCase();
  const rowKnown = knownLayoutKeyFromName(
    String(template?.name ?? ""),
    "addendum",
  );
  const tokenKnown =
    knownLayoutKeyFromName(token, "addendum") ||
    (token.toLowerCase() === "exhibit_c" ? "exhibit_c" : "");

  // Owned if any Settings option matches this funder's SignNow id / selection ref.
  return options.some((opt) => {
    const optKey = String(opt.layoutKey || "").trim();
    const optId = extractSignNowTemplateId(opt.templateId || opt.link);
    const optKnown = String(opt.knownLayoutKey || "").trim().toLowerCase();
    if (rowId && optId && rowId === optId) return true;
    if (tokenId && optId && tokenId === optId) return true;
    if (token && optKey && token === optKey) return true;
    if (rowLk && optKey && rowLk === optKey.toLowerCase()) return true;
    // Shared catalog keys (exhibit_c / ach_*) — match funder option by known kind
    // even when the CRM row still points at the platform template id.
    if (optKnown) {
      if (rowLk && rowLk === optKnown) return true;
      if (rowKnown && rowKnown === optKnown) return true;
      if (tokenKnown && tokenKnown === optKnown) return true;
      if (token && token.toLowerCase() === optKnown) return true;
    }
    // Legacy rows stored under shared Nitro keys (ach_weekly) — only keep when
    // this funder's option uses that same SignNow id (not a different copy).
    if (
      rowLk &&
      optKnown &&
      rowLk === optKnown &&
      rowId &&
      optId &&
      rowId === optId
    ) {
      return true;
    }
    return false;
  });
}

export type FunderSignNowTemplateOption = {
  id: string;
  /** Unique selection/mapping ref — SignNow template id when available. */
  layoutKey: string;
  /** Prefill kind key from the Settings name (`ach_weekly`, `exhibit_c`, …). */
  knownLayoutKey: string;
  templateId: string;
  name: string;
  type: "addendum" | "disclosure";
  pdfUrl: string;
  link: string;
};

export function mapFunderSignNowTemplates(
  items: SignNowTemplateLinkItem[] | null | undefined,
  kind: "addendum" | "disclosure",
): FunderSignNowTemplateOption[] {
  if (!items?.length) return [];
  const seen = new Set<string>();
  const out: FunderSignNowTemplateOption[] = [];
  for (const item of items) {
    const name = String(item?.name ?? "").trim();
    const link = String(item?.link ?? "").trim();
    const templateId = extractSignNowTemplateId(link);
    if (!name && !templateId && !link) continue;
    const knownLayoutKey = knownLayoutKeyFromName(name || templateId || "", kind);
    const layoutKey = layoutKeyForTemplate(
      { name: name || templateId || "Template", link },
      kind,
    );
    const key = `${layoutKey}:${templateId || link}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: templateId || layoutKey,
      layoutKey,
      knownLayoutKey,
      templateId: templateId || layoutKey,
      name: name || (kind === "disclosure" ? "Disclosure" : "Addendum"),
      type: kind,
      pdfUrl: templateId ? `signnow://${templateId}` : `platform://${layoutKey}`,
      link: link || templateId,
    });
  }
  return out;
}

export function funderHasSignNowTemplates(
  profile?: Pick<
    FunderProfile,
    | "signnowContractTemplateLink"
    | "signnowAddendumTemplates"
    | "signnowDisclosureTemplates"
  > | null,
): boolean {
  if (!profile) return false;
  if (extractSignNowTemplateId(profile.signnowContractTemplateLink)) return true;
  if (profile.signnowAddendumTemplates?.length) return true;
  if (profile.signnowDisclosureTemplates?.length) return true;
  return false;
}

export function funderSignNowAddendumOptions(
  profile?: FunderProfile | null,
): FunderSignNowTemplateOption[] {
  return mapFunderSignNowTemplates(profile?.signnowAddendumTemplates, "addendum");
}

/** True for a raw 40-char SignNow document/template id (never show as a UI label). */
export function isSignNowTemplateIdToken(value?: string | null): boolean {
  return /^[a-f0-9]{40}$/i.test(String(value ?? "").trim());
}

/**
 * Resolve a selected `bs:<ref>` / layout key / SignNow id to the Settings display name.
 * Prefer funder Settings names; never return a raw hex template id.
 */
export function resolveFunderAddendumDisplayName(
  ref: string | null | undefined,
  options: FunderSignNowTemplateOption[],
  fallbackName?: string | null,
): string {
  const token = String(ref ?? "")
    .trim()
    .replace(/^bs:/i, "");
  const fallback = String(fallbackName ?? "").trim();
  if (!token && !fallback) return "Addendum";

  const match =
    matchFunderSignNowAddendumOption(
      {
        layoutKey: token || null,
        templateId: token || null,
        name: fallback || null,
      },
      options,
    ) ||
    options.find((opt) => {
      const optKey = String(opt.layoutKey || "").trim().toLowerCase();
      const optId = extractSignNowTemplateId(opt.templateId || opt.link);
      const lower = token.toLowerCase();
      return Boolean(
        (optKey && optKey === lower) ||
          (optId && optId === lower) ||
          slugifyTemplateName(opt.name) === slugifyTemplateName(token),
      );
    });

  const fromMatch = String(match?.name ?? "").trim();
  if (fromMatch && !isSignNowTemplateIdToken(fromMatch)) return fromMatch;
  if (fallback && !isSignNowTemplateIdToken(fallback)) return fallback;

  const lower = token.toLowerCase();
  const fromKnownId = KNOWN_SIGNNOW_TEMPLATE_ID_LABELS[lower];
  if (fromKnownId) return fromKnownId;
  const fromKnownLayout = KNOWN_SIGNNOW_LAYOUT_LABELS[lower];
  if (fromKnownLayout) return fromKnownLayout;

  if (token && !isSignNowTemplateIdToken(token)) {
    const known = knownLayoutKeyFromName(token, "addendum");
    if (known) {
      const byKnown = options.find((opt) => opt.layoutKey === known);
      if (byKnown?.name && !isSignNowTemplateIdToken(byKnown.name)) {
        return byKnown.name;
      }
      if (KNOWN_SIGNNOW_LAYOUT_LABELS[known]) {
        return KNOWN_SIGNNOW_LAYOUT_LABELS[known];
      }
    }
    return token.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() || "Addendum";
  }
  return "Addendum";
}

export function funderSignNowDisclosureOptions(
  profile?: FunderProfile | null,
): FunderSignNowTemplateOption[] {
  return mapFunderSignNowTemplates(
    profile?.signnowDisclosureTemplates,
    "disclosure",
  );
}

/** Platform SignNow state disclosure when the funder has none in Settings. */
export function platformSignNowDisclosureOption(): FunderSignNowTemplateOption {
  return {
    id: SIGNNOW_DISCLOSURE_LAYOUT_KEY,
    layoutKey: SIGNNOW_DISCLOSURE_LAYOUT_KEY,
    knownLayoutKey: SIGNNOW_DISCLOSURE_LAYOUT_KEY,
    templateId: SIGNNOW_DISCLOSURE_TEMPLATE_ID,
    name: "State Disclosure",
    type: "disclosure",
    pdfUrl: `signnow://${SIGNNOW_DISCLOSURE_TEMPLATE_ID}`,
    link: SIGNNOW_DISCLOSURE_TEMPLATE_ID,
  };
}

/** Funder Settings disclosure, or the shared Nitro SignNow disclosure template. */
export function resolveSignNowDisclosureOption(
  profile?: FunderProfile | null,
): FunderSignNowTemplateOption {
  return funderSignNowDisclosureOptions(profile)[0] ?? platformSignNowDisclosureOption();
}

export function funderSignNowContractTemplateId(
  profile?: FunderProfile | null,
): string {
  return extractSignNowTemplateId(profile?.signnowContractTemplateLink);
}
