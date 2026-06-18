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

export function applyDocuSignPrefillTabStyle<T extends Record<string, string | undefined>>(
  tab: T,
  options?: { height?: string | number },
): T & { font: string; fontColor: string; fontSize: string } {
  return {
    ...tab,
    font: DOCUSIGN_PREFILL_FONT,
    fontColor: DOCUSIGN_PREFILL_FONT_COLOR,
    fontSize: docuSignFontSizeFromTabHeight(options?.height),
  };
}

/** Approximate DocuSign text-tab width (px) so the field hugs prefilled content. */
export function docuSignTextTabWidthForValue(
  value: string,
  height?: string | number,
): string {
  const text = String(value || '').trim();
  if (!text) return '20';
  const h = parseFloat(String(height ?? '19')) || 19;
  const fontSize = Math.min(11, Math.max(7, Math.round(h * 0.55)));
  const pxPerChar = fontSize * 0.58;
  const fit = Math.ceil(text.length * pxPerChar) + 6;
  return String(Math.max(20, Math.min(fit, 220)));
}

/**
 * Width for a prefilled tab: fit to value length.
 * Layout `width` is only a max cap when set to a positive number; `auto` / omitted = fit only.
 */
export function resolveDocuSignPrefillTabWidth(options: {
  value: string;
  height?: string | number;
  layoutWidth?: string | number;
}): string {
  const configured = parseFloat(String(options.layoutWidth ?? '').trim());
  const text = String(options.value || '').trim();
  if (!text && Number.isFinite(configured) && configured > 0) {
    return String(configured);
  }
  const fit = docuSignTextTabWidthForValue(options.value, options.height);
  if (!Number.isFinite(configured) || configured <= 0) return fit;
  return String(Math.min(configured, parseFloat(fit) || configured));
}
