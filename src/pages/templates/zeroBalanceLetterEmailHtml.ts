import {

  ZERO_BALANCE_LETTER_SIGNATURE_TITLE,

  ZERO_BALANCE_LETTER_VARIABLES,

} from "./ZeroBalanceLetter";

import type { TemplateValues, TemplateVariable } from "./types";

import {

  escapeHtml,

} from "./applicationApprovalEmailShared";

import {

  DEFAULT_LETTER_EMAIL_BRANDING,

  type LetterEmailBranding,

} from "./letterEmailBranding";



/**

 * Optional cloud-hosted icons for the info-table rows. Drop a Cloudinary (or

 * any hosted) image URL here and that row will render the image instead of the

 * unicode emoji fallback. Leave a value as "" to keep the emoji.

 */

const ZERO_BALANCE_LETTER_EMAIL_ICON_SRC = {

  date: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Vector_2_jpgu6e.png",

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

 * Like {@link pickOrNA} but returns an empty string for blank merge fields.

 * Used for optional salutation so we can omit the row entirely instead of

 * printing "NA" in the outgoing letter.

 */

function pickOrBlank(

  values: TemplateValues,

  variable: TemplateVariable,

): string {

  const raw = values[variable.key];

  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();

  return "";

}



/**

 * Gmail-safe HTML for the Zero Balance letter — Woodmere brand layout using

 * tables and inline styles. Blank merge fields surface "NA".

 */

export function renderZeroBalanceLetterEmailHtml(

  values: TemplateValues,

  branding: LetterEmailBranding = DEFAULT_LETTER_EMAIL_BRANDING,

): string {

  const theme = branding;

  const stripLight = escapeHtml(theme.accentStripLight);

  const stripDark = escapeHtml(theme.accentStripDark);

  const iconBg = escapeHtml(theme.infoTableIconBg);

  const letterDate = escapeHtml(pickOrNA(values, v.letter_date));

  const accountName = escapeHtml(pickOrNA(values, v.account_name));

  const salutationName = escapeHtml(pickOrBlank(values, v.salutation_name));

  const accountStatus = escapeHtml(pickOrNA(values, v.account_status));

  const senderName = escapeHtml(

    String(values.sender_name || "").trim() || "Admin team",

  );

  const signatureTitle = escapeHtml(ZERO_BALANCE_LETTER_SIGNATURE_TITLE);

  const companyName = escapeHtml(theme.companyName);

  const logoSrc = escapeHtml(theme.logoSrc);

  const watermarkSrc = escapeHtml(theme.watermarkSrc);
  const watermarkHtml = watermarkSrc
    ? `<img src="${watermarkSrc}" width="240" height="auto" alt="" border="0" style="display:inline-block;width:240px;max-width:240px;height:auto;opacity:0.04;filter:alpha(opacity=4);" />`
    : "";



  const bodyParagraph = `This letter is to confirm that your account with us has a zero balance as of the date below. At this time, there is no amount due on your account.`;



  const salutationRow =

    salutationName !== ""

      ? `

                <tr>

                  <td style="padding:0 0 16px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#09090b;">

                    Dear ${salutationName},

                  </td>

                </tr>`

      : "";



  const infoRow = (

    iconInner: string,

    label: string,

    val: string,

    bordered = true,

  ) => {

    const borderAttr = bordered ? ' style="border-bottom:1px solid #e2e8f0;"' : "";

    return `

                      <tr${borderAttr}>

                        <td width="50" bgcolor="${iconBg}" align="center" style="width:50px;background-color:${iconBg};padding:14px 0;vertical-align:middle;">

                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;margin:0 auto;">

                            <tr>

                              <td align="center">${iconInner}</td>

                            </tr>

                          </table>

                        </td>

                        <td width="160" style="width:160px;padding:14px 0 14px 20px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#09090b;">

                          ${label}

                        </td>

                        <td width="20" align="center" style="width:20px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#18181b;">

                          :

                        </td>

                        <td style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;color:#52525b;">

                          ${val}

                        </td>

                      </tr>`;

  };



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

  <!--[if mso]>

  <noscript>

    <xml>

      <o:OfficeDocumentSettings>

        <o:PixelsPerInch>96</o:PixelsPerInch>

      </o:OfficeDocumentSettings>

    </xml>

  </noscript>

  <![endif]-->

  <style type="text/css">

    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }

    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }

    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; display: block; }

    a { text-decoration: none; }

    @media only screen and (max-width: 620px) {

      .email-container { width: 100% !important; max-width: 100% !important; border: none !important; }

      .content-pad { padding-left: 24px !important; padding-right: 24px !important; }

      .info-table { width: 100% !important; }

    }

  </style>

</head>

<body style="margin:0;padding:0;width:100%;background-color:#f8fafc;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">

  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f8fafc;">

    <tr>

      <td align="center" style="padding:20px 10px;">

        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2e8f0;">



          <!-- Top two-tone accent strip -->

          <tr>

            <td style="padding:0;line-height:0;font-size:0;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">

                <tr>

                  <td height="12" bgcolor="${stripLight}" style="height:12px;line-height:12px;font-size:12px;background-color:${stripLight};padding:0;">&nbsp;</td>

                </tr>

                <tr>

                  <td height="12" bgcolor="${stripDark}" style="height:12px;line-height:12px;font-size:12px;background-color:${stripDark};padding:0;">&nbsp;</td>

                </tr>

              </table>

            </td>

          </tr>



          <!-- Logo -->

          <tr>

            <td align="center" style="padding:10px 45px 35px 45px;background-color:#ffffff;">

              <img src="${logoSrc}" alt="${companyName}" width="160" height="auto" border="0" style="display:block;width:160px;max-width:160px;height:auto;margin:0 auto;" />

            </td>

          </tr>



          <!-- Main content -->

          <tr>

            <td class="content-pad" style="padding:0 45px 20px 45px;background-color:#ffffff;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">



                <tr>

                  <td align="center" style="padding:0 0 35px 0;">

                    <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:28px;font-weight:700;line-height:1.2;color:${stripDark};letter-spacing:0.5px;text-transform:uppercase;">

                      ZERO BALANCE <span style="color:${stripLight};font-weight:400;">LETTER</span>

                    </h1>

                  </td>

                </tr>



                <tr>

                  <td style="padding:0 0 14px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#71717a;">

                    ${letterDate}

                  </td>

                </tr>

                <tr>

                  <td style="padding:0 0 18px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.4;color:#09090b;">

                    Re: ${accountName}

                  </td>

                </tr>



                <tr>

                  <td style="padding:0 0 16px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#09090b;">

                    <strong>Subject</strong> :&nbsp; Zero Balance Letter

                  </td>

                </tr>

                ${salutationRow}

                <tr>

                  <td style="padding:0 0 24px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#52525b;">

                    ${bodyParagraph}

                  </td>

                </tr>



                <tr>

                  <td style="padding:0 0 30px 0;">

                    <table role="presentation" class="info-table" border="0" cellpadding="0" cellspacing="0" width="${INFO_TABLE_WIDTH}" style="width:${INFO_TABLE_WIDTH}px;max-width:100%;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">

                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.date, "&#128197;", iconDate), "Date", letterDate)}

                      ${infoRow(iconCell(ZERO_BALANCE_LETTER_EMAIL_ICON_SRC.status, "&#10003;", iconStatus), "Account Status", accountStatus, false)}

                    </table>

                  </td>

                </tr>



                <tr>

                  <td style="padding:0 0 35px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#52525b;">

                    If you have any questions or need any further assistance, please feel free to contact us.

                  </td>

                </tr>



              </table>

            </td>

          </tr>



          <!-- Sign-off + watermark -->

          <tr>

            <td style="padding:0;background-color:#ffffff;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">

                <tr>

                  <td valign="bottom" style="padding:16px 0 10px 45px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#52525b;vertical-align:bottom;">

                    <p style="margin:0 0 4px 0;">Sincerely,</p>

                    <p style="margin:0 0 8px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:24px;font-weight:normal;color:#18181b;font-style:italic;">${senderName}</p>

                    <p style="margin:0;font-size:12px;color:#71717a;">${signatureTitle}</p>

                  </td>

                  <td align="right" valign="bottom" width="240" style="width:240px;padding:0 10px 6px 0;line-height:0;font-size:0;text-align:right;vertical-align:bottom;">

                    ${watermarkHtml}

                  </td>

                </tr>

              </table>

            </td>

          </tr>



          <!-- Footer two-tone accent strip -->

          <tr>

            <td style="padding:0;line-height:0;font-size:0;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">

                <tr>

                  <td height="12" bgcolor="${stripDark}" style="height:12px;line-height:12px;font-size:12px;background-color:${stripDark};padding:0;">&nbsp;</td>

                </tr>

                <tr>

                  <td height="12" bgcolor="${stripLight}" style="height:12px;line-height:12px;font-size:12px;background-color:${stripLight};padding:0;">&nbsp;</td>

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

