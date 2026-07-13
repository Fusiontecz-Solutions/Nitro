import type { TemplateVariable } from "./types";
import { createHtmlTemplatePreview } from "./HtmlTemplatePreview";
import { renderAllianceZeroBalanceLetterHtml } from "./Allicance_Zero_Balance_Letterhtml";

/**
 * Merge fields shown in Data Personalization for the Alliance zero balance letter.
 * Keep in sync with `Allicance_Zero_Balance_Letterhtml.ts`.
 */
export const ALLIANCE_ZERO_BALANCE_LETTER_VARIABLES: TemplateVariable[] = [
  { key: "letter_date", label: "Letter Date", placeholder: "07/13/2026" },
  {
    key: "account_name",
    label: "Account Name (Business Name)",
    placeholder: "Acme LLC",
  },
  {
    key: "payment_account_number",
    label: "Account Number",
    placeholder: "0110039633",
    defaultValue: "0110039633",
  },
  {
    key: "account_status",
    label: "Account Status",
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

const AllianceZeroBalanceLetter = createHtmlTemplatePreview(
  renderAllianceZeroBalanceLetterHtml,
  "Alliance zero balance letter preview",
);

export default AllianceZeroBalanceLetter;
