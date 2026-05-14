/**
 * HTML zero-balance confirmation letter for email (inline CSS for client compatibility).
 * Seeded once on startup if no template with the same name exists.
 */
export const ZERO_BALANCE_LETTER_NAME = 'Zero balance letter';

export const ZERO_BALANCE_LETTER_VARIABLES: string[] = [
  'letter_date',
  'merchant_legal_name',
  'agreement_date',
  'zero_balance_statement',
];

export const ZERO_BALANCE_LETTER_BODY = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;border-collapse:collapse;font-family:Georgia,'Times New Roman',Times,serif;font-size:14px;line-height:1.55;color:#1a1a1a;">
  <tr>
    <td style="padding:0 0 28px;text-align:center;">
      <div style="font-size:22px;font-weight:normal;letter-spacing:0.02em;color:#5c4033;">Barclays Advance</div>
      <div style="margin-top:6px;font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#6b5b4d;">Premier Stages of Capital Growth</div>
    </td>
  </tr>
  <tr>
    <td style="padding:0 0 20px;">
      <p style="margin:0 0 18px;">{{letter_date}}</p>
      <p style="margin:0 0 6px;"><strong>Merchant:</strong> {{merchant_legal_name}}</p>
      <p style="margin:0 0 22px;"><strong>Re:</strong> BARCLAYS ADVANCE LLC (&quot;BA&quot;)</p>
      <p style="margin:0 0 16px;text-align:justify;">
        This is to confirm that <strong>{{merchant_legal_name}}</strong> has a <strong>{{zero_balance_statement}}</strong> balance with Barclays Advance LLC (&quot;BA&quot;). Since this balance has been satisfied, per our agreement, dated <strong>{{agreement_date}}</strong>, we agree to release the UCC and reduce the current debt to BA to <strong>{{zero_balance_statement}}</strong>.
      </p>
      <p style="margin:0 0 28px;">
        If you need any further information regarding your account, please do not hesitate to contact us.
      </p>
      <p style="margin:0 0 4px;">Sincerely,</p>
      <p style="margin:0 0 4px;"><strong>Barclays Advance LLC</strong></p>
      <p style="margin:0;">
        <a href="mailto:Deals@barclaysadvance.com" style="color:#1a4480;text-decoration:none;">Deals@barclaysadvance.com</a>
      </p>
    </td>
  </tr>
</table>`;
