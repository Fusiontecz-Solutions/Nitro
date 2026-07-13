import type { TemplateValues, TemplateVariable } from "./types";
import { pick } from "./types";
import {
  ZERO_BALANCE_LETTER_SIGNATURE_TITLE,
  ZERO_BALANCE_LETTER_VARIABLES,
} from "./ZeroBalanceLetter";
import { escapeHtml } from "./applicationApprovalEmailShared";

const ALLIANCE_NAVY = "#16264a";
const ALLIANCE_NAVY_DEEP = "#111f3d";
const ALLIANCE_GREY = "#9ca3af";
const ALLIANCE_TEXT_DARK = "#1f2937";
const ALLIANCE_TEXT_BODY = "#6b7280";
const ALLIANCE_BORDER = "#e5e7eb";

const ALLIANCE_LOGO_SRC =
  "https://res.cloudinary.com/dehrku8og/image/upload/v1783949699/Screenshot_2026-07-10_at_11.16.10_PM_2_yyra0k.png";

const ALLIANCE_WATERMARK_SRC =
  "https://res.cloudinary.com/dehrku8og/image/upload/o_7,f_png/v1783949699/Screenshot_2026-07-10_at_11.16.10_PM_2_yyra0k.png";

const ALLIANCE_ICON_SRC = {
  account:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Account_Number_Icon_1_ieacvs.png",
  date: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Vector_2_jpgu6e.png",
  funding:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Image_6_ktsahv.png",
  status:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Account_Status_Icon_-_White_1_tfndrl.png",
};

const EMAIL_WIDTH = 600;
const INFO_TABLE_WIDTH = 510;
const ALLIANCE_BRAND_NAME = "Alliance Bridge Capital LLC";

/** Same fixed Alliance wire / payment account used by the payoff letter. */
const ALLIANCE_PAYMENT_ACCOUNT_NUMBER = "0110039633";

const v = ZERO_BALANCE_LETTER_VARIABLES.reduce<Record<string, TemplateVariable>>(
  (acc, variable) => {
    acc[variable.key] = variable;
    return acc;
  },
  {},
);

function iconChip(src: string): string {
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                            <tr>
                              <td width="40" height="40" align="center" valign="middle" bgcolor="${ALLIANCE_NAVY}" style="width:40px;height:40px;background-color:${ALLIANCE_NAVY};border-radius:8px;line-height:0;font-size:0;text-align:center;vertical-align:middle;">
                                <img src="${escapeHtml(src)}" alt="" width="20" height="20" border="0" style="display:block;width:20px;height:20px;border:0;outline:none;margin:0 auto;-ms-interpolation-mode:bicubic;" />
                              </td>
                            </tr>
                          </table>`;
}

function infoRow(
  src: string,
  label: string,
  val: string,
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
                        <td valign="middle" style="padding:14px 16px 14px 0;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_BODY};">${val}</td>
                      </tr>`;
}

/**
 * Gmail / Outlook-safe HTML for the Alliance Bridge Capital "Zero Balance Letter".
 */
export function renderAllianceZeroBalanceLetterHtml(
  values: TemplateValues,
): string {
  const letterDate = escapeHtml(pick(values, v.letter_date));
  const accountName = escapeHtml(pick(values, v.account_name));
  const accountNumber = escapeHtml(
    String(values.payment_account_number || "").trim() ||
      ALLIANCE_PAYMENT_ACCOUNT_NUMBER,
  );
  const accountStatus = escapeHtml(pick(values, v.account_status));
  const senderName = escapeHtml(
    String(values.sender_name || "").trim() || "Admin Team",
  );
  const signatureTitle = escapeHtml(ZERO_BALANCE_LETTER_SIGNATURE_TITLE);
  const brandName = escapeHtml(ALLIANCE_BRAND_NAME);
  const logoSrc = escapeHtml(ALLIANCE_LOGO_SRC);
  const watermarkSrc = escapeHtml(ALLIANCE_WATERMARK_SRC);

  const bodyParagraph = `This letter is to confirm that your account with us has a zero balance as of the date below. At this time, there is no amount due on your account.`;

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
        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;background-color:#ffffff;border:1px solid ${ALLIANCE_BORDER};">

          <tr>
            <td height="30" bgcolor="${ALLIANCE_NAVY_DEEP}" style="height:30px;line-height:30px;font-size:0;background-color:${ALLIANCE_NAVY_DEEP};padding:0;">&nbsp;</td>
          </tr>

          <tr>
            <td class="content-pad" style="padding:22px 45px 8px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td valign="middle" style="vertical-align:middle;line-height:0;font-size:0;">
                    <img src="${logoSrc}" alt="${brandName}" width="120" height="auto" border="0" style="display:block;width:120px;max-width:120px;height:auto;border:0;outline:none;-ms-interpolation-mode:bicubic;" />
                  </td>
                  <td align="right" valign="middle" style="text-align:right;vertical-align:middle;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;letter-spacing:1px;line-height:1.15;">
                    <span style="color:${ALLIANCE_NAVY};">ZERO BALANCE</span><br />
                    <span style="color:${ALLIANCE_GREY};">LETTER</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="content-pad" style="padding:8px 45px 30px 45px;background-color:#ffffff;background-image:url('${watermarkSrc}');background-repeat:no-repeat;background-position:right bottom;background-size:220px auto;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                <tr>
                  <td style="padding:16px 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${ALLIANCE_TEXT_BODY};">
                    ${letterDate}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 18px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};">
                    ${accountName}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${ALLIANCE_TEXT_DARK};">
                    <strong>Subject</strong> :&nbsp; Zero Balance Letter
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${ALLIANCE_TEXT_BODY};">
                    ${bodyParagraph}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 24px 0;">
                    <table role="presentation" class="info-table" border="0" cellpadding="0" cellspacing="0" width="${INFO_TABLE_WIDTH}" style="width:${INFO_TABLE_WIDTH}px;max-width:100%;border-collapse:separate;background-color:#ffffff;border:1px solid ${ALLIANCE_BORDER};border-radius:10px;overflow:hidden;">
                      ${infoRow(ALLIANCE_ICON_SRC.account, "Account Number", accountNumber)}
                      ${infoRow(ALLIANCE_ICON_SRC.date, "Date", letterDate)}
                      ${infoRow(ALLIANCE_ICON_SRC.status, "Account Status", accountStatus, false)}
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${ALLIANCE_TEXT_BODY};">
                    If you have any questions or need any further assistance, please feel free to contact us.
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};">
                    Sincerely,
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 4px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:18px;font-style:italic;color:${ALLIANCE_NAVY};">
                    ${senderName}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:${ALLIANCE_TEXT_DARK};">
                    ${signatureTitle}
                  </td>
                </tr>

              </table>
            </td>
          </tr>

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
