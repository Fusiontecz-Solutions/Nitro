import type { TemplateValues, TemplateVariable } from "./types";
import { pick } from "./types";
import { PAY_OFF_LETTER_SIGNATURE_TITLE, PAY_OFF_LETTER_VARIABLES } from "./PayOffLetter";
import { escapeHtml } from "./applicationApprovalEmailShared";

/**
 * Alliance Bridge Capital brand palette (deep navy letterhead).
 */
const ALLIANCE_NAVY = "#16264a";
const ALLIANCE_NAVY_DEEP = "#111f3d";
const ALLIANCE_GREY = "#9ca3af";
const ALLIANCE_TEXT_DARK = "#1f2937";
const ALLIANCE_TEXT_BODY = "#6b7280";
const ALLIANCE_BORDER = "#e5e7eb";

/** Hosted Alliance Bridge Capital logo (triangle + wordmark). */
const ALLIANCE_LOGO_SRC =
  "https://res.cloudinary.com/dehrku8og/image/upload/v1783949699/Screenshot_2026-07-10_at_11.16.10_PM_2_yyra0k.png";

/**
 * Faded bottom-right watermark. Cloudinary `o_7` bakes 7% opacity into the PNG
 * so it renders in email clients that ignore CSS background opacity.
 */
const ALLIANCE_WATERMARK_SRC =
  "https://res.cloudinary.com/dehrku8og/image/upload/o_7,f_png/v1783949699/Screenshot_2026-07-10_at_11.16.10_PM_2_yyra0k.png";

/**
 * Info-table icons (white glyphs on transparent) reused from the payoff letter.
 * They sit on the navy chip so they read as white line icons like the mockup.
 */
const ALLIANCE_ICON_SRC = {
  account:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Image_5_yhs5j4.png",
  payoff:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Image_6_ktsahv.png",
  date: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Image_7_wo9ohu.png",
  note: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Note_Icon_1_j4ywhl.png",
};

const EMAIL_WIDTH = 600;
const INFO_TABLE_WIDTH = 510;

/** Brand shown in the letterhead + sign-off for this Alliance letter. */
const ALLIANCE_BRAND_NAME = "Alliance Bridge Capital LLC";

/** Fixed Alliance wire / payment details (not merge fields). */
const ALLIANCE_PAYMENT = {
  bankName: "Optimum Bank",
  addressLine1: "8401 Myland Dr Ste A",
  addressLine2: "RICHMOND VA 23294",
  routingNumber: "067015096",
  accountNumber: "0110039633",
} as const;

const v = PAY_OFF_LETTER_VARIABLES.reduce<Record<string, TemplateVariable>>(
  (acc, variable) => {
    acc[variable.key] = variable;
    return acc;
  },
  {},
);

/** Navy chip that wraps each info-table icon. */
function iconChip(src: string): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                            <tr>
                              <td width="40" height="40" align="center" valign="middle" bgcolor="${ALLIANCE_NAVY}" style="width:40px;height:40px;background-color:${ALLIANCE_NAVY};border-radius:8px;line-height:0;font-size:0;text-align:center;vertical-align:middle;">
                                <img src="${escapeHtml(src)}" alt="" width="20" height="20" border="0" style="display:block;width:20px;height:20px;border:0;outline:none;margin:0 auto;-ms-interpolation-mode:bicubic;" />
                              </td>
                            </tr>
                          </table>`;
}

/** One row inside the info card: icon chip + label + colon + value. */
function infoRow(
  src: string,
  label: string,
  val: string,
  valCellStyle: string,
  bordered = true,
): string {
  const borderAttr = bordered
    ? ` style="border-bottom:1px solid ${ALLIANCE_BORDER};"`
    : "";
  return `
                      <tr${borderAttr}>
                        <td width="72" align="center" valign="middle" style="width:72px;padding:14px 0 14px 16px;vertical-align:middle;">
                          ${iconChip(src)}
                        </td>
                        <td width="150" valign="middle" style="width:150px;padding:14px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};vertical-align:middle;">
                          ${label}
                        </td>
                        <td width="18" align="center" valign="middle" style="width:18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};vertical-align:middle;">
                          :
                        </td>
                        <td valign="middle" style="padding:14px 16px 14px 0;vertical-align:middle;${valCellStyle}">${val}</td>
                      </tr>`;
}

/**
 * Gmail / Outlook-safe HTML for the Alliance Bridge Capital "Payoff Letter".
 * Navy letterhead, wordmark logo, and info card matching the brand mockup.
 */
export function renderAlliancePayoffLetterHtml(values: TemplateValues): string {
  const letterDate = escapeHtml(pick(values, v.letter_date));
  const accountName = escapeHtml(pick(values, v.account_name));
  const payoffAmount = escapeHtml(pick(values, v.payoff_amount));
  const goodThroughDate = escapeHtml(pick(values, v.good_through_date));
  const paymentBank = escapeHtml(
    String(values.payment_company_name || "").trim() || ALLIANCE_PAYMENT.bankName,
  );
  const paymentAddress1 = escapeHtml(
    String(values.payment_address_line1 || "").trim() ||
      ALLIANCE_PAYMENT.addressLine1,
  );
  const paymentAddress2 = escapeHtml(
    String(values.payment_address_line2 || "").trim() ||
      ALLIANCE_PAYMENT.addressLine2,
  );
  const paymentRoutingNumber = escapeHtml(
    String(values.payment_routing_number || "").trim() ||
      ALLIANCE_PAYMENT.routingNumber,
  );
  const paymentAccountNumber = escapeHtml(
    String(values.payment_account_number || "").trim() ||
      ALLIANCE_PAYMENT.accountNumber,
  );
  const senderName = escapeHtml(
    String(values.sender_name || "").trim() || "Admin Team",
  );
  const signatureTitle = escapeHtml(PAY_OFF_LETTER_SIGNATURE_TITLE);
  const brandName = escapeHtml(ALLIANCE_BRAND_NAME);
  const logoSrc = escapeHtml(ALLIANCE_LOGO_SRC);
  const watermarkSrc = escapeHtml(ALLIANCE_WATERMARK_SRC);

  const validUntil = goodThroughDate;

  const bodyParagraph =
    "We are pleased to provide the payoff information for your account. Please use the details below to remit the payoff amount. Payments received after the good through date may require a new payoff.";
  const remitParagraph =
    "Please remit the payoff amount to the address below. Ensure payments are received by the good through date to avoid additional interest charges.";
  const noteText = "Payoff amount is valid through the above date";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Payoff Letter</title>
  <style type="text/css">
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; display: block; }
    a { text-decoration: none; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .content-pad { padding-left: 24px !important; padding-right: 24px !important; }
      .info-table { width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:12px 10px;">
        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;background-color:#ffffff;border:1px solid ${ALLIANCE_BORDER};">

          <!-- Navy top bar -->
          <tr>
            <td height="30" bgcolor="${ALLIANCE_NAVY_DEEP}" style="height:30px;line-height:30px;font-size:0;background-color:${ALLIANCE_NAVY_DEEP};padding:0;">&nbsp;</td>
          </tr>

          <!-- Letterhead: Alliance logo (left) + PAYOFF LETTER (right) -->
          <tr>
            <td class="content-pad" style="padding:22px 45px 8px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td valign="middle" style="vertical-align:middle;line-height:0;font-size:0;">
                    <img src="${logoSrc}" alt="${brandName}" width="120" height="auto" border="0" style="display:block;width:120px;max-width:120px;height:auto;border:0;outline:none;-ms-interpolation-mode:bicubic;" />
                  </td>
                  <td align="right" valign="middle" style="text-align:right;vertical-align:middle;font-family:Georgia,'Times New Roman',Times,serif;font-size:30px;font-weight:bold;letter-spacing:1px;">
                    <span style="color:${ALLIANCE_NAVY};">PAYOFF</span> <span style="color:${ALLIANCE_GREY};">LETTER</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body (faded Alliance watermark, bottom-right) -->
          <tr>
            <td class="content-pad" style="padding:8px 45px 30px 45px;background-color:#ffffff;background-image:url('${watermarkSrc}');background-repeat:no-repeat;background-position:right bottom;background-size:220px auto;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                <tr>
                  <td style="padding:16px 0 10px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:16px;font-weight:bold;color:${ALLIANCE_NAVY};letter-spacing:0.5px;">
                    TO WHOM IT MAY CONCERN
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${ALLIANCE_TEXT_BODY};border-bottom:1px solid ${ALLIANCE_BORDER};">
                    This letter is to confirm that the payoff amount and wire instructions provided below are valid until ${validUntil}.
                  </td>
                </tr>

                <tr>
                  <td style="padding:16px 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${ALLIANCE_TEXT_BODY};">
                    ${letterDate}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};">
                    ${accountName}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_DARK};">
                    <strong>Subject</strong> : Payoff Letter
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${ALLIANCE_TEXT_BODY};">
                    ${bodyParagraph}
                  </td>
                </tr>

                <!-- Info card -->
                <tr>
                  <td style="padding:0 0 22px 0;">
                    <table role="presentation" class="info-table" border="0" cellpadding="0" cellspacing="0" width="${INFO_TABLE_WIDTH}" style="width:${INFO_TABLE_WIDTH}px;max-width:100%;border-collapse:separate;background-color:#ffffff;border:1px solid ${ALLIANCE_BORDER};border-radius:10px;overflow:hidden;">
                      ${infoRow(ALLIANCE_ICON_SRC.account, "Account Name", accountName, `font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_BODY};`)}
                      ${infoRow(ALLIANCE_ICON_SRC.payoff, "Payoff Amount", payoffAmount, `font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};`)}
                      ${infoRow(ALLIANCE_ICON_SRC.date, "Valid Till", goodThroughDate, `font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};`)}
                      ${infoRow(ALLIANCE_ICON_SRC.note, "Note", noteText, `font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#9ca3af;`, false)}
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${ALLIANCE_TEXT_BODY};">
                    ${remitParagraph}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};">
                    Payment Address
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_BODY};">
                    ${paymentBank}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_BODY};">
                    ${paymentAddress1}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_BODY};">
                    ${paymentAddress2}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};">
                    ${brandName}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 28px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      <tr>
                        <td valign="top" style="padding:0 60px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_BODY};vertical-align:top;">
                          <strong style="display:block;color:${ALLIANCE_TEXT_DARK};padding-bottom:4px;">Routing</strong>
                          ${paymentRoutingNumber}
                        </td>
                        <td valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_BODY};vertical-align:top;">
                          <strong style="display:block;color:${ALLIANCE_TEXT_DARK};padding-bottom:4px;">Account Number</strong>
                          ${paymentAccountNumber}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_BODY};">
                    Sincerely,
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 0 4px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:18px;font-style:italic;color:${ALLIANCE_NAVY};">
                    ${senderName}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${ALLIANCE_TEXT_BODY};">
                    ${signatureTitle}
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer accent stripe ribbon (navy + grey — Gmail/Outlook-safe) -->
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">
                <tr>
                  <td height="12" bgcolor="${ALLIANCE_NAVY_DEEP}" style="height:12px;line-height:12px;font-size:12px;background-color:${ALLIANCE_NAVY_DEEP};padding:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td height="12" bgcolor="${ALLIANCE_GREY}" style="height:12px;line-height:12px;font-size:12px;background-color:${ALLIANCE_GREY};padding:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
