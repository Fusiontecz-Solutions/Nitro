import type { TemplateVariable } from "./types";
import { createHtmlTemplatePreview } from "./HtmlTemplatePreview";
import { renderSignedContractEmailTemplateHtml } from "./contractStatusEmailHtml";

/**
 * Merge fields for the Signed Contract email. `logo_url`, `brand_primary`,
 * `brand_accent` and `company_name` come from the funder's Letter Info — the
 * playground's Funder picker fills them in.
 */
export const SIGNED_CONTRACT_EMAIL_VARIABLES: TemplateVariable[] = [
  {
    key: "book_name",
    label: "Funder name",
    placeholder: "Obsidian Capital Group",
    defaultValue: "Obsidian Capital Group",
  },
  {
    key: "merchant_name",
    label: "Merchant name",
    placeholder: "VVS CARTELL LLC",
    defaultValue: "VVS CARTELL LLC",
  },
  {
    key: "application_id",
    label: "Application ID",
    placeholder: "292",
    defaultValue: "292",
  },
  {
    key: "funded_amount",
    label: "Funded amount",
    placeholder: "$30,000.00",
    defaultValue: "$30,000.00",
  },
  {
    key: "signed_date",
    label: "Signed on",
    placeholder: "October 7, 2026",
    defaultValue: "October 7, 2026",
  },
  {
    key: "document_names",
    label: "Documents (comma separated)",
    placeholder: "Merchant Agreement, State Disclosure",
    defaultValue: "Merchant Agreement, State Disclosure",
  },
  {
    key: "attachment_name",
    label: "Attachment file name",
    placeholder: "Obsidian Capital Group VVS CARTELL LLC $30,000.00.pdf",
    defaultValue: "Obsidian Capital Group VVS CARTELL LLC $30,000.00.pdf",
  },
  {
    key: "company_name",
    label: "Sign-off company name",
    placeholder: "Obsidian Capital Group",
  },
  {
    key: "logo_url",
    label: "Logo URL",
    placeholder: "https://res.cloudinary.com/.../logo.png",
  },
  {
    key: "brand_primary",
    label: "Header color (accent strip dark)",
    placeholder: "#1E4FA3",
  },
  {
    key: "brand_accent",
    label: "Accent color (accent strip light)",
    placeholder: "#F26C11",
  },
];

const SignedContractEmail = createHtmlTemplatePreview(
  renderSignedContractEmailTemplateHtml,
  "Signed contract email preview",
);

export default SignedContractEmail;
