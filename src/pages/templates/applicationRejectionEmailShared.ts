export const APPLICATION_REJECTION_EMAIL_SUBJECT = "Application Rejected";

/** Decline email subject — includes business name when available. */
export function buildApplicationRejectionEmailSubject(
  businessName?: string | null,
): string {
  const business = String(businessName || "").trim();
  return business
    ? `${APPLICATION_REJECTION_EMAIL_SUBJECT} — ${business}`
    : APPLICATION_REJECTION_EMAIL_SUBJECT;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ApplicationRejectionEmailFields = {
  clientName: string;
  primaryReason: string;
  otherReasons: string;
};

export function resolveApplicationRejectionEmailFields(
  values: Record<string, string | undefined>,
): ApplicationRejectionEmailFields {
  const clientName =
    String(values.client_name || "").trim() || "Valued Partner";
  const primaryReason =
    String(values.primary_reason || "").trim() ||
    "Does not meet underwriting criteria";
  const otherReasons = String(values.other_reasons || "").trim();

  return {
    clientName,
    primaryReason,
    otherReasons,
  };
}
