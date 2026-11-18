/** Addenda that may appear more than once on the same deal (separate SignNow copies). */

export const MULTI_INSTANCE_ADDENDUM_LAYOUT_KEYS = new Set(["exhibit_c"]);

export const MULTI_INSTANCE_ADDENDUM_MAX = 10;

/** Canonical SignNow Exhibit C template id (fallback when layoutKey is missing). */
export const SIGNNOW_EXHIBIT_C_TEMPLATE_ID =
    "00fcf8fd543d4c4a8323633190a9066959f081a8";

/** ACH Daily catalog id — remittance addendum (not Exhibit C ×N). */
export const SIGNNOW_ACH_DAILY_TEMPLATE_ID =
    "5741b00ce3aa425bb96415ff89b67aa7b8b3daa6";

/** ACH Weekly catalog id. */
export const SIGNNOW_ACH_WEEKLY_TEMPLATE_ID =
    "37c76f0cae974ca085d0acf64bdf054686cb2815";

export function normalizeAddendumLayoutKey(ref: unknown): string {
    return String(ref ?? "")
        .trim()
        .toLowerCase()
        .replace(/::\d+$/, "");
}

/**
 * ref -> real Settings display name, for every addendum/disclosure template
 * currently loaded for any funder. A funder's Exhibit C template is often
 * just a bare SignNow hex id with nothing "exhibit_c"-shaped about it on its
 * own (Obsidian's, for one) — several call sites below only have the ref, not
 * its label, so without this registry extra Exhibit C copies for that funder
 * would be misread as a single-instance addendum and collapse back to one.
 * Populated by `registerAddendumRefLabels` wherever a funder's template
 * options are loaded; never cleared, since refs are stable SignNow ids/keys.
 */
const addendumRefLabelRegistry = new Map<string, string>();

export function registerAddendumRefLabels(
    options: ReadonlyArray<{
        ref?: unknown;
        layoutKey?: unknown;
        templateId?: unknown;
        label?: unknown;
        name?: unknown;
    }>,
): void {
    for (const opt of options) {
        const label = String(opt.label ?? opt.name ?? "").trim();
        if (!label) continue;
        for (const rawRef of [opt.ref, opt.layoutKey, opt.templateId]) {
            const key = normalizeAddendumLayoutKey(rawRef);
            if (key) addendumRefLabelRegistry.set(key, label);
        }
    }
}

function knownLabelFor(ref: unknown, label?: unknown): unknown {
    const given = String(label ?? "").trim();
    if (given) return given;
    const key = normalizeAddendumLayoutKey(ref);
    return key ? addendumRefLabelRegistry.get(key) : undefined;
}

function looksLikeExhibitCLabel(label: unknown): boolean {
    const n = String(label ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ");
    if (!n) return false;
    return (
        n === "exhibit c" ||
        n.includes("exhibit c") ||
        n.includes("exhibit_c") ||
        /\bexhibit\s*c\b/.test(n)
    );
}

function looksLikeAchDailyLabel(label: unknown): boolean {
    const n = String(label ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ");
    if (!n) return false;
    return n.includes("ach") && n.includes("daily") && !n.includes("weekly");
}

function looksLikeAchWeeklyLabel(label: unknown): boolean {
    const n = String(label ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ");
    if (!n) return false;
    return n.includes("ach") && n.includes("weekly");
}

/** True for the distinct ACH Daily SignNow template (not Exhibit C ×N). */
export function isAchDailyAddendumRef(ref: unknown, label?: unknown): boolean {
    const resolvedLabel = knownLabelFor(ref, label);
    if (looksLikeAchDailyLabel(resolvedLabel) || looksLikeAchDailyLabel(ref)) return true;
    const key = normalizeAddendumLayoutKey(ref);
    if (!key) return false;
    if (key === "ach_daily" || key.endsWith("_ach_daily")) return true;
    if (key === SIGNNOW_ACH_DAILY_TEMPLATE_ID) return true;
    return false;
}

/** True for ACH Weekly (layout key or catalog hex). */
export function isAchWeeklyAddendumRef(ref: unknown, label?: unknown): boolean {
    const resolvedLabel = knownLabelFor(ref, label);
    if (looksLikeAchWeeklyLabel(resolvedLabel) || looksLikeAchWeeklyLabel(ref)) return true;
    const key = normalizeAddendumLayoutKey(ref);
    if (!key) return false;
    if (key === "ach_weekly" || key.endsWith("_ach_weekly")) return true;
    if (key === SIGNNOW_ACH_WEEKLY_TEMPLATE_ID) return true;
    return false;
}

/**
 * Stable kind for dedupe: layout key and SignNow hex for the same catalog
 * addendum must collapse to one send-order row (except Exhibit C ×N).
 */
export function canonicalAddendumDedupKey(ref: unknown, label?: unknown): string {
    if (isAchDailyAddendumRef(ref, label)) return "ach_daily";
    if (isAchWeeklyAddendumRef(ref, label)) return "ach_weekly";
    const key = normalizeAddendumLayoutKey(ref);
    if (!key) return "";
    if (
        key === "exhibit_c" ||
        key === SIGNNOW_EXHIBIT_C_TEMPLATE_ID ||
        key.endsWith("_exhibit_c") ||
        key.includes("exhibit_c") ||
        looksLikeExhibitCLabel(key)
    ) {
        return "exhibit_c";
    }
    if (key === "exhibit_a" || key.endsWith("_exhibit_a") || key.includes("exhibit_a")) {
        return "exhibit_a";
    }
    if (key === "flex_addendum" || key.endsWith("_flex_addendum")) return "flex_addendum";
    if (key === "payoff_addendum" || key.endsWith("_payoff_addendum")) {
        return "payoff_addendum";
    }
    if (key === "epa" || key.endsWith("_epa")) return "epa";
    if (key === "monthly_fee" || key.endsWith("_monthly_fee")) return "monthly_fee";
    // A funder's copy is often stored under its bare SignNow hex id; resolve its kind from
    // the registered Settings name so the hex and the catalog form of the same Flex / EPA
    // addendum collapse to one row instead of a second, never-resolving pending row.
    const labelKind = singleInstanceKindFromLabel(knownLabelFor(ref, label));
    if (labelKind) return labelKind;
    return key;
}

/** Single-instance addendum kind named by a Settings label (mirrors the SignNow name keys). */
function singleInstanceKindFromLabel(label: unknown): string {
    const slug = String(label ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!slug) return "";
    if (slug.includes("exhibit_a")) return "exhibit_a";
    if ((slug.includes("flex") && slug.includes("addendum")) || slug === "flex" || slug.startsWith("flex_")) {
        return "flex_addendum";
    }
    if (slug.includes("payoff") && slug.includes("addendum")) return "payoff_addendum";
    if (slug.includes("monthly") && slug.includes("fee")) return "monthly_fee";
    if (slug === "epa" || slug.startsWith("epa_") || slug.endsWith("_epa") || slug.includes("_epa_")) {
        return "epa";
    }
    return "";
}

/**
 * True when this addendum may be attached multiple times (Exhibit C).
 * Accepts layout keys, template ids, and human labels — funder rows often
 * store only the SignNow hex id with no `exhibit_c` layoutKey.
 * ACH Daily must never count as Exhibit C ×N (its SignNow PDF name may still
 * say "Extra Exhibit C").
 */
export function isMultiInstanceAddendumRef(ref: unknown, label?: unknown): boolean {
    if (isAchDailyAddendumRef(ref, label) || isAchWeeklyAddendumRef(ref, label)) {
        return false;
    }
    const resolvedLabel = knownLabelFor(ref, label);
    if (resolvedLabel != null && looksLikeExhibitCLabel(resolvedLabel)) return true;
    const key = normalizeAddendumLayoutKey(ref);
    if (!key) return false;
    if (key === SIGNNOW_ACH_DAILY_TEMPLATE_ID || key === SIGNNOW_ACH_WEEKLY_TEMPLATE_ID) {
        return false;
    }
    if (key === "ach_daily" || key.endsWith("_ach_daily")) return false;
    if (key === "ach_weekly" || key.endsWith("_ach_weekly")) return false;
    if (MULTI_INSTANCE_ADDENDUM_LAYOUT_KEYS.has(key)) return true;
    if (key === SIGNNOW_EXHIBIT_C_TEMPLATE_ID) return true;
    if (key.endsWith("_exhibit_c") || key.includes("exhibit_c")) return true;
    if (looksLikeExhibitCLabel(key)) return true;
    return false;
}

/**
 * True Exhibit C copies only — never ACH Daily / Weekly.
 */
export function isExhibitCFamilyAddendumRef(ref: unknown, label?: unknown): boolean {
    if (isAchDailyAddendumRef(ref, label) || isAchWeeklyAddendumRef(ref, label)) {
        return false;
    }
    return isMultiInstanceAddendumRef(ref, label);
}

export function labelForExhibitCFamilyInstance(familyIndex: number): string {
    const n = Math.max(1, Math.floor(familyIndex));
    return n <= 1 ? "Exhibit C" : `Exhibit C (${n})`;
}

/** Collapse non-multi refs; keep every multi-instance occurrence (order preserved). */
export function expandAddendumRefsAllowingDuplicates(refs: unknown): string[] {
    const list = Array.isArray(refs) ? refs : [];
    const out: string[] = [];
    const seenNonMulti = new Set<string>();
    for (const raw of list) {
        const ref = String(raw ?? "").trim();
        if (!ref) continue;
        // Only Exhibit C may repeat. Never keep accidental ACH Daily/Weekly duplicates
        // (hex id + layout key used to create twin pending spinner rows).
        if (isMultiInstanceAddendumRef(ref)) {
            out.push(ref);
            continue;
        }
        const dedupKey = canonicalAddendumDedupKey(ref) || normalizeAddendumLayoutKey(ref);
        if (!dedupKey || seenNonMulti.has(dedupKey)) continue;
        seenNonMulti.add(dedupKey);
        out.push(ref);
    }
    return out;
}

export function countAddendumRefOccurrences(refs: readonly string[], target: string): number {
    const tKey = normalizeAddendumLayoutKey(target);
    if (!tKey) return 0;
    return refs.filter((r) => sameAddendumPickerRef(r, target)).length;
}

export function sameAddendumPickerRef(ref: unknown, target: unknown): boolean {
    const a = normalizeAddendumLayoutKey(ref);
    const b = normalizeAddendumLayoutKey(target);
    if (!a || !b) return false;
    if (a === b) return true;
    const aKind = canonicalAddendumDedupKey(a);
    const bKind = canonicalAddendumDedupKey(b);
    if (aKind && bKind && aKind === bKind) return true;
    return false;
}

export function setAddendumRefCount(
    refs: readonly string[],
    target: string,
    count: number,
    label?: unknown,
): string[] {
    const multi = isMultiInstanceAddendumRef(target, label);
    // Prefer the picker/funder ref (usually SignNow hex id) so mappings stay owned
    // by the selected funder and appear immediately on the send-order board.
    const storeRef = multi
        ? String(target || "").trim() || "exhibit_c"
        : normalizeAddendumLayoutKey(target) || String(target || "").trim();
    if (!storeRef) return [...refs];
    const capped = Math.max(0, Math.min(MULTI_INSTANCE_ADDENDUM_MAX, Math.floor(count)));
    const without = refs.filter((r) => !sameAddendumPickerRef(r, storeRef));
    if (capped <= 0) return without;
    const insertAt = (() => {
        const idx = refs.findIndex((r) => sameAddendumPickerRef(r, storeRef));
        return idx >= 0 ? idx : without.length;
    })();
    const next = [...without];
    next.splice(insertAt, 0, ...Array.from({ length: capped }, () => storeRef));
    return next;
}

export function labelForAddendumInstance(
    baseLabel: string,
    ref: string,
    allRefs: readonly string[],
    indexInAll: number,
): string {
    const label = String(baseLabel || "").trim() || "Addendum";
    if (!isMultiInstanceAddendumRef(ref, label)) return label;
    // Count only this same addendum's own copies. Matching by ref (not a bare
    // `isMultiInstanceAddendumRef(allRefs[i])` re-check with no label) is what
    // makes this work for a funder whose Exhibit C is a plain SignNow hex id
    // with nothing "exhibit_c"-shaped about it on its own (e.g. Obsidian) —
    // without the label, that hex cannot be told apart from any other ref.
    let n = 0;
    for (let i = 0; i <= indexInAll && i < allRefs.length; i++) {
        if (sameAddendumPickerRef(allRefs[i], ref)) n += 1;
    }
    return n <= 1 ? label : `${label} (${n})`;
}

export function exhibitCInstanceIndexFromDocumentName(documentName: unknown): number | null {
    const n = String(documentName ?? "").trim().toLowerCase();
    if (!n) return null;
    if (/\bach\b/.test(n) && /daily/.test(n) && !/weekly/.test(n)) return null;
    if (!(n.includes("exhibit") && n.includes("c")) && !n.includes("exhibit_c")) {
        return null;
    }
    const m = n.match(/\((\d+)\)\s*$/);
    if (m) {
        const idx = Number(m[1]) - 1;
        return Number.isFinite(idx) && idx >= 0 ? idx : 0;
    }
    return 0;
}

/** Resolve which picker option ref is the multi-instance Exhibit C row. */
export function findExhibitCOptionRef(
    options: Array<{ ref: string; label: string }>,
    selectedRefs: readonly string[] = [],
): string | null {
    for (const opt of options) {
        if (isMultiInstanceAddendumRef(opt.ref, opt.label)) return opt.ref;
    }
    for (const ref of selectedRefs) {
        if (isMultiInstanceAddendumRef(ref)) return ref;
    }
    return null;
}
