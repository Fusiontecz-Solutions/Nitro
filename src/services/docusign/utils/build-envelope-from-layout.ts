import type {
  DocumentLayout,
  DocumentLayoutPlacement,
} from './convert-docusign-template-export';
import {
  buildLayoutPrefillValueRecord,
  CRM_ID_TO_LAYOUT_VARIABLE,
  getPrefillDisplayLabel,
} from './prefill-layout-bridge';
import type { PrefillFieldInput } from './docusign-prefill';
import { DOCUSIGN_DEFAULT_ROLE_NAME, DOCUSIGN_SECONDARY_ROLE_NAME } from './docusign-client';
import {
  applyDocuSignPrefillTabStyle,
  resolveDocuSignPrefillTabWidth,
} from './docusign-tab-style';
import { embedArialBoldPdfFont, embedArialPdfFont } from './embed-arial-pdf-font';
import { DOCUMENT_LAYOUT_KEYS } from '../layouts/document-layout.registry';
import { isFunderContractLayoutKey } from '../../../utils/funderContractLayout';
import {
  buildScopedValuesForLayout,
  isMainContractLayoutKey,
  resolveSupplementalEnvelopeTabLabel,
} from './layout-prefill-scope';

const DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME = DOCUSIGN_SECONDARY_ROLE_NAME;

export type LayoutSignerInput = {
  roleName: string;
  name: string;
  email: string;
  routingOrder?: number;
};

export function prefillFieldsToValueMap(
  fields: Array<{ id?: string; value?: string }>,
): Record<string, string> {
  const out = buildLayoutPrefillValueRecord(fields as PrefillFieldInput[]);
  return expandPrefillValues(out);
}

export type BuildEnvelopeFromLayoutOptions = {
  layouts: DocumentLayout[];
  /** Prefill values keyed by layout variable (snake_case data labels). */
  values: Record<string, string>;
  signers: LayoutSignerInput[];
  ownerCount?: number;
  guarantorCount?: number;
  /** Display name for the primary (first) PDF in the envelope. */
  primaryDocumentName?: string;
  /**
   * When true, text/date values are already burned into document PDFs — only signature /
   * initial / attachment tabs are attached (visible to all recipients including CC).
   * @deprecated Prefer `flattenedLayoutKeys` when only some documents were flattened.
   */
  skipTextDateTabs?: boolean;
  /** Layout keys whose text/date prefill was burned into the PDF (skip duplicate tabs). */
  flattenedLayoutKeys?: ReadonlySet<string>;
  /** When true, text/date tabs are created locked (use only when sending immediately). */
  lockDataTabs?: boolean;
  /** Merged PDF bytes when multiple layouts are combined into one DocuSign document. */
  mergedDocument?: { name: string; documentBase64: string };
  /** Page offset per layout key (0-based) inside `mergedDocument`. */
  pageOffsetByLayoutKey?: Map<string, number>;
};

export async function countPdfPagesFromBase64(documentBase64: string): Promise<number> {
  const { PDFDocument } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(Buffer.from(documentBase64, 'base64'));
  return pdfDoc.getPageCount();
}

export function maxPlacementPageNumber(layout: DocumentLayout): number {
  let max = 1;
  for (const placement of layout.placements) {
    const page = parseInt(String(placement.pageNumber || '1'), 10);
    if (Number.isFinite(page) && page > max) max = page;
  }
  return max;
}

export async function assertLayoutPlacementsFitPdfPages(
  layout: DocumentLayout & { documentBase64?: string },
): Promise<void> {
  const base64 = layout.documentBase64;
  if (!base64) return;
  const pageCount = await countPdfPagesFromBase64(base64);
  const required = maxPlacementPageNumber(layout);
  if (required <= pageCount) return;
  throw new Error(
    `Document "${layout.name}" PDF has ${pageCount} page(s) but DocuSign tabs require page ${required}. ` +
      `Re-upload a ${required}-page PDF or update tab coordinates in state-document-config.`,
  );
}

export type LayoutPartyCounts = {
  ownerCount: number;
  guarantorCount: number;
};

/** Canonical CRM keys copied to legacy / duplicate tab labels automatically. */
const PREFILL_VALUE_ALIASES: Record<string, string[]> = {
  agreement_date: ['signature_date', 'disclosure_date', 'addendum_date'],
  addendum_date: ['agreement_date', 'signature_date', 'disclosure_date'],
  signature_date: ['agreement_date', 'addendum_date', 'Signature_date', 'disclosure_date'],
  Signature_date: ['signature_date', 'agreement_date', 'addendum_date', 'disclosure_date'],
  disclosure_date: ['agreement_date', 'addendum_date', 'signature_date'],
  /** Texas ACH / page-11 owner date labels — prefill from shared agreement date. */
  agreement_date_owner1_p11: [
    'agreement_date',
    'signature_date',
    'disclosure_date',
    'addendum_date',
  ],
  agreement_date_owner2_p11: [
    'agreement_date',
    'signature_date',
    'disclosure_date',
    'addendum_date',
  ],
  agreement_date_owner1_p6: [
    'agreement_date',
    'signature_date',
    'disclosure_date',
    'addendum_date',
  ],
  agreement_date_owner2_p6: [
    'agreement_date',
    'signature_date',
    'disclosure_date',
    'addendum_date',
  ],
  date_by_which_amount_mustbe_received: ['prepayment_received_by_date'],
  funder_name: ['disclosure_funder_name'],
  client_legal_name: ['business_legal_name', 'merchant_legal_name', 'client_legal_name_p11_footer'],
  client_legal_name_p11_footer: ['client_legal_name', 'business_legal_name', 'merchant_legal_name'],
  seller_1_name: [
    'owner1_guarantor_name',
    'guaranty_owner1_name',
    'guaranty_guarantor1_name',
    'client_name',
    'owner_name',
  ],
  seller_2_name: [
    'owner2_guarantor_name',
    'guaranty_owner2_name',
    'guaranty_guarantor2_name',
    'merchant2_name',
  ],
  business_name_2: [
    'owner2_guarantor_name',
    'guaranty_owner2_name',
    'guaranty_guarantor2_name',
    'merchant2_name',
    'appendix_merchant2_name',
    'addendum_dated_principal_owner2_name',
  ],
  client_name: [
    'client_name_by',
    'addendum_client_name',
    'guaranty_client_name',
    'owner1_guarantor_name',
    'guaranty_owner1_name',
    'guaranty_guarantor1_name',
    'security_guarantor',
  ],
  addendum_client_name: [
    'client_name',
    'owner1_guarantor_name',
    'guaranty_owner1_name',
    'guaranty_guarantor1_name',
    'guaranty_client_name',
    'security_guarantor',
  ],
  business_address: [
    'business_address_contract',
    'security_business_address',
    'guarantor_address',
    'recipient_address',
    'recipient_address1',
    'ach_authorization_account_holder_address',
  ],
  business_address_city: [
    'business_address_contract_city',
    'security_business_address_city',
    'guarantor_address_city',
    'ach_authorization_account_holder_city',
  ],
  business_address_state: [
    'business_address_contract_state',
    'security_business_address_state',
    'guarantor_address_state',
    'ach_authorization_account_holder_state',
  ],
  business_address_zip: [
    'business_address_contract_zip',
    'security_business_address_zip',
    'guarantor_address_zip',
    'ach_authorization_account_holder_zip',
  ],
  authorization_client_name: [
    'client_legal_name',
    'security_business_name',
    'business_legal_name',
  ],
  authorization_client_signer_name: [
    'customer_name',
    'client_name',
    'owner1_guarantor_name',
  ],
  ach_authorization_concent_account_holder_name: [
    'client_legal_name',
    'security_business_name',
    'business_legal_name',
    'authorization_client_name',
  ],
  ach_authorization_concent_account_holder_name_2: [
    'ach_authorization_concent_account_holder_name',
    'client_legal_name',
    'security_business_name',
    'business_legal_name',
    'authorization_client_name',
  ],
  entity_type: ['typeOfEntity1', 'typeofentity1'],
  typeofentity1: ['entity_type', 'typeOfEntity1'],
  typeOfEntity1: ['entity_type', 'typeofentity1'],
  federal_tax_id_ein: ['security_tax_ein', 'authorization_client_tax_id'],
  security_tax_ein: ['federal_tax_id_ein', 'authorization_client_tax_id'],
  frequency: ['paymentterms', 'payment_terms'],
  net_to_merchant: ['netfundprovided', 'net_fund_provided'],
  purchase_percent: ['specified_percentage', 'purchased_percent', 'percent_of_business_income'],
  percent_of_business_income: ['purchase_percent', 'specified_percentage', 'purchased_percent'],
  total_dollar_cost: [
    'finance_charge',
    'disclosure_finance_charge',
    'financeCharge',
    'total_dollar_cost_of_frinancing',
  ],
  finance_charge: [
    'total_dollar_cost',
    'disclosure_finance_charge',
    'financeCharge',
    'total_dollar_cost_of_frinancing',
  ],
  disclosure_finance_charge: [
    'total_dollar_cost',
    'finance_charge',
    'financeCharge',
    'total_dollar_cost_of_frinancing',
  ],
  total_amount_tobe_paid_to_provider: [
    'disclosure_total_payment',
    'total_repayment_amount',
    'purchase_price',
    'purchasePrice',
  ],
  total_amount_business_fund: ['disclosure_amount_financed', 'funding_provided'],
  total_amount_of_fund_disbursed: ['disclosure_recipient_funds', 'net_to_merchant'],
  total_amount_fund_disbursed: ['disclosure_recipient_funds', 'total_amount_of_fund_disbursed', 'net_to_merchant'],
  total_amount_of_fund_provided: ['disclosure_amount_financed', 'funding_provided', 'total_amount_business_fund'],
  total_of_payments: ['disclosure_total_payment', 'total_repayment_amount', 'purchase_price'],
  total_amount_sales_based_financing: ['disclosure_amount_financed', 'funding_provided', 'total_amount_business_fund'],
  disbursement_amount: ['disclosure_recipient_funds', 'total_amount_fund_disbursed', 'net_to_merchant'],
  total_repayment_amount: ['disclosure_total_payment', 'purchase_price', 'estimatedTotalPaymentAmount'],
  estimated_number_of_payement: ['disclosure_term_days', 'estimated_number_of_payments'],
  disclosure_name: [
    'legal_name',
    'client_legal_name',
    'security_business_name',
    'business_legal_name',
    'disclosure_merchant_name',
    'recipient_name',
    'client_name',
  ],
  disclosure_merchant_name: [
    'legal_name',
    'client_legal_name',
    'security_business_name',
    'business_legal_name',
    'disclosure_name',
    'recipient_name',
    'client_name',
  ],
  disclosure_date2: ['disclosure_date', 'agreement_date', 'signature_date'],
  recipient_name: [
    'legal_name',
    'client_legal_name',
    'security_business_name',
    'business_legal_name',
    'disclosure_merchant_name',
    'disclosure_name',
    'client_name',
  ],
  recipient_name2: [
    'legal_name',
    'client_legal_name',
    'security_business_name',
    'business_legal_name',
    'disclosure_merchant_name',
    'recipient_name',
    'disclosure_name',
    'client_name',
  ],
  recipient_address2: ['recipient_address', 'recipient_address1'],
  recipient_address: ['recipient_address1', 'business_address'],
  total_amount_commercial_financing: ['disclosure_amount_financed', 'funding_provided', 'total_amount_business_fund'],
  total_commerical_financing: ['disclosure_total_payment', 'total_repayment_amount'],
  deducted_at_disbursement: ['disclosure_origination_fee'],
  estimated_time_periodic_paymement: ['disclosure_term_days', 'estimated_number_of_payments'],
  theestimatedpayment: ['disclosure_estimated_payment', 'estimated_payment'],
  payment_exceed_percent: ['disclosure_payment_terms', 'percent_of_business_income'],
  signature1_date: ['disclosure_date', 'agreement_date', 'signature_date'],
  signature2_date: ['disclosure_date', 'agreement_date', 'signature_date'],
  estimated_payment_amount: ['disclosure_estimated_payment', 'estimated_payment', 'remittance'],
  monthly_income: ['disclosure_avg_monthly_revenue', 'avarage_monthly_income', 'etimated_average_income'],
  purchase_amount: ['disclosure_amount_financed', 'funding_provided'],
  purchase_price: ['disclosure_total_payment', 'total_repayment_amount', 'estimatedTotalPaymentAmount'],
  appendix_underwriting_fees: ['disclosure_broker_fee', 'underwriter_fee', 'underwriterfee', 'underwriter_fees'],
  owner1_guarantor_name: ['guaranty_owner1_name', 'guaranty_guarantor1_name', 'guaranty_client_name'],
  guaranty_owner1_name: ['owner1_guarantor_name', 'guaranty_guarantor1_name', 'guaranty_client_name', 'client_name'],
  guaranty_guarantor1_name: ['owner1_guarantor_name', 'guaranty_owner1_name', 'guaranty_client_name', 'client_name'],
  guaranty_client_name: ['client_name', 'owner1_guarantor_name', 'guaranty_owner1_name', 'guaranty_guarantor1_name'],
  security_guarantor: ['guaranty_guarantor1_name', 'guaranty_owner1_name', 'owner1_guarantor_name', 'client_name'],
  guaranty_owner1_ss: ['guaranty_guarantor1_ss'],
  guaranty_guarantor1_ss: ['guaranty_owner1_ss'],
  owner2_guarantor_name: [
    'guaranty_owner2_name',
    'guaranty_guarantor2_name',
    'merchant2_name',
    'appendix_merchant2_name',
    'addendum_dated_principal_owner2_name',
    'business_name_2',
  ],
  guaranty_owner2_name: [
    'owner2_guarantor_name',
    'guaranty_guarantor2_name',
    'merchant2_name',
    'appendix_merchant2_name',
    'addendum_dated_principal_owner2_name',
    'business_name_2',
  ],
  guaranty_guarantor2_name: [
    'owner2_guarantor_name',
    'guaranty_owner2_name',
    'merchant2_name',
    'appendix_merchant2_name',
    'addendum_dated_principal_owner2_name',
    'business_name_2',
  ],
  merchant2_name: [
    'owner2_guarantor_name',
    'guaranty_owner2_name',
    'guaranty_guarantor2_name',
    'appendix_merchant2_name',
    'addendum_dated_principal_owner2_name',
    'business_name_2',
  ],
  appendix_merchant2_name: [
    'owner2_guarantor_name',
    'guaranty_owner2_name',
    'merchant2_name',
    'guaranty_guarantor2_name',
    'addendum_dated_principal_owner2_name',
    'business_name_2',
  ],
  guaranty_owner2_ss: ['guaranty_guarantor2_ss'],
  guaranty_guarantor2_ss: ['guaranty_owner2_ss'],
  guaranty_owner2_driver_license: ['guaranty_guarantor2_driver_license'],
  guaranty_guarantor2_driver_license: ['guaranty_owner2_driver_license'],
};

/**
 * Merchant #2 initials — just right of Merchant #1 on the footer line (not mid-page).
 * ~1 initial-width + small gap from the primary tab; slightly higher on Y.
 */
const OWNER2_INITIAL_OFFSET_X = 108;
const OWNER2_INITIAL_OFFSET_Y = -6;

/** Nudge contract tabs down (DocuSign Y-down) so prefilled text sits on form lines. */
const CONTRACT_TAB_Y_OFFSET = Number(process.env.DOCUSIGN_CONTRACT_TAB_Y_OFFSET ?? 3) || 0;

function resolveTabYPosition(y: string | undefined, layoutKey?: string): string {
  const raw = String(y ?? '0').trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return raw || '0';
  if (layoutKey !== 'contract' || !CONTRACT_TAB_Y_OFFSET) return raw;
  return String(Math.max(0, Math.round(n + CONTRACT_TAB_Y_OFFSET)));
}

const PARTY2_NAME_KEYS = [
  'owner2_guarantor_name',
  'guaranty_owner2_name',
  'guaranty_guarantor2_name',
  'merchant2_name',
  'appendix_merchant2_name',
  'addendum_dated_principal_owner2_name',
  'business_name_2',
  'seller_2_name',
] as const;

const PARTY2_NAME_PRIORITY = [
  'owner2_guarantor_name',
  'merchant2_name',
  'guaranty_owner2_name',
  'guaranty_guarantor2_name',
  'appendix_merchant2_name',
  'addendum_dated_principal_owner2_name',
  'business_name_2',
  'seller_2_name',
] as const;

const PARTY1_NAME_KEYS = [
  'client_name',
  'addendum_client_name',
  'owner1_guarantor_name',
  'guaranty_owner1_name',
  'guaranty_guarantor1_name',
  'guaranty_client_name',
  'security_guarantor',
  'seller_1_name',
] as const;

const PARTY1_NAME_PRIORITY = [
  'owner1_guarantor_name',
  'guaranty_owner1_name',
  'guaranty_guarantor1_name',
  'guaranty_client_name',
  'security_guarantor',
  'client_name',
  'addendum_client_name',
  'seller_1_name',
] as const;

const PARTY1_SS_KEYS = ['guaranty_owner1_ss', 'guaranty_guarantor1_ss'] as const;
const PARTY1_DL_KEYS = [
  'guaranty_owner1_driver_license',
  'guaranty_guarantor1_driver_license',
] as const;

const PARTY2_SS_KEYS = ['guaranty_owner2_ss', 'guaranty_guarantor2_ss'] as const;

/** Woodmere contract page 16 = Katan page 15 (ACH portal, credentials, references). */
export const FILL_AT_SIGNING_VARIABLES = new Set([
  'ach_authorization_bank_portal_website',
  'ach_authorization_username',
  'ach_authorization_password',
  'ach_authorization_security_question1',
  'ach_authorization_security_answer1',
  'ach_authorization_security_question2',
  'ach_authorization_security_answer2',
  'ach_authorization_security_question3',
  'ach_authorization_security_answer3',
  'ach_authorization_other_infomation',
  'ach_authorization_reference_name1',
  'ach_authorization_reference_number_1',
  'ach_authorization_reference_relationship1',
  'ach_authorization_reference_name2',
  'ach_authorization_reference_number2',
  'ach_authorization_reference_relationship2',
  'ach_authorization_reference_name3',
  'ach_authorization_reference_number3',
  'ach_authorization_reference_relationship3',
]);

/** Katan uses page 15; Woodmere contract shifts portal section to page 16. */
const WOODMERE_CONTRACT_FILL_AT_SIGNING_PAGE = '16';

/** Woodmere-style 17-page contract (page-16 portal section) — excludes Texas Funding Group layout. */
function usesWoodmereStyleNonTexasContractLayout(layoutKey: string | undefined): boolean {
  const key = String(layoutKey || '').trim();
  if (!key || key === DOCUMENT_LAYOUT_KEYS.contract) return true;
  if (key === DOCUMENT_LAYOUT_KEYS.texasFundingGroupContract) return false;
  if (isFunderContractLayoutKey(key)) return true;
  return false;
}

/** Contract page 1 — merchant confirms or enters phone at signing (prefilled when available). */
export const REQUIRED_SIGNER_EDITABLE_VARIABLES = new Set(['client_phone']);

function isRequiredSignerEditablePlacement(placement: DocumentLayoutPlacement): boolean {
  const variable = String(placement.variable || '').trim().toLowerCase();
  return REQUIRED_SIGNER_EDITABLE_VARIABLES.has(variable);
}

function isFillAtSigningPlacement(placement: DocumentLayoutPlacement): boolean {
  if (placement.fillAtSigning === true) return true;
  const variable = String(placement.variable || '').trim().toLowerCase();
  return FILL_AT_SIGNING_VARIABLES.has(variable);
}

function isWoodmereContractFillAtSigningPlacement(
  layoutKey: string | undefined,
  placement: DocumentLayoutPlacement,
): boolean {
  if (!usesWoodmereStyleNonTexasContractLayout(layoutKey)) return false;
  // Explicit fillAtSigning works on any page (e.g. page-14 business phone).
  if (placement.fillAtSigning === true) return true;
  return (
    String(placement.pageNumber || '') === WOODMERE_CONTRACT_FILL_AT_SIGNING_PAGE &&
    isFillAtSigningPlacement(placement)
  );
}

/** Page-16 ACH fields start blank; page-1 client phone keeps CRM prefill on the live tab. */
function clearsValueAtSend(
  layoutKey: string | undefined,
  placement: DocumentLayoutPlacement,
): boolean {
  return isWoodmereContractFillAtSigningPlacement(layoutKey, placement);
}

function isSignerEditableTextPlacement(
  layoutKey: string | undefined,
  placement: DocumentLayoutPlacement,
): boolean {
  // Page-1 client_phone is always signer-editable (required) on every contract layout.
  if (isRequiredSignerEditablePlacement(placement)) return true;
  if (isWoodmereContractFillAtSigningPlacement(layoutKey, placement)) return true;
  return false;
}

/** Portal / reference fields on contract page 16, plus page-1 client phone. */
function isRequiredSignerTextField(
  placement: DocumentLayoutPlacement,
  layoutKey?: string,
): boolean {
  if (placement.type !== 'text') return false;
  if (isRequiredSignerEditablePlacement(placement)) return true;
  return isWoodmereContractFillAtSigningPlacement(layoutKey, placement);
}

/** True when a live DocuSign tab must stay unlocked at send (signer fills or confirms). */
export function isFillAtSigningTabRef(tab: {
  tabLabel?: string;
  name?: string;
}): boolean {
  const label = String(tab.tabLabel || tab.name || '')
    .trim()
    .toLowerCase();
  return Boolean(
    label &&
      (FILL_AT_SIGNING_VARIABLES.has(label) ||
        REQUIRED_SIGNER_EDITABLE_VARIABLES.has(label) ||
        label === 'authorized_business_phone'),
  );
}

function shouldIncludeEmptyTextPlacement(
  placement: DocumentLayoutPlacement,
  layoutKey?: string,
): boolean {
  // DateSigned / date tabs must be present even when CRM has no value (DocuSign stamps on sign).
  if (placement.type === 'date') return true;
  if (placement.type !== 'text') return false;
  if (isSignerEditableTextPlacement(layoutKey, placement)) return true;
  if (isWoodmereContractFillAtSigningPlacement(layoutKey, placement)) return true;
  return includeEmptyLockedOptionalTextPlacement(placement);
}

/** Contract ACH account-holder name lines (pages 14 & 15 — owner person name). */
const WOODMERE_ACH_OWNER_NAME_VARIABLES = new Set([
  'ach_authorization_account_holder_name',
]);

/** Consent / title lines on ACH pages — merchant business name (not owner). */
const WOODMERE_ACH_CONSENT_BUSINESS_NAME_VARIABLES = new Set([
  'ach_authorization_concent_account_holder_name',
  'ach_authorization_concent_account_holder_name_2',
]);

/** Woodmere ACH pages 1/14/15/16 — explicit owner-2 tabs; do not auto-mirror initials here. */
const WOODMERE_CONTRACT_NO_OWNER2_INITIAL_MIRROR_PAGES = new Set(['1', '14', '15', '16']);
/** ACH authorization pages 14 & 15 — owner 2 initials only (no signature/date). */
const WOODMERE_ACH_OWNER2_INITIALS_ONLY_PAGES = new Set(['14', '15']);

function placementPageOffset(
  placement: DocumentLayoutPlacement,
  pageOffset: number,
): DocumentLayoutPlacement {
  if (!pageOffset) return placement;
  const base = Math.max(1, parseInt(String(placement.pageNumber || '1'), 10) || 1);
  return { ...placement, pageNumber: String(base + pageOffset) };
}
const PARTY2_DL_KEYS = [
  'guaranty_owner2_driver_license',
  'guaranty_guarantor2_driver_license',
] as const;

function mirrorIdentityFields(
  out: Record<string, string>,
  keys: readonly string[],
): void {
  const value = keys.map((k) => String(out[k] || '').trim()).find(Boolean);
  if (!value) return;
  for (const k of keys) {
    if (!String(out[k] || '').trim()) out[k] = value;
  }
}

/** Owner / Merchant / Guarantor / Client 1 are the same person — force one canonical name. */
function syncParty1NameFields(out: Record<string, string>): void {
  const canonical = PARTY1_NAME_PRIORITY.map((k) => String(out[k] || '').trim()).find(
    Boolean,
  );
  if (!canonical) return;
  for (const k of PARTY1_NAME_KEYS) {
    out[k] = canonical;
  }
}

/** Owner / Merchant / Guarantor / Client 2 are the same person — force one canonical name. */
function syncParty2NameFields(out: Record<string, string>): void {
  const canonical = PARTY2_NAME_PRIORITY.map((k) => String(out[k] || '').trim()).find(
    Boolean,
  );
  if (!canonical) return;
  for (const k of PARTY2_NAME_KEYS) {
    out[k] = canonical;
  }
}

function stripParty2ValueKeys(out: Record<string, string>): void {
  for (const k of [...PARTY2_NAME_KEYS, ...PARTY2_SS_KEYS, ...PARTY2_DL_KEYS]) {
    delete out[k];
  }
  for (const key of Object.keys(out)) {
    const norm = key.toLowerCase();
    if (
      /seller_2|discover_owner2|agreement_date_owner2|owner2|owner_2|guarantor2|guarantor_2|merchant2|merchant_2|appendix_merchant2|business_name_2/.test(
        norm,
      )
    ) {
      delete out[key];
    }
  }
}

function expandPrefillValues(
  values: Record<string, string>,
  ownerCount?: number,
): Record<string, string> {
  const out = { ...values };
  syncParty1NameFields(out);
  mirrorIdentityFields(out, PARTY1_SS_KEYS);
  mirrorIdentityFields(out, PARTY1_DL_KEYS);
  if (ownerCount === undefined || ownerCount >= 2) {
    syncParty2NameFields(out);
    mirrorIdentityFields(out, PARTY2_SS_KEYS);
    mirrorIdentityFields(out, PARTY2_DL_KEYS);
  } else {
    stripParty2ValueKeys(out);
  }

  const todayUs = new Date().toLocaleDateString('en-US');
  const agreementDate =
    String(out.agreement_date || '').trim() ||
    String(out.signature_date || '').trim() ||
    String(out.Signature_date || '').trim() ||
    String(out.disclosure_date || '').trim() ||
    String(out.addendum_date || '').trim() ||
    todayUs;
  if (!String(out.agreement_date || '').trim()) out.agreement_date = agreementDate;
  if (!String(out.signature_date || '').trim()) out.signature_date = agreementDate;

  for (const [canonical, aliases] of Object.entries(PREFILL_VALUE_ALIASES)) {
    const v = String(out[canonical] || '').trim();
    if (!v) continue;
    for (const alias of aliases) {
      if (!String(out[alias] || '').trim()) out[alias] = v;
    }
  }

  // Seed owner date labels (and Texas ACH CRM-scoped ids) so supplemental layouts can resolve.
  const owner1DateKeys = [
    'agreement_date_owner1_p11',
    'agreement_date_owner1_p6',
    'ach_form_texas_agreement_date_owner1_p11',
    'ach_form_signature_date',
  ];
  const owner2DateKeys = [
    'agreement_date_owner2_p11',
    'agreement_date_owner2_p6',
    'ach_form_texas_agreement_date_owner2_p11',
  ];
  for (const dateKey of owner1DateKeys) {
    if (!String(out[dateKey] || '').trim()) out[dateKey] = agreementDate;
  }
  if (ownerCount === undefined || ownerCount >= 2) {
    for (const dateKey of owner2DateKeys) {
      if (!String(out[dateKey] || '').trim()) out[dateKey] = agreementDate;
    }
  }

  return out;
}

function enrichValuesFromSigners(
  values: Record<string, string>,
  signers: LayoutSignerInput[],
  ownerCount: number,
): Record<string, string> {
  const out = { ...values };
  const primaryName = String(
    signers.find((s) => /receiver|client|merchant|customer/i.test(s.roleName))?.name ||
      signers.find((s) => /^owner$/i.test(s.roleName))?.name ||
      signers.find((s) => /^guarantor$/i.test(s.roleName))?.name ||
      signers[0]?.name ||
      '',
  ).trim();
  if (primaryName) {
    for (const k of [...PRIMARY_GUARANTOR_NAME_VARIABLES, ...PARTY1_NAME_KEYS]) {
      out[k] = primaryName;
    }
  }
  syncParty1NameFields(out);
  if (ownerCount >= 2) {
    const primaryEmail = String(
      signers.find((s) => /receiver|client|merchant|customer/i.test(s.roleName))?.email ||
        signers[0]?.email ||
        '',
    )
      .trim()
      .toLowerCase();
    const secondarySigner =
      signers.find((s) => /owner\s*2|guarantor\s*2/i.test(s.roleName)) ||
      (signers.length >= 2 ? signers[signers.length - 1] : undefined) ||
      signers.find((s) => {
        const email = String(s.email || '').trim().toLowerCase();
        return Boolean(email && email !== primaryEmail);
      });
    const secondaryName = String(secondarySigner?.name || '').trim();
    const primaryNameNorm = primaryName.toLowerCase();
    if (secondaryName && secondaryName.toLowerCase() !== primaryNameNorm) {
      for (const k of PARTY2_NAME_KEYS) {
        out[k] = secondaryName;
      }
      if (!String(out.business_name_2 || '').trim()) {
        out.business_name_2 = secondaryName;
      }
    }
    syncParty2NameFields(out);
    mirrorIdentityFields(out, PARTY2_SS_KEYS);
    mirrorIdentityFields(out, PARTY2_DL_KEYS);
  } else {
    stripParty2ValueKeys(out);
  }
  return out;
}

type DocuSignTab = Record<string, string | undefined>;

type SignerTabBuckets = {
  textTabs: DocuSignTab[];
  dateTabs: DocuSignTab[];
  signHereTabs: DocuSignTab[];
  initialHereTabs: DocuSignTab[];
  signerAttachmentTabs: DocuSignTab[];
};

function emptySignerTabBuckets(): SignerTabBuckets {
  return {
    textTabs: [],
    dateTabs: [],
    signHereTabs: [],
    initialHereTabs: [],
    signerAttachmentTabs: [],
  };
}

function resolvePrimarySignerRoleName(signers: LayoutSignerInput[]): string {
  return (
    signers.find((s) => /^signer$/i.test(s.roleName))?.roleName ||
    signers.find((s) => /receiver|client|merchant|customer/i.test(s.roleName))?.roleName ||
    signers.find((s) => /^owner$/i.test(s.roleName))?.roleName ||
    signers.find((s) => /^guarantor$/i.test(s.roleName))?.roleName ||
    signers[0]?.roleName ||
    DOCUSIGN_DEFAULT_ROLE_NAME
  );
}

function resolveSecondarySignerRoleName(signers: LayoutSignerInput[]): string {
  const primaryRole = resolvePrimarySignerRoleName(signers).toLowerCase();
  return (
    signers.find((s) => /owner\s*2/i.test(s.roleName))?.roleName ||
    signers.find((s) => /guarantor\s*2/i.test(s.roleName))?.roleName ||
    signers.find(
      (s) =>
        /^signer$/i.test(s.roleName) &&
        s.roleName.toLowerCase() !== primaryRole,
    )?.roleName ||
    signers.find((s) => s.roleName.toLowerCase() !== primaryRole)?.roleName ||
    DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME
  );
}

function resolvePrimarySignerIndex(signers: LayoutSignerInput[]): number {
  const primaryRole = resolvePrimarySignerRoleName(signers).toLowerCase();
  const idx = signers.findIndex((s) => s.roleName.toLowerCase() === primaryRole);
  return idx >= 0 ? idx : 0;
}

function resolveSecondarySignerIndex(signers: LayoutSignerInput[]): number {
  const secondaryRole = resolveSecondarySignerRoleName(signers).toLowerCase();
  const idx = signers.findIndex((s) => s.roleName.toLowerCase() === secondaryRole);
  if (idx >= 0) return idx;
  return signers.length > 1 ? 1 : 0;
}

function resolvePlacementSignerIndex(
  placement: DocumentLayoutPlacement,
  signers: LayoutSignerInput[],
  counts: LayoutPartyCounts,
  layoutKey?: string,
): number {
  // Prefill text → merchant #1. DateSigned for Owner 2 routes to secondary when present.
  // Do not reuse the same tabLabel on multiple pages (DocuSign groups them → green).
  if (placement.type === 'text') {
    return resolvePrimarySignerIndex(signers);
  }
  if (placement.type === 'date') {
    if (isSecondaryParty(placement.signerParty) && counts.ownerCount >= 2) {
      return resolveSecondarySignerIndex(signers);
    }
    return resolvePrimarySignerIndex(signers);
  }

  const party = placement.signerParty;
  const page = String(placement.pageNumber || '');

  if (isSecondaryParty(party)) {
    if (counts.ownerCount >= 2) {
      if (
        layoutKey === 'contract' &&
        WOODMERE_ACH_OWNER2_INITIALS_ONLY_PAGES.has(page) &&
        placement.type !== 'initial'
      ) {
        return resolvePrimarySignerIndex(signers);
      }
      if (placement.type === 'initial') {
        return resolveSecondarySignerIndex(signers);
      }
      return resolveSecondarySignerIndex(signers);
    }
    if (placement.type === 'initial') {
      return resolvePrimarySignerIndex(signers);
    }
    return signers.length > 1 ? resolveSecondarySignerIndex(signers) : 0;
  }

  if (isPrimaryParty(party)) {
    return resolvePrimarySignerIndex(signers);
  }

  const legacy = String(placement.signerRole || '').trim();
  if (legacy && legacy.toLowerCase() !== 'signer') {
    const idx = signers.findIndex((s) => s.roleName.toLowerCase() === legacy.toLowerCase());
    if (idx >= 0) return idx;
  }

  return resolvePrimarySignerIndex(signers);
}

function isSecondaryParty(party: string | undefined): boolean {
  return party === 'secondary' || party === 'owner2' || party === 'guarantor2';
}

function isPrimaryParty(party: string | undefined): boolean {
  return (
    party === 'primary' ||
    party === 'client' ||
    party === 'owner' ||
    party === 'guarantor'
  );
}

function resolvePlacementSignerRoleName(
  placement: DocumentLayoutPlacement,
  signers: LayoutSignerInput[],
  counts: LayoutPartyCounts,
  layoutKey?: string,
): string {
  const idx = resolvePlacementSignerIndex(placement, signers, counts, layoutKey);
  return signers[idx]?.roleName || resolvePrimarySignerRoleName(signers);
}

const PRIMARY_GUARANTOR_NAME_VARIABLES = [
  'owner1_guarantor_name',
  'guaranty_owner1_name',
  'guaranty_guarantor1_name',
  'guaranty_client_name',
  'client_name',
  'addendum_client_name',
  'security_guarantor',
] as const;

function primaryGuarantorNamePresent(values: Record<string, string>): boolean {
  return PRIMARY_GUARANTOR_NAME_VARIABLES.some((k) => String(values[k] || '').trim());
}

/**
 * Mirror each Merchant #1 (primary) initial as a Merchant #2 (secondary) initial when two owners sign.
 * Applied to the main contract and every merged supplemental layout (ACH, flex addendum, etc.).
 */
function expandLayoutsWithOwner2Initials(
  layouts: DocumentLayout[],
  ownerCount: number,
): DocumentLayout[] {
  if (ownerCount < 2) return layouts;

  return layouts.map((layout) => {
    if (layout.skipOwner2InitialMirror) {
      return layout;
    }
    const extras: DocumentLayoutPlacement[] = [];
    for (const placement of layout.placements) {
      if (placement.type !== 'initial') continue;
      if (placement.when === 'owners >= 2') continue;
      if (
        layout.key === 'contract' &&
        WOODMERE_CONTRACT_NO_OWNER2_INITIAL_MIRROR_PAGES.has(
          String(placement.pageNumber || ''),
        )
      ) {
        continue;
      }
      if (isSecondaryParty(placement.signerParty)) continue;
      const party = placement.signerParty;
      if (party && !isPrimaryParty(party)) continue;

      const baseX = Number(placement.x);
      const baseY = Number(placement.y);
      if (!Number.isFinite(baseX) || !Number.isFinite(baseY)) continue;

      extras.push({
        ...placement,
        id: `${placement.id}_m2init`,
        slot: `${placement.slot || placement.id}_m2init`,
        x: String(baseX + OWNER2_INITIAL_OFFSET_X),
        y: String(Math.max(0, baseY + OWNER2_INITIAL_OFFSET_Y)),
        signerParty: 'secondary',
        when: 'owners >= 2',
        sourceTabLabel: `Merchant #2 ${placement.sourceTabLabel || placement.id}`,
      });
    }
    return { ...layout, placements: [...layout.placements, ...extras] };
  });
}

const FLEX_ADDENDUM_MONEY_VARIABLES = new Set([
  'daily_payment_1',
  'daily_payment_2',
  'receivable_purchase_1',
  'receivable_purchase_2',
]);

function formatFlexAddendumMoneyUsd(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const n = Number(trimmed.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return trimmed;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function resolveTextPlacementValue(
  variable: string,
  values: Record<string, string>,
  placement?: DocumentLayoutPlacement,
  layoutKey?: string,
): string {
  const key = String(variable || '').trim();
  if (!key) return '';

  const formatIfMoney = (raw: string) =>
    FLEX_ADDENDUM_MONEY_VARIABLES.has(key.toLowerCase())
      ? formatFlexAddendumMoneyUsd(raw)
      : raw;

  if (
    layoutKey === 'contract' &&
    (String(placement?.pageNumber || '') === '14' ||
      String(placement?.pageNumber || '') === '15') &&
    WOODMERE_ACH_CONSENT_BUSINESS_NAME_VARIABLES.has(key.toLowerCase())
  ) {
    const business = String(
      values.client_legal_name ||
        values.security_business_name ||
        values.business_legal_name ||
        values.authorization_client_name ||
        values.ach_authorization_concent_account_holder_name ||
        values.ach_authorization_concent_account_holder_name_2 ||
        '',
    ).trim();
    if (business) return formatIfMoney(business);
  }

  if (
    key.toLowerCase() === 'client_name' ||
    key.toLowerCase() === 'addendum_client_name'
  ) {
    // Always prefer Owner 1 person name — never merchant legal name.
    for (const aliasKey of PARTY1_NAME_PRIORITY) {
      const owner1 = String(values[aliasKey] || '').trim();
      if (owner1) return owner1;
    }
  }

  if (
    layoutKey === 'contract' &&
    (String(placement?.pageNumber || '') === '14' ||
      String(placement?.pageNumber || '') === '15') &&
    WOODMERE_ACH_OWNER_NAME_VARIABLES.has(key.toLowerCase())
  ) {
    for (const aliasKey of PARTY1_NAME_KEYS) {
      const owner1 = String(values[aliasKey] || '').trim();
      if (owner1) return owner1;
    }
  }

  const candidates = [
    key,
    key.toLowerCase(),
    CRM_ID_TO_LAYOUT_VARIABLE[key.toLowerCase()] || '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const direct = String(values[candidate] || '').trim();
    if (direct) return formatIfMoney(direct);
    const aliases = PREFILL_VALUE_ALIASES[candidate] || PREFILL_VALUE_ALIASES[candidate.toLowerCase()];
    if (aliases) {
      for (const alias of aliases) {
        const v = String(values[alias] || '').trim();
        if (v) return formatIfMoney(v);
      }
    }
  }
  return '';
}

function placementAllowed(
  placement: DocumentLayoutPlacement,
  counts: LayoutPartyCounts,
  values: Record<string, string> = {},
  layoutKey?: string,
): boolean {
  const when = String(placement.when || '').trim();
  if (when === 'owners >= 2' && counts.ownerCount < 2) return false;
  if (when === 'guarantors >= 2' && counts.ownerCount < 2) return false;

  if (
    layoutKey === 'contract' &&
    WOODMERE_ACH_OWNER2_INITIALS_ONLY_PAGES.has(String(placement.pageNumber || '')) &&
    isSecondaryParty(placement.signerParty) &&
    (placement.type === 'signature' || placement.type === 'date')
  ) {
    return false;
  }

  if (isSecondaryParty(placement.signerParty)) {
    if (counts.ownerCount < 2) return false;
  }

  if (
    placement.type === 'signature' &&
    placement.optional &&
    isPrimaryParty(placement.signerParty) &&
    !primaryGuarantorNamePresent(values)
  ) {
    return false;
  }

  const variable = String(placement.variable || '').trim().toLowerCase();
  const label = String(
    placement.sourceTabLabel || placement.slot || placement.variable || '',
  )
    .trim()
    .toLowerCase();
  if (variable || label) {
    const owner2Token = `${variable} ${label}`;
    if (
      /seller_2|discover_owner2|agreement_date_owner2|owner2|owner_2|guarantor2|guarantor_2/.test(
        owner2Token,
      ) &&
      counts.ownerCount < 2
    ) {
      return false;
    }
    if (/merchant2|merchant_2|appendix_merchant2|business_name_2/.test(owner2Token) && counts.ownerCount < 2) {
      return false;
    }
  }

  return true;
}

function includeEmptyLockedOptionalTextPlacement(
  placement: DocumentLayoutPlacement,
): boolean {
  return (
    placement.type === 'text' &&
    placement.optional === true &&
    placement.lockedForSigner === true
  );
}

function toTextTab(
  placement: DocumentLayoutPlacement,
  value: string,
  envelopeDocumentId: string,
  lockDataTabs = false,
  layoutKey?: string,
): DocuSignTab {
  const signerEditable = isSignerEditableTextPlacement(layoutKey, placement);
  const tabValue = clearsValueAtSend(layoutKey, placement) ? '' : value;
  const variable = String(placement.variable || '').trim();
  const displayLabel =
    getPrefillDisplayLabel(variable) ||
    String(placement.sourceTabLabel || '').trim() ||
    variable ||
    placement.slot;
  const scopedTabLabel = resolveSupplementalEnvelopeTabLabel(
    layoutKey || '',
    placement,
    variable,
  );
  const tabLabel =
    scopedTabLabel ||
    String(placement.sourceTabLabel || '').trim() ||
    displayLabel ||
    `${variable || 'text'}_${placement.id}`;
  const width = resolveDocuSignPrefillTabWidth({
    value: tabValue,
    height: placement.height,
    layoutWidth: placement.width,
    fontSize: placement.fontSize,
  });
  // Page-16 ACH and page-1 client phone stay editable; other prefilled text locks at send.
  const lockTab = signerEditable ? false : lockDataTabs || Boolean(placement.lockedForSigner);
  const optionalTab = !isRequiredSignerTextField(placement, layoutKey);
  return applyDocuSignPrefillTabStyle(
    {
      tabLabel,
      name: variable || undefined,
      documentId: envelopeDocumentId,
      pageNumber: placement.pageNumber,
      xPosition: placement.x,
      yPosition: resolveTabYPosition(placement.y, layoutKey),
      ...(tabValue ? { value: tabValue } : {}),
      ...(optionalTab ? { optional: 'true' } : { required: 'true', optional: 'false' }),
      ...(lockTab ? { locked: 'true' } : {}),
      ...(placement.bold ? { bold: 'true' } : {}),
      // Prefill hangs on signer 1; Owner 2 uses initials/signatures only. Keep tabLabels unique
      // across documents so DocuSign does not auto-group them (same label → green sync group).
      shared: 'false',
      width,
      ...(placement.height ? { height: placement.height } : {}),
    },
    { height: placement.height, fontSize: placement.fontSize },
  );
}

/** Stamp layout text/date values onto the base PDF for CC email (DocuSign download is often blank). */
export async function renderFlattenedLayoutPdf(
  layout: DocumentLayout & { documentBase64: string },
  values: Record<string, string>,
  counts: LayoutPartyCounts,
): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const pdfDoc = await PDFDocument.load(Buffer.from(layout.documentBase64, 'base64'));
  const font = await embedArialPdfFont(pdfDoc);
  const boldFont = await embedArialBoldPdfFont(pdfDoc);
  const pages = pdfDoc.getPages();
  const expanded = expandPrefillValues(values, counts.ownerCount);
  const scopedExpanded = buildScopedValuesForLayout(layout, expanded);

  for (const placement of layout.placements) {
    if (placement.type !== 'text' && placement.type !== 'date') continue;
    if (!placementAllowed(placement, counts, scopedExpanded, layout.key)) continue;
    if (isWoodmereContractFillAtSigningPlacement(layout.key, placement)) continue;
    // Keep client_phone as a live DocuSign tab (required + writable), never burn into PDF.
    if (isRequiredSignerEditablePlacement(placement)) continue;
    const text = resolveTextPlacementValue(
      placement.variable || '',
      scopedExpanded,
      placement,
      layout.key,
    );
    if (!text) continue;

    const pageIndex = Math.max(0, parseInt(String(placement.pageNumber || '1'), 10) - 1);
    const page = pages[pageIndex];
    if (!page) continue;

    const tabHeight = parseFloat(String(placement.height || '19')) || 19;
    const explicitFontSize = parseFloat(String(placement.fontSize ?? '').trim());
    const fontSize =
      Number.isFinite(explicitFontSize) && explicitFontSize > 0
        ? explicitFontSize
        : Math.min(11, Math.max(7, Math.round(tabHeight * 0.55)));
    const { height: pageHeight } = page.getSize();
    const x = parseFloat(String(placement.x || '0')) || 0;
    const yTop = parseFloat(resolveTabYPosition(placement.y, layout.key)) || 0;
    const y = pageHeight - yTop - fontSize;

    const maxWidth = parseFloat(
      resolveDocuSignPrefillTabWidth({
        value: text,
        height: placement.height,
        layoutWidth: placement.width,
        fontSize: placement.fontSize,
      }),
    );
    page.drawText(text, {
      x,
      y: Math.max(2, y),
      size: fontSize,
      font: placement.bold ? boldFont : font,
      color: rgb(0, 0, 0),
      maxWidth: Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : undefined,
    });
  }

  return Buffer.from(
    await pdfDoc.save({ useObjectStreams: false, updateFieldAppearances: false }),
  );
}

/** State disclosure PDFs often fail DocuSign validation after pdf-lib rewrite. */
export function shouldFlattenLayoutPdf(layout: DocumentLayout): boolean {
  return !String(layout.key || '').startsWith('state_disclosure_');
}

function layoutPrefillBurnedIntoPdf(
  layoutKey: string,
  options: BuildEnvelopeFromLayoutOptions,
): boolean {
  if (options.flattenedLayoutKeys) {
    return options.flattenedLayoutKeys.has(layoutKey);
  }
  return options.skipTextDateTabs === true;
}

function toSignTab(
  placement: DocumentLayoutPlacement,
  envelopeDocumentId: string,
  layoutKey?: string,
): DocuSignTab {
  const baseLabel = placement.slot || `${placement.type}_${placement.id}`;
  const scoped =
    layoutKey && !isMainContractLayoutKey(layoutKey)
      ? `${String(layoutKey).replace(/[^a-zA-Z0-9]+/g, '_')}_${baseLabel}`
      : baseLabel;
  return {
    tabLabel: scoped,
    documentId: envelopeDocumentId,
    pageNumber: placement.pageNumber,
    xPosition: placement.x,
    yPosition: resolveTabYPosition(placement.y, layoutKey),
    optional: placement.optional ? 'true' : 'false',
  };
}

function toAttachmentTab(
  placement: DocumentLayoutPlacement,
  envelopeDocumentId: string,
  layoutKey?: string,
): DocuSignTab {
  const isOptional = placement.optional !== false;
  const tab: DocuSignTab = {
    tabLabel:
      String(placement.sourceTabLabel || '').trim() ||
      placement.slot ||
      `attachment_${placement.id}`,
    documentId: envelopeDocumentId,
    pageNumber: placement.pageNumber,
    xPosition: placement.x,
    yPosition: resolveTabYPosition(placement.y, layoutKey),
    scaleValue: '1',
  };
  if (isOptional) {
    // Match DocuSign template export: optional attachments use SignerAttachmentOptional
    // with optional=true only (no required property).
    tab.name = 'SignerAttachmentOptional';
    tab.optional = 'true';
  } else {
    tab.name = 'SignerAttachment';
    tab.optional = 'false';
    tab.required = 'true';
  }
  return tab;
}

export function buildRecipientTabsByRoleForLayout(
  layout: DocumentLayout,
  envelopeDocumentId: string,
  values: Record<string, string>,
  signers: LayoutSignerInput[],
  counts: LayoutPartyCounts,
): Map<string, SignerTabBuckets> {
  const signerTabs = new Map<number, SignerTabBuckets>();
  const scopedValues = buildScopedValuesForLayout(layout, values);

  const ensureSigner = (signerIndex: number) => {
    if (!signerTabs.has(signerIndex)) {
      signerTabs.set(signerIndex, emptySignerTabBuckets());
    }
    return signerTabs.get(signerIndex)!;
  };

  for (const placement of layout.placements) {
    if (!placementAllowed(placement, counts, scopedValues, layout.key)) continue;

    const signerIndex = resolvePlacementSignerIndex(placement, signers, counts, layout.key);

    const bucket = ensureSigner(signerIndex);

    if (placement.type === 'text' || placement.type === 'date') {
      const variable = placement.variable || '';
      const value = resolveTextPlacementValue(
        variable,
        scopedValues,
        placement,
        layout.key,
      );
      if (!value && !shouldIncludeEmptyTextPlacement(placement, layout.key)) continue;
      const tab = toTextTab(placement, value, envelopeDocumentId, false, layout.key);
      if (placement.type === 'date') bucket.dateTabs.push(tab);
      else bucket.textTabs.push(tab);
      continue;
    }

    if (placement.type === 'signature') {
      bucket.signHereTabs.push(toSignTab(placement, envelopeDocumentId, layout.key));
      continue;
    }

    if (placement.type === 'initial') {
      bucket.initialHereTabs.push(toSignTab(placement, envelopeDocumentId, layout.key));
      continue;
    }

    if (placement.type === 'attachment') {
      bucket.signerAttachmentTabs.push(toAttachmentTab(placement, envelopeDocumentId, layout.key));
    }
  }

  const byRole = new Map<string, SignerTabBuckets>();
  signers.forEach((s, idx) => {
    const tabs = signerTabs.get(idx);
    if (tabs) byRole.set(s.roleName, tabs);
  });
  return byRole;
}

function signerHasTabs(tabs: SignerTabBuckets): boolean {
  return (
    tabs.textTabs.length +
      tabs.dateTabs.length +
      tabs.signHereTabs.length +
      tabs.initialHereTabs.length +
      tabs.signerAttachmentTabs.length >
    0
  );
}

/**
 * Builds DocuSign envelope definition from platform layouts + PDFs.
 * Same `variable` is written to every placement that references it (multi-page prefill).
 */
export function buildEnvelopeFromLayouts(options: BuildEnvelopeFromLayoutOptions) {
  const counts: LayoutPartyCounts = {
    ownerCount: options.ownerCount ?? 1,
    guarantorCount: options.guarantorCount ?? 0,
  };
  const values = enrichValuesFromSigners(
    expandPrefillValues(options.values, counts.ownerCount),
    options.signers,
    counts.ownerCount,
  );
  const documents: Array<{ documentId: string; name: string; documentBase64: string }> =
    [];
  /** Map each layout package to envelope document id (1-based merge order). */
  const layoutKeyToEnvelopeDocId = new Map<string, string>();
  const pageOffsetByLayoutKey = options.pageOffsetByLayoutKey ?? new Map<string, number>();

  if (options.mergedDocument?.documentBase64) {
    const mergedName =
      String(options.mergedDocument.name || '').trim() ||
      options.primaryDocumentName ||
      'Contract Package';
    documents.push({
      documentId: '1',
      name: mergedName,
      documentBase64: options.mergedDocument.documentBase64,
    });
    for (const layout of options.layouts) {
      layoutKeyToEnvelopeDocId.set(layout.key, '1');
    }
  } else {
    options.layouts.forEach((layout, idx) => {
      const envelopeDocId = String(idx + 1);
      layoutKeyToEnvelopeDocId.set(layout.key, envelopeDocId);
      const base64 = (layout as DocumentLayout & { documentBase64?: string })
        .documentBase64;
      if (!base64) {
        throw new Error(
          `Layout "${layout.key}" is missing documentBase64 on the merged envelope build.`,
        );
      }
      documents.push({
        documentId: envelopeDocId,
        name:
          idx === 0 && options.primaryDocumentName
            ? options.primaryDocumentName
            : layout.document.originalFileName || layout.name,
        documentBase64: base64,
      });
    });
  }

  const signerTabs = new Map<number, SignerTabBuckets>();

  const ensureSigner = (signerIndex: number) => {
    if (!signerTabs.has(signerIndex)) {
      signerTabs.set(signerIndex, emptySignerTabBuckets());
    }
    return signerTabs.get(signerIndex)!;
  };

  const expandedLayouts = expandLayoutsWithOwner2Initials(options.layouts, counts.ownerCount);

  for (const layout of expandedLayouts) {
    const envelopeDocId = layoutKeyToEnvelopeDocId.get(layout.key) || '1';
    const pageOffset = pageOffsetByLayoutKey.get(layout.key) ?? 0;
    const scopedValues = buildScopedValuesForLayout(layout, values);

    for (const placement of layout.placements) {
      if (!placementAllowed(placement, counts, scopedValues, layout.key)) continue;

      const signerIndex = resolvePlacementSignerIndex(
        placement,
        options.signers,
        counts,
        layout.key,
      );

      const bucket = ensureSigner(signerIndex);
      const tabPlacement = placementPageOffset(placement, pageOffset);

      if (placement.type === 'text' || placement.type === 'date') {
        if (
          layoutPrefillBurnedIntoPdf(layout.key, options) &&
          !shouldIncludeEmptyTextPlacement(placement, layout.key)
        ) {
          continue;
        }
        const variable = placement.variable || '';
        const value = resolveTextPlacementValue(
          variable,
          scopedValues,
          placement,
          layout.key,
        );
        if (!value && !shouldIncludeEmptyTextPlacement(placement, layout.key)) continue;
        const tab = toTextTab(tabPlacement, value, envelopeDocId, options.lockDataTabs, layout.key);
        if (placement.type === 'date') bucket.dateTabs.push(tab);
        else bucket.textTabs.push(tab);
        continue;
      }

      if (placement.type === 'signature') {
        bucket.signHereTabs.push(toSignTab(tabPlacement, envelopeDocId, layout.key));
        continue;
      }

      if (placement.type === 'initial') {
        bucket.initialHereTabs.push(toSignTab(tabPlacement, envelopeDocId, layout.key));
        continue;
      }

      if (placement.type === 'attachment') {
        bucket.signerAttachmentTabs.push(toAttachmentTab(tabPlacement, envelopeDocId, layout.key));
      }
    }
  }

  const emptyTabs = emptySignerTabBuckets;

  const mappedSigners = options.signers.map((s, idx) => {
    const tabs = signerTabs.get(idx) || emptyTabs();
    return {
      roleName: s.roleName,
      name: s.name,
      email: s.email,
      routingOrder: s.routingOrder,
      tabs,
    };
  });

  if (counts.ownerCount >= 2) {
    const secondaryIdx = resolveSecondarySignerIndex(options.signers);
    const secondaryTabs = signerTabs.get(secondaryIdx);
    const hasSecondaryRecipient = mappedSigners.some(
      (s, idx) => idx === secondaryIdx && signerHasTabs(s.tabs),
    );
    if (!hasSecondaryRecipient && secondaryTabs && signerHasTabs(secondaryTabs)) {
      const secondaryInput = options.signers[secondaryIdx];
      if (secondaryInput) {
        mappedSigners.push({
          roleName:
            secondaryInput.roleName || resolveSecondarySignerRoleName(options.signers),
          name: secondaryInput.name,
          email: secondaryInput.email,
          routingOrder: secondaryInput.routingOrder ?? 2,
          tabs: secondaryTabs,
        });
      }
    }
  }

  const signers = mappedSigners
    .filter((s) => signerHasTabs(s.tabs))
    .map((s, idx) => ({
      roleName: s.roleName,
      name: s.name,
      email: s.email,
      recipientId: String(idx + 1),
      routingOrder: String(s.routingOrder ?? idx + 1),
      tabs: s.tabs,
    }));

  return {
    status: 'created',
    documents,
    recipients: { signers },
  };
}
