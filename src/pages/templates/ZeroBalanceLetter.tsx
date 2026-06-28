import type {
  TemplateComponentProps,
  TemplateVariable,
} from "./types";
import { pick } from "./types";

/**
 * Zero-balance confirmation letter merge fields. The sent email HTML is rendered
 * by `zeroBalanceLetterEmailHtml.ts` (purple/cyan layout).
 */
export const ZERO_BALANCE_LETTER_VARIABLES: TemplateVariable[] = [
  { key: "letter_date", label: "Letter Date", placeholder: "May 20, 2024" },
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
    key: "salutation_name",
    label: "Salutation Name",
    placeholder: "John Doe",
  },
  {
    key: "funding_amount",
    label: "Funding Amount",
    placeholder: "$50,000.00",
  },
  {
    key: "account_status",
    label: "Account Status",
    placeholder: "Paid in Full",
  },
  { key: "sender_name", label: "Sender Name", placeholder: "Your Name" },
];

/** Fixed line under the sender name in zero balance letter preview + email. */
export const ZERO_BALANCE_LETTER_SIGNATURE_TITLE = "Account Specialist";

const v = ZERO_BALANCE_LETTER_VARIABLES.reduce<
  Record<string, TemplateVariable>
>((acc, variable) => {
  acc[variable.key] = variable;
  return acc;
}, {});

export default function ZeroBalanceLetter({ values }: TemplateComponentProps) {
  const letterDate = pick(values, v.letter_date);
  const recipientName = pick(values, v.recipient_name);
  const recipientAddress1 = pick(values, v.recipient_address_line1);
  const recipientAddress2 = pick(values, v.recipient_address_line2);
  const accountName = pick(values, v.account_name);
  const salutationName = pick(values, v.salutation_name);
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
            <p style={{ margin: "0 0 16px", color: "#718096" }}>{letterDate}</p>
            <div style={{ margin: "0 0 24px", fontWeight: "bold" }}>
              {recipientName}
              <br />
              {recipientAddress1}
              <br />
              {recipientAddress2}
            </div>
            <p style={{ margin: "0 0 20px", fontWeight: "bold", color: "#132238" }}>
              Re: {accountName}
            </p>
            <p style={{ margin: "0 0 14px" }}>Dear {salutationName},</p>
            <p style={{ margin: "0 0 24px", color: "#4a5568", textAlign: "justify" }}>
              This letter is to confirm that your account with us has a zero balance
              as of the date below. At this time, there is no amount due on your
              account.
            </p>
            <p style={{ margin: "0 0 8px" }}>
              <strong>Account Status:</strong> {accountStatus}
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
