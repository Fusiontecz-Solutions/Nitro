/**
 * Derives repayment frequency from a human-readable `term` string.
 * The Excel `frequency` column must not be used for persistence — always derive from `term`.
 *
 * - Case-insensitive; surrounding / duplicate spaces on input should be normalized by callers
 *   when building the stored `term`; this function only lowercases for matching.
 * - Uses whole-word `day(s)` / `week(s)` so values like "Monday" do not become `daily`.
 * - `monthly`, `yearly`, malformed text → `"NA"`. Null/empty → `"NA"`.
 */
export function deriveFrequency(term: string | null | undefined): string {
    if (term == null) return 'NA';
    const normalized = String(term).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!normalized) return 'NA';
    if (/\bdays?\b/.test(normalized)) return 'daily';
    if (/\bweeks?\b/.test(normalized)) return 'weekly';
    return 'NA';
}

/** Collapse whitespace; empty after trim → `"NA"` (stored `term` default). */
export function normalizeTermForOfferDecision(raw: unknown): string {
    const t = String(raw ?? '')
        .trim()
        .replace(/\s+/g, ' ');
    return t === '' ? 'NA' : t;
}

/** Map spec lowercase labels to values stored in DB / used by existing UI (`Daily`, `Weekly`). */
export function frequencySpecToStored(spec: string): string {
    const s = String(spec ?? '').trim().toLowerCase();
    if (s === 'daily') return 'Daily';
    if (s === 'weekly') return 'Weekly';
    return 'NA';
}

/**
 * Best-effort contract length in days from `OfferDecision.term` (legacy int-as-text or "60 Days").
 */
export function parseContractLengthDaysFromOfferTerm(term: unknown): number | null {
    if (term == null) return null;
    if (typeof term === 'number' && Number.isFinite(term)) return term;
    const str = String(term).trim();
    if (!str || str.toUpperCase() === 'NA') return null;
    const m = /^(\d+)/.exec(str.replace(/\s+/g, ' '));
    if (!m) return null;
    const n = Number.parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
}

/**
 * Estimated term in CALENDAR DAYS for the state disclosure, from the offer's own
 * `term` text and payment frequency.
 *
 * The disclosure's "Estimated Term" is a number of days, but `OfferDecision.term` is
 * captured in the cadence's own unit — "20" / "20 Days" on a daily deal, "10 Weeks" on a
 * weekly one. Reading that number as days made a 10-week deal disclose a 10-day term.
 *
 * The unit written on the term wins (a term already expressed in days is never scaled);
 * a bare number is read in the selected frequency's unit. Returns null when there is no
 * usable term, so callers keep whatever they already had.
 */
export function parseDisclosureTermDaysFromOffer(
    term: unknown,
    frequency: unknown,
): number | null {
    const count = parseContractLengthDaysFromOfferTerm(term);
    if (count == null || !(count > 0)) return null;

    const termText = String(term ?? '').toLowerCase();
    const freqText = String(frequency ?? '').toLowerCase();
    const unit = /\bweeks?\b/.test(termText)
        ? 'week'
        : /\bdays?\b/.test(termText)
          ? 'day'
          : /\bmonths?\b/.test(termText)
            ? 'month'
            : freqText.startsWith('week')
              ? 'week'
              : freqText.startsWith('bi')
                ? 'biweek'
                : freqText.startsWith('month')
                  ? 'month'
                  : 'day';

    if (unit === 'week') return count * 7;
    if (unit === 'biweek') return count * 14;
    if (unit === 'month') return count * 30;
    return count;
}
