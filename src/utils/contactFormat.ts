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
 *
 * Drops a leading US country code on 11-digit values, then groups the digits
 * 3-3-rest so every phone/mobile/business-phone blank on an agreement prints
 * dashed — a short 9-digit entry renders `882-768-828` rather than the bare
 * `882768828` the CRM used to stamp.
 *
 * Values that cannot be grouped safely are returned trimmed and unchanged:
 * fewer than 7 digits (partial entry), or more than 10 after the country code
 * is dropped (an extension such as `555-123-4567 x89`, or an international
 * number), so nothing is silently mangled.
 */
export function formatUsPhone(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  let digits = digitsOf(raw);
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length < 7 || digits.length > 10) return raw;

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

/**
 * True for field names that hold a phone / mobile / business-phone / fax number.
 *
 * Templates spell these every which way — `owner2_phone`, `authorized_business_phone`,
 * `telephone`, `cell_phone`, `ownerMobileNumber`, `preferred_phone_number` — so the
 * three patterns below cover underscore-delimited names, `<kind>number`/`<kind>no`
 * suffixes, and run-together camelCase names once lowercased. Deliberately narrow
 * around the bare word `number`: `routing_number`, `account_number` and
 * `ein_number` must NOT be dashed as phones.
 */
export function isPhoneFieldName(name: unknown): boolean {
  const n = String(name ?? '').toLowerCase();
  return (
    /(?:^|_)(?:phone|telephone|mobile|cell|fax|tel)(?:\d*)(?:_|$)/.test(n) ||
    /(?:phone|telephone|mobile|cell|fax)_?(?:number|num|no)(?:\d*)(?:_|$)/.test(n) ||
    /(?:phone|telephone|mobile|cell|fax)(?:number|num|no)?(?:\d*)$/.test(n)
  );
}

/** True for field names that hold an SSN / social security number. */
export function isSsnFieldName(name: unknown): boolean {
  const n = String(name ?? '').toLowerCase();
  return /(?:^|_)ssn(?:\d*)(?:_|$)/.test(n) || /social_?security/.test(n) || /(?:^|_)ss(?:\d*)(?:_|$)/.test(n);
}

/**
 * Builds a single "street, city, state zip" line from separate address parts.
 *
 * Several signing-provider widgets (e.g. the Guarantor / Signer 1 / Recipient 1
 * address line on a signature page) hold the whole address in one field with no
 * companion city/state/zip widgets nearby, unlike the business address block
 * elsewhere in the same package. Composing here keeps that single line from
 * printing street-only while the paired city/state/zip fields (which DO exist
 * as their own widgets on other pages) are left untouched.
 */
export function composeFullAddress(
  street: unknown,
  city: unknown,
  state: unknown,
  zip: unknown,
): string {
  const streetPart = String(street ?? '').trim();
  const cityPart = String(city ?? '').trim();
  const statePart = String(state ?? '').trim();
  const zipPart = String(zip ?? '').trim();
  const cityStateZip = [cityPart, [statePart, zipPart].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  if (!streetPart) return cityStateZip;
  if (!cityStateZip) return streetPart;
  return `${streetPart}, ${cityStateZip}`;
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
