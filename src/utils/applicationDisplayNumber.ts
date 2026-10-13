/**
 * The application reference users see in the CRM ("Deal ID" column).
 * Prefers `Application.dealId` and falls back to the internal autoincrement
 * `Application.applicationId` only when no deal id is set — the same rule the
 * frontend Applications list uses, so emails / notifications / contracts match it.
 */
export function resolveApplicationDisplayNumber(
  app: { dealId?: string | null; applicationId?: number | string | null } | null | undefined,
): string {
  const dealId = String(app?.dealId ?? '').trim();
  if (dealId) return dealId;
  const appNumber = app?.applicationId;
  return appNumber != null ? String(appNumber).trim() : '';
}
