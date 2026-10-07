import { BRAND_DISPLAY_NAME } from '../../../constants/brand';
import { signingPortalTokenTtlHours } from './signnow-portal-token';

/** Minimal HTML escape — merchant names and funder names are untrusted input. */
function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Merchant-facing "your contract is ready to sign" email.
 * Laid out like the signNow notification merchants already recognise: brand bar,
 * centered headline, one short sentence naming the document and sender, then a
 * single blue action button.
 * The link is single-signer and expires; the copy says so, because an expired
 * link is the most common reason a merchant contacts the funder. The stated
 * window is read from the token TTL so the promise cannot drift from the code.
 */
export function buildSigningPortalEmailHtml(input: {
  recipientName?: string | null;
  contractLabel: string;
  funderName?: string | null;
  senderEmail?: string | null;
  signingLink: string;
}): string {
  const greeting = input.recipientName
    ? `Hi ${escapeHtml(input.recipientName)},`
    : 'Hello,';
  // The header bar names the funder the contract is from, so an Obsidian or
  // Tiberian invite never opens with "Nitro Advance" in its preview line.
  const funderName = String(input.funderName || '').trim();
  const brand = escapeHtml(funderName || BRAND_DISPLAY_NAME);
  const sender = brand;
  const label = escapeHtml(input.contractLabel);
  const link = escapeHtml(input.signingLink);
  const senderEmail = input.senderEmail ? escapeHtml(input.senderEmail) : '';
  const ttlHours = signingPortalTokenTtlHours();
  const expiryCopy =
    ttlHours >= 24 && ttlHours % 24 === 0
      ? `${ttlHours / 24} ${ttlHours === 24 ? 'day' : 'days'}`
      : `${ttlHours} ${ttlHours === 1 ? 'hour' : 'hours'}`;
  const fromPart = senderEmail
    ? ` from <a href="mailto:${senderEmail}" style="color:#1d4ed8;font-weight:bold;">${senderEmail}</a>`
    : ` from <strong>${sender}</strong>`;

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e4e7eb;border-radius:8px;">
            <tr>
              <td style="padding:20px 32px;border-bottom:1px solid #e4e7eb;font-size:26px;font-weight:bold;color:#1d4ed8;letter-spacing:-0.5px;">
                ${brand}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:36px 32px 8px;font-size:24px;line-height:32px;font-weight:bold;color:#1f2933;">
                Your document is ready to sign
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0;font-size:15px;line-height:24px;">${greeting}</td>
            </tr>
            <tr>
              <td style="padding:12px 32px 0;font-size:15px;line-height:24px;">
                You have been invited to review and sign the <strong>${label}</strong> document${fromPart}.
                Follow the link below to open and sign the document.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 32px;">
                <a href="${link}"
                   style="display:inline-block;background:#1d7ce8;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:14px 48px;border-radius:4px;">
                  Review &amp; Sign
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 16px;font-size:13px;line-height:20px;color:#52606d;">
                This link is for you only and expires in ${expiryCopy}. If it has expired, reply to this
                email and we will send a new one.
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 28px;font-size:12px;line-height:18px;color:#7b8794;border-top:1px solid #e4e7eb;">
                If the button does not work, copy and paste this address into your browser:<br />
                <span style="word-break:break-all;">${link}</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
