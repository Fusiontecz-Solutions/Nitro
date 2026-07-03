import type { TemplateValues } from "./types";
import {
  escapeHtml,
  resolveDocumentRequestEmailFields,
} from "./documentRequestEmailShared";

/** Hosted PNG logo for Gmail/Outlook-safe outbound email (no SVG — stripped by Outlook). */
const DOCUMENT_REQUEST_EMAIL_LOGO_SRC =
  "https://res.cloudinary.com/dfy6ahsqz/image/upload/v1780324705/white_logo_d8bsb1.svg";

/** Hosted PNG document icon shown in the "Required Documents" circle. */
const DOCUMENT_REQUEST_EMAIL_ICON_SRC =
  "https://res.cloudinary.com/dehrku8og/image/upload/v1781717948/Document_Icon_a9g7lp.png";

/**
 * Center faded background watermark layout image.
 * Cloudinary `o_7` reduces opacity to 7% and `f_png` rasterizes the SVG so the
 * opacity is baked into the served asset (CSS opacity can't target a
 * background-image in email clients).
 */
const DOCUMENT_REQUEST_EMAIL_WATERMARK_SRC =
  "https://res.cloudinary.com/dfy6ahsqz/image/upload/o_7,f_png/v1780324705/white_logo_d8bsb1.png";

/** Use two columns when the list has this many items or more. */
const TWO_COLUMN_MIN_ITEMS = 4;
/** Fixed column width — % columns collapse in Outlook. */
const DOCUMENT_LIST_COLUMN_WIDTH = 168;

function renderDocumentItem(label: string, isLast: boolean): string {
  const cellStyle = isLast
    ? "padding:8px 0 4px 0;"
    : "padding:8px 0; border-bottom:1px solid #eeeeee;";
  return `
    <tr>
      <td style="${cellStyle}">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
          <tr>
            <td width="18" style="font-size:14px;color:#888888;line-height:1.2;vertical-align:top;text-align:left;padding-top:1px;">&bull;</td>
            <td style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:#222222;line-height:1.35;vertical-align:top;">
              ${escapeHtml(label)}
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function renderDocumentColumn(labels: string[]): string {
  const rows = labels
    .map((label, index) =>
      renderDocumentItem(label, index === labels.length - 1),
    )
    .join("");
  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      ${rows}
    </table>`;
}

function renderDocumentList(labels: string[]): string {
  if (labels.length === 0) {
    return renderDocumentColumn(["Additional documents (as discussed)"]);
  }

  if (labels.length < TWO_COLUMN_MIN_ITEMS) {
    return renderDocumentColumn(labels);
  }

  const splitAt = Math.ceil(labels.length / 2);
  const leftLabels = labels.slice(0, splitAt);
  const rightLabels = labels.slice(splitAt);

  return `
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;">
      <tr>
        <td class="request-doc-column" width="${DOCUMENT_LIST_COLUMN_WIDTH}" valign="top" style="width:${DOCUMENT_LIST_COLUMN_WIDTH}px;vertical-align:top;padding:0 10px 0 0;">
          ${renderDocumentColumn(leftLabels)}
        </td>
        <td class="request-doc-column" width="${DOCUMENT_LIST_COLUMN_WIDTH}" valign="top" style="width:${DOCUMENT_LIST_COLUMN_WIDTH}px;vertical-align:top;padding:0;">
          ${renderDocumentColumn(rightLabels)}
        </td>
      </tr>
    </table>`;
}

function renderApplicationInfoBlock(
  clientName: string,
  applicationOwnerName: string,
  applicationNumber: string,
): string {
  const rows: string[] = [];
  if (clientName) {
    rows.push(`
      <tr>
        <td style="padding:0 8px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#888888;white-space:nowrap;vertical-align:top;">Client name:</td>
        <td style="padding:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;line-height:1.4;color:#333333;vertical-align:top;">${escapeHtml(clientName)}</td>
      </tr>`);
  }
  if (applicationOwnerName) {
    rows.push(`
      <tr>
        <td style="padding:0 8px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#888888;white-space:nowrap;vertical-align:top;">Application Owner:</td>
        <td style="padding:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;line-height:1.4;color:#333333;vertical-align:top;">${escapeHtml(applicationOwnerName)}</td>
      </tr>`);
  }
  if (applicationNumber && applicationNumber !== "N/A") {
    rows.push(`
      <tr>
        <td style="padding:0 8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;color:#888888;white-space:nowrap;vertical-align:top;">Application #:</td>
        <td style="padding:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;line-height:1.4;color:#333333;vertical-align:top;">${escapeHtml(applicationNumber)}</td>
      </tr>`);
  }
  if (rows.length === 0) return "";

  return `
                      <tr>
                        <td style="padding:0 0 20px 0;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f9fafb" style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
                            <tr>
                              <td style="padding:12px 14px;">
                                <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                  ${rows.join("")}
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>`;
}

function renderNoteBlock(note: string): string {
  if (!note) return "";
  return `
                      <tr>
                        <td style="padding:0 0 25px 0;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f9fafb" style="background-color:#f9fafb;border-left:3px solid #22a1e3;border-radius:4px;">
                            <tr>
                              <td style="padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#555555;">
                                <strong style="color:#333333;">Important Note:</strong><br/>
                                ${escapeHtml(note).replace(/\n/g, "<br/>")}
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>`;
}

/**
 * Gmail / Outlook-safe HTML for the ISO document upload request email.
 * Uses the branded layout from the Document Request design with a single
 * upload CTA linking to the public document portal (no CRM login).
 */
export function renderDocumentRequestEmailHtml(
  values: TemplateValues,
): string {
  const fields = resolveDocumentRequestEmailFields(values);
  const uploadUrl = escapeHtml(fields.uploadUrl);
  const teamName = escapeHtml(fields.teamName);
  const logoSrc = escapeHtml(DOCUMENT_REQUEST_EMAIL_LOGO_SRC);
  const documentIconSrc = escapeHtml(DOCUMENT_REQUEST_EMAIL_ICON_SRC);
  const watermarkSrc = escapeHtml(DOCUMENT_REQUEST_EMAIL_WATERMARK_SRC);
  const documentList = renderDocumentList(fields.requestedDocumentLabels);
  const applicationInfoBlock = renderApplicationInfoBlock(
    fields.clientName,
    fields.applicationOwnerName,
    fields.applicationNumber,
  );
  const noteBlock = renderNoteBlock(fields.note);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Document Upload Request</title>
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
      .request-table { width: 100% !important; }
      .request-sidebar { display: block !important; width: 100% !important; border-radius: 12px 12px 0 0 !important; text-align: center !important; padding: 25px 0 !important; }
      .request-content { display: block !important; width: 100% !important; border-radius: 0 0 12px 12px !important; padding-left: 15px !important; padding-right: 15px !important; }
      .request-doc-column { display: block !important; width: 100% !important; max-width: 100% !important; padding-right: 0 !important; padding-bottom: 10px !important; }
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
                <tr>
                  <td bgcolor="#a25ddc" style="padding:0;line-height:0;font-size:0;background-color:#a25ddc;height:45px;text-align:center;vertical-align:bottom;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;background-color:#ffffff;border-radius:12px 12px 0 0;">
                      <tr>
                        <td style="padding:10px 45px 0 45px;line-height:0;font-size:0;">
                          <img src="${logoSrc}" alt="Katan Capital" width="130" style="display:block;width:130px;height:auto;max-width:130px;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td align="center" class="content-pad" style="padding:40px 45px 25px 45px;">
                    <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:28px;font-weight:bold;line-height:1.3;color:#22a1e3;letter-spacing:0.5px;text-transform:uppercase;text-align:center;">
                      DOCUMENT UPLOAD<br>REQUEST
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td class="content-pad" style="padding:10px 45px 30px 45px;background-color:#ffffff;background-image:url('${watermarkSrc}');background-repeat:no-repeat;background-position:right center;background-size:contain;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                      <tr>
                        <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;line-height:1.3;color:#333333;">
                          Hi,
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 25px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#777777;">
                          To continue processing your application, please upload the required documents listed below.
                        </td>
                      </tr>${applicationInfoBlock}
                      <tr>
                        <td style="padding:0 0 25px 0;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border-spacing:0;">
                            <tr>
                              <td style="border-radius:12px;box-shadow:0 14px 28px -8px rgba(0,0,0,0.22),0 6px 14px -4px rgba(0,0,0,0.14);">
                                <table role="presentation" class="request-table" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #9ec9ea;border-radius:12px;overflow:hidden;">
                                  <tr>
                                    <td class="request-sidebar" width="115" bgcolor="#0056cd" align="center" valign="middle" style="width:115px;background-color:#0056cd;padding:30px 10px;text-align:center;vertical-align:middle;border-radius:11px 0 0 11px;">
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;background-color:#ffffff;border-radius:50%;width:40px;height:40px;box-shadow:0 4px 10px rgba(0,0,0,0.18);">
                                        <tr>
                                          <td align="center" valign="middle" style="height:40px;line-height:0;font-size:0;text-align:center;vertical-align:middle;">
                                            <img src="${documentIconSrc}" alt="Document" width="22" height="22" style="display:block;width:22px;height:22px;max-width:22px;margin:0 auto;" />
                                          </td>
                                        </tr>
                                      </table>
                                      <p style="margin:14px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;line-height:1.4;color:#ffffff;letter-spacing:0.5px;text-transform:uppercase;">
                                        Required<br>Documents
                                      </p>
                                    </td>
                                    <td class="request-content" bgcolor="#ffffff" valign="top" style="background-color:#ffffff;padding:15px 25px;border-radius:0 11px 11px 0;">
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                                        <tr>
                                          <td valign="top" style="padding:0;">
                                            ${documentList}
                                          </td>
                                        </tr>
                                      </table>
                                    </td>
                                  </tr>
                                </table>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>${noteBlock}
                      <tr>
                        <td style="padding:5px 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#666666;">
                          Please upload the documents using the button below. You can upload everything from one page.
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 12px 0;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                            <tr>
                              <td align="center" bgcolor="#22a1e3" style="border-radius:6px;background-color:#22a1e3;">
                                <a href="${uploadUrl}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#ffffff;line-height:1;text-transform:uppercase;letter-spacing:0.3px;">
                                  Upload Documents
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.4;color:#555555;">
                          Thank you for your cooperation,
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:0 0 20px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#444444;font-weight:bold;">
                          Best Regards,<br>
                          <span style="color:#666666;font-weight:normal;">${teamName}</span>
                        </td>
                      </tr>
                      <tr>
                        <td align="right" style="padding:0 0 10px 0;line-height:0;font-size:0;text-align:right;">
                          <img src="${logoSrc}" alt="Katan Capital" width="150" border="0" style="display:block;width:150px;max-width:150px;height:auto;margin-left:auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
      <!-- Footer Accent Stripe Ribbon Component (Fixed Solid Bars) -->
<tr>
  <td style="padding:0;line-height:0;font-size:0;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">
      <!-- Solid Purple Top Stripe -->
      <tr>
        <td height="12" bgcolor="#a25ddc" style="height:12px;line-height:12px;font-size:12px;background-color:#a25ddc;padding:0;">&nbsp;</td>
      </tr>
      <!-- Solid Blue Bottom Stripe (Full and Uncut) -->
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
