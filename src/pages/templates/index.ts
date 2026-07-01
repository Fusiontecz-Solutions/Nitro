export {
  BUILTIN_FE_TEMPLATE_ID_PREFIX,
  BUILTIN_FE_TEMPLATES,
  getBuiltinReactTemplateDefinition,
  isBuiltinFeTemplate,
  mergeBuiltinFeTemplates,
  previewValuesForBuiltinDefinition,
  renderBuiltinReactTemplateHtml,
} from "./registry";

export type {
  TemplateCategory,
  TemplateComponentProps,
  TemplateDefinition,
  TemplateValues,
  TemplateVariable,
} from "./types";
export { TEMPLATE_CATEGORY_LABELS, pick } from "./types";
export {
  default as ApplicationApprovalEmail,
  APPLICATION_APPROVAL_EMAIL_VARIABLES,
} from "./ApplicationApprovalEmail";
export { renderApplicationApprovalEmailHtml } from "./applicationApprovalEmailHtml";
export {
  default as ApplicationApprovedEmail,
  APPLICATION_APPROVED_EMAIL_VARIABLES,
} from "./ApplicationApprovedEmail";
export { renderApplicationApprovedEmailHtml } from "./applicationApprovedEmailHtml";
export {
  default as ApplicationRejectionEmail,
  APPLICATION_REJECTION_EMAIL_VARIABLES,
} from "./ApplicationRejectionEmail";
export { renderApplicationRejectionEmailHtml } from "./applicationRejectionEmailHtml";
export {
  default as OfferUpdatedEmail,
  OFFER_UPDATED_EMAIL_VARIABLES,
} from "./OfferUpdatedEmail";
export { renderOfferUpdatedEmailHtml } from "./offerUpdatedEmailHtml";
export { renderDocumentRequestEmailHtml } from "./documentRequestEmailHtml";
export {
  default as DocumentRequestEmail,
  DOCUMENT_REQUEST_EMAIL_VARIABLES,
} from "./DocumentRequestEmail";
export {
  APPLICATION_APPROVAL_EMAIL_SUBJECT,
  OFFER_UPDATED_EMAIL_SUBJECT,
  APPLICATION_APPROVAL_URL_PLACEHOLDER,
  APPLICATION_APPROVAL_CLIENT_NAME_PLACEHOLDER,
  APPLICATION_APPROVAL_COMPANY_NAME_PLACEHOLDER,
  resolveApplicationApprovalEmailFields,
  buildApplicationApprovalEmailServerPlaceholderValues,
} from "./applicationApprovalEmailShared";
export {
  APPLICATION_APPROVED_EMAIL_SUBJECT,
  APPLICATION_APPROVED_CLIENT_NAME_PLACEHOLDER,
  APPLICATION_APPROVED_COMPANY_NAME_PLACEHOLDER,
  APPLICATION_APPROVED_REQUEST_AMOUNT_PLACEHOLDER,
  APPLICATION_APPROVED_APPROVED_AMOUNT_PLACEHOLDER,
  APPLICATION_APPROVED_FACTOR_RATE_PLACEHOLDER,
  APPLICATION_APPROVED_PAYBACK_AMOUNT_PLACEHOLDER,
  APPLICATION_APPROVED_TERM_PLACEHOLDER,
  APPLICATION_APPROVED_REPAY_PLACEHOLDER,
  APPLICATION_APPROVED_MONTHLY_REPAYMENT_PLACEHOLDER,
  APPLICATION_APPROVED_ACH_FREQUENCY_PLACEHOLDER,
  resolveApplicationApprovedEmailFields,
  buildApplicationApprovedEmailServerPlaceholderValues,
} from "./applicationApprovedEmailShared";
export {
  APPLICATION_REJECTION_EMAIL_SUBJECT,
  buildApplicationRejectionEmailSubject,
  resolveApplicationRejectionEmailFields,
} from "./applicationRejectionEmailShared";
export {
  DOCUMENT_REQUEST_UPLOAD_URL_PLACEHOLDER,
  documentRequestEmailSubject,
  resolveDocumentRequestEmailFields,
} from "./documentRequestEmailShared";
