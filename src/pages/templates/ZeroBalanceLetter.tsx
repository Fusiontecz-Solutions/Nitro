import type {
  TemplateComponentProps,
  TemplateVariable,
} from "./types";
import { pick } from "./types";

/**
 * Zero-balance confirmation letter merge fields. The sent email HTML is rendered
 * by `zeroBalanceLetterEmailHtml.ts` (Nitro Advance branded layout).
 *
 * Data Personalization in Letters.tsx is curated by `personalizationLayout("zbl")`
 * — not every variable below is shown in that form.
 */
export const ZERO_BALANCE_LETTER_VARIABLES: TemplateVariable[] = [
  { key: "letter_date", label: "Letter Date", placeholder: "05/20/2024" },
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
  { key: "deal_id", label: "Deal ID", placeholder: "OA-1001" },
  {
    key: "merchant_name",
    label: "Merchant Name",
    placeholder: "Acme LLC",
  },
  {
    key: "salutation_name",
    label: "Salutation Name",
    placeholder: "Joseph",
  },
  {
    key: "date_of_funding",
    label: "Date of Funding",
    placeholder: "05/20/2024",
  },
  {
    key: "account_status",
    label: "Status",
    placeholder: "Zero Balance",
    defaultValue: "Zero Balance",
  },
  {
    key: "sender_name",
    label: "Sender Name",
    placeholder: "Admin Team",
    defaultValue: "Admin Team",
  },
];

/** Fixed line under the sender name in zero balance letter preview + email. */
export const ZERO_BALANCE_LETTER_SIGNATURE_TITLE = "Account Specialist";

/** Shown under Sincerely when sender_name is blank. */
export const ZERO_BALANCE_LETTER_DEFAULT_SENDER_NAME = "Admin Team";

const v = ZERO_BALANCE_LETTER_VARIABLES.reduce<
  Record<string, TemplateVariable>
>((acc, variable) => {
  acc[variable.key] = variable;
  return acc;
}, {});

export default function ZeroBalanceLetter({ values }: TemplateComponentProps) {
  const letterDate = pick(values, v.letter_date);
  const dealId = pick(values, v.deal_id);
  const merchantName = pick(values, v.merchant_name);
  const salutationName = pick(values, v.salutation_name);
  const dateOfFunding = pick(values, v.date_of_funding);
  const accountStatus = pick(values, v.account_status);

  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{
        borderCollapse: "collapse",
        width: "100%",
        maxWidth: 640,
        fontFamily: "Helvetica, Arial, sans-serif",
        fontSize: 14,
        lineHeight: 1.55,
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
                fontSize: 32,
                fontWeight: "bold",
                color: "#1FA5E3",
                letterSpacing: "1px",
                textTransform: "uppercase",
              }}
            >
              Zero Balance Letter
            </h1>
            <p style={{ margin: "0 0 16px", color: "#718096" }}>{letterDate}</p>
            <p style={{ margin: "0 0 8px", fontWeight: "bold", color: "#1f2937" }}>
              Re: {merchantName}
            </p>
            <p style={{ margin: "0 0 16px", fontWeight: "bold", color: "#1f2937" }}>
              Subject : Zero Balance Letter
            </p>
            <p style={{ margin: "0 0 14px" }}>Dear {salutationName},</p>
            <p style={{ margin: "0 0 24px", color: "#4a5568" }}>
              This letter is to confirm that your account with us has a zero balance
              as of the date below. At this time, there is no amount due on your
              account.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Deal ID:</strong> {dealId}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Merchant Name:</strong> {merchantName}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Date of Funding:</strong> {dateOfFunding}
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Status:</strong> {accountStatus}
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
