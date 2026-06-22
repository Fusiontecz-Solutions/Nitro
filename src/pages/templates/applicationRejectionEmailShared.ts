export const APPLICATION_REJECTION_EMAIL_SUBJECT = "Application Rejected";

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
