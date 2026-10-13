import {
  isDedicatedExhibitCRequiredField,
  isMerchantRequiredSignerField,
  usesAddendumFillableFont,
  type SignNowPrefillDocumentKind,
} from './signnow-field-map';

/**
 * SignNow rejects a whole PUT /document/{id} with
 * "Empty prefilled text for lock to sign prefill" if ANY field has
 * lock_to_sign_prefill=true and no prefilled_text. Owner templates include
 * empty party-2 / ACH slots, so locking every Owner field blanks the review.
 *
 * Prefill on fillable fields is only shown to the assigned signer. Merchant
 * view-only (and later signers) see committed `texts[].data`, not prefilled_text.
 */

const SIGN_TYPES = new Set(['signature', 'initials', 'stamp']);
const NON_TEXT_TYPES = new Set([
  'signature',
  'initials',
  'stamp',
  'checkbox',
  'checkmark',
  'radiobutton',
  'attachment',
]);

const STYLE_KEYS = [
  'font',
  'font_size',
  'size',
  'color',
  'align',
  'valign',
  'label',
  'validator_id',
  'bold',
  'italic',
  'underline',
  'max_chars',
  'max_lines',
  'stretch_mode',
  'line_height',
] as const;

export function canLockSignNowPrefill(field: Record<string, unknown>): boolean {
  const type = String(field.type || '').toLowerCase();
  if (NON_TEXT_TYPES.has(type) || SIGN_TYPES.has(type)) return false;
  return Boolean(String(field.prefilled_text || '').trim());
}

/** Parse `Field merchant_contact_phone validation failed.` → field name. */
export function parseSignNowPrefillValidationField(detail: string): string {
  const match = String(detail || '').match(
    /Field\s+([A-Za-z0-9 _.-]+?)\s+validation failed/i,
  );
  return match?.[1] ? String(match[1]).trim() : '';
}

/** Fixed style for baked / prefilled mapping text (contract, addenda, disclosures). */
const DEFAULT_FONT = 'Times New Roman';
const DEFAULT_FONT_SIZE = 10;
/**
 * Signer-typed widgets render smaller than baked `texts[]` at the same size.
 * 16pt matches the addendum / Exhibit C line face (date, merchant, guarantor).
 */
export const FILLABLE_FONT_SIZE = 16;
/** Thin template underlines shrink typed text; addendum widgets are ~24pt tall. */
export const CONTRACT_FILLABLE_MIN_HEIGHT = 24;

export function applySignNowFieldStyle(
  target: Record<string, unknown>,
  source: Record<string, unknown> = {},
  options?: { maxSize?: number },
): Record<string, unknown> {
  for (const key of STYLE_KEYS) {
    if (source[key] != null && source[key] !== '') {
      target[key] = source[key];
    }
  }
  target.font = DEFAULT_FONT;
  const maxSize = Number(options?.maxSize);
  const next =
    Number.isFinite(maxSize) && maxSize > 0 ? maxSize : DEFAULT_FONT_SIZE;
  target.size = next;
  target.font_size = next;
  if (!target.color) target.color = '000000';
  if (!target.valign) target.valign = 'middle';
  return target;
}

/** Face for the signer's signature and initials widgets, on every document. */
export const SIGNATURE_FIELD_FONT = 'Times New Roman';
export const SIGNATURE_FIELD_FONT_SIZE = 12;
const SIGNATURE_FONT_TYPES = new Set(['signature', 'initials']);
const SIGNATURE_FONT_KEYS = ['font', 'size', 'font_size'] as const;

/**
 * Box height that renders a signer's mark at a 12pt line. SignNow stores no
 * font on signature / initials widgets (their JSON is only x, y, width, height,
 * name, required, page_number, allowed_types) and scales the drawn or typed mark
 * to fill the box, so the template's 40×41pt initials boxes printed initials
 * roughly 30pt tall no matter what face was requested. The height is the size.
 */
export const SIGNATURE_FIELD_HEIGHT = 16;

/**
 * Signature / initials widgets: Times New Roman 12 face, and a box sized to a
 * 12pt line. A taller box is shrunk around its own vertical centre, so the mark
 * stays on the same printed line; a box already that small is left alone, which
 * keeps repeated publishes from moving it.
 */
export function applySignNowSignatureFieldFont(
  field: Record<string, unknown>,
): Record<string, unknown> {
  if (!SIGNATURE_FONT_TYPES.has(String(field.type || '').toLowerCase())) return field;
  field.font = SIGNATURE_FIELD_FONT;
  field.size = SIGNATURE_FIELD_FONT_SIZE;
  field.font_size = SIGNATURE_FIELD_FONT_SIZE;
  const height = Number(field.height);
  const y = Number(field.y);
  if (Number.isFinite(height) && Number.isFinite(y) && height > SIGNATURE_FIELD_HEIGHT) {
    field.y = Math.round(y + (height - SIGNATURE_FIELD_HEIGHT) / 2);
    field.height = SIGNATURE_FIELD_HEIGHT;
  }
  return field;
}

/**
 * The same fields without the signature face — the last-resort body if SignNow
 * ever refuses a PUT because of it, so a send never fails over a font.
 */
export function withoutSignNowSignatureFieldFont(
  fields: Record<string, unknown>[],
): Record<string, unknown>[] {
  return fields.map((field) => {
    if (!SIGNATURE_FONT_TYPES.has(String(field.type || '').toLowerCase())) return field;
    const next = { ...field };
    for (const key of SIGNATURE_FONT_KEYS) delete next[key];
    return next;
  });
}

export function hasSignNowSignatureFieldFont(fields: Record<string, unknown>[]): boolean {
  return fields.some(
    (field) =>
      SIGNATURE_FONT_TYPES.has(String(field.type || '').toLowerCase()) && field.font != null,
  );
}

/** Keep the SignNow template face (do not force 10pt — that shrinks contract widgets). */
export function copySignNowTemplateStyle(
  target: Record<string, unknown>,
  source: Record<string, unknown> = {},
): Record<string, unknown> {
  for (const key of STYLE_KEYS) {
    if (source[key] != null && source[key] !== '') {
      target[key] = source[key];
    }
  }
  return target;
}

/** Merchant-typed fillable fields: addendum-sized face, tall enough to render it. */
export function applyContractFillableFont(
  field: Record<string, unknown>,
  options?: { maxSize?: number },
): Record<string, unknown> {
  const fillableSize =
    Number.isFinite(Number(options?.maxSize)) && Number(options?.maxSize) > 0
      ? Number(options?.maxSize)
      : FILLABLE_FONT_SIZE;
  applySignNowFieldStyle(field, field, { maxSize: fillableSize });
  field.size = fillableSize;
  field.font_size = fillableSize;
  field.font = DEFAULT_FONT;
  field.valign = 'middle';
  const height = Number(field.height) || 0;
  if (height < CONTRACT_FILLABLE_MIN_HEIGHT) {
    field.height = CONTRACT_FILLABLE_MIN_HEIGHT;
  }
  delete field.stretch_mode;
  delete field.line_height;
  const attrs =
    field.json_attributes && typeof field.json_attributes === 'object'
      ? { ...(field.json_attributes as Record<string, unknown>) }
      : {};
  attrs.size = fillableSize;
  attrs.font_size = fillableSize;
  attrs.font = DEFAULT_FONT;
  attrs.valign = 'middle';
  delete attrs.stretch_mode;
  delete attrs.line_height;
  field.json_attributes = attrs;
  return field;
}

export function sanitizeSignNowPutFields(
  fields: Record<string, unknown>[],
): Record<string, unknown>[] {
  return fields.map((field) => {
    const next = { ...field };
    if (!canLockSignNowPrefill(next)) {
      delete next.lock_to_sign_prefill;
    }
    return next;
  });
}

/** Label suffix an earlier build added to Exhibit C copies; it showed as a placeholder. */
const EXHIBIT_C_COPY_LABEL_SUFFIX = /\s*\(copy \d+\)\s*$/i;
/** Widget-name suffix that keeps an Exhibit C copy's widgets apart in Review. */
const EXHIBIT_C_COPY_NAME_SUFFIX = /__copy\d+$/i;

/** The widget name without the Review-only copy suffix (`ach_bank_name_p1__copy2` → `ach_bank_name_p1`). */
export function stripExhibitCCopyFieldName(name: unknown): string {
  return String(name ?? '').replace(EXHIBIT_C_COPY_NAME_SUFFIX, '');
}

/**
 * Give every widget on an Exhibit C copy a *name* no other document carries.
 *
 * Every copy is made from one template, and SignNow links same-named widgets
 * across the documents of a group in the Owner's review session, so
 * `Exhibit C (2)` showed Exhibit C #1's values over its own prefill. A unique
 * label did not break that link (and surfaced as the `ach_bank_portal_p1
 * (copy 2)` placeholder); only the name does. The merchant send never showed
 * it, because its values are baked as page text.
 *
 * Everything else in the backend keeps working on the original names: the
 * SignNow client strips the suffix from every document it reads
 * (`normalizeExhibitCCopyFieldNames`), and the merchant publish writes the
 * original names back. The label an earlier build appended is removed too.
 *
 * `copyNumber` is 1-based (`Exhibit C (2)` → 2). Returns how many were renamed.
 */
export function nameExhibitCCopyFieldsForReview(
  fields: Record<string, unknown>[],
  copyNumber: number,
): number {
  if (!Number.isFinite(copyNumber) || copyNumber < 2) return 0;
  let renamed = 0;
  for (const field of fields) {
    const type = String(field.type || 'text').toLowerCase();
    if (SIGN_TYPES.has(type)) continue;
    const base = stripExhibitCCopyFieldName(field.name).trim();
    if (!base) continue;
    field.name = `${base}__copy${copyNumber}`;
    clearExhibitCCopyLabel(field, base);
    renamed += 1;
  }
  return renamed;
}

/**
 * Remove the `(copy N)` labels an earlier build wrote onto Exhibit C copies —
 * on every publish, so a merchant never sees `ach_bank_portal_p1 (copy 2)` as a
 * placeholder in a box they have to fill. Returns how many were cleaned.
 */
export function clearExhibitCCopyLabels(fields: Record<string, unknown>[]): number {
  let cleaned = 0;
  for (const field of fields) {
    const before = JSON.stringify([field.label, (field.json_attributes as any)?.label]);
    clearExhibitCCopyLabel(field, stripExhibitCCopyFieldName(field.name).trim());
    if (JSON.stringify([field.label, (field.json_attributes as any)?.label]) !== before) cleaned += 1;
  }
  return cleaned;
}

/** Drop the `(copy N)` label an earlier build wrote; a label that was just the name goes. */
function clearExhibitCCopyLabel(field: Record<string, unknown>, baseName: string): void {
  const strip = (target: Record<string, unknown>) => {
    const label = String(target.label ?? '');
    if (!EXHIBIT_C_COPY_LABEL_SUFFIX.test(label)) return;
    const base = label.replace(EXHIBIT_C_COPY_LABEL_SUFFIX, '').trim();
    if (!base || base === baseName) delete target.label;
    else target.label = base;
  };
  strip(field);
  if (field.json_attributes && typeof field.json_attributes === 'object') {
    const attrs = { ...(field.json_attributes as Record<string, unknown>) };
    strip(attrs);
    field.json_attributes = attrs;
  }
}

/**
 * Strip the Review-only copy suffix from every widget of a SignNow document
 * (or of each document in a group payload), in place. Applied to every read
 * so name-based logic — prefill resolution, merchant-required widgets, review
 * checks — never sees the suffix, and the merchant publish restores the names.
 */
export function normalizeExhibitCCopyFieldNames<T>(payload: T): T {
  const visitDoc = (doc: any) => {
    if (!doc || typeof doc !== 'object') return;
    for (const key of ['fields', 'fillable_fields', 'texts', 'signatures', 'initials', 'checks']) {
      const rows = doc[key];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        for (const prop of ['name', 'field_name'] as const) {
          if (typeof row[prop] === 'string' && EXHIBIT_C_COPY_NAME_SUFFIX.test(row[prop])) {
            row[prop] = stripExhibitCCopyFieldName(row[prop]);
          }
        }
        const attrs = row.json_attributes;
        if (attrs && typeof attrs === 'object' && typeof attrs.name === 'string') {
          attrs.name = stripExhibitCCopyFieldName(attrs.name);
        } else if (typeof attrs === 'string' && /__copy\d+/i.test(attrs)) {
          try {
            const parsed = JSON.parse(attrs);
            if (parsed && typeof parsed.name === 'string') {
              parsed.name = stripExhibitCCopyFieldName(parsed.name);
              row.json_attributes = JSON.stringify(parsed);
            }
          } catch {
            /* leave an unparseable attribute blob as it is */
          }
        }
      }
    }
  };
  const data: any = payload;
  visitDoc(data);
  if (Array.isArray(data?.documents)) data.documents.forEach(visitDoc);
  return payload;
}

export function signNowPrefillTextPayload(
  fields: Record<string, unknown>[],
): Array<{ field_name: string; prefilled_text: string }> {
  const out: Array<{ field_name: string; prefilled_text: string }> = [];
  const seen = new Set<string>();
  for (const field of fields) {
    const type = String(field.type || 'text').toLowerCase();
    if (NON_TEXT_TYPES.has(type) || SIGN_TYPES.has(type)) continue;
    const name = String(field.name || '').trim();
    const value = String(field.prefilled_text || '').trim();
    if (!name || !value || seen.has(name)) continue;
    if (/checkbox|checkmark|radio/i.test(name)) continue;
    seen.add(name);
    out.push({ field_name: name, prefilled_text: value });
  }
  return out;
}

/**
 * Baked `texts[]` stamps are plain page text: SignNow renders them on one line
 * from `x`/`y` and ignores the widget's `width`/`height`, so a long value (an
 * owner's full street address) runs straight across the page and over whatever
 * sits in the next column — the Owner #1 address printing through the Owner #2
 * "Address:" label. Enlarging the widget in the template cannot fix it, because
 * nothing about the box reaches the stamp. So the wrapping has to happen here:
 * measure the value, and emit one stamp per line inside the widget's box.
 *
 * Times New Roman advance widths, in 1/1000 em (Adobe's Times-Roman metrics).
 * Only the characters CRM values actually contain are listed; anything else
 * falls back to a middling 500.
 */
const TIMES_CHAR_WIDTHS: Record<string, number> = {
  ' ': 250, '!': 333, '"': 408, '#': 500, '$': 500, '%': 833, '&': 778, "'": 180,
  '(': 333, ')': 333, '*': 500, '+': 564, ',': 250, '-': 333, '.': 250, '/': 278,
  '0': 500, '1': 500, '2': 500, '3': 500, '4': 500, '5': 500, '6': 500, '7': 500,
  '8': 500, '9': 500, ':': 278, ';': 278, '<': 564, '=': 564, '>': 564, '?': 444,
  '@': 921, 'A': 722, 'B': 667, 'C': 667, 'D': 722, 'E': 611, 'F': 556, 'G': 722,
  'H': 722, 'I': 333, 'J': 389, 'K': 722, 'L': 611, 'M': 889, 'N': 722, 'O': 722,
  'P': 556, 'Q': 722, 'R': 667, 'S': 556, 'T': 611, 'U': 722, 'V': 722, 'W': 944,
  'X': 722, 'Y': 722, 'Z': 611, '[': 333, ']': 333, '_': 500, 'a': 444, 'b': 500,
  'c': 444, 'd': 500, 'e': 444, 'f': 333, 'g': 500, 'h': 500, 'i': 278, 'j': 278,
  'k': 500, 'l': 278, 'm': 778, 'n': 500, 'o': 500, 'p': 500, 'q': 500, 'r': 333,
  's': 389, 't': 278, 'u': 500, 'v': 500, 'w': 722, 'x': 500, 'y': 500, 'z': 444,
};

const DEFAULT_CHAR_WIDTH = 500;
/** Line spacing as a multiple of the font size, matching the template's face. */
const BAKED_LINE_SPACING = 1.2;
/** Never shrink a stamp past this — below it the value stops being readable. */
const MIN_BAKED_FONT_SIZE = 7;
/**
 * The widget box is drawn a little wider than the printed rule, and SignNow's
 * renderer is not pixel-identical to these metrics, so leave a small margin
 * rather than filling the box to its last point.
 */
const BAKED_WIDTH_MARGIN = 2;

export function measureSignNowTextWidth(text: string, size: number): number {
  let units = 0;
  for (const char of String(text ?? '')) {
    units += TIMES_CHAR_WIDTHS[char] ?? DEFAULT_CHAR_WIDTH;
  }
  return (units / 1000) * (Number(size) || DEFAULT_FONT_SIZE);
}

/**
 * Greedy word wrap on the measured width. A single word too long for the line
 * (an unbroken email or URL) is split by character rather than left to overflow,
 * because overflow is what collides with the neighbouring column.
 */
export function wrapSignNowText(
  text: string,
  width: number,
  size: number,
): string[] {
  const value = String(text ?? '').trim();
  const limit = Number(width) || 0;
  if (!value) return [];
  if (limit <= 0 || measureSignNowTextWidth(value, size) <= limit) return [value];
  const lines: string[] = [];
  let line = '';
  const push = () => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of value.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measureSignNowTextWidth(candidate, size) <= limit) {
      line = candidate;
      continue;
    }
    push();
    if (measureSignNowTextWidth(word, size) <= limit) {
      line = word;
      continue;
    }
    let chunk = '';
    for (const char of word) {
      if (chunk && measureSignNowTextWidth(chunk + char, size) > limit) {
        lines.push(chunk);
        chunk = '';
      }
      chunk += char;
    }
    line = chunk;
  }
  push();
  return lines.length ? lines : [value];
}

/**
 * Fit a value into the widget's box: wrap onto as many lines as the height
 * allows, and when even that is not enough, step the font size down until it
 * fits. The value is never truncated — a slightly smaller stamp is always
 * better than a lost or overlapping one.
 */
export function fitSignNowTextToBox(
  data: string,
  width: number,
  height: number,
  size: number,
): { lines: string[]; size: number; lineHeight: number } {
  const boxWidth = Math.max(0, (Number(width) || 0) - BAKED_WIDTH_MARGIN);
  const boxHeight = Number(height) || 0;
  const startSize = Number(size) || DEFAULT_FONT_SIZE;
  if (!boxWidth) {
    return {
      lines: [String(data ?? '').trim()],
      size: startSize,
      lineHeight: startSize * BAKED_LINE_SPACING,
    };
  }
  /**
   * A widget only as tall as its own line (the ACH and page-23 address rules)
   * has no room for a second line: wrapping there would print over whatever
   * follows underneath. Those values are shrunk to fit instead.
   */
  const singleLineOnly = boxHeight < 2 * startSize * BAKED_LINE_SPACING;
  if (singleLineOnly) {
    let fontSize = startSize;
    while (
      fontSize > MIN_BAKED_FONT_SIZE &&
      measureSignNowTextWidth(data, fontSize) > boxWidth
    ) {
      fontSize -= 1;
    }
    return {
      lines: [String(data ?? '').trim()],
      size: fontSize,
      lineHeight: fontSize * BAKED_LINE_SPACING,
    };
  }
  let fontSize = startSize;
  let lines = wrapSignNowText(data, boxWidth, fontSize);
  while (fontSize > MIN_BAKED_FONT_SIZE) {
    const lineHeight = fontSize * BAKED_LINE_SPACING;
    const maxLines = Math.max(1, Math.floor(boxHeight / lineHeight));
    if (lines.length <= maxLines) {
      return { lines, size: fontSize, lineHeight };
    }
    fontSize -= 1;
    lines = wrapSignNowText(data, boxWidth, fontSize);
  }
  return { lines, size: fontSize, lineHeight: fontSize * BAKED_LINE_SPACING };
}

/**
 * One stamp per wrapped line, each offset by the line height from the widget's
 * own anchor. Single-line values (the overwhelming majority) come back as the
 * one row `toSignNowCompletedText` has always produced.
 */
export function toSignNowCompletedTexts(
  field: Record<string, unknown>,
  options?: { maxSize?: number },
): Record<string, unknown>[] {
  const row = toSignNowCompletedText(field, options);
  if (!row) return [];
  const fit = fitSignNowTextToBox(
    String(row.data ?? ''),
    Number(field.width) || 0,
    Number(field.height) || 0,
    Number(row.size) || DEFAULT_FONT_SIZE,
  );
  if (fit.lines.length <= 1 && fit.size === Number(row.size)) return [row];
  const top = Number(row.y) || 0;
  return fit.lines.map((line, index) => ({
    ...row,
    data: line,
    size: fit.size,
    y: index === 0 ? top : Math.round(top + index * fit.lineHeight),
  }));
}

export function toSignNowCompletedText(
  field: Record<string, unknown>,
  options?: { maxSize?: number },
): Record<string, unknown> | null {
  const type = String(field.type || 'text').toLowerCase();
  if (NON_TEXT_TYPES.has(type)) return null;
  const data = String(field.prefilled_text || field.data || '').trim();
  if (!data || /^enter text$/i.test(data)) return null;
  const styled = applySignNowFieldStyle(
    {
      x: Number(field.x) || 0,
      y: Number(field.y) || 0,
      page_number: Number(field.page_number) || 0,
      width: field.width,
      height: field.height,
    },
    field,
    options,
  );
  const row: Record<string, unknown> = {
    data,
    x: styled.x,
    y: styled.y,
    page_number: styled.page_number,
    font: styled.font,
    size: styled.size,
    color: styled.color,
  };
  const name = String(field.name || '').trim();
  if (name) row.name = name;
  if (styled.line_height) row.line_height = styled.line_height;
  return row;
}

/**
 * Merchant view-only shows committed text elements, not locked prefilled fields.
 * Keep signatures/initials as fillable; stamp CRM values onto the page as texts.
 * Empty merchant-required slots (page-20 ACH, Exhibit C orange, page-22
 * references) stay fillable only when sending to the merchant.
 */
export function splitPrefillPutPayload(
  fields: Record<string, unknown>[],
  bakeFilledText: boolean,
  options?: {
    maxSize?: number;
    keepEmptyMerchantRequired?: boolean;
    documentKind?: SignNowPrefillDocumentKind;
    /** Role that holds CRM-only widgets; its blank fields are not the merchant's to fill. */
    ownerRole?: string;
  },
): { fields: Record<string, unknown>[]; texts: Record<string, unknown>[] } {
  if (!bakeFilledText) {
    return { fields, texts: [] };
  }
  const fillable: Record<string, unknown>[] = [];
  const texts: Record<string, unknown>[] = [];
  for (const field of fields) {
    const type = String(field.type || 'text').toLowerCase();
    if (NON_TEXT_TYPES.has(type)) {
      fillable.push(field);
      continue;
    }
    const prefillOpts = options?.documentKind
      ? { documentKind: options.documentKind }
      : undefined;
    const isMerchantRequired =
      isDedicatedExhibitCRequiredField(String(field.name || '')) ||
      isMerchantRequiredSignerField(
        String(field.name || ''),
        Number(field.page_number),
        prefillOpts,
      );
    const value = String(field.prefilled_text || field.data || '').trim();
    const empty = !value || /^enter text$/i.test(value);
    /**
     * Every blank widget the template assigned to a signer has to survive the
     * publish. Keying off the hardcoded name whitelist (or off `required`, which
     * SignNow does not report on these widgets) meant the page-22 reference,
     * landlord and emergency slots fell through to `toSignNowCompletedText` —
     * which returns null for an empty value — so they were deleted outright.
     * The signer saw bare underlines and SignNow had no field left to enforce.
     *
     * The template's own `required` flag rides along untouched: required widgets
     * block Finish, optional ones stay optional. Blank CRM/Owner-held widgets
     * are still dropped, so nothing the merchant should not see comes back.
     */
    const templateRequired =
      field.required === true || String(field.required ?? '').toLowerCase() === 'true';
    const role = String(field.role || '').trim();
    const ownerRole = String(options?.ownerRole || '').trim();
    const signerAssigned =
      Boolean(role) &&
      !/^owner$/i.test(role) &&
      (!ownerRole || role.toLowerCase() !== ownerRole.toLowerCase());
    // The Notification of Assignment merchant list is deliberately left blank.
    const keepBlank = /assignment_merchant_line/i.test(String(field.name || ''));
    const merchantFillable =
      empty &&
      Boolean(options?.keepEmptyMerchantRequired) &&
      !keepBlank &&
      (isMerchantRequired || templateRequired || signerAssigned);
    if (merchantFillable) {
      const next = { ...field };
      if (
        usesAddendumFillableFont(
          String(field.name || ''),
          Number(field.page_number),
          prefillOpts,
        )
      ) {
        applyContractFillableFont(next, options);
      }
      fillable.push(next);
      continue;
    }
    for (const text of toSignNowCompletedTexts(field, options)) {
      texts.push(text);
    }
  }
  return { fields: fillable, texts: dropOverlappingDuplicateTexts(texts) };
}

/**
 * Two widgets on the same spot carrying the same CRM value bake two stamps, and
 * `PUT /document/{id}` prints both — the `10  10` the merchant saw in the
 * Obsidian agreement's SPECIFIED PERCENTAGE cell, where the named percent
 * widget and the template's leftover `Text Field 25` sit on top of each other.
 *
 * Unlike `dropBakedTextsAlreadyStamped` (which compares this send against
 * stamps an earlier send left behind) this collapses duplicates *within* one
 * publish, before anything is written. Only an identical value is dropped, so
 * no information can be lost: the surviving stamp renders exactly what the
 * dropped one would have. The window is the same narrow one used for stale
 * stamps — legitimate repeats of a value on one line (the `$` column markers,
 * the two signature dates) sit 90pt or more apart.
 */
export function dropOverlappingDuplicateTexts(
  texts: Record<string, unknown>[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const row of texts) {
    const data = String(row.data ?? '').trim();
    const duplicate = out.some(
      (kept) =>
        String(kept.data ?? '').trim() === data &&
        (Number(kept.page_number) || 0) === (Number(row.page_number) || 0) &&
        Math.abs((Number(kept.x) || 0) - (Number(row.x) || 0)) <= DUPLICATE_STAMP_DX &&
        Math.abs((Number(kept.y) || 0) - (Number(row.y) || 0)) <= DUPLICATE_STAMP_DY,
    );
    if (!duplicate) out.push(row);
  }
  return out;
}

/**
 * Page text already committed onto a document by an earlier publish.
 *
 * `PUT /document/{id}` REPLACES `fields` but only ever APPENDS `texts` — the
 * element id in the payload is ignored and `texts: []` is a no-op. So a second
 * merchant publish stamps its values on top of the first set instead of
 * replacing it, and both render: that is the two Exhibit C values overlapping on
 * the Account Holder / Bank lines once an Exhibit C (2) copy is added and the
 * package is sent again. `DELETE /document/{id}/text/{textId}` is the only way
 * to clear them (it drops every text element on the document, not just the id
 * passed), so a re-publish has to clear first and then write the full set.
 */
export type CommittedSignNowText = {
  id: string;
  page_number: number;
  x: number;
  y: number;
  data: string;
  raw: Record<string, unknown>;
};

export function collectCommittedSignNowTexts(remote: unknown): CommittedSignNowText[] {
  const rows = Array.isArray((remote as Record<string, unknown>)?.texts)
    ? ((remote as Record<string, unknown>).texts as Record<string, unknown>[])
    : [];
  const out: CommittedSignNowText[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const data = String(row.data ?? '').trim();
    if (!data) continue;
    out.push({
      id: String(row.id ?? '').trim(),
      page_number: Number(row.page_number) || 0,
      x: Number(row.x) || 0,
      y: Number(row.y) || 0,
      data,
      raw: row,
    });
  }
  return out;
}

/** Two stamps land on the same line when their anchors are within a few points. */
const TEXT_SPOT_TOLERANCE = 6;

export function isSameSignNowTextSpot(
  a: { page_number?: unknown; x?: unknown; y?: unknown },
  b: { page_number?: unknown; x?: unknown; y?: unknown },
  tolerance = TEXT_SPOT_TOLERANCE,
): boolean {
  if ((Number(a.page_number) || 0) !== (Number(b.page_number) || 0)) return false;
  return (
    Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) <= tolerance &&
    Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) <= tolerance
  );
}

/**
 * An earlier stamp carrying the same value a few points off this send's stamp is
 * that value's previous copy, not a second value: once a widget's text is baked
 * the widget leaves `fields`, so the next send no longer holds a spot for it and
 * the anchor-based checks above cannot recognise it. Measured on a live Obsidian
 * group, the page-1 money row drifted 4-15pt horizontally and 2-4pt vertically
 * between sends, which is why `$ 10,000.00` printed twice.
 *
 * Window is deliberately narrow: legitimate repeats of one value on a single
 * line (the `$` column markers, the two signature dates) sit 90pt or more apart.
 */
const DUPLICATE_STAMP_DX = 60;
const DUPLICATE_STAMP_DY = 8;

function isStaleDuplicateStamp(
  baked: { page_number?: unknown; x?: unknown; y?: unknown; data?: unknown },
  old: CommittedSignNowText,
): boolean {
  if ((Number(baked.page_number) || 0) !== old.page_number) return false;
  const data = String(baked.data ?? '').trim();
  if (!data || data !== old.data) return false;
  return (
    Math.abs((Number(baked.x) || 0) - old.x) <= DUPLICATE_STAMP_DX &&
    Math.abs((Number(baked.y) || 0) - old.y) <= DUPLICATE_STAMP_DY
  );
}

/**
 * Baked values an earlier publish already stamped on the page, for the case where
 * the clear failed — SignNow refuses text deletes once the group is out for
 * signature. Writing them again would append a second copy next to the first, so
 * the duplicates are dropped and the surviving stamp stands.
 */
export function dropBakedTextsAlreadyStamped(
  bakedTexts: Record<string, unknown>[],
  committed: readonly CommittedSignNowText[],
): Record<string, unknown>[] {
  if (!committed.length) return bakedTexts;
  return bakedTexts.filter((row) => !committed.some((old) => isStaleDuplicateStamp(row, old)));
}

/**
 * The exact `texts` set a re-publish should end with: this send's baked values,
 * plus any earlier stamp whose spot this send does not cover (agreement text
 * that no longer has a widget behind it must not be wiped by the clear).
 *
 * One value per spot, current value wins — so nothing can stack.
 */
export function mergeCommittedSignNowTexts(
  bakedTexts: Record<string, unknown>[],
  committed: readonly CommittedSignNowText[],
  options?:
    | number
    | {
        tolerance?: number;
        /**
         * Spots this send holds a widget for. Their old stamp is dropped even
         * when this send bakes nothing there — the CRM value behind it was
         * cleared or is now blank, so keeping the stamp would show a value the
         * application no longer has.
         */
        ownedSpots?: ReadonlyArray<{ page_number?: unknown; x?: unknown; y?: unknown }>;
      },
): Record<string, unknown>[] {
  const tolerance =
    typeof options === 'number' ? options : options?.tolerance ?? TEXT_SPOT_TOLERANCE;
  const ownedSpots = typeof options === 'number' ? [] : options?.ownedSpots ?? [];
  const out = [...bakedTexts];
  for (const old of committed) {
    const covered = out.some((row) => isSameSignNowTextSpot(row, old, tolerance));
    if (covered) continue;
    if (bakedTexts.some((row) => isStaleDuplicateStamp(row, old))) continue;
    if (ownedSpots.some((spot) => isSameSignNowTextSpot(spot, old, tolerance))) continue;
    // Re-send the old stamp without its id: SignNow assigns a fresh one anyway.
    const { id: _id, ...rest } = old.raw as Record<string, unknown>;
    out.push(rest);
  }
  return out;
}

/** Roles the preparer reviews a package under (see `isPreparerRole`). */
const REVIEW_ROLE_RE = /^(owner|approver|me)$|fill out|preparer|sender|verifier/i;

function fieldAttrs(field: Record<string, unknown>): Record<string, unknown> {
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

/**
 * Values the preparer changed by hand in the Owner Review, keyed by lower-cased
 * widget name.
 *
 * Review writes the CRM values as each Owner widget's `prefilled_text`; what the
 * preparer types over them is committed by SignNow as a page text element when
 * they click Finish — linked back through the widget's `element_id`, and placed
 * on the widget's own spot. The merchant send then re-resolved every widget from
 * the CRM, and the stamp of the edit sat on a spot the send owns, so it was
 * dropped: a refinance itemization corrected in Review ("Amount Given Directly
 * to You" 9,125.00) went out with the CRM's figure instead.
 *
 * Only an Owner widget whose committed text differs from what Review prefilled
 * counts. A merchant publish moves every filled widget off the Owner role and
 * bakes it, so a resend never mistakes an earlier bake's stamp for an edit.
 */
export function collectOwnerReviewEdits(remote: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const root = (remote || {}) as Record<string, unknown>;
  const texts = collectCommittedSignNowTexts(remote);
  if (!texts.length) return out;
  const byId = new Map(texts.filter((t) => t.id).map((t) => [t.id, t]));
  for (const container of ['fields', 'fillable_fields']) {
    const rows = Array.isArray(root[container]) ? (root[container] as unknown[]) : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const field = row as Record<string, unknown>;
      const attrs = fieldAttrs(field);
      const type = String(field.type || attrs.type || '').toLowerCase();
      if (NON_TEXT_TYPES.has(type)) continue;
      const role = String(field.role || attrs.role || attrs.role_name || '').trim();
      if (!REVIEW_ROLE_RE.test(role)) continue;
      const name = stripExhibitCCopyFieldName(
        String(attrs.name || field.name || field.field_name || '').trim(),
      ).toLowerCase();
      if (!name || out.has(name)) continue;
      const elementId = String(field.element_id ?? '').trim();
      const committed =
        (elementId && byId.get(elementId)) ||
        texts.find((t) =>
          isSameSignNowTextSpot(
            {
              page_number: field.page_number ?? attrs.page_number,
              x: field.x ?? attrs.x,
              y: field.y ?? attrs.y,
            },
            t,
          ),
        );
      if (!committed) continue;
      const prefilled = String(attrs.prefilled_text ?? field.prefilled_text ?? '').trim();
      if (committed.data === prefilled) continue;
      out.set(name, committed.data);
    }
  }
  return out;
}
