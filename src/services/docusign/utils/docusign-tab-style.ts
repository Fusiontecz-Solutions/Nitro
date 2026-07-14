/** DocuSign prefill styling — contract, ACH, and addendum templates all use Arial. */
export const DOCUSIGN_PREFILL_FONT = 'arial';
export const DOCUSIGN_PREFILL_FONT_COLOR = 'black';

/** Map layout tab height (px) to DocuSign fontSize token (templates mostly use size9). */
export function docuSignFontSizeFromTabHeight(height?: string | number): string {
  const h = parseFloat(String(height ?? '19')) || 19;
  if (h <= 14) return 'size7';
  if (h <= 17) return 'size8';
  return 'size9';
}

/** Resolve DocuSign fontSize token from explicit pt size or tab height. */
export function resolveDocuSignFontSizeToken(options?: {
  fontSize?: string | number;
  height?: string | number;
}): string {
  const explicit = parseFloat(String(options?.fontSize ?? '').trim());
  if (Number.isFinite(explicit) && explicit > 0) {
    const rounded = Math.round(explicit);
    if (rounded <= 7) return 'size7';
    if (rounded === 8) return 'size8';
    if (rounded === 9) return 'size9';
    if (rounded === 10) return 'size10';
    if (rounded === 11) return 'size11';
    if (rounded === 12) return 'size12';
    if (rounded <= 14) return 'size14';
    if (rounded <= 16) return 'size16';
    if (rounded <= 18) return 'size18';
    if (rounded <= 22) return 'size22';
    if (rounded <= 24) return 'size24';
    if (rounded <= 26) return 'size26';
    if (rounded <= 28) return 'size28';
    if (rounded <= 32) return 'size32';
    if (rounded <= 36) return 'size36';
    if (rounded <= 42) return 'size42';
    if (rounded <= 48) return 'size48';
    if (rounded <= 54) return 'size54';
    if (rounded <= 60) return 'size60';
    if (rounded <= 66) return 'size66';
    return 'size72';
  }
  return docuSignFontSizeFromTabHeight(options?.height);
}

export function applyDocuSignPrefillTabStyle<T extends Record<string, string | undefined>>(
  tab: T,
  options?: { height?: string | number; fontSize?: string | number },
): T & { font: string; fontColor: string; fontSize: string } {
  return {
    ...tab,
    font: DOCUSIGN_PREFILL_FONT,
    fontColor: DOCUSIGN_PREFILL_FONT_COLOR,
    fontSize: resolveDocuSignFontSizeToken(options),
  };
}

/** Approximate DocuSign text-tab width (px) so the field hugs prefilled content. */
export function docuSignTextTabWidthForValue(
  value: string,
  height?: string | number,
  fontSizePt?: string | number,
): string {
  const text = String(value || '').trim();
  if (!text) return '12';
  const explicit = parseFloat(String(fontSizePt ?? '').trim());
  const h = parseFloat(String(height ?? '19')) || 19;
  const fontSize =
    Number.isFinite(explicit) && explicit > 0
      ? explicit
      : Math.min(11, Math.max(7, Math.round(h * 0.55)));
  // Tight fit to glyph width only — no padded “extra” tab width.
  const pxPerChar = fontSize * 0.55;
  const fit = Math.ceil(text.length * pxPerChar) + 1;
  return String(Math.max(8, Math.min(fit, 360)));
}

/**
 * Width for a prefilled tab: fit to value length.
 * Layout `width` is only a max cap when set to a positive number; `auto` / omitted = fit only.
 */
export function resolveDocuSignPrefillTabWidth(options: {
  value: string;
  height?: string | number;
  layoutWidth?: string | number;
  fontSize?: string | number;
}): string {
  const configured = parseFloat(String(options.layoutWidth ?? '').trim());
  const text = String(options.value || '').trim();
  if (!text && Number.isFinite(configured) && configured > 0) {
    return String(configured);
  }
  const fit = docuSignTextTabWidthForValue(
    options.value,
    options.height,
    options.fontSize,
  );
  if (!Number.isFinite(configured) || configured <= 0) return fit;
  return String(Math.min(configured, parseFloat(fit) || configured));
}
