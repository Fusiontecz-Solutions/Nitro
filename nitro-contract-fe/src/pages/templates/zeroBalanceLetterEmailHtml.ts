import {
  ZERO_BALANCE_LETTER_DEFAULT_SENDER_NAME,
  ZERO_BALANCE_LETTER_SIGNATURE_TITLE,
  ZERO_BALANCE_LETTER_VARIABLES,
} from "./ZeroBalanceLetter";
import type { TemplateValues, TemplateVariable } from "./types";
import type { LetterEmailBranding } from "./letterEmailBranding";
import { letterHtmlTheme } from "./letterHtmlTheme";

/**
 * Info-table icons — same Payoff letter Cloudinary assets, one distinct icon
 * per row (Deal ID / Merchant Name / Date of Funding / Status).
 */
const ZERO_BALANCE_LETTER_EMAIL_ICON_SRC = {
  dealId:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Image_5_yhs5j4.png",
  merchant:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Note_Icon_1_j4ywhl.png",
  date: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Image_7_wo9ohu.png",
  status:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Account_Status_Icon_-_White_1_tfndrl.png",
};

const EMAIL_WIDTH = 600;
const INFO_TABLE_WIDTH = 510;

const v = ZERO_BALANCE_LETTER_VARIABLES.reduce<
  Record<string, (typeof ZERO_BALANCE_LETTER_VARIABLES)[number]>
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
  return "NA";
}

/**
 * Gmail-safe HTML for the Zero Balance letter — Nitro Advance theme using tables
 * and inline styles. Blank merge fields surface "NA".
 */
export function renderZeroBalanceLetterEmailHtml(
  values: TemplateValues,
  branding?: LetterEmailBranding | null,
): string {
  const letterDate = escapeHtml(pickOrNA(values, v.letter_date));
  const dealId = escapeHtml(pickOrNA(values, v.deal_id));
  const merchantName = escapeHtml(pickOrNA(values, v.merchant_name));
  const salutationName = escapeHtml(pickOrNA(values, v.salutation_name));
  const dateOfFunding = escapeHtml(pickOrNA(values, v.date_of_funding));
  const accountStatus = escapeHtml(pickOrNA(values, v.account_status));
  const senderNameRaw =
    typeof values.sender_name === "string" ? values.sender_name.trim() : "";
  const senderName = escapeHtml(
    !senderNameRaw || /^na$/i.test(senderNameRaw)
      ? ZERO_BALANCE_LETTER_DEFAULT_SENDER_NAME
      : senderNameRaw
  );
  const signatureTitle = escapeHtml(ZERO_BALANCE_LETTER_SIGNATURE_TITLE);
  const theme = letterHtmlTheme(branding);
  const companyName = escapeHtml(theme.companyName);
  const logoSrc = escapeHtml(theme.logoSrc);
  const brandPrimary = theme.brandPrimary;
  const brandAccent = theme.brandAccent;
  const brandMid = theme.brandMid;

  const bodyParagraph =
    "This letter is to confirm that your account with us has a zero balance as of the date below. At this time, there is no amount due on your account.";

  const infoRow = (
    iconInner: string,
    label: string,
    val: string,
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
                        <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#666666;">
                          ${val}
                        </td>
                      </tr>`;
  };

  const iconDealId =
    'style="border:2px solid #ffffff;border-radius:50%;width:30px;height:30px;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;line-height:30px;"';
  const iconMerchant =
    'style="font-family:Arial,sans-serif;font-size:26px;color:#ffffff;line-height:26px;"';
  const iconDate =
    'style="border:2px solid #ffffff;border-radius:4px;width:22px;height:22px;font-family:Arial,sans-serif;font-size:13px;color:#ffffff;line-height:22px;"';
  const iconStatus =
    'style="border:2px solid #ffffff;border-radius:50%;width:24px;height:24px;font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;line-height:24px;"';

  const iconCell = (
    src: string,
    fallbackEmoji: string,
    fallbackCellStyle: string,
  ): string => {
    if (typeof src === "string" && src.trim() !== "") {
      return `<td align="center" style="line-height:0;font-size:0;"><img src="${escapeHtml(
        src.trim(),
      )}" alt="" width="24" height="24" border="0" style="display:block;width:24px;height:24px;border:0;outline:none;-ms-interpolation-mode:bicubic;" /></td>`;
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
  <title>Zero Balance Letter</title>
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
            <td class="content-pad" style="padding:40px 45px 40px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                <tr>
                  <td align="center" style="padding:0 0 28px 0;">
                    <h1 style="margin:0;font-family:Georgia,'Times New Roman',Times,serif;font-size:32px;font-weight:bold;line-height:1.2;color:${brandAccent};letter-spacing:1px;text-transform:uppercase;">
                      Zero Balance Letter
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;">
                    ${letterDate}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#1f2937;">
                    Re: ${merchantName}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#1f2937;">
                    Subject : Zero Balance Letter
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;">
                    Dear ${salutationName},
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#4b5563;">
                    ${bodyParagraph}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 30px 0;">
                    <table role="presentation" class="info-table" border="0" cellpadding="0" cellspacing="0" width="${INFO_TABLE_WIDTH}" style="width:${INFO_TABLE_WIDTH}px;max-width:100%;border-collapse:collapse;background-color:#ffffff;border:2px solid ${brandAccent};border-radius:8px;overflow:hidden;">
                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.dealId, "&#128179;", iconDealId), "Deal ID", dealId)}
                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.merchant, "&#128196;", iconMerchant), "Merchant Name", merchantName)}
                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.date, "&#128197;", iconDate), "Date of Funding", dateOfFunding)}
                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.status, "&#10003;", iconStatus), "Status", accountStatus, false)}
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 35px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#4b5563;">
                    If you have any questions or need any further assistance, please feel free to contact us.
                  </td>
                </tr>

                <tr>
                  <td style="padding:0;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                      <tr>
                        <td valign="bottom" width="52%" style="padding:0 12px 20px 0;vertical-align:bottom;">
                          <p style="margin:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;">Sincerely,</p>
                          <p style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;font-weight:normal;color:${brandAccent};font-style:italic;">${senderName}</p>
                          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;">${signatureTitle}</p>
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

