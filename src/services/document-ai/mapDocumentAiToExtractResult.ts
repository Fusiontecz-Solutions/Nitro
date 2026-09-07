import type { google } from '@google-cloud/documentai/build/protos/protos';
import type { PdfClaudeExtractResultDTO } from '../../nestjs-claude-pdf/claude-pdf-extraction.service';
import { preferBetterEin, resolveEin } from '../einSanitizer';

type Document = google.cloud.documentai.v1.IDocument;
type TextAnchor = google.cloud.documentai.v1.Document.ITextAnchor;

/**
 * Custom Document AI extractor field IDs — application auto-create, driver license, void check.
 * These names must stay distinct; never alias one schema field onto another.
 */
export const DOCUMENT_AI_SCHEMA_FIELDS = [
  'account_holder_address_line1',
  'account_holder_address_line2',
  'account_holder_name',
  'account_number',
  'account_type',
  'address_line1',
  'address_line2',
  'applicant_name',
  'bank_address',
  'bank_city',
  'bank_name',
  'bank_state',
  'bank_zip',
  'business_name',
  'check_number',
  'city',
  'credit_score',
  'date_business_started',
  'date_of_birth',
  'dba_name',
  'driver_license_number',
  'ein',
  'email',
  'expiration_date',
  'eye_color',
  'first_name',
  'full_name',
  'gross_annual_sales',
  'height',
  'home_address',
  'issue_date',
  'last_name',
  'legal_business_name',
  'license_class',
  'owner_city',
  'owner_email',
  'owner_first_name',
  'owner_last_name',
  'owner_mobile',
  'owner_state',
  'owner_zip',
  'ownership_percent',
  'phone',
  'physical_address',
  'requested_amount',
  'routing_number',
  'sex',
  'ssn',
  'state',
  'type_of_entity',
  'website',
  'zip',
] as const;

function normalizeFieldKey(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[#:]/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function textFromAnchor(document: Document, anchor?: TextAnchor | null): string {
  const full = String(document.text || '');
  if (!anchor?.textSegments?.length) return '';
  return anchor.textSegments
    .map((seg) => {
      const start = Number(seg.startIndex ?? 0);
      const end = Number(seg.endIndex ?? 0);
      return full.substring(start, end);
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(kd: Record<string, string>, key: string): string {
  return String(kd[key] || '').trim();
}

function setIfEmpty(kd: Record<string, string>, key: string, value: string): void {
  const v = String(value || '').trim();
  if (!v || pick(kd, key)) return;
  kd[key] = v;
}

function splitPersonName(full: string): { first: string; last: string } | null {
  const parts = String(full || '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return null;
  return {
    first: parts.slice(0, -1).join(' '),
    last: parts[parts.length - 1]!,
  };
}

/**
 * Non-schema labels → schema field IDs.
 * Schema IDs listed above always map to themselves.
 */
const FIELD_ALIASES: Record<string, string> = {
  legal_corporate_name: 'legal_business_name',
  legal_name: 'legal_business_name',
  company_name: 'business_name',
  corporate_name: 'business_name',
  merchant_name: 'business_name',
  dba: 'dba_name',
  doing_business_as: 'dba_name',
  business_address: 'physical_address',
  street_address: 'physical_address',
  address: 'physical_address',
  business_city: 'city',
  business_state: 'state',
  zip_code: 'zip',
  business_zip: 'zip',
  telephone: 'phone',
  business_phone: 'phone',
  phone_number: 'phone',
  business_email: 'email',
  email_address: 'email',
  federal_tax_id: 'ein',
  federal_tax_id_number: 'ein',
  tax_id: 'ein',
  tax_id_number: 'ein',
  fein: 'ein',
  employer_identification_number: 'ein',
  business_ein_number: 'ein',
  loan_amount: 'requested_amount',
  amount_requested: 'requested_amount',
  funding_requested: 'requested_amount',
  annual_sales: 'gross_annual_sales',
  principal_first_name: 'owner_first_name',
  principal_last_name: 'owner_last_name',
  given_name: 'first_name',
  family_name: 'last_name',
  applicant: 'applicant_name',
  owner_name: 'applicant_name',
  principal_name: 'applicant_name',
  social_security_number: 'ssn',
  owner_ssn: 'ssn',
  dob: 'date_of_birth',
  mobile_phone: 'owner_mobile',
  cell_phone: 'owner_mobile',
  owner_phone: 'owner_mobile',
  personal_email: 'owner_email',
  principal_email: 'owner_email',
  owner_address: 'home_address',
  residential_address: 'home_address',
  ownership_percentage: 'ownership_percent',
  fico: 'credit_score',
  business_start_date: 'date_business_started',
  incorporation_date: 'date_business_started',
  entity_type: 'type_of_entity',
  url: 'website',
  license_number: 'driver_license_number',
  dl_number: 'driver_license_number',
  exp_date: 'expiration_date',
  member_name: 'account_holder_name',
  aba_routing_number: 'routing_number',
  checking_account_number: 'account_number',
};

for (const field of DOCUMENT_AI_SCHEMA_FIELDS) {
  FIELD_ALIASES[field] = field;
}

function canonicalKey(rawLabel: string): string {
  const nk = normalizeFieldKey(rawLabel);
  return FIELD_ALIASES[nk] || nk;
}

function mergeKeyData(target: Record<string, string>, label: string, value: string): void {
  const v = String(value || '').trim();
  if (!v) return;
  const key = canonicalKey(label);
  if (key === 'ein') {
    const chosen = preferBetterEin(target[key], v);
    if (chosen) target[key] = chosen;
    return;
  }
  if (!target[key] || target[key].length < v.length) {
    target[key] = v;
  }
}

function collectFormFields(document: Document, keyData: Record<string, string>): void {
  for (const page of document.pages || []) {
    for (const field of page.formFields || []) {
      const name = textFromAnchor(document, field.fieldName?.textAnchor);
      const value = textFromAnchor(document, field.fieldValue?.textAnchor);
      if (name) mergeKeyData(keyData, name, value);
    }
  }
}

function collectEntities(document: Document, keyData: Record<string, string>): void {
  for (const entity of document.entities || []) {
    const type = String(entity.type || '').trim();
    const value =
      String(entity.mentionText || '').trim() ||
      String(entity.normalizedValue?.text || '').trim();
    if (type) mergeKeyData(keyData, type, value);

    for (const prop of entity.properties || []) {
      const propType = String(prop.type || '').trim();
      const propValue =
        String(prop.mentionText || '').trim() ||
        String(prop.normalizedValue?.text || '').trim();
      if (propType) mergeKeyData(keyData, propType, propValue);
    }
  }
}

/** Fill empty application / KYC keys from sibling schema fields without collapsing them. */
export function applyDocumentAiSchemaFallbacks(kd: Record<string, string>): Record<string, string> {
  setIfEmpty(kd, 'business_name', pick(kd, 'legal_business_name'));
  setIfEmpty(kd, 'legal_business_name', pick(kd, 'business_name'));

  const applicantSplit = splitPersonName(pick(kd, 'applicant_name'));
  const fullSplit = splitPersonName(pick(kd, 'full_name'));

  setIfEmpty(kd, 'owner_first_name', pick(kd, 'first_name'));
  setIfEmpty(kd, 'owner_last_name', pick(kd, 'last_name'));
  setIfEmpty(kd, 'first_name', pick(kd, 'owner_first_name'));
  setIfEmpty(kd, 'last_name', pick(kd, 'owner_last_name'));

  if (applicantSplit) {
    setIfEmpty(kd, 'owner_first_name', applicantSplit.first);
    setIfEmpty(kd, 'owner_last_name', applicantSplit.last);
    setIfEmpty(kd, 'first_name', applicantSplit.first);
    setIfEmpty(kd, 'last_name', applicantSplit.last);
  }
  if (fullSplit) {
    setIfEmpty(kd, 'first_name', fullSplit.first);
    setIfEmpty(kd, 'last_name', fullSplit.last);
    setIfEmpty(kd, 'owner_first_name', fullSplit.first);
    setIfEmpty(kd, 'owner_last_name', fullSplit.last);
  }

  setIfEmpty(kd, 'full_name', [pick(kd, 'first_name'), pick(kd, 'last_name')].filter(Boolean).join(' '));
  setIfEmpty(
    kd,
    'applicant_name',
    [pick(kd, 'owner_first_name'), pick(kd, 'owner_last_name')].filter(Boolean).join(' '),
  );
  setIfEmpty(
    kd,
    'home_address',
    [pick(kd, 'address_line1'), pick(kd, 'address_line2')].filter(Boolean).join(', '),
  );

  return kd;
}

export function mapDocumentAiToExtractResult(document: Document): PdfClaudeExtractResultDTO {
  const key_data: Record<string, string> = {};
  collectFormFields(document, key_data);
  collectEntities(document, key_data);
  applyDocumentAiSchemaFallbacks(key_data);

  const pages = (document.pages || []).map((page, idx) => ({
    page_number: Number(page.pageNumber ?? idx + 1),
    note: '',
  }));

  const fullText = String(document.text || '').trim();
  const ein = resolveEin(key_data.ein, fullText);
  if (ein) key_data.ein = ein;
  else delete key_data.ein;

  const docTypeGuess = /driver|license|identification/i.test(fullText)
    ? 'driver_license'
    : /routing|account number|voided check|direct deposit/i.test(fullText)
      ? 'voided_check'
      : /application|merchant|funding|loan|mca/i.test(fullText)
        ? 'business_funding_application'
        : 'unknown';

  return {
    document_type: docTypeGuess,
    title: '',
    summary: fullText.slice(0, 500),
    key_data,
    pages,
    transactions: [],
    model_notes: 'extracted_via_google_document_ai',
    raw_ocr_text: fullText,
  };
}

export function mapDocumentAiToKycKeyData(
  document: Document,
  documentType: 'driverLicense' | 'voidedCheck',
): Record<string, string> {
  const result = mapDocumentAiToExtractResult(document);
  const kd = { ...(result.key_data || {}) };

  if (documentType === 'driverLicense') {
    setIfEmpty(kd, 'first_name', pick(kd, 'owner_first_name'));
    setIfEmpty(kd, 'last_name', pick(kd, 'owner_last_name'));
    setIfEmpty(kd, 'address_line1', pick(kd, 'home_address'));
    setIfEmpty(kd, 'city', pick(kd, 'owner_city'));
    setIfEmpty(kd, 'state', pick(kd, 'owner_state'));
    setIfEmpty(kd, 'zip', pick(kd, 'owner_zip'));
  }

  if (documentType === 'voidedCheck') {
    setIfEmpty(kd, 'account_holder_name', pick(kd, 'member_name'));
    setIfEmpty(kd, 'account_holder_address_line1', pick(kd, 'address_line1'));
    setIfEmpty(kd, 'account_holder_address_line2', pick(kd, 'address_line2'));
    setIfEmpty(kd, 'routing_number', pick(kd, 'aba_routing_number'));
    setIfEmpty(kd, 'account_number', pick(kd, 'checking_account_number'));
    setIfEmpty(kd, 'legal_business_name', pick(kd, 'business_name'));
  }

  return kd;
}
