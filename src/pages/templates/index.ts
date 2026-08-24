export * from "./types";
export {
  APPLICATION_REJECTION_EMAIL_SUBJECT,
  buildApplicationRejectionEmailSubject,
  formatDeclineReasonsForEmail,
  DECLINE_REASONS_DELIMITER,
  resolveApplicationRejectionEmailFields,
  type ApplicationRejectionEmailFields,
} from "./applicationRejectionEmailShared";
export * from "./applicationRejectionEmailHtml";
export {
  APPLICATION_APPROVAL_EMAIL_SUBJECT,
  APPLICATION_APPROVAL_URL_PLACEHOLDER,
  APPLICATION_APPROVAL_CLIENT_NAME_PLACEHOLDER,
  APPLICATION_APPROVAL_COMPANY_NAME_PLACEHOLDER,
  OFFER_UPDATED_EMAIL_SUBJECT,
  APP_COMPANY_NAME,
  APP_COMPANY_CRM_NAME,
  resolveApplicationApprovalEmailFields,
  type ApplicationApprovalEmailFields,
} from "./applicationApprovalEmailShared";
export * from "./applicationApprovalEmailHtml";
export {
  APPLICATION_APPROVED_EMAIL_SUBJECT,
  buildApplicationApprovedEmailServerPlaceholderValues,
  resolveApplicationApprovedEmailFields,
  type ApplicationApprovedEmailFields,
} from "./applicationApprovedEmailShared";
export * from "./applicationApprovedEmailHtml";
export * from "./offerUpdatedEmailHtml";
export {
  DOCUMENT_REQUEST_UPLOAD_URL_PLACEHOLDER,
  documentRequestEmailSubject,
  resolveDocumentRequestEmailFields,
  type DocumentRequestEmailFields,
} from "./documentRequestEmailShared";
export * from "./documentRequestEmailHtml";
export * from "./letterEmailBranding";
export { default as ApplicationRejectionEmail, APPLICATION_REJECTION_EMAIL_VARIABLES } from "./ApplicationRejectionEmail";
export { default as ApplicationApprovalEmail } from "./ApplicationApprovalEmail";
export {
  default as ApplicationApprovedEmail,
  APPLICATION_APPROVED_EMAIL_VARIABLES,
} from "./ApplicationApprovedEmail";
export { TEMPLATE_REGISTRY } from "./registry";
export { default as TemplatePlayground } from "./TemplatePlayground";
