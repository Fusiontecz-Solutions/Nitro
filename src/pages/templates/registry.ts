import ApplicationRejectionEmail, {
  APPLICATION_REJECTION_EMAIL_VARIABLES,
} from "./ApplicationRejectionEmail";
import { renderApplicationRejectionEmailHtml } from "./applicationRejectionEmailHtml";
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
];
