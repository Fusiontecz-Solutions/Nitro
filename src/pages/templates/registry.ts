import ApplicationApprovalEmail, {
  APPLICATION_APPROVAL_EMAIL_VARIABLES,
} from "./ApplicationApprovalEmail";
import { renderApplicationApprovalEmailHtml } from "./applicationApprovalEmailHtml";
import ApplicationRejectionEmail, {
  APPLICATION_REJECTION_EMAIL_VARIABLES,
} from "./ApplicationRejectionEmail";
import { renderApplicationRejectionEmailHtml } from "./applicationRejectionEmailHtml";
import DocumentRequestEmail, {
  DOCUMENT_REQUEST_EMAIL_VARIABLES,
} from "./DocumentRequestEmail";
import { renderDocumentRequestEmailHtml } from "./documentRequestEmailHtml";
import OfferUpdatedEmail, {
  OFFER_UPDATED_EMAIL_VARIABLES,
} from "./OfferUpdatedEmail";
import { renderOfferUpdatedEmailHtml } from "./offerUpdatedEmailHtml";
import type { TemplateDefinition } from "./types";

/**
 * Central registry of every template in this folder. Add new templates here
 * so they automatically show up in the Template Playground (`/template-playground`).
 */
export const TEMPLATE_REGISTRY: TemplateDefinition[] = [
  {
    id: "application-rejection-email",
    name: "Application Rejection Email",
    category: "email",
    description:
      "Email sent to a client / ISO when an application is rejected during underwriting.",
    variables: APPLICATION_REJECTION_EMAIL_VARIABLES,
    Component: ApplicationRejectionEmail,
    renderHtml: renderApplicationRejectionEmailHtml,
  },
  {
    id: "document-request-email",
    name: "Document Request Email",
    category: "email",
    description:
      "Email sent to an ISO / client requesting documents be uploaded via the public portal.",
    variables: DOCUMENT_REQUEST_EMAIL_VARIABLES,
    Component: DocumentRequestEmail,
    renderHtml: renderDocumentRequestEmailHtml,
  },
  {
    id: "application-approval-email",
    name: "Application Approval Email",
    category: "email",
    description:
      "Email sent to an ISO / client when an application is pre-approved, with a link to calculate approvals.",
    variables: APPLICATION_APPROVAL_EMAIL_VARIABLES,
    Component: ApplicationApprovalEmail,
    renderHtml: renderApplicationApprovalEmailHtml,
  },
  {
    id: "offer-updated-email",
    name: "Offer Updated Email",
    category: "email",
    description:
      "Email sent to an ISO / client when approved offer values are updated, with a link to review the new offer.",
    variables: OFFER_UPDATED_EMAIL_VARIABLES,
    Component: OfferUpdatedEmail,
    renderHtml: renderOfferUpdatedEmailHtml,
  },
];
