import type { TemplateVariable } from "./types";
import { createHtmlTemplatePreview } from "./HtmlTemplatePreview";
import { renderContractSentEmailTemplateHtml } from "./contractStatusEmailHtml";
import { SIGNED_CONTRACT_EMAIL_VARIABLES } from "./SignedContractEmail";

/**
 * Merge fields for the agent's Contract Sent email — the Signed Contract
 * fields, with the send date and the signers the package went to in place of
 * the signed date.
 */
export const CONTRACT_SENT_EMAIL_VARIABLES: TemplateVariable[] =
  SIGNED_CONTRACT_EMAIL_VARIABLES.flatMap((variable) =>
    variable.key === "signed_date"
      ? [
          { ...variable, key: "sent_date", label: "Sent on" },
          {
            key: "signer_emails",
            label: "Sent to (signer emails, comma separated)",
            placeholder: "owner@vvscartell.com",
            defaultValue: "owner@vvscartell.com",
          },
        ]
      : [variable],
  );

const ContractSentEmail = createHtmlTemplatePreview(
  renderContractSentEmailTemplateHtml,
  "Contract sent email preview",
);

export default ContractSentEmail;
