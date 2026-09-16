/**
 * Canonical display formats for phone numbers and SSNs across the CRM,
 * signing providers (SignNow / DocuSign / BoldSign) and generated PDFs.
 *
 *   phone -> XXX-XXX-XXXX
 *   ssn   -> XXX-XX-XXXX
 *
 * Matches the existing EIN convention (XX-XXXXXXX) in `services/einSanitizer.ts`.
 */

function digitsOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\D/g, '');
}

/**
 * Formats a phone-like value as XXX-XXX-XXXX.
 * Drops a leading US country code on 11-digit values. Values that do not hold
 * exactly 10 usable digits are returned trimmed and unchanged, so extensions or
 * international numbers are never silently mangled.
 */
export function formatUsPhone(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  let digits = digitsOf(raw);
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return raw;

  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Formats an SSN-like value as XXX-XX-XXXX.
 * Values that do not hold exactly 9 digits are returned trimmed and unchanged.
 */
export function formatSsn(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const digits = digitsOf(raw);
  if (digits.length !== 9) return raw;

  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

/** True for field names that hold a phone/mobile/fax number. */
export function isPhoneFieldName(name: unknown): boolean {
  const n = String(name ?? '').toLowerCase();
  return /(?:^|_)(?:phone|mobile|fax)(?:\d*)(?:_|$)/.test(n) || /phone_?number/.test(n);
}

/** True for field names that hold an SSN / social security number. */
export function isSsnFieldName(name: unknown): boolean {
  const n = String(name ?? '').toLowerCase();
  return /(?:^|_)ssn(?:\d*)(?:_|$)/.test(n) || /social_?security/.test(n) || /(?:^|_)ss(?:\d*)(?:_|$)/.test(n);
}

/** Digits-only fallback for widgets whose validator rejects dashes. */
export function digitsOnlyPhone(value: unknown): string {
  let digits = digitsOf(value);
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits;
}

export function digitsOnlySsn(value: unknown): string {
  return digitsOf(value);
}

/** What a signing provider told us about one widget, when the document was read. */
export type SigningWidgetInfo = {
  /** Widget type as reported by the provider, e.g. `text`, `numeric`, `dropdown`. */
  type?: string | null;
  /** Provider validator attached to the widget, e.g. SignNow's Number validator. */
  validatorId?: string | null;
};

const PLAIN_TEXT_WIDGET_TYPES = new Set(['', 'text', 'textarea', 'string']);

/**
 * True when a widget accepts a dashed value such as `561-577-8267`.
 *
 * SignNow's Number/phone validators reject dashes, and a single invalid value
 * rejects the WHOLE prefill-texts batch, leaving the agreement blank. So this is
 * deliberately conservative: dashes are only allowed on a plain text widget with
 * no validator attached. An unknown widget (`undefined`) is treated as unsafe.
 */
export function widgetAcceptsDashes(widget?: SigningWidgetInfo): boolean {
  if (!widget) return false;
  if (String(widget.validatorId ?? '').trim()) return false;
  return PLAIN_TEXT_WIDGET_TYPES.has(String(widget.type ?? '').toLowerCase().trim());
}
