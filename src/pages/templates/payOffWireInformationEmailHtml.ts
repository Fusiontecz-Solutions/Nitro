import { PAY_OFF_WIRE_INFORMATION_VARIABLES } from "./PayOffWireInformation";
import type { TemplateValues, TemplateVariable } from "./types";
import type { LetterEmailBranding } from "./letterEmailBranding";
import { letterHtmlTheme } from "./letterHtmlTheme";

/** Merge fields for Nitro Payoff Wire Information. */
export { PAY_OFF_WIRE_INFORMATION_VARIABLES };

const ICON_SRC = {
  merchant:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Image_5_yhs5j4.png",
  beneficiary:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Account_Number_Icon_1_ieacvs.png",
  payoff:
    "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791504/Image_6_ktsahv.png",
  date: "https://res.cloudinary.com/dehrku8og/image/upload/q_auto/f_auto/v1781791503/Image_7_wo9ohu.png",
};

const EMAIL_WIDTH = 600;
const INFO_TABLE_WIDTH = 510;

const v = PAY_OFF_WIRE_INFORMATION_VARIABLES.reduce<
  Record<string, TemplateVariable>
>((acc, variable) => {
  acc[variable.key] = variable;
  return acc;
}, {});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pickOrNA(values: TemplateValues, variable: TemplateVariable): string {
  const raw = values[variable.key];
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  if (variable.defaultValue?.trim()) return variable.defaultValue.trim();
  return "NA";
}

function iconCell(src: string): string {
  return `<td align="center" style="line-height:0;font-size:0;"><img src="${escapeHtml(
    src,
  )}" alt="" width="28" height="28" border="0" style="display:block;width:28px;height:28px;border:0;outline:none;-ms-interpolation-mode:bicubic;" /></td>`;
}

/**
 * Gmail-safe HTML for Payoff Wire Information — Nitro Advance theme.
 * Beneficiary name + bank address (no deal ID / no beneficiary address).
 */
export function renderPayOffWireInformationEmailHtml(
  values: TemplateValues,
  branding?: LetterEmailBranding | null,
): string {
  const theme = letterHtmlTheme(branding);
  const brandPrimary = theme.brandPrimary;
  const brandAccent = theme.brandAccent;
  const brandMid = theme.brandMid;

  const infoRow = (
    iconSrc: string,
    label: string,
    val: string,
    valCellStyle: string,
    bordered = true,
  ): string => {
    const borderAttr = bordered ? ' style="border-bottom:1px solid #e5e7eb;"' : "";
    return `
                      <tr${borderAttr}>
                        <td width="50" bgcolor="${brandMid}" align="center" style="width:50px;background-color:${brandMid};padding:14px 0;vertical-align:middle;">
                          <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="border-collapse:collapse;margin:0 auto;">
                            <tr>
                              ${iconCell(iconSrc)}
                            </tr>
                          </table>
                        </td>
                        <td width="180" style="width:180px;padding:14px 0 14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:#111111;">
                          ${label}
                        </td>
                        <td width="16" align="center" style="width:16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${brandAccent};">
                          :
                        </td>
                        <td style="padding:14px 16px;${valCellStyle}">${val}</td>
                      </tr>`;
  };

  const letterDate = escapeHtml(pickOrNA(values, v.letter_date));
  const merchantName = escapeHtml(pickOrNA(values, v.merchant_legal_name));
  const payoffAmount = escapeHtml(pickOrNA(values, v.payoff_amount));
  const validTill = escapeHtml(pickOrNA(values, v.good_through_date));
  const lenderRaw =
    (typeof values.lender_name === "string" && values.lender_name.trim()) ||
    (typeof values.beneficiary_name === "string" &&
      values.beneficiary_name.trim()) ||
    "NA";
  const beneficiaryName = escapeHtml(lenderRaw);
  const bankName = escapeHtml(pickOrNA(values, v.bank_name));
  const bankAddress1 = escapeHtml(pickOrNA(values, v.payment_address_line1));
  // Optional second line; Address is usually a single combined field in Data Personalization.
  const bankAddress2Raw =
    typeof values.payment_address_line2 === "string"
      ? values.payment_address_line2.trim()
      : "";
  const bankAddress2 =
    bankAddress2Raw && !/^na$/i.test(bankAddress2Raw)
      ? escapeHtml(bankAddress2Raw)
      : "";
  const routing = escapeHtml(pickOrNA(values, v.payment_routing_number));
  const accountNumber = escapeHtml(pickOrNA(values, v.payment_account_number));
  const logoSrc = escapeHtml(theme.logoSrc);
  const brandName = escapeHtml(theme.companyName);

  const intro =
    "Please find below the payoff and wiring instructions for your account. Wires received after the valid through date may require updated instructions.";
  const wireCopy =
    "Please wire the payoff amount to the bank account below. Include the Merchant's name or Customer ID as reference in the memo section of the wire.";

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payoff Wire Information</title>
  <style type="text/css">
    body, table, td, p, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; display: block; }
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .content-pad { padding-left: 24px !important; padding-right: 24px !important; }
      .info-table { width: 100% !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background-color:#f3f4f6;">
    <tr>
      <td align="center" style="padding:12px 10px;">
        <table role="presentation" class="email-container" border="0" cellpadding="0" cellspacing="0" width="${EMAIL_WIDTH}" style="width:${EMAIL_WIDTH}px;max-width:${EMAIL_WIDTH}px;border-collapse:collapse;background-color:#ffffff;border:1px solid #e5e7eb;">

          <tr>
            <td bgcolor="${brandPrimary}" style="padding:0;line-height:0;font-size:0;background-color:${brandPrimary};height:45px;vertical-align:bottom;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;border-collapse:collapse;">
                <tr>
                  <td bgcolor="#ffffff" style="background-color:#ffffff;padding:8px 24px 0 24px;border-top-left-radius:8px;border-top-right-radius:8px;line-height:0;font-size:0;">
                    <img src="${logoSrc}" alt="${brandName}" width="130" height="auto" border="0" style="display:block;width:130px;max-width:130px;height:auto;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="content-pad" style="padding:40px 45px 30px 45px;background-color:#ffffff;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;">

                <tr>
                  <td align="center" style="padding:0 0 28px 0;text-align:center;">
                    <h1 style="margin:0;font-family:Georgia,'Times New Roman',Times,serif;font-size:28px;font-weight:bold;line-height:1.25;color:${brandAccent};letter-spacing:0.5px;text-transform:uppercase;">
                      Payoff Wire Information
                    </h1>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 14px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;">
                    ${letterDate}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 10px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;line-height:1.4;color:#1f2937;">
                    ${merchantName}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:bold;color:#1f2937;">
                    Subject: Payoff Wire Information
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 22px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#4b5563;">
                    ${intro}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 22px 0;">
                    <table role="presentation" class="info-table" border="0" cellpadding="0" cellspacing="0" width="${INFO_TABLE_WIDTH}" style="width:${INFO_TABLE_WIDTH}px;max-width:100%;border-collapse:collapse;background-color:#ffffff;border:2px solid ${brandAccent};border-radius:8px;overflow:hidden;">
                      ${infoRow(ICON_SRC.merchant, "Merchant Name", merchantName, "font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#666666;")}
                      ${infoRow(ICON_SRC.payoff, "Payoff Amount", payoffAmount, "font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#111111;")}
                      ${infoRow(ICON_SRC.beneficiary, "Beneficiary Name", beneficiaryName, "font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#666666;")}
                      ${infoRow(ICON_SRC.date, "Valid Till", validTill, "font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#666666;", false)}
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#4b5563;">
                    ${wireCopy}
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 0 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#1f2937;">
                    ${bankName}
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 0 ${bankAddress2 ? "3px" : "16px"} 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;">
                    ${bankAddress1}
                  </td>
                </tr>
                ${
                  bankAddress2
                    ? `<tr>
                  <td style="padding:0 0 16px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;">
                    ${bankAddress2}
                  </td>
                </tr>`
                    : ""
                }

                <tr>
                  <td style="padding:0 0 28px 0;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                      <tr>
                        <td valign="top" style="padding:0 48px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;vertical-align:top;">
                          <strong style="display:block;color:#1f2937;padding-bottom:3px;">Routing</strong>
                          ${routing}
                        </td>
                        <td valign="top" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#4b5563;vertical-align:top;">
                          <strong style="display:block;color:#1f2937;padding-bottom:3px;">Account Number</strong>
                          ${accountNumber}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0;" align="right">
                    <img src="${logoSrc}" alt="${brandName}" width="130" border="0" style="display:block;width:130px;max-width:130px;height:auto;margin-left:auto;border:0;outline:none;-ms-interpolation-mode:bicubic;" />
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="width:100%;border-collapse:collapse;margin:0;">
                <tr>
                  <td height="12" bgcolor="${brandPrimary}" style="height:12px;line-height:12px;font-size:12px;background-color:${brandPrimary};padding:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td height="12" bgcolor="${brandAccent}" style="height:12px;line-height:12px;font-size:12px;background-color:${brandAccent};padding:0;">&nbsp;</td>
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
