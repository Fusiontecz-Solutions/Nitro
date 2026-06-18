import type { TemplateVariable } from "./types";
import { APPLICATION_APPROVAL_EMAIL_VARIABLES } from "./ApplicationApprovalEmail";
import { createHtmlTemplatePreview } from "./HtmlTemplatePreview";
import { renderOfferUpdatedEmailHtml } from "./offerUpdatedEmailHtml";
import { APPLICATION_APPROVAL_URL_PLACEHOLDER } from "./applicationApprovalEmailShared";

/** Same merge fields as the approval email — resend uses the updated-offer copy. */
export const OFFER_UPDATED_EMAIL_VARIABLES: TemplateVariable[] =
  APPLICATION_APPROVAL_EMAIL_VARIABLES.map((variable) => {
    if (variable.key === "calculate_approval_url") {
      return {
        ...variable,
        label: "Review updated offer URL",
        placeholder: APPLICATION_APPROVAL_URL_PLACEHOLDER,
        defaultValue: "https://example.com/public/application/approval/sample-token",
      };
    }
    if (variable.key === "view_application_url") {
      return {
        ...variable,
        placeholder: APPLICATION_APPROVAL_URL_PLACEHOLDER,
        defaultValue: "https://example.com/public/application/approval/sample-token",
      };
    }
    return variable;
  });

const OfferUpdatedEmail = createHtmlTemplatePreview(
  renderOfferUpdatedEmailHtml,
  "Offer updated email preview",
);

export default OfferUpdatedEmail;
