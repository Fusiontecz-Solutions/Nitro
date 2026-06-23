import type { TemplateValues } from "./types";
import {
  escapeHtml,
  resolveApplicationRejectionEmailFields,
} from "./applicationRejectionEmailShared";

/** Hosted logo for outbound email (Gmail/Outlook-safe absolute URL). */
const APPLICATION_REJECTION_EMAIL_LOGO_SRC =
  "https://res.cloudinary.com/dfy6ahsqz/image/upload/v1780324705/white_logo_d8bsb1.svg";

/**
 * Center faded background watermark layout image.
 * Cloudinary `o_7` reduces opacity to 7% and `f_png` rasterizes the SVG so the
 * opacity is baked into the served asset (CSS opacity can't target a
 * background-image in email clients).
 */
const APPLICATION_REJECTION_EMAIL_WATERMARK_SRC =
  "https://res.cloudinary.com/dfy6ahsqz/image/upload/o_7,f_png/v1780324705/white_logo_d8bsb1.png";

/**
 * Gmail / Outlook-safe HTML for the ISO application-declined email.
 * Table-based layout with hosted PNG logo, purple accent bars, a blue
 * "Reason For Decline" panel, and a footer ribbon. No SVG or CSS background
 * images (those break in Outlook and many mobile clients).
 */
export function renderApplicationRejectionEmailHtml(
  values: TemplateValues,
): string {
  const fields = resolveApplicationRejectionEmailFields(values);
  const clientName = escapeHtml(fields.clientName);
  const primaryReason = escapeHtml(fields.primaryReason);
  const otherReasonsText = fields.otherReasons;
  const logoSrc = escapeHtml(APPLICATION_REJECTION_EMAIL_LOGO_SRC);
  const watermarkSrc = escapeHtml(APPLICATION_REJECTION_EMAIL_WATERMARK_SRC);

  const otherReasonsBlock = otherReasonsText
    ? `
                                  <tr>
                                    <td style="border-top:1px dashed #cccccc;font-size:0;line-height:0;padding-bottom:12px;">&nbsp;</td>
                                  </tr>
                                  <tr>
                                    <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#333333;padding-bottom:8px;">
                                      Other Reason(s)
                                    </td>
                                  </tr>
                                  <tr>
                                    <td>
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" bgcolor="#f2f4f7" style="background-color:#f2f4f7;border-radius:4px;">
                                        <tr>
                                          <td style="padding:6px 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666666;vertical-align:middle;">
                                            <span style="color:#666666;font-size:12px;padding-right:5px;line-height:1;">&bull;</span> ${escapeHtml(otherReasonsText)}
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                  </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Application Declined</title>
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
      .content-pad { padding-left: 20px !important; padding-right: 20px !important; }
      .reason-table { width: 100% !important; }
      .reason-sidebar { display: block !important; width: 100% !important; border-radius: 6px 6px 0 0 !important; text-align: center !important; padding: 20px 0 !important; }
      .reason-content { display: block !important; width: 100% !important; border-radius: 0 0 6px 6px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f4f5f7;">
    <tr>
      <td align="center" style="padding:20px 10px;">

        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="600" style="width:600px;max-width:600px;border-collapse:collapse;border:1px solid #e2e8f0;background-color:#ffffff;">
          <tr>
            <td style="padding:0;position:relative;z-index:1;">

              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;">

                <!-- Top Header: full-width purple band with centered white logo tab -->
                <tr>
                  <td bgcolor="#a25ddc" align="center" style="padding:0;line-height:0;font-size:0;background-color:#a25ddc;">
                    <!--[if mso]>
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center"><tr><td bgcolor="#ffffff" align="center" style="background-color:#ffffff;padding:20px 55px 24px 55px;line-height:0;font-size:0;">
                    <![endif]-->
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;background-color:#ffffff;border-radius:0 0 16px 16px;">
                      <tr>
                        <td align="center" bgcolor="#ffffff" style="padding:20px 55px 24px 55px;line-height:0;font-size:0;background-color:#ffffff;border-radius:0 0 16px 16px;">
                          <img src="${logoSrc}" alt="Katan Capital" width="150" style="display:block;width:150px;height:auto;max-width:150px;margin:0 auto;" />
                        </td>
                      </tr>
                    </table>
                    <!--[if mso]>
                    </td></tr></table>
                    <![endif]-->
                  </td>
                </tr>

                <!-- Title Block -->
                <tr>
                  <td align="center" class="content-pad" style="padding:40px 45px 15px 45px;">
                    <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;line-height:1.2;color:#22a1e3;letter-spacing:0.5px;">
                      APPLICATION <span style="color:#22a1e3;">REJECT</span>
                    </h1>
                    <p style="margin:16px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#666666;font-weight:normal;max-width:420px;text-align:center;margin-left:auto;margin-right:auto;">
                      Thank you for your application.<br>After careful review, we are unable to approve it at this time.
                    </p>
                  </td>
                </tr>

                <!-- Body Content Area -->
                <tr>
                  <td class="content-pad" style="padding:30px 45px 30px 45px;background-color:#ffffff;background-image:url('${watermarkSrc}');background-repeat:no-repeat;background-position:right center;background-size:contain;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                      <tr>
                        <td style="padding:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:1.3;color:#333333;">
                          Hi ${clientName},
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 0 25px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#777777;">
                          Unfortunately, your application does not meet our underwriting criteria.
                        </td>
                      </tr>

                      <!-- Reason for Decline -->
                      <tr>
                        <td style="padding:0 0 20px 0;">
                          <table role="presentation" class="reason-table" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #bce1f6;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
                            <tr>
                              <td class="reason-sidebar" width="130" bgcolor="#0056cd" align="center" valign="middle" style="width:130px;min-width:130px;background-color:#0056cd;padding:25px 12px;text-align:center;vertical-align:middle;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;background-color:#ffffff;border-radius:50%;width:34px;height:34px;">
                                  <tr>
                                    <td align="center" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#0056cd;height:34px;line-height:34px;text-align:center;vertical-align:middle;">
                                      X
                                    </td>
                                  </tr>
                                </table>
                                <p style="margin:12px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;line-height:1.3;color:#ffffff;letter-spacing:0.5px;text-transform:uppercase;">
                                  Reason For<br>Decline
                                </p>
                              </td>

                              <td class="reason-content" bgcolor="#ffffff" valign="top" style="background-color:#ffffff;padding:20px 25px;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                  <tr>
                                    <td style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;color:#da1e28;padding-bottom:5px;">
                                      Primary Reason
                                    </td>
                                  </tr>
                                  <tr>
                                    <td style="padding-bottom:15px;vertical-align:middle;">
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                                        <tr>
                                          <td style="font-size:18px;color:#da1e28;padding-right:8px;line-height:1;vertical-align:middle;">&bull;</td>
                                          <td style="font-family:Georgia,Times,serif;font-size:18px;font-weight:bold;color:#111111;line-height:1;vertical-align:middle;">
                                            ${primaryReason}
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                  </tr>${otherReasonsBlock}
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <!-- Disclaimer Notice -->
                      <tr>
                        <td style="padding:0 0 35px 0;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#dff0fa" style="background-color:#dff0fa;border-radius:6px;border-left:4px solid #0056cd;">
                            <tr>
                              <td width="30" valign="middle" style="padding:10px 0 10px 12px;vertical-align:middle;text-align:center;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" bgcolor="#0056cd" style="background-color:#0056cd;border-radius:50%;width:16px;height:16px;text-align:center;">
                                  <tr>
                                    <td align="center" valign="middle" style="font-family:Georgia,serif;font-size:11px;font-weight:bold;color:#ffffff;line-height:16px;height:16px;text-align:center;font-style:italic;">i</td>
                                  </tr>
                                </table>
                              </td>
                              <td style="padding:10px 15px 10px 10px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.4;color:#454f63;vertical-align:middle;">
                                This decision is based on information from the review of your application and support documents.
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#888888;">
                          This decision is specific to this application and does not affect future submissions.
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#444444;">
                          <strong style="color:#333333;font-weight:bold;">Thank you for considering us as your funding partner.</strong><br>
                          <span style="color:#777777;">We appreciate your interest and wish you success.</span>
                        </td>
                      </tr>

                      <!-- Sign-off: team name (left) + colored logo (right) -->
                      <tr>
                        <td style="padding:10px 0 5px 0;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">
                            <tr>
                              <td valign="bottom" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#333333;vertical-align:bottom;">
                                Katan Capital Team
                              </td>
                              <td align="right" valign="bottom" style="text-align:right;vertical-align:bottom;line-height:0;font-size:0;">
                                <img src="${logoSrc}" alt="Katan Capital" width="150" style="display:block;width:150px;height:auto;max-width:150px;margin-left:auto;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                    </table>
                  </td>
                </tr>

                <!-- Footer Accent Ribbon -->
                <tr>
                  <td style="padding:0;line-height:0;font-size:0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">
                      <tr>
                        <td height="12" bgcolor="#a25ddc" style="height:12px;line-height:12px;font-size:12px;background-color:#a25ddc;padding:0;">&nbsp;</td>
                      </tr>
                      <tr>
                        <td height="12" bgcolor="#22a1e3" style="height:12px;line-height:12px;font-size:12px;background-color:#22a1e3;padding:0;">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
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

