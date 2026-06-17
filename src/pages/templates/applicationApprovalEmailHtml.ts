import type { TemplateValues } from "./types";
import {
  CLIENT_PROVIDED_STIPS,
  COMPANY_HANDLED_STIPS,
  escapeHtml,
  resolveApplicationApprovalEmailFields,
} from "./applicationApprovalEmailShared";

/** Hosted logo for outbound email (Gmail/Outlook-safe absolute URL). */
const APPLICATION_APPROVAL_EMAIL_LOGO_SRC =
  "https://res.cloudinary.com/dwqrrr11n/image/upload/v1781189417/62276ff9534732040de8e636d9e861dd182a7ecd_aoct74.png";

/** Bottom-right watermark for the email content body. */
const APPLICATION_APPROVAL_EMAIL_WATERMARK_SRC =
  "https://res.cloudinary.com/dwqrrr11n/image/upload/v1781200688/white_logo_1_6_fw2uye.png";

const EMAIL_WIDTH = 600;
const CONTENT_WIDTH = 510;

/**
 * Bulletproof CTA — VML roundrect for Outlook + inline anchor for Gmail/Apple Mail.
 * Avoids border-radius / margin issues that strip button styling in inbox clients.
 */
function buildStyledCtaButton(
  href: string,
  label: string,
  spacerBottom = 20,
): string {
  const safeLabel = escapeHtml(label);
  return `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0;padding:0 0 ${spacerBottom}px 0;">
  <tr>
    <td align="left" style="padding:0;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:38px;v-text-anchor:middle;width:260px;" arcsize="10%" strokecolor="#cca43b" strokeweight="2px" fillcolor="#132238">
        <w:anchorlock/>
        <center style="color:#cca43b;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">${safeLabel}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${href}" target="_blank" style="background-color:#132238;border:2px solid #cca43b;border-radius:4px;color:#cca43b;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:16px;padding:10px 22px;text-align:center;text-decoration:none;-webkit-text-size-adjust:none;mso-hide:all;">${safeLabel}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

function renderStipList(items: readonly string[]): string {
  return items
    .map(
      (item) => `
    <tr>
      <td valign="top" style="padding:0 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#666666;">
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:9px;line-height:18px;color:#999999;">&#9632;</span>
        <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#666666;">&nbsp;${escapeHtml(item)}</span>
      </td>
    </tr>`,
    )
    .join("");
}

function renderStipColumn(title: string, itemsHtml: string): string {
  return `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;table-layout:fixed;">
  <tr>
    <td style="padding:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;line-height:16px;color:#444444;">
      ${title}
    </td>
  </tr>
  <tr>
    <td style="padding:0;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
        ${itemsHtml}
      </table>
    </td>
  </tr>
</table>`;
}

/**
 * Gmail / Outlook-safe HTML for the ISO application-approval email.
 * Uses fixed-width tables, hosted PNG assets, VML buttons, and no SVG or CSS
 * background images (those break in Outlook and many mobile clients).
 */
export function renderApplicationApprovalEmailHtml(
  values: TemplateValues,
): string {
  const fields = resolveApplicationApprovalEmailFields(values);
  const clientName = escapeHtml(fields.clientName);
  const companyName = escapeHtml(fields.companyName);
  const brandName = escapeHtml(fields.companyNameBrand);
  const crmName = escapeHtml(fields.crmName);
  const calculateHref = escapeHtml(fields.calculateApprovalUrl);
  const logoSrc = escapeHtml(APPLICATION_APPROVAL_EMAIL_LOGO_SRC);
  const watermarkSrc = escapeHtml(APPLICATION_APPROVAL_EMAIL_WATERMARK_SRC);
  const clientProvidedStips = renderStipList(CLIENT_PROVIDED_STIPS);
  const companyHandledStips = renderStipList(COMPANY_HANDLED_STIPS);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Application Approved</title>
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
      .email-container { width: 100% !important; max-width: 100% !important; }
      .content-pad { padding-left: 24px !important; padding-right: 24px !important; }
      .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; }
      .stack-gap { height: 16px !important; line-height: 16px !important; font-size: 16px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f4f7f9;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f4f7f9;">
    <tr>
      <td align="center" style="padding:12px 10px;">
        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;background-color:#ffffff;border:1px solid #dddddd;">

          <!-- Header accent (table-based — SVG is stripped by Outlook) -->
          <tr>
            <td style="padding:0;line-height:0;font-size:0;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;border-collapse:collapse;">
                <tr>
                  <td width="140" height="4" bgcolor="#cca43b" style="width:140px;height:4px;line-height:4px;font-size:4px;background-color:#cca43b;">&nbsp;</td>
                  <td width="460" height="4" bgcolor="#132238" style="width:460px;height:4px;line-height:4px;font-size:4px;background-color:#132238;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:20px 24px 6px 24px;background-color:#ffffff;">
              <img src="${logoSrc}" alt="${brandName}" width="120" height="auto" border="0" style="display:block;width:120px;max-width:120px;height:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;margin:0 auto;" />
            </td>
          </tr>

          <!-- Title -->
          <tr>
            <td align="center" class="content-pad" style="padding:8px 45px 2px 45px;background-color:#ffffff;">
              <p style="margin:0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;line-height:1.15;color:#3a4756;letter-spacing:1px;">
                APPLICATION <span style="color:#cca43b;">APPROVED</span>
              </p>
              <p style="margin:8px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#777777;font-weight:normal;">
                Congratulations! Your application has been successfully processed.
              </p>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td align="center" class="content-pad" style="padding:12px 45px 14px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${CONTENT_WIDTH}" style="width:${CONTENT_WIDTH}px;max-width:100%;border-collapse:collapse;">
                <tr>
                  <td width="225" style="width:225px;border-top:1px solid #e0d0a6;font-size:0;line-height:0;">&nbsp;</td>
                  <td width="60" align="center" style="width:60px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1;color:#cca43b;">&#9671;</td>
                  <td width="225" style="width:225px;border-top:1px solid #e0d0a6;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="content-pad" style="padding:0 45px 16px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${CONTENT_WIDTH}" style="width:${CONTENT_WIDTH}px;max-width:100%;border-collapse:collapse;">

                <tr>
                  <td style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:1.3;color:#333333;">
                    Hi ${clientName}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#666666;">
                    We are pleased to inform you that your application for
                    <strong style="color:#333333;font-weight:bold;">&apos;${companyName}&apos;</strong>
                    has been pre-approved by <strong style="color:#333333;font-weight:bold;">${brandName}!</strong>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#666666;">
                    Please click on the button below to calculate your approvals. You do not need a ${crmName} login to use our calculator! Everyone on your team will have immediate access via this email.
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 20px 0;">
                    ${buildStyledCtaButton(calculateHref, "Calculate your Approval", 0)}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 10px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:15px;font-weight:bold;line-height:1.3;color:#132238;letter-spacing:0.5px;">
                    REQUIRED STIPS FOR FUNDING
                  </td>
                </tr>

                <!-- Two-column stips (fixed pixel widths — % columns collapse in Outlook) -->
                <tr>
                  <td style="padding:0 0 18px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${CONTENT_WIDTH}" style="width:${CONTENT_WIDTH}px;max-width:100%;border-collapse:collapse;table-layout:fixed;">
                      <tr>
                        <td class="stack-column" width="255" valign="top" style="width:255px;vertical-align:top;padding:0 12px 0 0;">
                          ${renderStipColumn("Provide with signed contracts:", clientProvidedStips)}
                        </td>
                        <td class="stack-column" width="255" valign="top" style="width:255px;vertical-align:top;padding:0;">
                          ${renderStipColumn(`${brandName} Company will take care of:`, companyHandledStips)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#666666;">
                    If you need more information or have any questions, contact your representative directly.
                  </td>
                </tr>

                <!-- Watermark as &lt;img&gt; (CSS background-image is ignored by Outlook) -->
                <tr>
                  <td align="right" style="padding:8px 0 0 0;line-height:0;font-size:0;">
                    <img src="${watermarkSrc}" width="150" height="auto" alt="" border="0" style="display:block;width:150px;max-width:150px;height:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;margin-left:auto;" />
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer accent -->
          <tr>
            <td style="padding:0;line-height:0;font-size:0;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;border-collapse:collapse;">
                <tr>
                  <td width="${EMAIL_WIDTH}" height="5" bgcolor="#cca43b" style="width:${EMAIL_WIDTH}px;height:5px;line-height:5px;font-size:5px;background-color:#cca43b;">&nbsp;</td>
                </tr>
                <tr>
                  <td width="${EMAIL_WIDTH}" height="6" bgcolor="#132238" style="width:${EMAIL_WIDTH}px;height:6px;line-height:6px;font-size:6px;background-color:#132238;">&nbsp;</td>
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
