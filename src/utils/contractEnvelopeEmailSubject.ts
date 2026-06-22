import { EMAIL_BRAND_DISPLAY_NAME } from '../constants/emailBrand';
import { sanitizeLetterPdfFilename } from '../services/pdf/letterHtmlToPdf.service';

/** Lender prefix for contract envelope email subjects and PDF names. */
export const CONTRACT_ENVELOPE_LENDER_NAME = String(
  process.env.DOCUSIGN_EMAIL_LENDER_NAME || EMAIL_BRAND_DISPLAY_NAME,
).trim();

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

/** Contract envelope subject / PDF name: Woodmere Financial : BusinessName - $12,345.67 */
export function buildContractEnvelopeEmailSubject(
  businessName: string,
  offerAmount?: number | string | null,
): string {
  const business = String(businessName || '').trim() || 'Business';
  const amount = formatContractOfferAmountForSubject(offerAmount);
  return `${CONTRACT_ENVELOPE_LENDER_NAME} : ${business} - ${amount}`;
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

/** @deprecated Use buildContractEnvelopeEmailSubject */
export function buildDocuSignEnvelopeEmailSubject(
  businessName: string,
  offerAmount?: number | string | null,
): string {
  return buildContractEnvelopeEmailSubject(businessName, offerAmount);
}
