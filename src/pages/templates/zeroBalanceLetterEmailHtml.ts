import {
  ZERO_BALANCE_LETTER_SIGNATURE_TITLE,
  ZERO_BALANCE_LETTER_VARIABLES,
} from "./ZeroBalanceLetter";
import type { TemplateValues, TemplateVariable } from "./types";
import { APP_COMPANY_NAME } from "@/constants/appBranding";

/** Hosted logo for outbound zero balance letter email. */
const ZERO_BALANCE_LETTER_EMAIL_LOGO_SRC =
  "https://res.cloudinary.com/dfy6ahsqz/image/upload/v1780324705/white_logo_d8bsb1.svg";

/**
 * Center faded background watermark. Cloudinary `o_7` bakes 7% opacity into the
 * PNG so it renders in email clients that ignore CSS background opacity.
 */
const ZERO_BALANCE_LETTER_EMAIL_WATERMARK_SRC =
  "https://res.cloudinary.com/dfy6ahsqz/image/upload/o_7,f_png/v1780324705/white_logo_d8bsb1.png";

/**
 * Optional cloud-hosted icons for the info-table rows. Drop a Cloudinary (or
 * any hosted) image URL here and that row will render the image instead of the
 * unicode emoji fallback. Leave a value as "" to keep the emoji.
 */
const ZERO_BALANCE_LETTER_EMAIL_ICON_SRC = {
  account: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Account_Number_Icon_1_ieacvs.png",
  date: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Vector_2_jpgu6e.png",
  funding: "",
  status: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Account_Status_Icon_-_White_1_tfndrl.png",
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
function pickOrNA(values: TemplateValues, variable: TemplateVariable): string {
  const raw = values[variable.key];
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return "NA";
}

/**
 * Gmail-safe HTML for the Zero Balance letter — purple/cyan layout using tables
 * and inline styles. Blank merge fields surface "NA".
 */
export function renderZeroBalanceLetterEmailHtml(
  values: TemplateValues,
): string {
  const letterDate = escapeHtml(pickOrNA(values, v.letter_date));
  const recipientName = escapeHtml(pickOrNA(values, v.recipient_name));
  const recipientAddress1 = escapeHtml(
    pickOrNA(values, v.recipient_address_line1),
  );
  const recipientAddress2 = escapeHtml(
    pickOrNA(values, v.recipient_address_line2),
  );
  const accountName = escapeHtml(pickOrNA(values, v.account_name));
  const salutationName = escapeHtml(pickOrNA(values, v.salutation_name));
  const fundingAmount = escapeHtml(pickOrNA(values, v.funding_amount));
  const accountStatus = escapeHtml(pickOrNA(values, v.account_status));
  const senderName = escapeHtml(pickOrNA(values, v.sender_name));
  const signatureTitle = escapeHtml(ZERO_BALANCE_LETTER_SIGNATURE_TITLE);
  const companyName = escapeHtml(APP_COMPANY_NAME);
  const logoSrc = escapeHtml(ZERO_BALANCE_LETTER_EMAIL_LOGO_SRC);
  const watermarkSrc = escapeHtml(ZERO_BALANCE_LETTER_EMAIL_WATERMARK_SRC);

  const bodyParagraph = `This letter confirms that your account has a zero balance as of <strong>${letterDate}</strong>. No amount is currently due.`;

  const infoRow = (
    iconInner: string,
    label: string,
    val: string,
    bordered = true,
  ) => {
    const borderAttr = bordered ? ' style="border-bottom:1px solid #e5e7eb;"' : "";
    return `
                      <tr${borderAttr}>
                        <td width="50" bgcolor="#0250c5" align="center" style="width:50px;background-color:#0250c5;padding:14px 0;vertical-align:middle;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;margin:0 auto;">
                            <tr>
                              <td align="center">${iconInner}</td>
                            </tr>
                          </table>
                        </td>
                        <td width="160" style="width:160px;padding:14px 0 14px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#111111;">
                          ${label}
                        </td>
                        <td width="20" align="center" style="width:20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#0250c5;">
                          :
                        </td>
                        <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#666666;">
                          ${val}
                        </td>
                      </tr>`;
  };

  const iconAccount =
    'style="font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;line-height:16px;letter-spacing:1px;"';
  const iconDate =
    'style="border:2px solid #ffffff;border-radius:4px;width:22px;height:22px;font-family:Arial,sans-serif;font-size:13px;color:#ffffff;line-height:22px;"';
  const iconFunding =
    'style="font-family:Arial,sans-serif;font-size:16px;font-weight:bold;color:#ffffff;line-height:16px;"';
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
            <td bgcolor="#a855f7" style="padding:0;line-height:0;font-size:0;background-color:#a855f7;height:45px;vertical-align:bottom;">
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
            <td class="content-pad" style="padding:40px 45px 40px 45px;background-color:#ffffff;background-image:url('${watermarkSrc}');background-repeat:no-repeat;background-position:right center;background-size:contain;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                <tr>
                  <td align="center" style="padding:0 0 35px 0;">
                    <h1 style="margin:0;font-family:Georgia,'Times New Roman',Times,serif;font-size:32px;font-weight:bold;line-height:1.2;color:#0ea5e9;letter-spacing:1px;text-transform:uppercase;">
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
                  <td style="padding:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:1.4;color:#1f2937;">
                    ${recipientName}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 5px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#4b5563;">
                    ${recipientAddress1}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#4b5563;">
                    ${recipientAddress2}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#1f2937;">
                    Re: ${accountName}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;">
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
                    <table role="presentation" class="info-table" border="0" cellpadding="0" cellspacing="0" width="${INFO_TABLE_WIDTH}" style="width:${INFO_TABLE_WIDTH}px;max-width:100%;border-collapse:collapse;background-color:#ffffff;border:2px solid #0ea5e9;border-radius:8px;overflow:hidden;">
                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.account, "&#9776;", iconAccount), "Account Name", accountName)}
                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.date, "&#128197;", iconDate), "Date", letterDate)}
                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.funding, "&#36;", iconFunding), "Funding Amount", fundingAmount)}
                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.status, "&#10003;", iconStatus), "Account Status", accountStatus, false)}
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
                          <p style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;font-weight:normal;color:#0ea5e9;font-style:italic;">${senderName}</p>
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
                  <td height="12" bgcolor="#a855f7" style="height:12px;line-height:12px;font-size:12px;background-color:#a855f7;padding:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td height="12" bgcolor="#0ea5e9" style="height:12px;line-height:12px;font-size:12px;background-color:#0ea5e9;padding:0;">&nbsp;</td>
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

