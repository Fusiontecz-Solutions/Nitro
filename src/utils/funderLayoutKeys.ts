/** Mirrors backend `funderContractLayout.ts` slug rules for template lookup. */

export function slugifyFunderDocumentToken(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function funderDisclosureLayoutKeyForState(
  funderId: string,
  state: string,
  frequency: string,
): string {
  const id = String(funderId || "").trim();
  const stateToken = slugifyFunderDocumentToken(state);
  const freqToken = slugifyFunderDocumentToken(frequency);
  return `funder_${id}_disclosure_${stateToken}_${freqToken}`;
}

export function funderNamedAddendumLayoutKey(funderId: string, slug: string): string {
  const id = String(funderId || "").trim();
  const token = slugifyFunderDocumentToken(slug);
  return token ? `funder_${id}_addendum_${token}` : `funder_${id}_addendum`;
}

export const FUNDER_ADDENDUM_COORDINATE_LAYOUT_OPTIONS = [
  { value: "flex_addendum", label: "Flex addendum" },
  { value: "balance_transfer", label: "Balance transfer" },
  { value: "ach_authorization", label: "ACH authorization" },
] as const;

export const DISCLOSURE_FREQUENCY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
] as const;

export type FunderDocumentTemplateRow = {
  id: string;
  name: string;
  type: string;
  state: string | null;
  frequency: string | null;
  layoutKey: string | null;
  pdfUrl: string | null;
  createdAt: string;
};

export function isFunderDisclosureRow(row: FunderDocumentTemplateRow): boolean {
  return row.type === "disclosure" || String(row.layoutKey || "").includes("_disclosure_");
}

export function isFunderAddendumRow(row: FunderDocumentTemplateRow): boolean {
  const key = String(row.layoutKey || "");
  return (
    key.includes("_addendum_") ||
    key.endsWith("_flex_addendum") ||
    key.endsWith("_balance_transfer") ||
    key.endsWith("_ach_authorization")
  );
}
