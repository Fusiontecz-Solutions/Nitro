import type { TemplateComponentProps, TemplateVariable } from "./types";
import { pick } from "./types";
// function AppLogoMark() {
//             <AppLogoMark />
//               <span>admin@oceanadvance.com</span>
//               <span>www.ocean.finexusai.com</span>

/**
 * Merge fields surfaced by this template (preserves UI order).
 * Data Personalization in Letters.tsx is curated by `personalizationLayout("payoff")`.
 */
export const PAY_OFF_LETTER_VARIABLES: TemplateVariable[] = [
  { key: "letter_date", label: "Letter Date", placeholder: "05/20/2024" },
  { key: "deal_id", label: "Deal ID", placeholder: "OA-1001" },
  { key: "recipient_name", label: "Recipient Name", placeholder: "John Doe" },
  {
    key: "recipient_address_line1",
    label: "Recipient Address Line 1",
    placeholder: "123 Client Street",
  },
  {
    key: "recipient_address_line2",
    label: "Recipient Address Line 2",
    placeholder: "City, State, 12345",
  },
  {
    key: "account_number",
    label: "Account Number",
    placeholder: "1234567890",
  },
  {
    key: "account_name",
    label: "Account Name (Business Name)",
    placeholder: "Acme LLC",
  },
  {
    key: "merchant_name",
    label: "Merchant Name",
    placeholder: "Acme LLC",
  },
  { key: "salutation_name", label: "Salutation Name", placeholder: "John Doe" },
  { key: "payoff_amount", label: "Amount", placeholder: "$5,678.90" },
  {
    key: "good_through_date",
    label: "Valid Till",
    placeholder: "05/27/2024",
  },
  {
    key: "note",
    label: "Note",
    placeholder: "Payoff amount is valid through the above date",
    defaultValue: "Payoff amount is valid through the above date",
  },
  {
    key: "lender_name",
    label: "Lender Name",
    placeholder: "NA",
  },
  {
    key: "payment_company_name",
    label: "Bank Name",
    placeholder: "NA",
  },
  {
    key: "payment_address_line1",
    label: "Address line 1",
    placeholder: "NA",
  },
  {
    key: "payment_address_line2",
    label: "City, state, zip",
    placeholder: "NA",
  },
  {
    key: "payment_routing_number",
    label: "Routing Number",
    placeholder: "NA",
  },
  {
    key: "payment_account_number",
    label: "Account Number",
    placeholder: "NA",
  },
  {
    key: "sender_name",
    label: "Sender Name",
    placeholder: "Admin Team",
    defaultValue: "Admin Team",
  },
];

/** Fixed line under the sender name in payoff letter preview + email (not a merge field). */
export const PAY_OFF_LETTER_SIGNATURE_TITLE = "Account Specialist";

/** Shown under Sincerely when sender_name is blank. */
export const PAY_OFF_LETTER_DEFAULT_SENDER_NAME = "Admin Team";

const v = PAY_OFF_LETTER_VARIABLES.reduce<Record<string, TemplateVariable>>(
  (acc, variable) => {
    acc[variable.key] = variable;
    return acc;
  },
  {},
);

export default function PayOffLetter({ values }: TemplateComponentProps) {
  const letterDate = pick(values, v.letter_date);
  const dealId = pick(values, v.deal_id);
  const recipientName = pick(values, v.recipient_name);
  const merchantName = pick(values, v.merchant_name);
  const accountName = pick(values, v.account_name);
  const displayMerchant = merchantName || accountName;
  const payoffAmount = pick(values, v.payoff_amount);
  const goodThroughDate = pick(values, v.good_through_date);
  const note = pick(values, v.note);
  const lenderName = pick(values, v.lender_name);
  const paymentCompany = pick(values, v.payment_company_name);
  const paymentAddress1 = pick(values, v.payment_address_line1);
  // Optional second line when present; Data Personalization uses a single Address field.
  const paymentAddress2Raw =
    typeof values.payment_address_line2 === "string"
      ? values.payment_address_line2.trim()
      : "";
  const paymentAddress2 = /^na$/i.test(paymentAddress2Raw)
    ? ""
    : paymentAddress2Raw;
  const paymentRoutingNumber = pick(values, v.payment_routing_number);
  const paymentAccountNumber = pick(values, v.payment_account_number);
  const senderNameRaw =
    typeof values.sender_name === "string" ? values.sender_name.trim() : "";
  const senderName =
    !senderNameRaw || /^na$/i.test(senderNameRaw)
      ? PAY_OFF_LETTER_DEFAULT_SENDER_NAME
      : senderNameRaw;

  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{
        borderCollapse: "collapse",
        width: "100%",
//           <span>admin@oceanadvance.com</span>
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
//           <span>www.ocean.finexusai.com</span>
      }}
    >
      <tbody>
        <tr>
          <td style={{ padding: "0 0 20px" }}>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: 14,
                fontWeight: "bold",
                letterSpacing: "0.04em",
                color: "#1FA5E3",
                textTransform: "uppercase",
              }}
            >
              TO WHOM IT MAY CONCERN
            </p>
            <p style={{ margin: "0 0 20px", color: "#4b5563", lineHeight: 1.5 }}>
              This letter is to confirm that the payoff amount and wire
              instructions provided below are valid until {goodThroughDate}.
            </p>
            <hr
              style={{
                border: "none",
                borderTop: "1px solid #e5e7eb",
                margin: "0 0 20px",
              }}
            />
            <p style={{ margin: "0 0 12px", color: "#6b7280" }}>{letterDate}</p>
            <p style={{ margin: "0 0 6px", fontWeight: "bold", color: "#1f2937" }}>
              {displayMerchant || recipientName}
            </p>
            <p style={{ margin: "0 0 16px", fontWeight: "bold", color: "#1f2937" }}>
              Subject : Payoff Letter
            </p>
            <p style={{ margin: "0 0 24px", color: "#4b5563" }}>
              We are pleased to provide the payoff information for your account.
              Please use the details below to remit the payoff amount. Payments
              received after the good through date may require a new payoff.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Deal ID:</strong> {dealId}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Merchant Name:</strong> {displayMerchant}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Amount:</strong> {payoffAmount}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Valid Till:</strong> {goodThroughDate}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Note:</strong> {note}
            </p>
            <p style={{ margin: "0 0 24px" }}>
              Please remit the payoff amount to the address below. Ensure payments
              are received by the good through date to avoid additional interest
              charges.
            </p>
            <p style={{ margin: "0 0 4px", fontWeight: "bold", color: "#1f2937" }}>
              Payment Address
            </p>
            {lenderName ? (
              <p style={{ margin: "0 0 3px", fontWeight: "bold", color: "#1f2937" }}>
                {lenderName}
              </p>
            ) : null}
            {paymentCompany ? (
              <p
                style={{
                  margin: "0 0 3px",
                  fontWeight: lenderName ? "normal" : "bold",
                  color: "#1f2937",
                }}
              >
                {paymentCompany}
              </p>
            ) : null}
            <p style={{ margin: paymentAddress2 ? "0 0 3px" : "0 0 16px" }}>
              {paymentAddress1}
            </p>
            {paymentAddress2 ? (
              <p style={{ margin: "0 0 16px" }}>{paymentAddress2}</p>
            ) : null}
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              style={{ borderCollapse: "collapse", margin: "0 0 24px" }}
            >
              <tbody>
                <tr>
                  <td style={{ padding: "0 48px 0 0", verticalAlign: "top" }}>
                    <span
                      style={{
                        display: "block",
                        fontWeight: "bold",
                        color: "#1f2937",
                        paddingBottom: 3,
                      }}
                    >
                      Routing
                    </span>
                    <span style={{ color: "#4b5563" }}>{paymentRoutingNumber}</span>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <span
                      style={{
                        display: "block",
                        fontWeight: "bold",
                        color: "#1f2937",
                        paddingBottom: 3,
                      }}
                    >
                      Account Number
                    </span>
                    <span style={{ color: "#4b5563" }}>{paymentAccountNumber}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <p style={{ margin: "0 0 20px", fontSize: 14, color: "#718096", fontStyle: "italic" }}>
              Sincerely,
            </p>
            <p
              style={{
                margin: "0 0 8px",
                fontFamily: "Georgia, 'Times New Roman', Times, serif",
                fontSize: 24,
                fontStyle: "italic",
                fontWeight: "normal",
                color: "#0ea5e9",
              }}
            >
              {senderName}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>
              {PAY_OFF_LETTER_SIGNATURE_TITLE}
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
