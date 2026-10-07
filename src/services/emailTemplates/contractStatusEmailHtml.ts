/**
 * Contract status emails, branded with the contract's funder (book): its letter
 * logo and accent colors, the same ones the payoff / zero-balance letters use.
 *
 * - "Contract Sent" — to the deal's agent when the package goes out for
 *   signature, with the unsigned package attached.
 * - "Signed Contract" — once every signer has completed the package, to the
 *   submissions inbox, the CC list, the signers, the agent and the sender.
 *
 * Kept in step with the frontend copy at
 * `nitro-contract-fe/src/pages/templates/contractStatusEmailHtml.ts`, which
 * the Template Playground previews.
 */

export interface ContractEmailBrandFields {
  /** Funder / book the contract is written under, e.g. "Obsidian Capital Group". */
  bookName: string;
  merchantName: string;
  applicationId?: string | null;
  /** Pre-formatted, e.g. "$30,000.00". */
  fundedAmount?: string | null;
  documentNames?: string[] | null;
  attachmentName?: string | null;
  /** Name the email signs off with (funder letter company name). */
  companyName: string;
  /** Hosted logo URL or `cid:` reference. */
  logoSrc: string;
  /** Header band color. */
  brandPrimary: string;
  /** Top accent stripe. */
  brandAccent: string;
}

export interface SignedContractEmailFields extends ContractEmailBrandFields {
  /** Pre-formatted, e.g. "October 7, 2026". */
  signedDate?: string | null;
}

export interface ContractSentEmailFields extends ContractEmailBrandFields {
  /** Pre-formatted, e.g. "October 7, 2026". */
  sentDate?: string | null;
  /** Signer addresses the package went to. */
  signerEmails?: string[] | null;
}

const EMAIL_WIDTH = 600;

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clean(value: string | null | undefined): string {
  return String(value ?? '').trim();
}

function buildSubject(bookName: string, merchantName: string, status: string): string {
  const parts = [clean(bookName), clean(merchantName)].filter(Boolean);
  return [...parts, status].join(': ');
}

/** `Obsidian Capital Group: VVS CARTELL LLC: Signed Contract` */
export function buildSignedContractEmailSubject(bookName: string, merchantName: string): string {
  return buildSubject(bookName, merchantName, 'Signed Contract');
}

/** `Obsidian Capital Group: VVS CARTELL LLC: Contract Sent` */
export function buildContractSentEmailSubject(bookName: string, merchantName: string): string {
  return buildSubject(bookName, merchantName, 'Contract Sent');
}

type Badge = { label: string; background: string; border: string; color: string };
type Step = { label: string; state: 'done' | 'current' | 'pending' };

interface ContractEmailLayout {
  title: string;
  preheader: string;
  badge: Badge;
  /** Already-escaped HTML. */
  leadHtml: string;
  /** Label + already-escaped value rows, appended after Book / Merchant / Application / Amount. */
  extraRows: Array<[string, string]>;
  steps?: Step[];
  attachmentCaption: string;
  noteText: string;
  footerText: string;
}

function renderSteps(steps: Step[], primary: string): string {
  const cell = (step: Step, index: number) => {
    const circle =
      step.state === 'done'
        ? { bg: '#12b76a', color: '#ffffff', text: '&#10003;' }
        : step.state === 'current'
          ? { bg: primary, color: '#ffffff', text: String(index + 1) }
          : { bg: '#e4e7ec', color: '#667085', text: String(index + 1) };
    const labelColor = step.state === 'pending' ? '#98a2b3' : '#101828';
    return `
                        <td align="center" valign="top" width="33%" style="width:33%;padding:0 4px;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="border-collapse:separate;margin:0 auto;">
                            <tr>
                              <td align="center" valign="middle" width="30" height="30" bgcolor="${circle.bg}" style="width:30px;height:30px;background-color:${circle.bg};border-radius:15px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:${circle.color};">${circle.text}</td>
                            </tr>
                          </table>
                          <div style="padding-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.4;font-weight:bold;color:${labelColor};">${escapeHtml(step.label)}</div>
                        </td>`;
  };
  return `
                <tr>
                  <td style="padding:0 0 24px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border:1px solid #e4e7ec;border-radius:10px;">
                      <tr>
                        <td colspan="3" style="padding:14px 18px 4px 18px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.2px;color:${primary};text-transform:uppercase;">What Happens Next</td>
                      </tr>
                      <tr>
                        <td colspan="3" style="padding:12px 10px 18px 10px;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                            <tr>${steps.map(cell).join('')}
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`;
}

function renderContractEmail(fields: ContractEmailBrandFields, layout: ContractEmailLayout): string {
  const book = escapeHtml(clean(fields.bookName) || 'Contract');
  const merchant = escapeHtml(clean(fields.merchantName) || 'the merchant');
  const company = escapeHtml(clean(fields.companyName) || clean(fields.bookName));
  const logoSrc = escapeHtml(clean(fields.logoSrc));
  const primary = escapeHtml(clean(fields.brandPrimary) || '#0D2478');
  const accent = escapeHtml(clean(fields.brandAccent) || '#1E4FA3');
  const attachment = escapeHtml(clean(fields.attachmentName));
  const documents = (fields.documentNames || []).map(clean).filter(Boolean);
  const year = new Date().getFullYear();
  const badge = layout.badge;

  const detailRows: Array<[string, string]> = [
    ['Book', book],
    ['Merchant', merchant],
  ];
  if (clean(fields.applicationId)) {
    detailRows.push(['Application ID', `#${escapeHtml(clean(fields.applicationId).replace(/^#/, ''))}`]);
  }
  if (clean(fields.fundedAmount)) detailRows.push(['Funded Amount', escapeHtml(clean(fields.fundedAmount))]);
  detailRows.push(...layout.extraRows);
  if (documents.length) {
    detailRows.push(['Documents', documents.map(escapeHtml).join('<br />')]);
  }

  const detailRowsHtml = detailRows
    .map(
      ([label, value], index) => `
                      <tr>
                        <td valign="top" width="150" style="width:150px;padding:13px 18px;${index ? 'border-top:1px solid #e4e7ec;' : ''}font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#667085;">${label}</td>
                        <td valign="top" style="padding:13px 18px;${index ? 'border-top:1px solid #e4e7ec;' : ''}font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#101828;font-weight:bold;word-break:break-word;">${value}</td>
                      </tr>`,
    )
    .join('');

  const attachmentHtml = attachment
    ? `
                <tr>
                  <td style="padding:0 0 28px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border:1px dashed #d0d5dd;border-radius:10px;">
                      <tr>
                        <td width="44" valign="middle" style="width:44px;padding:14px 0 14px 16px;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                            <tr>
                              <td align="center" valign="middle" width="44" height="44" bgcolor="${primary}" style="width:44px;height:44px;background-color:${primary};border-radius:8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:0.5px;color:#ffffff;">PDF</td>
                            </tr>
                          </table>
                        </td>
                        <td valign="middle" style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;">
                          <div style="font-size:14px;line-height:1.4;font-weight:bold;color:#101828;word-break:break-word;">${attachment}</div>
                          <div style="font-size:12px;line-height:1.5;color:#667085;padding-top:2px;">${layout.attachmentCaption}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${layout.title}</title>
  <style type="text/css">
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; display: block; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .content-pad { padding-left: 22px !important; padding-right: 22px !important; }
      .hero-title { font-size: 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#eef1f5;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef1f5;">${book} &middot; ${merchant} &mdash; ${layout.preheader}</div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#eef1f5;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:separate;background-color:#ffffff;border:1px solid #e3e8ef;border-radius:12px;overflow:hidden;">

          <tr>
            <td height="5" bgcolor="${accent}" style="height:5px;line-height:5px;font-size:0;background-color:${accent};">&nbsp;</td>
          </tr>
          <tr>
            <td align="center" bgcolor="${primary}" style="padding:26px 0 0 0;line-height:0;font-size:0;background-color:${primary};">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:14px 28px 10px 28px;border-top-left-radius:10px;border-top-right-radius:10px;line-height:0;font-size:0;">
                    <img src="${logoSrc}" alt="${company}" width="150" border="0" style="display:block;width:150px;max-width:150px;height:auto;margin:0 auto;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="content-pad" style="padding:36px 44px 8px 44px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:0 0 16px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate;">
                      <tr>
                        <td bgcolor="${badge.background}" style="background-color:${badge.background};border:1px solid ${badge.border};border-radius:999px;padding:5px 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1px;color:${badge.color};text-transform:uppercase;">${badge.label}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="hero-title" style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:28px;line-height:1.25;font-weight:bold;color:#101828;">${layout.title}</td>
                </tr>
                <tr>
                  <td style="padding:0 0 28px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.65;color:#475467;">
                    ${layout.leadHtml}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 24px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;background-color:#f9fafb;border:1px solid #e4e7ec;border-radius:10px;">
                      <tr>
                        <td colspan="2" style="padding:14px 18px 12px 18px;border-bottom:1px solid #e4e7ec;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:bold;letter-spacing:1.2px;color:${primary};text-transform:uppercase;">Contract Details</td>
                      </tr>${detailRowsHtml}
                    </table>
                  </td>
                </tr>
${layout.steps ? renderSteps(layout.steps, primary) : ''}${attachmentHtml}
                <tr>
                  <td style="padding:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.65;color:#667085;">
                    ${layout.noteText}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 32px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#344054;">
                    Thank you,<br /><strong style="color:#101828;">${company}</strong>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="content-pad" bgcolor="#f9fafb" style="padding:20px 44px;background-color:#f9fafb;border-top:1px solid #e4e7ec;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#98a2b3;text-align:center;">
              ${layout.footerText}<br />&copy; ${year} ${company}. All rights reserved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderSignedContractEmailHtml(fields: SignedContractEmailFields): string {
  const book = escapeHtml(clean(fields.bookName) || 'Contract');
  const merchant = escapeHtml(clean(fields.merchantName) || 'the merchant');
  const extraRows: Array<[string, string]> = [];
  if (clean(fields.signedDate)) extraRows.push(['Signed On', escapeHtml(clean(fields.signedDate))]);
  return renderContractEmail(fields, {
    title: 'Contract Signed',
    preheader: 'all parties have signed. The executed contract is attached.',
    badge: { label: '&#10003;&nbsp; Fully Executed', background: '#ecfdf3', border: '#abefc6', color: '#067647' },
    leadHtml: `All parties have completed signing the <strong style="color:#101828;">${book}</strong> agreement for <strong style="color:#101828;">${merchant}</strong>. The fully executed contract is attached to this email for your records.`,
    extraRows,
    attachmentCaption: 'Fully executed copy &middot; attached to this email',
    noteText:
      'Please keep this copy for your records. If anything in the signed agreement looks incorrect, reply to this email and our team will follow up.',
    footerText: 'This is an automated notification sent when every signer has completed the contract.',
  });
}

export function renderContractSentEmailHtml(fields: ContractSentEmailFields): string {
  const book = escapeHtml(clean(fields.bookName) || 'Contract');
  const merchant = escapeHtml(clean(fields.merchantName) || 'the merchant');
  const signers = (fields.signerEmails || []).map(clean).filter(Boolean);
  const extraRows: Array<[string, string]> = [];
  if (clean(fields.sentDate)) extraRows.push(['Sent On', escapeHtml(clean(fields.sentDate))]);
  if (signers.length) extraRows.push(['Sent To', signers.map(escapeHtml).join('<br />')]);
  return renderContractEmail(fields, {
    title: 'Contract Sent',
    preheader: 'the contract is out for signature. A copy of the package is attached.',
    badge: { label: '&#9679;&nbsp; Awaiting Signature', background: '#fffaeb', border: '#fedf89', color: '#b54708' },
    leadHtml: `The <strong style="color:#101828;">${book}</strong> contract for <strong style="color:#101828;">${merchant}</strong> has been sent to the merchant for signature. A copy of the contract package is attached for your records.`,
    extraRows,
    steps: [
      { label: 'Contract sent', state: 'done' },
      { label: 'Merchant signs', state: 'current' },
      { label: 'Signed copy to you', state: 'pending' },
    ],
    attachmentCaption: 'Contract package &middot; sent for signature',
    noteText:
      'You will receive the fully executed copy as soon as every signer has completed it. If the merchant has questions about the contract, reply to this email and our team will help.',
    footerText: 'This is an automated notification sent when a contract goes out for signature.',
  });
}
