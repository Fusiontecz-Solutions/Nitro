/**
 * Read-back check for the Owner review prefill.
 *
 * Review used to mint the SignNow link as soon as the prefill writes returned,
 * trusting that a write which did not error had landed. It had not always:
 * a freshly copied Disclosure / Contract / Addendum is readable before SignNow
 * has attached all of its widgets, so the prefill was planned against a
 * snapshot that was missing some of them and those widgets were never written.
 * The review opened with gaps, and a second Review — against a document that
 * had finished loading — filled them.
 *
 * The link is now minted only after every document has been read back fresh
 * and every widget the CRM has a value for actually carries one.
 */

const NON_VALUE_TYPES = new Set([
  'signature',
  'initials',
  'stamp',
  'checkmark',
  'checkbox',
  'radiobutton',
  'attachment',
]);

const VALUE_CONTAINERS = ['texts', 'fields', 'fillable_fields'] as const;

export type SignNowReviewPrefillCheck = {
  documentId: string;
  documentName: string;
  /** Widgets that must carry a CRM value but read back empty. */
  missing: string[];
  /** `GET /document/{id}` failed, so nothing about this document is confirmed. */
  unreadable: boolean;
  /** A freshly copied document that still has no widgets at all. */
  withoutFields: boolean;
};

function parseAttrs(field: Record<string, unknown>): Record<string, unknown> {
  let attrs = field.json_attributes;
  if (typeof attrs === 'string') {
    try {
      attrs = JSON.parse(attrs);
    } catch {
      attrs = {};
    }
  }
  return attrs && typeof attrs === 'object' ? (attrs as Record<string, unknown>) : {};
}

function nameKey(name: string): string {
  return String(name || '').trim().toLowerCase();
}

/** Current value of every named value widget on a `GET /document/{id}` payload. */
export function readSignNowWidgetValues(remote: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!remote || typeof remote !== 'object') return out;
  const src = remote as Record<string, unknown>;
  for (const container of VALUE_CONTAINERS) {
    const rows = Array.isArray(src[container]) ? (src[container] as unknown[]) : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const field = row as Record<string, unknown>;
      const attrs = parseAttrs(field);
      const type = String(field.type || attrs.type || '').toLowerCase();
      if (type && NON_VALUE_TYPES.has(type)) continue;
      const key = nameKey(
        String(attrs.name || field.name || field.field_name || attrs.label || field.label || ''),
      );
      if (!key) continue;
      const element =
        field.element && typeof field.element === 'object'
          ? (field.element as Record<string, unknown>)
          : {};
      const value = String(
        field.data ||
          field.prefilled_text ||
          attrs.data ||
          attrs.prefilled_text ||
          element.data ||
          '',
      ).trim();
      // SignNow's own placeholder is not a value.
      if (!value || /^enter text$/i.test(value)) continue;
      if (!out.has(key)) out.set(key, value);
    }
  }
  return out;
}

/**
 * Which widgets on a fresh read must carry a value.
 *
 * - `resolvable`: widgets on the fresh read the CRM has a value for.
 * - `planned`: widgets the prefill knew about when it wrote.
 * - `written`: widgets the prefill actually sent a value to.
 *
 * A widget is required when the prefill wrote to it (the write must have
 * landed) or when the prefill never saw it (the snapshot was stale). A widget
 * the prefill saw but deliberately left blank — a value SignNow's validator
 * refused, a field a document forces blank — is not required, so the check
 * cannot demand something the write will never produce.
 */
export function requiredReviewPrefillFields(input: {
  resolvable: readonly string[];
  planned: readonly string[];
  written: readonly string[];
}): string[] {
  const planned = new Set(input.planned.map(nameKey));
  const written = new Set(input.written.map(nameKey));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of input.resolvable) {
    const key = nameKey(name);
    if (!key || seen.has(key)) continue;
    if (written.has(key) || !planned.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

function amountOf(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!/^[$\s]*-?[\d,]*\.?\d+\s*%?$/.test(text)) return null;
  const n = Number(text.replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Required widgets that read back without a value.
 *
 * `expected` is the value the CRM resolved for each widget. A widget reading
 * back as a zero amount where the CRM holds a real one is not prefilled either:
 * `0.00` is a placeholder (the pre-warm's empty-map write, a calculator run
 * without inputs), and letting it through is how Review opened a disclosure
 * showing 0.00 on lines the send then baked correctly.
 */
export function missingReviewPrefillFields(
  remote: unknown,
  required: readonly string[],
  expected?: Readonly<Record<string, string>>,
): string[] {
  const values = readSignNowWidgetValues(remote);
  return required.filter((name) => {
    const read = values.get(nameKey(name));
    if (!read) return true;
    const want = expected ? amountOf(expected[name]) : null;
    return want != null && want !== 0 && amountOf(read) === 0;
  });
}

export function reviewPrefillIsComplete(checks: readonly SignNowReviewPrefillCheck[]): boolean {
  return checks.every((c) => !c.unreadable && !c.withoutFields && c.missing.length === 0);
}

export function incompleteReviewPrefillDocuments(
  checks: readonly SignNowReviewPrefillCheck[],
): SignNowReviewPrefillCheck[] {
  return checks.filter((c) => c.unreadable || c.withoutFields || c.missing.length > 0);
}

/** What the CRM shows when the package still is not complete after every retry. */
export function describeIncompleteReviewPrefill(
  checks: readonly SignNowReviewPrefillCheck[],
): string {
  const parts = incompleteReviewPrefillDocuments(checks).map((c) => {
    const name = c.documentName || c.documentId;
    if (c.unreadable) return `${name} (could not be read back)`;
    if (c.withoutFields) return `${name} (fields not loaded yet)`;
    const n = c.missing.length;
    return `${name} (${n} field${n === 1 ? '' : 's'} empty)`;
  });
  return (
    'SignNow review was not opened because the documents are not fully prefilled yet' +
    (parts.length ? `: ${parts.join(', ')}` : '') +
    '. Wait a few seconds and click Review in SignNow again.'
  );
}
