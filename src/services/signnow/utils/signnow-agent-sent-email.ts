/**
 * "Application sent for contract" email to the deal's agent, with the contract
 * package attached. Sent from the selected funder's sender identity, so the
 * body carries no CRM branding of its own.
 */

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `Contract Sent — Tiberian Funding Acme LLC $25,000.00` */
export function buildAgentContractSentSubject(contractLabel: string): string {
  const label = String(contractLabel || '').trim() || 'Contract';
  return `Contract Sent — ${label}`;
}

export function buildAgentContractSentHtml(contractLabel: string): string {
  const label = escapeHtml(String(contractLabel || '').trim() || 'Contract');
  return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Contract Sent</title>
</head>
<body style="margin:0; padding:0; background:#f4f7f9; font-family: Arial, Helvetica, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border:1px solid #e5e7eb;">
                    <tr>
                        <td style="padding: 20px 24px 8px;">
                            <h2 style="margin:0; color:#111827; font-size:22px;">Application Sent for Contract</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 20px; color:#374151; font-size:14px; line-height:1.6;">
                            <p style="margin: 0 0 8px;"><strong>Contract:</strong> ${label}</p>
                            <p style="margin: 12px 0 0;">The contract for this application has been sent to the merchant for signature. A copy of the contract package is attached for your records.</p>
                            <p style="margin: 12px 0 0;">You will receive the signed copy once every signer has completed it.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}
