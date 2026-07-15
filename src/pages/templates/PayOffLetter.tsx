import type { TemplateComponentProps, TemplateVariable } from "./types";
import { pick } from "./types";
// function AppLogoMark() {
//             <AppLogoMark />
//               <span>admin@katancapital.com</span>
//               <span>www.katan.finexusai.com</span>

/** Merge fields surfaced by this template (preserves UI order). */
export const PAY_OFF_LETTER_VARIABLES: TemplateVariable[] = [
  {
    key: "letter_date",
    label: "Letter Date",
    placeholder: "May 20, 2024",
    defaultValue: "May 20, 2024",
  },
  {
    key: "account_name",
    label: "Account Name (Business Name)",
    placeholder: "Acme LLC",
    defaultValue: "Acme LLC",
  },
  {
    key: "payoff_amount",
    label: "Payoff Amount",
    placeholder: "$5,678.90",
    defaultValue: "$5,678.90",
  },
  {
    key: "good_through_date",
    label: "Valid Till",
    placeholder: "May 27, 2024",
    defaultValue: "May 27, 2024",
  },
  {
    key: "payment_company_name",
    label: "Payment Company Name",
    placeholder: "Woodmere Capital LLC",
    defaultValue: "Woodmere Capital LLC",
  },
  {
    key: "payment_address_line1",
    label: "Payment Address Line 1",
    placeholder: "609 Barnard Ave",
    defaultValue: "609 Barnard Ave",
  },
  {
    key: "payment_address_line2",
    label: "Payment Address Line 2",
    placeholder: "Woodmere NY 11598",
    defaultValue: "Woodmere NY 11598",
  },
  {
    key: "payment_routing_number",
    label: "Routing Number",
    placeholder: "067015096",
    defaultValue: "067015096",
  },
  {
    key: "payment_account_number",
    label: "Payment Account Number",
    placeholder: "210062956",
    defaultValue: "210062956",
  },
  {
    key: "sender_name",
    label: "Sender Name",
    placeholder: "Admin team",
    defaultValue: "Admin team",
  },
];

/** Fixed line under the sender name in payoff letter preview + email (not a merge field). */
export const PAY_OFF_LETTER_SIGNATURE_TITLE = "Account Specialist";

const v = PAY_OFF_LETTER_VARIABLES.reduce<Record<string, TemplateVariable>>(
  (acc, variable) => {
    acc[variable.key] = variable;
    return acc;
  },
  {},
);

export default function PayOffLetter({ values }: TemplateComponentProps) {
  const letterDate = pick(values, v.letter_date);
  const accountName = pick(values, v.account_name);
  const payoffAmount = pick(values, v.payoff_amount);
  const goodThroughDate = pick(values, v.good_through_date);
  const paymentCompany = pick(values, v.payment_company_name);
  const paymentAddress1 = pick(values, v.payment_address_line1);
  const paymentAddress2 = pick(values, v.payment_address_line2);
  const paymentRoutingNumber = pick(values, v.payment_routing_number);
  const paymentAccountNumber = pick(values, v.payment_account_number);
  const senderName = pick(values, v.sender_name);

  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{
        borderCollapse: "collapse",
        width: "100%",
//           <span>admin@katancapital.com</span>
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
//           <span>www.katan.finexusai.com</span>
      }}
    >
      <tbody>
        <tr>
          <td style={{ padding: "0 0 20px" }}>
            <h1
              style={{
                margin: "0 0 30px",
                textAlign: "center",
                fontFamily: "Georgia, 'Times New Roman', Times, serif",
                fontSize: 32,
                fontWeight: "bold",
                color: "#0ea5e9",
                textTransform: "uppercase",
              }}
            >
              Payoff Letter
            </h1>
            <p style={{ margin: "0 0 16px", color: "#6b7280" }}>{letterDate}</p>
            <p style={{ margin: "0 0 20px", fontWeight: "bold", color: "#1f2937" }}>
              Re: {accountName}
            </p>
            <p style={{ margin: "0 0 24px" }}>
              We are pleased to provide the payoff information for your account.
              Please use the details below to remit the payoff amount. Payments
              received after the good through date may require a new payoff.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Account Name:</strong> {accountName}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Payoff Amount:</strong> {payoffAmount}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Good Through Date:</strong> {goodThroughDate}
            </p>
            <p style={{ margin: "0 0 24px" }}>
              Please remit the payoff amount to the address below. Ensure payments
              are received by the good through date to avoid additional interest
              charges.
            </p>
            <p style={{ margin: "0 0 4px", fontWeight: "bold", color: "#1f2937" }}>
              Payment Address
            </p>
            <p style={{ margin: "0 0 3px", fontWeight: "bold", color: "#1f2937" }}>{paymentCompany}</p>
            <p style={{ margin: "0 0 3px" }}>{paymentAddress1}</p>
            <p style={{ margin: "0 0 16px" }}>{paymentAddress2}</p>
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
