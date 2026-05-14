/**
 * HTML payoff / wire-instruction letter for email (table + inline CSS for client compatibility).
 * Seeded once on startup if no template with the same name exists.
 */
export const PAYOFF_WIRE_LETTER_NAME = 'Payoff Wire Instructions';

export const PAYOFF_WIRE_LETTER_VARIABLES: string[] = [
  'merchant_name',
  'customer_id',
  'payoff_amount',
  'client_name',
  'letter_date',
];

export const PAYOFF_WIRE_LETTER_BODY = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;border-collapse:collapse;font-family:'Times New Roman',Times,serif;font-size:14px;line-height:1.45;color:#111111;">
  <tr>
    <td style="border:1px solid #000000;padding:12px 14px;width:32%;vertical-align:middle;font-weight:bold;">Merchant:</td>
    <td style="border:1px solid #000000;padding:12px 14px;vertical-align:middle;">{{merchant_name}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000000;padding:12px 14px;font-weight:bold;vertical-align:middle;">Reference:</td>
    <td style="border:1px solid #000000;padding:12px 14px;vertical-align:middle;">Deal ID: {{customer_id}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000000;padding:12px 14px;font-weight:bold;vertical-align:middle;">Payoff Amount:</td>
    <td style="border:1px solid #000000;padding:12px 14px;vertical-align:middle;">{{payoff_amount}}</td>
  </tr>
  <tr>
    <td style="border:1px solid #000000;padding:10px 14px;height:12px;" colspan="2">&nbsp;</td>
  </tr>
  <tr>
    <td style="border:1px solid #000000;padding:12px 14px;font-weight:bold;vertical-align:top;">Send Wire to:</td>
    <td style="border:1px solid #000000;padding:0;vertical-align:top;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
        <tr>
          <td style="padding:12px 14px;border-bottom:1px solid #000000;vertical-align:top;">
            <strong>Beneficiary Name: BARCLAYS ADVANCE LLC</strong>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 14px;vertical-align:top;">
            <strong>OPTIMUM BANK</strong><br>652 N Broad St, Suite 201<br>Middletown, DE 19709
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:14px;">
              <tr>
                <td style="width:50%;vertical-align:top;padding:0 12px 0 0;">
                  <strong>Routing</strong><br>067015096
                </td>
                <td style="width:50%;vertical-align:top;padding:0 0 0 12px;">
                  <strong>Account Number</strong><br>0210047692
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
<p style="margin:20px 0 0;font-family:'Times New Roman',Times,serif;font-size:14px;line-height:1.5;color:#111111;max-width:640px;">
  Please add Merchant's name or customer ID as a memo space when making payoff.
</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;border-collapse:collapse;margin-top:28px;font-family:'Times New Roman',Times,serif;font-size:14px;color:#111111;">
  <tr>
    <td style="width:33%;vertical-align:bottom;padding:8px 8px 8px 0;">
      <div style="font-weight:bold;border-bottom:1px solid #000000;padding-bottom:6px;">Client Name:</div>
      <div style="border-bottom:1px solid #000000;min-height:26px;padding-top:10px;">{{client_name}}</div>
    </td>
    <td style="width:34%;vertical-align:bottom;padding:8px;">
      <div style="font-weight:bold;border-bottom:1px solid #000000;padding-bottom:6px;">Client Signature:</div>
      <div style="border-bottom:1px solid #000000;min-height:26px;padding-top:10px;">&nbsp;</div>
    </td>
    <td style="width:33%;vertical-align:bottom;padding:8px 0 8px 8px;">
      <div style="font-weight:bold;border-bottom:1px solid #000000;padding-bottom:6px;">Date:</div>
      <div style="border-bottom:1px solid #000000;min-height:26px;padding-top:10px;">{{letter_date}}</div>
    </td>
  </tr>
</table>
<p style="margin:48px 0 0;font-family:'Times New Roman',Times,serif;font-size:14px;line-height:1.5;color:#111111;max-width:640px;text-align:left;">
  <span style="border-bottom:1px solid #000000;padding-bottom:2px;">BARCLAYS ADVANCE LLC</span>
</p>`;
