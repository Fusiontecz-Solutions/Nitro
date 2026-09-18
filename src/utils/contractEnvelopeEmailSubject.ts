import { EMAIL_BRAND_DISPLAY_NAME } from '../constants/emailBrand';
import { sanitizeLetterPdfFilename } from '../services/pdf/letterHtmlToPdf.service';

/** Lender prefix for contract envelope email subjects and PDF names. */
export const CONTRACT_ENVELOPE_LENDER_NAME = String(
  process.env.DOCUSIGN_EMAIL_LENDER_NAME || EMAIL_BRAND_DISPLAY_NAME,
).trim();

export type ContractEnvelopeEmailContext = {
  businessName: string | null;
  offerAmount: number | string | null;
  funderName: string | null;
};

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

/**
 * Contract / SignNow invite subject:
 * Selected Funder Business name $Amount
 */
export function buildContractEnvelopeEmailSubject(
  businessName: string,
  offerAmount?: number | string | null,
  funderName?: string | null,
): string {
  const business = String(businessName || '').trim() || 'Business';
  const amount = formatContractOfferAmountForSubject(offerAmount);
  const selectedFunder =
    String(funderName || '').trim() || CONTRACT_ENVELOPE_LENDER_NAME;
  return `${selectedFunder} ${business} ${amount}`;
}

/** ACH / standalone subject / PDF name: {FunderName}: BusinessName - ACH */
export function buildAchFormEnvelopeEmailSubject(
  businessName: string,
  _offerAmount?: number | string | null,
  funderName?: string | null,
): string {
  const business = String(businessName || '').trim() || 'Business';
  const lender =
    String(funderName || '').trim() || CONTRACT_ENVELOPE_LENDER_NAME;
  return `${lender}: ${business} - ACH`;
}

export function extractContractEmailContextFromPrefill(
  fields?:
    | Array<{ id?: string; value?: unknown }>
    | Record<string, unknown>
    | null,
): ContractEnvelopeEmailContext {
  const map = new Map<string, string>();
  if (Array.isArray(fields)) {
    for (const field of fields) {
      const id = String(field?.id || '').trim().toLowerCase();
      const value = String(field?.value ?? '').trim();
      if (id && value) map.set(id, value);
    }
  } else if (fields && typeof fields === 'object') {
    for (const [key, raw] of Object.entries(fields)) {
      const id = String(key || '').trim().toLowerCase();
      const value = String(raw ?? '').trim();
      if (id && value) map.set(id, value);
    }
  }
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const value = map.get(key.toLowerCase());
      if (value) return value;
    }
    return '';
  };
  return {
    businessName:
      pick(
        'client_legal_name',
        'client_name',
        'legal_name',
        'business_legal_name',
        'merchant_legal_name',
        'doing_business_as',
        'dba',
      ) || null,
    offerAmount:
      pick('approved_amount', 'approvedamount', 'approvedAmount') || null,
    funderName:
      pick('funder_name', 'disclosure_funder_name', 'lender_name') || null,
  };
}

/**
 * Guards subjects that bypass buildContractEnvelopeEmailSubject (e.g. a raw
 * caller-supplied title fallback): prepends a $ to a trailing bare amount
 * like "Business 12000.00" so it reads "Business $12000.00".
 */
export function ensureSubjectAmountHasDollarSign(subject: string): string {
  const trimmed = String(subject || '').trim();
  if (!trimmed) return trimmed;
  return trimmed.replace(
    /(^|[^$\d])(\d[\d,]*\.\d{2})\s*$/,
    (_match, pre: string, amount: string) => `${pre}$${amount}`,
  );
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
  funderName?: string | null,
): string {
  return buildContractEnvelopeEmailSubject(businessName, offerAmount, funderName);
}
