/** Matches backend bulk-import rules (KK → Katan II, KC → Katan III). */
export function deriveOrganizationFromDealId(
  dealIdRaw: string | null | undefined,
): string | null {
  let normalized = String(dealIdRaw ?? "").trim().toUpperCase();
  if (!normalized) return null;
  normalized = normalized.replace(/^['']+/g, "");
  const compact = normalized.replace(/[\s\-_/]+/g, "");
  if (compact.startsWith("KK")) return "Katan II";
  if (compact.startsWith("KC")) return "Katan III";
  return null;
}

export function getApplicationOrganizationDisplay(
  organization: string | null | undefined,
  dealId: string | null | undefined,
): string {
  const stored = organization?.trim();
  if (stored) return stored;
  return deriveOrganizationFromDealId(dealId) ?? "-";
}
