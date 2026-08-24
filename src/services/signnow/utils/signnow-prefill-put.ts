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

const DEFAULT_MAX_FONT_SIZE = 9;

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
  if (!target.font) target.font = 'Arial';
  const size = Number(target.size || target.font_size || 0);
  const maxSize = Number(options?.maxSize);
  const cap =
    Number.isFinite(maxSize) && maxSize > 0 ? maxSize : DEFAULT_MAX_FONT_SIZE;
  if (!Number.isFinite(size) || size <= 0) {
    const height = Number(target.height || 0);
    const guessed = Math.max(8, Math.min(cap, Math.round(height > 2 ? height - 2 : 10)));
    target.size = guessed;
    target.font_size = guessed;
  } else {
    const next = Math.min(size, cap);
    target.size = next;
    target.font_size = next;
  }
  if (!target.color) target.color = '000000';
  return target;
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
 */
export function splitPrefillPutPayload(
  fields: Record<string, unknown>[],
  bakeFilledText: boolean,
  options?: { maxSize?: number },
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
    const text = toSignNowCompletedText(field, options);
    if (text) texts.push(text);
  }
  return { fields: fillable, texts };
}
