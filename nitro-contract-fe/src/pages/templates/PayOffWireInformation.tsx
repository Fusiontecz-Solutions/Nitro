import type { TemplateComponentProps, TemplateVariable } from "./types";
import { pick } from "./types";

/**
 * Merge fields for Nitro Payoff Wire Information.
 * Sent email HTML is rendered by `payOffWireInformationEmailHtml.ts`.
 */
export const PAY_OFF_WIRE_INFORMATION_VARIABLES: TemplateVariable[] = [
  { key: "letter_date", label: "Letter Date", placeholder: "07/14/2026" },
  {
    key: "merchant_legal_name",
    label: "Merchant Name",
    placeholder: "Acme LLC",
  },
  { key: "payoff_amount", label: "Payoff Amount", placeholder: "$22,485.00" },
  {
    key: "good_through_date",
    label: "Valid Till",
    placeholder: "07/17/2026",
  },
  {
    key: "lender_name",
    label: "Lender Name",
    placeholder: "NA",
  },
  {
    key: "bank_name",
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
];

const v = PAY_OFF_WIRE_INFORMATION_VARIABLES.reduce<
  Record<string, TemplateVariable>
>((acc, variable) => {
  acc[variable.key] = variable;
  return acc;
}, {});

export default function PayOffWireInformation({
  values,
}: TemplateComponentProps) {
  const letterDate = pick(values, v.letter_date);
  const merchantName = pick(values, v.merchant_legal_name);
  const payoffAmount = pick(values, v.payoff_amount);
  const validTill = pick(values, v.good_through_date);
  const lenderNameRaw =
    (typeof values.lender_name === "string" && values.lender_name.trim()) ||
    (typeof values.beneficiary_name === "string" &&
      values.beneficiary_name.trim()) ||
    "";
  const lenderName = lenderNameRaw || pick(values, v.lender_name);
  const bankName = pick(values, v.bank_name);
  const bankAddress1 = pick(values, v.payment_address_line1);
  // City/state/zip is not editable in Data Personalization; still show when seeded from Letter Info.
  const bankAddress2Raw =
    typeof values.payment_address_line2 === "string"
      ? values.payment_address_line2.trim()
      : "";
  const bankAddress2 = /^na$/i.test(bankAddress2Raw) ? "" : bankAddress2Raw;
  const routing = pick(values, v.payment_routing_number);
  const accountNumber = pick(values, v.payment_account_number);

  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{
        borderCollapse: "collapse",
        width: "100%",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
        color: "#2d3748",
      }}
    >
      <tbody>
        <tr>
          <td style={{ padding: "0 0 20px" }}>
            <h1
              style={{
                margin: "0 0 28px",
                textAlign: "center",
                fontFamily: "Georgia, 'Times New Roman', Times, serif",
                fontSize: 28,
                fontWeight: "bold",
                color: "#1FA5E3",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              Payoff Wire Information
            </h1>
            <p style={{ margin: "0 0 14px", color: "#6b7280" }}>{letterDate}</p>
            <p
              style={{
                margin: "0 0 10px",
                fontSize: 15,
                fontWeight: "bold",
                color: "#1f2937",
              }}
            >
              {merchantName}
            </p>
            <p style={{ margin: "0 0 16px", fontWeight: "bold", color: "#1f2937" }}>
              Subject: Payoff Wire Information
            </p>
            <p style={{ margin: "0 0 22px", color: "#4b5563" }}>
              Please find below the payoff and wiring instructions for your
              account. Wires received after the valid through date may require
              updated instructions.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Merchant Name:</strong> {merchantName}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Payoff Amount:</strong> {payoffAmount}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Beneficiary Name:</strong> {lenderName}
            </p>
            <p style={{ margin: "0 0 22px" }}>
              <strong>Valid Till:</strong> {validTill}
            </p>
            <p style={{ margin: "0 0 24px", color: "#4b5563" }}>
              Please wire the payoff amount to the bank account below. Include
              the Merchant&apos;s name or Customer ID as reference in the memo
              section of the wire.
            </p>
            <p
              style={{
                margin: "0 0 6px",
                fontSize: 15,
                fontWeight: "bold",
                color: "#1f2937",
              }}
            >
              {bankName}
            </p>
            <p
              style={{
                margin: bankAddress2 ? "0 0 3px" : "0 0 16px",
                color: "#4b5563",
              }}
            >
              {bankAddress1}
            </p>
            {bankAddress2 ? (
              <p style={{ margin: "0 0 16px", color: "#4b5563" }}>
                {bankAddress2}
              </p>
            ) : null}
            <table
              role="presentation"
              cellPadding={0}
              cellSpacing={0}
              style={{ borderCollapse: "collapse" }}
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
                    <span style={{ color: "#4b5563" }}>{routing}</span>
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
                    <span style={{ color: "#4b5563" }}>{accountNumber}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
