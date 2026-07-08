import { EMAIL_BRAND_DISPLAY_NAME } from '../constants/emailBrand';
import { sanitizeLetterPdfFilename } from '../services/pdf/letterHtmlToPdf.service';
import { isAllianceBridgeFunder } from '../services/docusign/utils/resolve-main-contract-layout';

/** Lender prefix for contract / ACH envelope email subjects and PDF names. */
export const CONTRACT_ENVELOPE_LENDER_NAME = String(
  process.env.DOCUSIGN_EMAIL_LENDER_NAME || EMAIL_BRAND_DISPLAY_NAME,
).trim();

/** Alliance Bridge contract envelope subject / PDF prefix (Texas and non-Texas). */
export const ALLIANCE_BRIDGE_CONTRACT_LENDER_NAME = 'ALLIANCE BRIDGE CAPITAL';

/** @deprecated Use CONTRACT_ENVELOPE_LENDER_NAME */
export const DOCUSIGN_EMAIL_LENDER_NAME = CONTRACT_ENVELOPE_LENDER_NAME;

export function resolveContractEnvelopeLenderName(options?: {
  funderName?: string | null;
}): string {
  if (isAllianceBridgeFunder(options?.funderName)) {
    return ALLIANCE_BRIDGE_CONTRACT_LENDER_NAME;
  }
  return CONTRACT_ENVELOPE_LENDER_NAME;
}

function parseContractOfferAmount(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[$,\s]/g, '').trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatContractOfferAmountForSubject(
  value?: number | string | null,
): string {
  const amount = parseContractOfferAmount(value);
  if (amount == null) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Contract envelope email subject: KATAN CAPITAL : BusinessName - $Offer Amount */
export function buildContractEnvelopeEmailSubject(
  businessName: string,
  offerAmount?: number | string | null,
  lenderName?: string | null,
): string {
  const business = String(businessName || '').trim() || 'Business';
  const amount = formatContractOfferAmountForSubject(offerAmount);
  const lender =
    String(lenderName ?? CONTRACT_ENVELOPE_LENDER_NAME).trim() ||
    CONTRACT_ENVELOPE_LENDER_NAME;
  return `${lender} : ${business} - ${amount}`;
}

/** ACH-only envelope email subject and PDF name: ACH FORM: BusinessName */
export function buildAchFormEnvelopeEmailSubject(businessName: string): string {
  const business = String(businessName || '').trim() || 'Business';
  return `ACH FORM: ${business}`;
}

/** @deprecated Use buildContractEnvelopeEmailSubject */
export function buildDocuSignEnvelopeEmailSubject(
  businessName: string,
  offerAmount?: number | string | null,
): string {
  return buildContractEnvelopeEmailSubject(businessName, offerAmount);
}

export function buildContractEnvelopePdfFilename(subject: string): string {
  return sanitizeLetterPdfFilename(subject);
}

export function buildContractEnvelopeDocumentName(subject: string): string {
  return buildContractEnvelopePdfFilename(subject).replace(/\.pdf$/i, '');
}

export function normalizeContractCcEmailSubject(subject: string | null | undefined): string {
  const trimmed = String(subject || '').trim();
  return trimmed || 'Contract';
}
