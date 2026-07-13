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
  declineReasons: string[];
};

/** Delimiter for encoding multiple decline reasons in template values. */
export const DECLINE_REASONS_DELIMITER = "|||";

/**
 * Canonical decline reason options — used by the template playground to let
 * testers tick reasons instead of typing the delimited string by hand.
 */
export const DECLINE_REASON_OPTIONS = [
  "Bad balances",
  "Negative days",
  "Bouncing",
  "Returns",
  "Od fees",
  "Low revenue",
  "Low revenue construction",
  "Low revenue trucking",
  "No active position",
  "Not enough MCA history",
  "Behind reverse",
  "Leverage",
  "Recovery in file",
  "Recent default",
  "Active settlement",
  "Behind recent deals",
  "Low recent funding",
  "Behind scam company",
] as const;

/** Split selected decline reasons for the rejection email template. */
export function formatDeclineReasonsForEmail(reasons: string[]): {
  primaryReason: string;
  otherReasons: string;
  combinedReason: string;
  declineReasons: string;
} {
  const trimmed = reasons.map((r) => String(r).trim()).filter(Boolean);
  const primaryReason = trimmed[0] || "";
  const otherReasons = trimmed.slice(1).join(", ");
  const combinedReason = trimmed.join(", ");
  const declineReasons = trimmed.join(DECLINE_REASONS_DELIMITER);
  return { primaryReason, otherReasons, combinedReason, declineReasons };
}

/** Resolve every decline reason for display in the rejection email. */
export function resolveDeclineReasonsList(
  values: Record<string, string | undefined>,
): string[] {
  const encoded = String(values.decline_reasons || "").trim();
  if (encoded) {
    return encoded
      .split(DECLINE_REASONS_DELIMITER)
      .map((reason) => reason.trim())
      .filter(Boolean);
  }

  const primaryReason = String(values.primary_reason || "").trim();
  const otherReasons = String(values.other_reasons || "").trim();
  const fromLegacy: string[] = [];

  if (primaryReason) {
    fromLegacy.push(primaryReason);
  }
  if (otherReasons) {
    otherReasons
      .split(",")
      .map((reason) => reason.trim())
      .filter(Boolean)
      .forEach((reason) => fromLegacy.push(reason));
  }

  if (fromLegacy.length > 0) {
    return fromLegacy;
  }

  return ["Does not meet underwriting criteria"];
}

export const DECLINE_REASONS_PER_COLUMN = 5;

/** Split decline reasons into left (first 5) and right (remaining) columns. */
export function splitDeclineReasonsForColumns(
  reasons: string[],
  perColumn: number = DECLINE_REASONS_PER_COLUMN,
): { left: string[]; right: string[] } {
  const list = reasons.length
    ? reasons
    : ["Does not meet underwriting criteria"];
  return {
    left: list.slice(0, perColumn),
    right: list.slice(perColumn),
  };
}

function renderDeclineReasonBulletRow(
  reason: string,
  escapeFn: (value: string) => string,
  paddingBottom: number,
): string {
  return `
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:${paddingBottom}px;">
                                        <tr>
                                          <td style="font-size:18px;color:#da1e28;padding-right:8px;line-height:1;vertical-align:top;width:16px;">&bull;</td>
                                          <td style="font-family:Georgia,Times,serif;font-size:18px;font-weight:bold;color:#111111;line-height:1.3;vertical-align:top;">
                                            ${escapeFn(reason)}
                                          </td>
                                        </tr>
                                      </table>`;
}

function renderDeclineReasonColumnHtml(
  reasons: string[],
  escapeFn: (value: string) => string,
): string {
  if (reasons.length === 0) {
    return "&nbsp;";
  }

  return reasons
    .map((reason, index) =>
      renderDeclineReasonBulletRow(
        reason,
        escapeFn,
        index < reasons.length - 1 ? 12 : 0,
      ),
    )
    .join("");
}

/** Gmail/Outlook-safe two-column layout for decline reasons (5 per column). */
export function renderDeclineReasonsEmailRows(
  reasons: string[],
  escapeFn: (value: string) => string = escapeHtml,
): string {
  const { left, right } = splitDeclineReasonsForColumns(reasons);

  if (right.length === 0) {
    return `
                                  <tr>
                                    <td style="vertical-align:top;">
                                      ${renderDeclineReasonColumnHtml(left, escapeFn)}
                                    </td>
                                  </tr>`;
  }

  return `
                                  <tr>
                                    <td style="vertical-align:top;">
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                        <tr>
                                          <td width="50%" valign="top" style="width:50%;padding-right:10px;vertical-align:top;">
                                            ${renderDeclineReasonColumnHtml(left, escapeFn)}
                                          </td>
                                          <td width="50%" valign="top" style="width:50%;padding-left:10px;vertical-align:top;">
                                            ${renderDeclineReasonColumnHtml(right, escapeFn)}
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                  </tr>`;
}

export function resolveApplicationRejectionEmailFields(
  values: Record<string, string | undefined>,
): ApplicationRejectionEmailFields {
  const clientName =
    String(values.client_name || "").trim() || "Valued Partner";
  const declineReasons = resolveDeclineReasonsList(values);
  const primaryReason =
    declineReasons[0] || "Does not meet underwriting criteria";
  const otherReasons = declineReasons.slice(1).join(", ");

  return {
    clientName,
    primaryReason,
    otherReasons,
    declineReasons,
  };
}
