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
    const text = toSignNowCompletedText(field, options);
    if (text) texts.push(text);
  }
  return { fields: fillable, texts };
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
