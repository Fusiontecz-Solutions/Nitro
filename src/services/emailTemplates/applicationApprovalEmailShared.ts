/** Display name for outbound emails (override via APP_COMPANY_NAME). */
export const APP_COMPANY_NAME =
  String(process.env.APP_COMPANY_NAME || '').trim() || 'Katan Capital';

/** CRM product name referenced in client-facing emails. */
export const APP_COMPANY_CRM_NAME =
  String(process.env.APP_COMPANY_CRM_NAME || '').trim() || `${APP_COMPANY_NAME} CRM`;

export const CLIENT_PROVIDED_STIPS = [
  'Void Check',
  "Driver's License",
  'Merchant Interview',
] as const;

export const COMPANY_HANDLED_STIPS = [
  'Decision Logic/Bank Login',
  'Recent Bank Statements',
] as const;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type ApplicationApprovalTemplateValues = Record<string, string | undefined>;

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
  values: ApplicationApprovalTemplateValues,
): ApplicationApprovalEmailFields {
  const clientName = String(values.client_name || '').trim() || 'Valued Client';
  const companyName = String(values.company_name || '').trim() || 'your company';
  const viewApplicationUrl = String(values.view_application_url || '').trim() || '#';
  const calculateApprovalUrl =
    String(values.calculate_approval_url || '').trim() || '#';

  return {
    clientName,
    companyName,
    viewApplicationUrl,
    calculateApprovalUrl,
    viewCommentUrl: calculateApprovalUrl,
    companyNameBrand: APP_COMPANY_NAME,
    crmName: APP_COMPANY_CRM_NAME,
  };
}
