import type { TemplateValues } from "./types";
import {
  APPLICATION_APPROVAL_EMAIL_LOGO_SRC,
  escapeHtml,
  escapeHrefAttribute,
  resolveApplicationApprovalEmailFields,
} from "./applicationApprovalEmailShared";
import { resolveApplicationApprovedEmailFields } from "./applicationApprovedEmailShared";
import {
  buildOfferDetailsRows,
  renderOfferDetailsTable,
} from "./offerDetailsEmailHtml";

const EMAIL_WIDTH = 600;

/**
 * Bulletproof CTA — VML roundrect for Outlook + inline anchor for Gmail/Apple Mail.
 * Nitro Advance royal-blue CTA.
 */
function buildStyledCtaButton(
  href: string,
  label: string,
  spacerBottom = 20,
  vmlWidth = 200,
): string {
  const safeLabel = escapeHtml(label);
  return `
<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="left" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;margin:0;padding:0 0 ${spacerBottom}px 0;">
  <tr>
    <td align="left" style="padding:0;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:40px;v-text-anchor:middle;width:${vmlWidth}px;" arcsize="10%" stroked="f" fillcolor="#1E4FA3">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;">${safeLabel}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="${href}" target="_blank" style="background-color:#1E4FA3;border-radius:4px;color:#ffffff;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:40px;padding:0 24px;text-align:center;text-decoration:none;-webkit-text-size-adjust:none;mso-hide:all;">${safeLabel}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

/*
 * LEGACY ISO approval email (pre-approval calculator link + funding stips).
 * Replaced by the offer-details + approve-button template below; kept for reference.
 */
// function renderStipList(items: readonly string[]): string {
//   return items
//     .map(
//       (item) => `
//     <tr>
//       <td valign="top" style="padding:2px 0 4px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#666666;">
//         <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#666666;">&bull;</span>
//         <span style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:18px;color:#666666;">&nbsp;${escapeHtml(item)}</span>
//       </td>
//     </tr>`,
//     )
//     .join("");
// }
//
// function renderStipColumn(title: string, itemsHtml: string): string {
//   return `
// <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;table-layout:fixed;">
//   <tr>
//     <td style="padding:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:18px;color:#333333;">
//       ${title}
//     </td>
//   </tr>
//   <tr>
//     <td style="padding:0;">
//       <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
//         ${itemsHtml}
//       </table>
//     </td>
//   </tr>
// </table>`;
// }
//
// /**
//  * Gmail / Outlook-safe HTML for the ISO pre-approval email — calculator link
//  * and funding stips only (no inline offer terms; see applicationApprovedEmailHtml).
//  */
// export function renderApplicationApprovalEmailHtml(
//   values: TemplateValues,
// ): string {
//   const fields = resolveApplicationApprovalEmailFields(values);
//   const companyName = escapeHtml(fields.companyName);
//   const brandName = escapeHtml(fields.companyNameBrand);
//   const crmName = escapeHtml(fields.crmName);
//   const calculateHref = escapeHrefAttribute(fields.isoApprovalUrl);
//
//   const logoSrc = escapeHtml(APPLICATION_APPROVAL_EMAIL_LOGO_SRC);
//   const watermarkSrc = escapeHtml(APPLICATION_APPROVAL_EMAIL_BG_WATERMARK_SRC);
//   const clientName = escapeHtml(fields.clientName);
//   const clientProvidedStips = renderStipList(CLIENT_PROVIDED_STIPS);
//   const companyHandledStips = renderStipList(COMPANY_HANDLED_STIPS);
//
//   return `<!DOCTYPE html>
// <html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
// <head>
//   <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
//   <meta name="viewport" content="width=device-width, initial-scale=1.0" />
//   <meta http-equiv="X-UA-Compatible" content="IE=edge" />
//   <meta name="x-apple-disable-message-reformatting" />
//   <title>Application Approved</title>
//   <!--[if mso]>
//   <noscript>
//     <xml>
//       <o:OfficeDocumentSettings>
//         <o:PixelsPerInch>96</o:PixelsPerInch>
//       </o:OfficeDocumentSettings>
//     </xml>
//   </noscript>
//   <![endif]-->
//   <style type="text/css">
//     body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
//     table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
//     img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; display: block; }
//     a { text-decoration: none; }
//     @media only screen and (max-width: 620px) {
//       .email-container { width: 100% !important; max-width: 100% !important; }
//       .content-pad { padding-left: 24px !important; padding-right: 24px !important; }
//       .stack-column { display: block !important; width: 100% !important; max-width: 100% !important; }
//       .stack-gap { height: 16px !important; line-height: 16px !important; font-size: 16px !important; }
//     }
//   </style>
// </head>
// <body style="margin:0;padding:0;width:100%;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
//   <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f3f4f6;">
//     <tr>
//       <td align="center" style="padding:12px 10px;">
//         <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e5e7eb;">
//
//           <!-- Header accent top strip (Vibrant Purple Background) -->
//           <tr>
//             <td bgcolor="#0D2478" style="padding:0;line-height:0;font-size:0;background-color:#0D2478;height:45px;vertical-align:bottom;">
//               <!-- Centered White Tab Card Layout for Logo Wrapper -->
//               <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;border-collapse:collapse;">
//                 <tr>
//                   <td bgcolor="#ffffff" style="background-color:#ffffff;padding:8px 24px 0 24px;border-top-left-radius:8px;border-top-right-radius:8px;line-height:0;font-size:0;">
//                     <img src="${logoSrc}" alt="${brandName}" width="130" height="auto" border="0" style="display:block;width:130px;max-width:130px;height:auto;" />
//                   </td>
//                 </tr>
//               </table>
//             </td>
//           </tr>
//
//           <!-- Main structural layout container containing center watermark background asset -->
//           <tr>
//             <td class="content-pad" style="padding:40px 45px 30px 45px;background-color:#ffffff;${watermarkSrc ? `background-image:url('${watermarkSrc}');background-repeat:no-repeat;background-position:right center;background-size:contain;` : ''}">
//               <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
//                 
//                 <!-- Main Title Heading -->
//                 <tr>
//                   <td align="center" style="padding:0 0 4px 0;">
//                     <h1 style="margin:0;font-family:Georgia,'Times New Roman',Times,serif;font-size:32px;font-weight:bold;line-height:1.2;color:#1E4FA3;letter-spacing:0.5px;text-transform:uppercase;">
//                       Application Approved
//                     </h1>
//                   </td>
//                 </tr>
//
//                 <!-- Subtitle Context Block -->
//                 <tr>
//                   <td align="center" style="padding:0 0 35px 0;">
//                     <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.4;color:#4b5563;">
//                       Congratulations! Your application has been successfully processed.
//                     </p>
//                   </td>
//                 </tr>
//
//                 <!-- Body Context Elements -->
//                 <tr>
//                   <td style="padding:0 0 12px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:1.4;color:#1f2937;">
//                     Hi ${clientName},
//                   </td>
//                 </tr>
//
//                 <tr>
//                   <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#6b7280;">
//                     We are pleased to inform you that your application for <strong style="color:#1f2937;font-weight:bold;">&apos;${companyName}&apos;</strong> has been pre-approved by <strong style="color:#1f2937;font-weight:bold;">${brandName}!</strong>
//                   </td>
//                 </tr>
//
//                 <tr>
//                   <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#6b7280;">
//                     Please click on the button below to calculate your approvals. You do not need a ${crmName} login to use our calculator! Everyone on your team will have immediate access via this email.
//                   </td>
//                 </tr>
//
//                 <!-- Primary Action Item Button -->
//                 <tr>
//                   <td style="padding:0 0 30px 0;">
//                     ${buildStyledCtaButton(calculateHref, "Calculate your Approval", 0)}
//                   </td>
//                 </tr>
//
//                 <!-- Required Stips Section Header Label -->
//                 <tr>
//                   <td style="padding:0 0 16px 0;font-family:Georgia,'Times New Roman',Times,serif;font-size:16px;font-weight:bold;line-height:1.3;color:#374151;letter-spacing:0.5px;text-transform:uppercase;">
//                     REQUIRED STIPS FOR FUNDING
//                   </td>
//                 </tr>
//
//                 <!-- Grid Data Split Rows Context -->
//                 <tr>
//                   <td style="padding:0 0 35px 0;">
//                     <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;table-layout:fixed;">
//                       <tr>
//                         <td class="stack-column" width="245" valign="top" style="width:245px;vertical-align:top;padding:0 20px 0 0;">
//                           ${renderStipColumn("Provide with signed contracts:", clientProvidedStips)}
//                         </td>
//                         <td class="stack-column" width="245" valign="top" style="width:245px;vertical-align:top;padding:0;">
//                           ${renderStipColumn(`${brandName} will take care of:`, companyHandledStips)}
//                         </td>
//                       </tr>
//                     </table>
//                   </td>
//                 </tr>
//
//                 <!-- Sign-off: team name (left) + colored logo (right) -->
//                 <tr>
//                   <td style="padding:10px 0 5px 0;">
//                     <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">
//                       <tr>
//                         <td valign="bottom" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#333333;vertical-align:bottom;">
//                           ${brandName} Team
//                         </td>
//                         <td align="right" valign="bottom" style="text-align:right;vertical-align:bottom;line-height:0;font-size:0;">
//                           <img src="${logoSrc}" alt="${brandName}" width="150" style="display:block;width:150px;height:auto;max-width:150px;margin-left:auto;" />
//                         </td>
//                       </tr>
//                     </table>
//                   </td>
//                 </tr>
//
//               </table>
//             </td>
//           </tr>
//
//           <!-- Footer accent stripe ribbon (full-width bars — Gmail/Outlook-safe) -->
//           <tr>
//             <td style="padding:0;line-height:0;font-size:0;">
//               <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">
//                 <tr>
//                   <td height="12" bgcolor="#0D2478" style="height:12px;line-height:12px;font-size:12px;background-color:#0D2478;padding:0;">&nbsp;</td>
//                 </tr>
//                 <tr>
//                   <td height="12" bgcolor="#F26C11" style="height:12px;line-height:12px;font-size:12px;background-color:#F26C11;padding:0;">&nbsp;</td>
//                 </tr>
//               </table>
//             </td>
//           </tr>
//
//         </table>
//       </td>
//     </tr>
//   </table>
// </body>
// </html>`;
// }

/** Append the portal action that opens the ISO approve confirmation on arrival. */
function withApproveAction(href: string): string {
  return `${href}${href.includes("?") ? "&amp;" : "?"}action=approve`;
}

/**
 * Gmail / Outlook-safe HTML for the ISO approval email — approved offer terms inline
 * plus a "Click Here to Approve Application" CTA. The CTA opens the public approval
 * portal with `?action=approve`; confirming there moves the deal to Contract Pending.
 */
export function renderApplicationApprovalEmailHtml(
  values: TemplateValues,
): string {
  const fields = resolveApplicationApprovalEmailFields(values);
  const offerFields = resolveApplicationApprovedEmailFields(values);
  const clientName = escapeHtml(fields.clientName);
  const companyName = escapeHtml(fields.companyName);
  const brandName = escapeHtml(fields.companyNameBrand);
  const crmName = escapeHtml(fields.crmName);
  const portalHref = escapeHrefAttribute(fields.isoApprovalUrl);
  const approveHref = withApproveAction(portalHref);

  const logoSrc = escapeHtml(APPLICATION_APPROVAL_EMAIL_LOGO_SRC);
  const offerDetailsRows = buildOfferDetailsRows(offerFields);

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
      .email-container { width: 100% !important; max-width: 100% !important; border: none !important; }
      .content-pad { padding-left: 24px !important; padding-right: 24px !important; }
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
                  <td height="12" bgcolor="#F26C11" style="height:12px;line-height:12px;font-size:12px;background-color:#F26C11;padding:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td height="12" bgcolor="#0D2478" style="height:12px;line-height:12px;font-size:12px;background-color:#0D2478;padding:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:10px 45px 35px 45px;background-color:#ffffff;">
              <img src="${logoSrc}" alt="${brandName}" width="160" height="auto" border="0" style="display:block;width:160px;max-width:160px;height:auto;margin:0 auto;" />
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td class="content-pad" style="padding:0 45px 20px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                <tr>
                  <td align="center" style="padding:0 0 25px 0;">
                    <h1 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:28px;font-weight:700;line-height:1.2;color:#0D2478;letter-spacing:0.5px;text-transform:uppercase;">
                      APPLICATION <span style="color:#a1a1aa;font-weight:400;">APPROVED</span>
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td align="center" style="padding:0 0 30px 0;">
                    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.4;color:#52525b;">
                      Congratulations! Your application has been successfully approved.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 12px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.4;color:#09090b;">
                    Hi ${clientName},
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 14px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#52525b;">
                    We are pleased to inform you that your application for <strong style="color:#09090b;font-weight:700;">&apos;${companyName}&apos;</strong> has been approved by <strong style="color:#09090b;font-weight:700;">${brandName}!</strong> The approved offer terms are summarized below.
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 28px 0;">
                    ${renderOfferDetailsTable(offerDetailsRows)}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 16px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#52525b;">
                    To accept these terms, click the button below. Once approved, your application moves straight to contract preparation. You do not need a ${crmName} login.
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 24px 0;">
                    ${buildStyledCtaButton(approveHref, "Click Here to Approve Application", 0, 290)}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 14px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#52525b;">
                    If you need more information or have any questions about these terms, contact your ${crmName} representative directly.
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Sign-off -->
          <tr>
            <td style="padding:0;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td valign="bottom" style="padding:16px 0 18px 45px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#52525b;vertical-align:bottom;">
                    Best Regards,<br/>${brandName} Team
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
