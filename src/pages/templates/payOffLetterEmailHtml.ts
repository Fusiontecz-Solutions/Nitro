import {
  PAY_OFF_LETTER_DEFAULT_SENDER_NAME,
  PAY_OFF_LETTER_SIGNATURE_TITLE,
  PAY_OFF_LETTER_VARIABLES,
} from "./PayOffLetter";
import type { TemplateValues, TemplateVariable } from "./types";
import type { LetterEmailBranding } from "./letterEmailBranding";
import { letterHtmlTheme } from "./letterHtmlTheme";

/**
 * Optional cloud-hosted icons for the info-table rows. Drop a Cloudinary (or
 * any hosted) image URL here and that row will render the image instead of the
 * unicode emoji fallback. Leave a value as "" to keep the emoji.
 */
const PAY_OFF_LETTER_EMAIL_ICON_SRC = {
  deal: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Image_5_yhs5j4.png",
  merchant:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Account_Number_Icon_1_ieacvs.png",
  payoff: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Image_6_ktsahv.png",
  date: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Image_7_wo9ohu.png",
  note: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Note_Icon_1_j4ywhl.png",
};

const EMAIL_WIDTH = 600;
const INFO_TABLE_WIDTH = 510;

const v = PAY_OFF_LETTER_VARIABLES.reduce<
  Record<string, (typeof PAY_OFF_LETTER_VARIABLES)[number]>
>((acc, variable) => {
  acc[variable.key] = variable;
  return acc;
}, {});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Email-specific picker: returns the supplied value, or `"NA"` when the
 * merge field is blank. We intentionally do NOT fall back to the variable's
 * `placeholder` here so the outgoing email never contains dummy preview text.
 */
function pickOrNA(
  values: TemplateValues,
  variable: TemplateVariable | undefined,
): string {
  if (!variable) return "NA";
  const raw = values[variable.key];
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (variable.defaultValue?.trim()) return variable.defaultValue.trim();
  return "NA";
}

function pickFirstOrNA(
  values: TemplateValues,
  ...variables: Array<TemplateVariable | undefined>
): string {
  for (const variable of variables) {
    if (!variable) continue;
    const raw = values[variable.key];
    if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  }
  return "NA";
}

/**
 * Gmail-safe HTML for the Payoff letter — Nitro Advance theme using tables
 * and inline styles (layout aligned with the modern payoff letter design).
 * Blank merge fields surface "NA".
 */
export function renderPayOffLetterEmailHtml(
  values: TemplateValues,
  branding?: LetterEmailBranding | null,
): string {
  const dealId = escapeHtml(pickOrNA(values, v.deal_id));
  const letterDate = escapeHtml(pickOrNA(values, v.letter_date));
  const merchantName = escapeHtml(
    pickFirstOrNA(values, v.merchant_name, v.account_name, v.recipient_name),
  );
  const payoffAmount = escapeHtml(pickOrNA(values, v.payoff_amount));
  const goodThroughDate = escapeHtml(pickOrNA(values, v.good_through_date));
  const noteText = escapeHtml(pickOrNA(values, v.note));
  const lenderNameRaw =
    typeof values.lender_name === "string" ? values.lender_name.trim() : "";
  const lenderName = lenderNameRaw ? escapeHtml(lenderNameRaw) : "";
  const paymentCompany = escapeHtml(pickOrNA(values, v.payment_company_name));
  const paymentAddress1 = escapeHtml(pickOrNA(values, v.payment_address_line1));
  // Optional second line when present; Data Personalization uses a single Address field.
  const paymentAddress2Raw =
    typeof values.payment_address_line2 === "string"
      ? values.payment_address_line2.trim()
      : "";
  const paymentAddress2 =
    paymentAddress2Raw && !/^na$/i.test(paymentAddress2Raw)
      ? escapeHtml(paymentAddress2Raw)
      : "";
  const paymentRoutingNumber = escapeHtml(
    pickOrNA(values, v.payment_routing_number),
  );
  const paymentAccountNumber = escapeHtml(
    pickOrNA(values, v.payment_account_number),
  );
  const senderNameRaw =
    typeof values.sender_name === "string" ? values.sender_name.trim() : "";
  const senderName = escapeHtml(
    !senderNameRaw || /^na$/i.test(senderNameRaw)
      ? PAY_OFF_LETTER_DEFAULT_SENDER_NAME
      : senderNameRaw,
  );
  const signatureTitle = escapeHtml(PAY_OFF_LETTER_SIGNATURE_TITLE);
  const theme = letterHtmlTheme(branding);
  const companyName = escapeHtml(theme.companyName);
  const logoSrc = escapeHtml(theme.logoSrc);
  const brandPrimary = theme.brandPrimary;
  const brandAccent = theme.brandAccent;
  const brandMid = theme.brandMid;

  const bodyParagraph =
    "We are pleased to provide the payoff information for your account. Please use the details below to remit the payoff amount. Payments received after the good through date may require a new payoff.";

  const remitParagraph =
    "Please remit the payoff amount to the address below. Ensure payments are received by the good through date to avoid additional interest charges.";

  const infoRow = (
    iconInner: string,
    label: string,
    val: string,
    valCellStyle: string,
    bordered = true,
  ) => {
    const borderAttr = bordered ? ' style="border-bottom:1px solid #e5e7eb;"' : "";
    return `
                      <tr${borderAttr}>
                        <td width="50" bgcolor="${brandMid}" align="center" style="width:50px;background-color:${brandMid};padding:14px 0;vertical-align:middle;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;margin:0 auto;">
                            <tr>
                              <td align="center">${iconInner}</td>
                            </tr>
                          </table>
                        </td>
                        <td width="160" style="width:160px;padding:14px 0 14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#111111;">
                          ${label}
                        </td>
                        <td width="20" align="center" style="width:20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:${brandMid};">
                          :
                        </td>
                        <td style="padding:14px 16px;${valCellStyle}">${val}</td>
                      </tr>`;
  };

  const iconAccount =
    'style="border:2px solid #ffffff;border-radius:50%;width:30px;height:30px;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;line-height:30px;"';
  const iconPayoff =
    'style="border:2px solid #ffffff;border-radius:50%;width:30px;height:30px;font-family:Arial,sans-serif;font-size:17px;font-weight:bold;color:#ffffff;line-height:30px;"';
  const iconDate =
    'style="border:2px solid #ffffff;border-radius:4px;width:28px;height:28px;font-family:Arial,sans-serif;font-size:16px;color:#ffffff;line-height:28px;"';
  const iconNote =
    'style="font-family:Arial,sans-serif;font-size:26px;color:#ffffff;line-height:26px;"';

  /**
   * Renders an info-table icon cell. When `src` is a non-empty cloud image URL
   * it renders a 28x28 `<img>`; otherwise it falls back to the unicode emoji.
   */
  const iconCell = (
    src: string,
    fallbackEmoji: string,
    fallbackCellStyle: string,
  ): string => {
    if (typeof src === "string" && src.trim() !== "") {
      return `<td align="center" style="line-height:0;font-size:0;"><img src="${escapeHtml(
        src.trim(),
      )}" alt="" width="28" height="28" border="0" style="display:block;width:28px;height:28px;border:0;outline:none;-ms-interpolation-mode:bicubic;" /></td>`;
    }
    return `<td align="center" ${fallbackCellStyle}>${fallbackEmoji}</td>`;
  };

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
        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e5e7eb;">

          <tr>
            <td bgcolor="${brandPrimary}" style="padding:0;line-height:0;font-size:0;background-color:${brandPrimary};height:45px;vertical-align:bottom;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;border-collapse:collapse;">
                <tr>
                  <td bgcolor="#ffffff" style="background-color:#ffffff;padding:8px 24px 0 24px;border-top-left-radius:8px;border-top-right-radius:8px;line-height:0;font-size:0;">
                    <img src="${logoSrc}" alt="${companyName}" width="130" height="auto" border="0" style="display:block;width:130px;max-width:130px;height:auto;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="content-pad" style="padding:40px 45px 30px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                <tr>
                  <td style="padding:0 0 12px 0;">
                    <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:1.4;color:${brandAccent};letter-spacing:0.5px;text-transform:uppercase;">
                      To Whom It May Concern
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#4b5563;">
                    This letter is to confirm that the payoff amount and wire instructions provided below are valid until ${goodThroughDate}.
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 20px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                      <tr>
                        <td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;">
                    ${letterDate}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:1.4;color:#1f2937;">
                    ${merchantName}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#1f2937;">
                    Subject : Payoff Letter
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#4b5563;">
                    ${bodyParagraph}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 24px 0;">
                    <table role="presentation" class="info-table" border="0" cellpadding="0" cellspacing="0" width="${INFO_TABLE_WIDTH}" style="width:${INFO_TABLE_WIDTH}px;max-width:100%;border-collapse:collapse;background-color:#ffffff;border:2px solid ${brandAccent};border-radius:8px;overflow:hidden;">
                      ${infoRow(iconCell(PAY_OFF_LETTER_EMAIL_ICON_SRC.deal, "&#128179;", iconAccount), "Deal ID", dealId, "font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#666666;")}
                      ${infoRow(iconCell(PAY_OFF_LETTER_EMAIL_ICON_SRC.merchant, "&#127970;", iconAccount), "Merchant Name", merchantName, "font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#666666;")}
                      ${infoRow(iconCell(PAY_OFF_LETTER_EMAIL_ICON_SRC.payoff, "$", iconPayoff), "Amount", payoffAmount, "font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;color:#111111;")}
                      ${infoRow(iconCell(PAY_OFF_LETTER_EMAIL_ICON_SRC.date, "&#128197;", iconDate), "Valid Till", goodThroughDate, "font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#666666;")}
                      ${infoRow(iconCell(PAY_OFF_LETTER_EMAIL_ICON_SRC.note, "&#128172;", iconNote), "Note", noteText, "font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#777777;", false)}
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 30px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#4b5563;">
                    ${remitParagraph}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#1f2937;">
                    Payment Address
                  </td>
                </tr>
                ${
                  lenderName
                    ? `<tr>
                  <td style="padding:0 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#1f2937;">
                    ${lenderName}
                  </td>
                </tr>`
                    : ""
                }
                <tr>
                  <td style="padding:0 0 3px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:${lenderName ? "normal" : "bold"};color:#1f2937;">
                    ${paymentCompany}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 ${paymentAddress2 ? "3px" : "16px"} 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;">
                    ${paymentAddress1}
                  </td>
                </tr>
                ${
                  paymentAddress2
                    ? `<tr>
                  <td style="padding:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;">
                    ${paymentAddress2}
                  </td>
                </tr>`
                    : ""
                }

                <tr>
                  <td style="padding:0 0 35px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      <tr>
                        <td valign="top" style="padding:0 48px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;vertical-align:top;">
                          <strong style="display:block;color:#1f2937;padding-bottom:3px;">Routing</strong>
                          ${paymentRoutingNumber}
                        </td>
                        <td valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;vertical-align:top;">
                          <strong style="display:block;color:#1f2937;padding-bottom:3px;">Account Number</strong>
                          ${paymentAccountNumber}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        <td valign="bottom" width="52%" style="padding:0 12px 20px 0;vertical-align:bottom;">
                          <p style="margin:0 0 20px 0;font-size:14px;color:#718096;font-style:italic;">Sincerely,</p>
                          <p style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;font-weight:normal;color:${brandAccent};font-style:italic;">${senderName}</p>
                          <p style="margin:0;font-size:12px;color:#718096;">${signatureTitle}</p>
                        </td>
                        <td valign="bottom" align="right" width="48%" style="padding:0 0 12px 0;line-height:0;font-size:0;vertical-align:bottom;text-align:right;">
                          <img src="${logoSrc}" alt="${companyName}" width="150" border="0" style="display:block;width:150px;max-width:150px;height:auto;margin-left:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer accent stripe ribbon (full-width bars — Gmail/Outlook-safe) -->
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">
                <tr>
                  <td height="12" bgcolor="${brandPrimary}" style="height:12px;line-height:12px;font-size:12px;background-color:${brandPrimary};padding:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td height="12" bgcolor="${brandAccent}" style="height:12px;line-height:12px;font-size:12px;background-color:${brandAccent};padding:0;">&nbsp;</td>
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
