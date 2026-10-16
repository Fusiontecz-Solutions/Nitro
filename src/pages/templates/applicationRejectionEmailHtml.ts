import type { TemplateValues } from "./types";
import {
  escapeHtml,
  resolveApplicationRejectionEmailFields,
} from "./applicationRejectionEmailShared";
import { APP_EMAIL_LOGO_URL } from "@/constants/appBranding";

/** Brand logo for outbound email / in-app template previews. */
const APPLICATION_DECLINE_EMAIL_LOGO_SRC = APP_EMAIL_LOGO_URL;

/** Bottom-right watermark for the email content body. */
const APPLICATION_DECLINE_EMAIL_WATERMARK_SRC = APP_EMAIL_LOGO_URL;

const EMAIL_WIDTH = 600;
const CONTENT_WIDTH = 510;

function renderOtherReasonsBlock(otherReasons: string): string {
  if (!otherReasons) return "";

  return `
                            <!-- Intermediary Subtle Dotted Separation Border -->
                            <tr>
                              <td style="border-top:1px dashed #e2e8f0;font-size:0;line-height:0;padding:12px 0 12px 0;">&nbsp;</td>
                            </tr>
                            <!-- Alternate Contributory Factors Segment -->
                            <tr>
                              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;color:#1e293b;padding:0 0 8px 0;">
                                Other Reason(s)
                              </td>
                            </tr>
                            <tr>
                              <td style="padding:0;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;border-radius:4px;border-collapse:collapse;">
                                  <tr>
                                    <td style="padding:8px 14px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;color:#475569;line-height:1.4;">
                                      ${otherReasons}
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>`;
}

export function renderApplicationRejectionEmailHtml(
  values: TemplateValues,
): string {
  const fields = resolveApplicationRejectionEmailFields(values);
  const clientName = escapeHtml(fields.clientName);
  const primaryReason = escapeHtml(fields.primaryReason);
  const otherReasons = escapeHtml(fields.otherReasons);
  const otherReasonsBlock = renderOtherReasonsBlock(otherReasons);

  const logoSrc = escapeHtml(APPLICATION_DECLINE_EMAIL_LOGO_SRC);
  const watermarkSrc = escapeHtml(APPLICATION_DECLINE_EMAIL_WATERMARK_SRC);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Application Update</title>
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
      .reason-card { width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f8fafc;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f8fafc;">
    <tr>
      <td align="center" style="padding:20px 10px;">
        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e2e8f0;position:relative;">

          <!-- Top Two-Tone Accent Strip Header -->
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">
                <tr>
                  <td height="12" bgcolor="#F26C11" style="height:12px;line-height:12px;font-size:12px;background-color:#F26C11;padding:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td height="12" bgcolor="#0D2478" style="height:12px;line-height:12px;font-size:12px;background-color:#0D2478;padding:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Corporate Brand Logo Insertion -->
          <tr>
            <td align="center" style="padding:10px 45px 35px 45px;background-color:#ffffff;">
              <img src="${logoSrc}" alt="Logo" width="160" height="auto" border="0" style="display:block;width:160px;max-width:160px;height:auto;margin:0 auto;" />
            </td>
          </tr>

          <!-- Main Rejection Notice Header Display -->
          <tr>
            <td align="center" class="content-pad" style="padding:0 45px 25px 45px;background-color:#ffffff;">
              <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:28px;font-weight:700;line-height:1.2;color:#0D2478;letter-spacing:0.5px;text-transform:uppercase;">
                APPLICATION <span style="color:#a1a1aa;font-weight:400;">REJECT</span>
              </h1>
              <p style="margin:24px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:#52525b;">
                Thank you for your application.<br />
                After careful review, we are unable to approve it at this time.
              </p>
            </td>
          </tr>

          <!-- Letter Body Introduction Section -->
          <tr>
            <td class="content-pad" style="padding:15px 45px 20px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:0 0 12px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#09090b;">
                    Hi ${clientName},
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 10px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#52525b;">
                    Unfortunately, your application does not meet our underwriting criteria.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Reason For Decline Detailed Card Block Layout -->
          <tr>
            <td class="content-pad" style="padding:10px 45px 25px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${CONTENT_WIDTH}" style="width:${CONTENT_WIDTH}px;max-width:100%;border-collapse:collapse;">
                <tr>
                  <td>
                    <table role="presentation" class="reason-card" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;box-shadow: 0px 4px 12px rgba(0,0,0,0.03);">
                      <tr>
                        <!-- Left Side Vertical Status Block Ribbon -->
                        <td width="115" bgcolor="#1E4FA3" align="center" valign="middle" style="width:115px;background-color:#1E4FA3;padding:25px 12px;vertical-align:middle;text-align:center;border-top-left-radius:12px;border-bottom-left-radius:12px;position:relative;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;border-collapse:collapse;">
                            <tr>
                              <td align="center" style="padding:0 0 14px 0;">
                                <!-- Circular Cross Status Emblem Wrapper -->
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:50%;width:36px;height:36px;border-collapse:collapse;">
                                  <tr>
                                    <td align="center" valign="middle" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:400;color:#000000;line-height:36px;">
                                      X
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                            <tr>
                              <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;color:#ffffff;line-height:1.4;letter-spacing:0.8px;text-transform:uppercase;">
                                REASON FOR
                              </td>
                            </tr>
                            <tr>
                              <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;color:#ffffff;line-height:1.4;letter-spacing:0.8px;text-transform:uppercase;">
                                DECLINE
                              </td>
                            </tr>
                          </table>
                        </td>

                        <!-- Diagonal Divider Between Ribbon And Details -->
                        <td width="20" bgcolor="#ffffff" valign="middle" style="width:20px;background-color:#ffffff;padding:0;font-size:0;line-height:0;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
                          <svg width="20" height="130" viewBox="0 0 20 130" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;height:100%;width:20px;">
                            <path d="M0 0L15 65L0 130H20V0H0Z" fill="#ffffff"/>
                            <path d="M0 0L15 65L0 130" stroke="#e2e8f0" stroke-width="1"/>
                          </svg>
                        </td>

                        <!-- Right Side Descriptive Text Information Fields -->
                        <td valign="top" bgcolor="#ffffff" style="padding:22px 24px;vertical-align:top;background-color:#ffffff;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;border-right:1px solid #e2e8f0;border-top-right-radius:12px;border-bottom-right-radius:12px;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                            <!-- Primary Trigger Segment -->
                            <tr>
                              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:bold;color:#dc2626;text-transform:capitalize;padding:0 0 6px 0;">
                                Primary Reason
                              </td>
                            </tr>
                            <tr>
                              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;color:#1e293b;padding:0 0 10px 0;">
                                <span style="color:#dc2626;font-size:16px;line-height:1;vertical-align:middle;margin-right:4px;">&#9679;</span> ${primaryReason}
                              </td>
                            </tr>${otherReasonsBlock}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Explicit Footnote/Context Clarification Box Container -->
          <tr>
            <td class="content-pad" style="padding:0 45px 30px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="${CONTENT_WIDTH}" style="width:${CONTENT_WIDTH}px;border-collapse:collapse;background-color:#f1f5f9;border-radius:6px;">
                <tr>
                  <td width="40" valign="middle" style="width:40px;padding:12px 0 12px 14px;vertical-align:middle;text-align:center;">
                    <!-- Circular Info Sign Icon Layout -->
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="background-color:#0f172a;border-radius:50%;width:20px;height:20px;border-collapse:collapse;margin:0 auto;">
                      <tr>
                        <td align="center" valign="middle" style="font-family:Georgia,serif;font-size:12px;font-weight:bold;color:#ffffff;line-height:20px;font-style:italic;text-align:center;">
                          i
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="padding:12px 14px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:1.5;color:#475569;">
                    This decision is based on information from the review of your application and support documents.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Outro Informational Statements & Salutation Block -->
          <tr>
            <td class="content-pad" style="padding:0 45px 35px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:0 0 20px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#64748b;">
                    This decision is specific to this application and does not affect future submissions.
                  </td>
                </tr>
                <tr>
                  <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;line-height:1.5;color:#1e293b;">
                    Thank you for considering us as your funding partner.
                  </td>
                </tr>
                <tr>
                  <td style="padding:4px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:#475569;">
                    We appreciate your interest and wish you success.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Watermark Visual Brand Signature Anchor Layout -->
          <tr>
            <td style="padding:0;background-color:#ffffff;position:relative;line-height:0;font-size:0;">
              <div style="position:absolute;right:10px;bottom:45px;width:240px;z-index:1;opacity:0.04;pointer-events:none;">
                <img src="${watermarkSrc}" width="240" height="auto" alt="" border="0" style="display:block;width:240px;max-width:240px;height:auto;" />
              </div>
            </td>
          </tr>

          <!-- Footer Two-Tone Accent Strip Foundation -->
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">
                <tr>
                  <td height="12" bgcolor="#0D2478" style="height:12px;line-height:12px;font-size:12px;background-color:#0D2478;padding:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td height="12" bgcolor="#F26C11" style="height:12px;line-height:12px;font-size:12px;background-color:#F26C11;padding:0;">&nbsp;</td>
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
