import {
  APP_COMPANY_CRM_NAME,
  APP_COMPANY_NAME,
} from "@/constants/appBranding";

export const APPLICATION_APPROVAL_EMAIL_SUBJECT =
  "Your Application Has Been Approved";

export const OFFER_UPDATED_EMAIL_SUBJECT =
  "Your Offer Values Have Been Updated";

export const CLIENT_PROVIDED_STIPS = [
  "Void Check",
  "Driver's License",
  "Merchant Interview",
] as const;

export const COMPANY_HANDLED_STIPS = [
  "Decision Logic/Bank Login",
  "Recent Bank Statements",
] as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type ApplicationApprovalEmailFields = {
  clientName: string;
  companyName: string;
  viewApplicationUrl: string;
  calculateApprovalUrl: string;
  viewCommentUrl: string;
  companyNameBrand: string;
  crmName: string;
};

export function resolveApplicationApprovalEmailFields(
  values: Record<string, string | undefined>,
): ApplicationApprovalEmailFields {
  const clientName =
    String(values.client_name || "").trim() || "Valued Client";
  const companyName =
    String(values.company_name || "").trim() || "your company";
  const viewApplicationUrl =
    String(values.view_application_url || "").trim() || "#";
  const calculateApprovalUrl =
    String(values.calculate_approval_url || "").trim() || "#";

  return {
    clientName,
    companyName,
    viewApplicationUrl,
    calculateApprovalUrl,
    /** Same public approval portal as the primary CTA (calculate / review offer). */
    viewCommentUrl: calculateApprovalUrl,
    companyNameBrand: APP_COMPANY_NAME,
    crmName: APP_COMPANY_CRM_NAME,
  };
}
