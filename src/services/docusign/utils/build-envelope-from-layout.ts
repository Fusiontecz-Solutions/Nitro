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
import { DOCUSIGN_DEFAULT_ROLE_NAME } from './docusign-client';
import {
  applyDocuSignPrefillTabStyle,
  resolveDocuSignPrefillTabWidth,
} from './docusign-tab-style';
import { embedArialPdfFont } from './embed-arial-pdf-font';

const DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME =
  process.env.DOCUSIGN_SECONDARY_ROLE_NAME || 'Owner 2';

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
   */
  skipTextDateTabs?: boolean;
  /** When true, text/date tabs are created locked (use only when sending immediately). */
  lockDataTabs?: boolean;
  /** Merged PDF bytes when multiple layouts are combined into one DocuSign document. */
  mergedDocument?: { name: string; documentBase64: string };
  /** Page offset per layout key (0-based) inside `mergedDocument`. */
  pageOffsetByLayoutKey?: Map<string, number>;
};

export type LayoutPartyCounts = {
  ownerCount: number;
  guarantorCount: number;
};

/** Canonical CRM keys copied to legacy / duplicate tab labels automatically. */
const PREFILL_VALUE_ALIASES: Record<string, string[]> = {
  agreement_date: ['signature_date', 'disclosure_date'],
  signature_date: ['agreement_date', 'Signature_date', 'disclosure_date'],
  Signature_date: ['signature_date', 'agreement_date', 'disclosure_date'],
  disclosure_date: ['agreement_date', 'signature_date'],
  date_of_new_secured_agreement: ['agreement_date', 'signature_date'],
  date_of_previous_secured_agreement: ['agreement_date', 'signature_date', 'previous_secured_agreement_date', 'previous_agreement_date'],
  remaining_rtr_balance: ['refinance_amount', 'remaining_rtr_balance', 'remaining_rtr', 'remainingRtrBalance'],
  date_by_which_amount_mustbe_received: ['prepayment_received_by_date'],
  funder_name: ['disclosure_funder_name'],
  client_legal_name: ['business_legal_name', 'merchant_legal_name'],
  business_name_2: [
    'owner2_guarantor_name',
    'guaranty_owner2_name',
    'guaranty_guarantor2_name',
    'merchant2_name',
    'appendix_merchant2_name',
  ],
  client_name: [
    'client_name_by',
    'guaranty_client_name',
    'owner1_guarantor_name',
    'guaranty_owner1_name',
    'guaranty_guarantor1_name',
  ],
  ach_authorization_account_holder_name: [
    'owner1_guarantor_name',
    'customer_name',
    'client_name',
    'guaranty_owner1_name',
    'guaranty_guarantor1_name',
    'guaranty_client_name',
  ],
  ach_authorization_concent_account_holder_name: [
    'owner1_guarantor_name',
    'customer_name',
    'client_name',
    'guaranty_owner1_name',
    'guaranty_guarantor1_name',
    'guaranty_client_name',
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
  disclosure_name: ['client_name', 'recipient_name'],
  disclosure_date2: ['disclosure_date', 'agreement_date', 'signature_date'],
  recipient_name: ['client_name', 'disclosure_name'],
  recipient_name2: ['client_name', 'recipient_name'],
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
  disclosure_avg_monthly_revenue: [
    'disclosure_avg_monthly_revenue',
    'avarage_monthly_income',
    'monthly_income',
    'etimated_average_income',
  ],
  purchase_amount: [],
  receivable_purchase: ['purchase_amount'],
  daily_payment_1: ['daily_payment', 'remittance'],
  daily_payment_2: ['daily_payment', 'remittance'],
  receivable_purchase_1: ['purchase_amount', 'receivable_purchase'],
  receivable_purchase_2: ['purchase_amount', 'receivable_purchase'],
  purchase_price: ['disclosure_total_payment', 'total_repayment_amount', 'estimatedTotalPaymentAmount'],
  appendix_underwriting_fees: ['underwriter_fee', 'underwriterfee', 'underwriter_fees'],
  owner1_guarantor_name: ['guaranty_owner1_name', 'guaranty_guarantor1_name', 'guaranty_client_name'],
  guaranty_owner1_name: ['owner1_guarantor_name', 'guaranty_guarantor1_name', 'guaranty_client_name', 'client_name'],
  guaranty_guarantor1_name: ['owner1_guarantor_name', 'guaranty_owner1_name', 'guaranty_client_name', 'client_name'],
  guaranty_client_name: ['client_name', 'owner1_guarantor_name', 'guaranty_owner1_name', 'guaranty_guarantor1_name'],
  security_guarantor: ['guaranty_guarantor1_name', 'guaranty_owner1_name', 'owner1_guarantor_name', 'client_name'],
  guaranty_owner1_ss: ['guaranty_guarantor1_ss'],
  guaranty_guarantor1_ss: ['guaranty_owner1_ss'],
  guaranty_owner1_driver_license: ['guaranty_guarantor1_driver_license', 'guaranty_ss_driver_license'],
  guaranty_guarantor1_driver_license: ['guaranty_owner1_driver_license'],
  guaranty_ss_driver_license: ['guaranty_owner1_driver_license', 'guaranty_guarantor1_driver_license'],
  owner2_guarantor_name: ['guaranty_owner2_name', 'guaranty_guarantor2_name', 'merchant2_name'],
  guaranty_owner2_name: ['owner2_guarantor_name', 'guaranty_guarantor2_name', 'merchant2_name'],
  guaranty_guarantor2_name: ['owner2_guarantor_name', 'guaranty_owner2_name', 'merchant2_name'],
  merchant2_name: ['owner2_guarantor_name', 'guaranty_owner2_name', 'guaranty_guarantor2_name'],
  appendix_merchant2_name: [
    'owner2_guarantor_name',
    'guaranty_owner2_name',
    'merchant2_name',
    'guaranty_guarantor2_name',
  ],
  guaranty_owner2_ss: ['guaranty_guarantor2_ss'],
  guaranty_guarantor2_ss: ['guaranty_owner2_ss'],
  guaranty_owner2_driver_license: ['guaranty_guarantor2_driver_license'],
  guaranty_guarantor2_driver_license: ['guaranty_owner2_driver_license'],
  seller_1_name: [
    'owner1_guarantor_name',
    'guaranty_owner1_name',
    'guaranty_guarantor1_name',
    'guaranty_client_name',
    'client_name',
  ],
  seller_2_name: [
    'owner2_guarantor_name',
    'guaranty_owner2_name',
    'guaranty_guarantor2_name',
    'merchant2_name',
    'appendix_merchant2_name',
  ],
  doing_business_as: ['dba', 'security_doing_business_as'],
  client_phone: ['authorized_business_phone', 'guarantor_phone'],
  exhibit_company_name_1: ['exhibit_company_name_2', 'exhibit_company_name_3'],
};

/**
 * Merchant #2 initials — just right of Merchant #1 on the footer line (not mid-page).
 * ~1 initial-width + small gap from the primary tab; slightly higher on Y.
 */
const OWNER2_INITIAL_OFFSET_X = 108;
const OWNER2_INITIAL_OFFSET_Y = -6;

const PARTY2_NAME_KEYS = [
  'owner2_guarantor_name',
  'guaranty_owner2_name',
  'guaranty_guarantor2_name',
  'merchant2_name',
  'appendix_merchant2_name',
  'seller_2_name',
] as const;

const PARTY1_PERSONAL_NAME_KEYS = [
  'owner1_guarantor_name',
  'guaranty_owner1_name',
  'guaranty_guarantor1_name',
  'guaranty_client_name',
  'security_guarantor',
  'seller_1_name',
] as const;

const PARTY1_NAME_KEYS = PARTY1_PERSONAL_NAME_KEYS;

const PARTY1_SS_KEYS = ['guaranty_owner1_ss', 'guaranty_guarantor1_ss', 'guaranty_ss'] as const;
const PARTY1_DL_KEYS = [
  'guaranty_owner1_driver_license',
  'guaranty_guarantor1_driver_license',
  'guaranty_ss_driver_license',
] as const;

const PARTY2_SS_KEYS = ['guaranty_owner2_ss', 'guaranty_guarantor2_ss'] as const;
const PARTY2_DL_KEYS = [
  'guaranty_owner2_driver_license',
  'guaranty_guarantor2_driver_license',
] as const;

const PARTY2_PREFILL_VARIABLES = new Set<string>([
  ...PARTY2_NAME_KEYS,
  ...PARTY2_SS_KEYS,
  ...PARTY2_DL_KEYS,
  'appendix_merchant2_name',
  'business_name_2',
  'merchant2_name',
]);

function isParty2PrefillVariable(variable: string): boolean {
  const key = String(variable || '').trim().toLowerCase();
  if (!key) return false;
  if (PARTY2_PREFILL_VARIABLES.has(key)) return true;
  return /owner2|owner_2|guarantor2|guarantor_2|merchant2|merchant_2|seller_2|business_name_2|appendix_merchant2/.test(
    key,
  );
}

/** Drop owner-2 / guarantor-2 prefill when the envelope only has one merchant signer. */
export function stripParty2PrefillUnlessMultiOwner(
  values: Record<string, string>,
  ownerCount: number,
): Record<string, string> {
  if (ownerCount >= 2) return values;
  const out = { ...values };
  for (const key of Object.keys(out)) {
    if (isParty2PrefillVariable(key)) delete out[key];
  }
  return out;
}

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

/** Overwrite every key in the group with the best available party identity value. */
function forceMirrorIdentityFields(
  out: Record<string, string>,
  keys: readonly string[],
  preferredKeys: readonly string[] = keys,
): void {
  const value = preferredKeys
    .concat(keys)
    .map((k) => String(out[k] || '').trim())
    .find(Boolean);
  if (!value) return;
  for (const k of keys) {
    out[k] = value;
  }
}

const PARTY1_NAME_PREFERRED = [
  'owner1_guarantor_name',
  'guaranty_owner1_name',
  'guaranty_guarantor1_name',
  'guaranty_client_name',
  'customer_name',
  'security_guarantor',
  'seller_1_name',
] as const;

const PARTY2_NAME_PREFERRED = [
  'owner2_guarantor_name',
  'merchant2_name',
  'guaranty_owner2_name',
  'guaranty_guarantor2_name',
  'appendix_merchant2_name',
  'seller_2_name',
  'business_name_2',
] as const;

/** Contract page 1 — merchant confirms or enters phone at signing (prefilled when available). */
export const REQUIRED_SIGNER_EDITABLE_VARIABLES = new Set(['client_phone']);

/** Contract page 15 — ACH portal, credentials, and references (merchant fills at signing). */
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

const EXHIBIT_PREFILL_VARIABLE_PATTERN = /^(exhibit_a_value_\d+|exhibit_owner_name)$/i;

function isExhibitPrefillPlacement(placement: DocumentLayoutPlacement): boolean {
  return EXHIBIT_PREFILL_VARIABLE_PATTERN.test(String(placement.variable || '').trim());
}

function isRequiredSignerEditablePlacement(placement: DocumentLayoutPlacement): boolean {
  const variable = String(placement.variable || '').trim().toLowerCase();
  return REQUIRED_SIGNER_EDITABLE_VARIABLES.has(variable);
}

/** Page-15 ACH fields start blank; page-1 editable fields keep CRM prefill. */
function clearsValueAtSend(placement: DocumentLayoutPlacement): boolean {
  if (placement.fillAtSigning === true) return true;
  const variable = String(placement.variable || '').trim().toLowerCase();
  return FILL_AT_SIGNING_VARIABLES.has(variable);
}

function isSignerEditableTextPlacement(placement: DocumentLayoutPlacement): boolean {
  if (placement.fillAtSigning === true) return true;
  const variable = String(placement.variable || '').trim().toLowerCase();
  return (
    FILL_AT_SIGNING_VARIABLES.has(variable) ||
    REQUIRED_SIGNER_EDITABLE_VARIABLES.has(variable)
  );
}

/** Page-15 ACH fields and page-1 client phone are required signer text. */
function isRequiredSignerTextField(placement: DocumentLayoutPlacement): boolean {
  if (placement.type !== 'text') return false;
  if (isRequiredSignerEditablePlacement(placement)) return true;
  return (
    String(placement.pageNumber || '') === '15' &&
    isFillAtSigningPlacement(placement)
  );
}

function isFillAtSigningPlacement(placement: DocumentLayoutPlacement): boolean {
  if (placement.fillAtSigning === true) return true;
  const variable = String(placement.variable || '').trim().toLowerCase();
  return FILL_AT_SIGNING_VARIABLES.has(variable);
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
        REQUIRED_SIGNER_EDITABLE_VARIABLES.has(label)),
  );
}

function expandPrefillValues(values: Record<string, string>): Record<string, string> {
  const out = { ...values };
  for (const [canonical, aliases] of Object.entries(PREFILL_VALUE_ALIASES)) {
    const v = String(out[canonical] || '').trim();
    if (!v) continue;
    for (const alias of aliases) {
      if (!String(out[alias] || '').trim()) out[alias] = v;
    }
  }
  if (!String(out.client_name || '').trim()) {
    const personal = String(
      out.customer_name || out.client_name_by || '',
    ).trim();
    if (personal) {
      out.client_name = personal;
    } else {
      const legal = String(
        out.client_legal_name || out.business_legal_name || out.merchant_legal_name || '',
      ).trim();
      if (legal) out.client_name = legal;
    }
  }
  forceMirrorIdentityFields(out, PARTY1_NAME_KEYS, PARTY1_NAME_PREFERRED);
  forceMirrorIdentityFields(out, PARTY1_SS_KEYS);
  forceMirrorIdentityFields(out, PARTY1_DL_KEYS);
  const legalName = String(
    out.client_legal_name || out.business_legal_name || out.merchant_legal_name || '',
  ).trim();
  const personalClientName = PARTY1_NAME_PREFERRED.map((k) => String(out[k] || '').trim()).find(
    Boolean,
  );
  const currentClientName = String(out.client_name || '').trim();
  if (personalClientName) {
    out.client_name = personalClientName;
  } else if (legalName && currentClientName && currentClientName === legalName) {
    const customer = String(out.customer_name || out.client_name_by || '').trim();
    if (customer && customer !== legalName) out.client_name = customer;
  }
  forceMirrorIdentityFields(out, PARTY1_NAME_KEYS, PARTY1_NAME_PREFERRED);
  forceMirrorIdentityFields(out, PARTY1_SS_KEYS);
  forceMirrorIdentityFields(out, PARTY1_DL_KEYS);
  forceMirrorIdentityFields(out, PARTY2_NAME_KEYS, PARTY2_NAME_PREFERRED);
  forceMirrorIdentityFields(out, PARTY2_SS_KEYS);
  forceMirrorIdentityFields(out, PARTY2_DL_KEYS);
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
    for (const k of PRIMARY_GUARANTOR_NAME_VARIABLES) {
      if (!String(out[k] || '').trim()) out[k] = primaryName;
    }
    for (const k of PARTY1_NAME_KEYS) {
      if (!String(out[k] || '').trim()) out[k] = primaryName;
    }
  }
  if (ownerCount >= 2) {
    const party2FromPrefill = PARTY2_NAME_PREFERRED.map((k) => String(out[k] || '').trim()).find(
      Boolean,
    );
    if (party2FromPrefill) {
      forceMirrorIdentityFields(out, PARTY2_NAME_KEYS, PARTY2_NAME_PREFERRED);
      forceMirrorIdentityFields(out, PARTY2_SS_KEYS);
      forceMirrorIdentityFields(out, PARTY2_DL_KEYS);
      const party2Name = PARTY2_NAME_PREFERRED.map((k) => String(out[k] || '').trim()).find(
        Boolean,
      );
      if (party2Name) out.business_name_2 = party2Name;
    } else {
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
        out.business_name_2 = secondaryName;
        forceMirrorIdentityFields(out, PARTY2_NAME_KEYS, PARTY2_NAME_PREFERRED);
      }
    }
  }
  forceMirrorIdentityFields(out, PARTY1_NAME_KEYS, PARTY1_NAME_PREFERRED);
  forceMirrorIdentityFields(out, PARTY1_SS_KEYS);
  forceMirrorIdentityFields(out, PARTY1_DL_KEYS);
  const legalAfterSigners = String(
    out.client_legal_name || out.business_legal_name || out.merchant_legal_name || '',
  ).trim();
  const personalAfterSigners = PARTY1_NAME_PREFERRED.map((k) => String(out[k] || '').trim()).find(
    Boolean,
  );
  const currentAfterSigners = String(out.client_name || '').trim();
  if (personalAfterSigners) {
    out.client_name = personalAfterSigners;
  } else if (
    legalAfterSigners &&
    currentAfterSigners &&
    currentAfterSigners === legalAfterSigners
  ) {
    const customer = String(out.customer_name || out.client_name_by || '').trim();
    if (customer && customer !== legalAfterSigners) out.client_name = customer;
  }
  if (ownerCount >= 2) {
    forceMirrorIdentityFields(out, PARTY2_NAME_KEYS, PARTY2_NAME_PREFERRED);
    forceMirrorIdentityFields(out, PARTY2_SS_KEYS);
    forceMirrorIdentityFields(out, PARTY2_DL_KEYS);
  }
  return out;
}

type DocuSignTab = Record<string, string | undefined>;

type SignerTabBuckets = {
  textTabs: DocuSignTab[];
  dateTabs: DocuSignTab[];
  dateSignedTabs: DocuSignTab[];
  signHereTabs: DocuSignTab[];
  initialHereTabs: DocuSignTab[];
  signerAttachmentTabs: DocuSignTab[];
};

function emptySignerTabBuckets(): SignerTabBuckets {
  return {
    textTabs: [],
    dateTabs: [],
    dateSignedTabs: [],
    signHereTabs: [],
    initialHereTabs: [],
    signerAttachmentTabs: [],
  };
}

function resolvePrimarySignerIndex(signers: LayoutSignerInput[]): number {
  const idx = signers.findIndex((s) =>
    /receiver|client|merchant|customer/i.test(s.roleName),
  );
  if (idx >= 0) return idx;
  const ownerIdx = signers.findIndex((s) => /^owner$/i.test(s.roleName));
  if (ownerIdx >= 0) return ownerIdx;
  const guarantorIdx = signers.findIndex((s) => /^guarantor$/i.test(s.roleName));
  if (guarantorIdx >= 0) return guarantorIdx;
  return 0;
}

function resolveSecondarySignerIndex(signers: LayoutSignerInput[]): number {
  const primaryIdx = resolvePrimarySignerIndex(signers);
  const owner2Idx = signers.findIndex((s) => /owner\s*2|guarantor\s*2/i.test(s.roleName));
  if (owner2Idx >= 0 && owner2Idx !== primaryIdx) return owner2Idx;

  const primaryEmail = String(signers[primaryIdx]?.email || '')
    .trim()
    .toLowerCase();
  for (let i = signers.length - 1; i >= 0; i--) {
    if (i === primaryIdx) continue;
    const email = String(signers[i]?.email || '').trim().toLowerCase();
    if (email && email !== primaryEmail) return i;
  }
  if (signers.length > 1) {
    return primaryIdx === 0 ? 1 : 0;
  }
  return primaryIdx;
}

function resolvePrimarySignerRoleName(signers: LayoutSignerInput[]): string {
  const idx = resolvePrimarySignerIndex(signers);
  return signers[idx]?.roleName || DOCUSIGN_DEFAULT_ROLE_NAME;
}

function resolveSecondarySignerRoleName(signers: LayoutSignerInput[]): string {
  const primaryIdx = resolvePrimarySignerIndex(signers);
  const secondaryIdx = resolveSecondarySignerIndex(signers);
  if (secondaryIdx !== primaryIdx) {
    return signers[secondaryIdx]?.roleName || DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME;
  }
  return (
    signers.find((s) => /owner\s*2/i.test(s.roleName))?.roleName ||
    signers.find((s) => /guarantor\s*2/i.test(s.roleName))?.roleName ||
    DOCUSIGN_SECONDARY_SIGNER_ROLE_NAME
  );
}

function resolvePlacementSignerIndex(
  placement: DocumentLayoutPlacement,
  signers: LayoutSignerInput[],
  counts: LayoutPartyCounts,
): number {
  const party = placement.signerParty;

  if (isSecondaryParty(party)) {
    if (counts.ownerCount >= 2) {
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
    const idx = signers.findIndex(
      (s) => s.roleName.toLowerCase() === legacy.toLowerCase(),
    );
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
): string {
  const party = placement.signerParty;

  if (isSecondaryParty(party)) {
    if (counts.ownerCount >= 2) {
      return resolveSecondarySignerRoleName(signers);
    }
    // One signer deal: secondary-slot initials (e.g. page 11) go to the merchant/owner1.
    if (placement.type === 'initial') {
      return resolvePrimarySignerRoleName(signers);
    }
    return resolveSecondarySignerRoleName(signers);
  }

  if (isPrimaryParty(party)) {
    return resolvePrimarySignerRoleName(signers);
  }

  const legacy = String(placement.signerRole || '').trim();
  if (!legacy || legacy.toLowerCase() === 'signer') {
    return resolvePrimarySignerRoleName(signers);
  }

  const match = signers.find((s) => s.roleName.toLowerCase() === legacy.toLowerCase());
  if (match) return match.roleName;

  // DocuSign template exports use legacy role names (e.g. "Receiver") that do not
  // match platform signer roles ("Client", "Owner 2"). Prefill tabs must attach to
  // the primary merchant signer or they are dropped at envelope build time.
  return resolvePrimarySignerRoleName(signers);
}

const PRIMARY_GUARANTOR_NAME_VARIABLES = [
  'owner1_guarantor_name',
  'guaranty_owner1_name',
  'guaranty_guarantor1_name',
  'guaranty_client_name',
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

function isZeroMoneyPrefillValue(value: unknown): boolean {
  const n = Number(String(value ?? '').replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n === 0;
}

function resolveTextPlacementValue(
  variable: string,
  values: Record<string, string>,
): string {
  const key = String(variable || '').trim();
  if (!key) return '';
  const formatIfMoney = (raw: string) =>
    FLEX_ADDENDUM_MONEY_VARIABLES.has(key.toLowerCase())
      ? formatFlexAddendumMoneyUsd(raw)
      : raw;
  const candidates = [
    key,
    key.toLowerCase(),
    CRM_ID_TO_LAYOUT_VARIABLE[key.toLowerCase()] || '',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const direct = String(values[candidate] || '').trim();
    if (direct && !(key === 'appendix_underwriting_fees' && isZeroMoneyPrefillValue(direct))) {
      return formatIfMoney(direct);
    }
    const aliases = PREFILL_VALUE_ALIASES[candidate] || PREFILL_VALUE_ALIASES[candidate.toLowerCase()];
    if (aliases) {
      for (const alias of aliases) {
        const v = String(values[alias] || '').trim();
        if (!v) continue;
        if (key === 'appendix_underwriting_fees' && isZeroMoneyPrefillValue(v)) continue;
        return formatIfMoney(v);
      }
    }
  }
  return '';
}

function placementPageOffset(
  placement: DocumentLayoutPlacement,
  pageOffset: number,
): DocumentLayoutPlacement {
  if (!pageOffset) return placement;
  const base = Math.max(1, parseInt(String(placement.pageNumber || '1'), 10) || 1);
  return { ...placement, pageNumber: String(base + pageOffset) };
}

function placementAllowed(
  placement: DocumentLayoutPlacement,
  counts: LayoutPartyCounts,
  values: Record<string, string> = {},
): boolean {
  const when = String(placement.when || '').trim();
  if (when === 'owners >= 2' && counts.ownerCount < 2) return false;
  if (when === 'guarantors >= 2' && counts.ownerCount < 2) return false;

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
  if (variable) {
    if (/owner2|owner_2/.test(variable) && counts.ownerCount < 2) return false;
    if (/guarantor2|guarantor_2/.test(variable) && counts.ownerCount < 2) return false;
  }

  return true;
}

function shouldIncludeEmptyTextPlacement(placement: DocumentLayoutPlacement): boolean {
  if (placement.type !== 'text') return false;
  if (isSignerEditableTextPlacement(placement)) return true;
  if (placement.lockedForSigner) return true;
  if (placement.optional) return true;
  return false;
}

function toTextTab(
  placement: DocumentLayoutPlacement,
  value: string,
  envelopeDocumentId: string,
): DocuSignTab {
  const signerEditable = isSignerEditableTextPlacement(placement);
  const tabValue = clearsValueAtSend(placement) ? '' : value;
  const variable = String(placement.variable || '').trim();
  const displayLabel =
    getPrefillDisplayLabel(variable) ||
    String(placement.sourceTabLabel || '').trim() ||
    variable ||
    placement.slot;
  const tabLabel =
    String(placement.sourceTabLabel || '').trim() ||
    displayLabel ||
    `${variable || 'text'}_${placement.id}`;
  const width = resolveDocuSignPrefillTabWidth({
    value: tabValue,
    height: placement.height,
    layoutWidth: placement.width,
  });
  // Page-15 ACH and page-1 client phone stay editable; all other text is read-only.
  const lockTab = !signerEditable;
  const optionalTab = !isRequiredSignerTextField(placement);
  const tabPayload: Record<string, string> = {
    tabLabel,
    ...(variable ? { name: variable } : {}),
    documentId: envelopeDocumentId,
    pageNumber: placement.pageNumber,
    xPosition: placement.x,
    yPosition: placement.y,
    ...(optionalTab
      ? { optional: 'true' }
      : { required: 'true', optional: 'false' }),
    ...(lockTab ? { locked: 'true' } : {}),
    shared: signerEditable ? 'false' : 'true',
    width,
    ...(placement.height ? { height: placement.height } : {}),
  };
  if (tabValue) {
    tabPayload.value = tabValue;
  }
  return applyDocuSignPrefillTabStyle(tabPayload, { height: placement.height });
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
  const pages = pdfDoc.getPages();
  const expanded = expandPrefillValues(values);

  for (const placement of layout.placements) {
    if (placement.type !== 'text' && placement.type !== 'date') continue;
    if (!placementAllowed(placement, counts, expanded)) continue;
    if (isFillAtSigningPlacement(placement)) continue;
    const text = resolveTextPlacementValue(placement.variable || '', expanded);
    if (!text) continue;

    const pageIndex = Math.max(0, parseInt(String(placement.pageNumber || '1'), 10) - 1);
    const page = pages[pageIndex];
    if (!page) continue;

    const tabHeight = parseFloat(String(placement.height || '19')) || 19;
    const fontSize = Math.min(11, Math.max(7, Math.round(tabHeight * 0.55)));
    const { height: pageHeight } = page.getSize();
    const x = parseFloat(String(placement.x || '0')) || 0;
    const yTop = parseFloat(String(placement.y || '0')) || 0;
    const y = pageHeight - yTop - fontSize;

    const maxWidth = parseFloat(
      resolveDocuSignPrefillTabWidth({
        value: text,
        height: placement.height,
        layoutWidth: placement.width,
      }),
    );
    page.drawText(text, {
      x,
      y: Math.max(2, y),
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
      maxWidth: Number.isFinite(maxWidth) && maxWidth > 0 ? maxWidth : undefined,
    });
  }

  return Buffer.from(await pdfDoc.save());
}

function toDateSignedTab(
  placement: DocumentLayoutPlacement,
  envelopeDocumentId: string,
): DocuSignTab {
  const tabLabel =
    String(placement.sourceTabLabel || '').trim() ||
    String(placement.variable || '').trim() ||
    placement.slot ||
    `date_signed_${placement.id}`;
  return applyDocuSignPrefillTabStyle(
    {
      tabLabel,
      name: 'DateSigned',
      documentId: envelopeDocumentId,
      pageNumber: placement.pageNumber,
      xPosition: placement.x,
      yPosition: placement.y,
      optional: 'true',
      ...(placement.width ? { width: placement.width } : {}),
      ...(placement.height ? { height: placement.height } : {}),
    },
    { height: placement.height },
  );
}

function toSignTab(
  placement: DocumentLayoutPlacement,
  envelopeDocumentId: string,
): DocuSignTab {
  const isOptional = placement.optional === true;
  return {
    tabLabel: placement.slot || `${placement.type}_${placement.id}`,
    documentId: envelopeDocumentId,
    pageNumber: placement.pageNumber,
    xPosition: placement.x,
    yPosition: placement.y,
    optional: isOptional ? 'true' : 'false',
    ...(isOptional ? {} : { required: 'true' }),
  };
}

function toAttachmentTab(
  placement: DocumentLayoutPlacement,
  envelopeDocumentId: string,
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
    yPosition: placement.y,
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
): Map<number, SignerTabBuckets> {
  const signerTabs = new Map<number, SignerTabBuckets>();

  const ensureSigner = (signerIndex: number) => {
    if (!signerTabs.has(signerIndex)) {
      signerTabs.set(signerIndex, emptySignerTabBuckets());
    }
    return signerTabs.get(signerIndex)!;
  };

  for (const placement of layout.placements) {
    if (!placementAllowed(placement, counts, values)) continue;

    const signerIndex = resolvePlacementSignerIndex(placement, signers, counts);

    const bucket = ensureSigner(signerIndex);

    if (placement.type === 'date') {
      bucket.dateSignedTabs.push(toDateSignedTab(placement, envelopeDocumentId));
      continue;
    }

    if (placement.type === 'text') {
      const variable = placement.variable || '';
      const value = resolveTextPlacementValue(variable, values);
      if (!value && !shouldIncludeEmptyTextPlacement(placement)) {
        continue;
      }
      bucket.textTabs.push(toTextTab(placement, value, envelopeDocumentId));
      continue;
    }

    if (placement.type === 'signature') {
      bucket.signHereTabs.push(toSignTab(placement, envelopeDocumentId));
      continue;
    }

    if (placement.type === 'initial') {
      bucket.initialHereTabs.push(toSignTab(placement, envelopeDocumentId));
      continue;
    }

    if (placement.type === 'attachment') {
      bucket.signerAttachmentTabs.push(toAttachmentTab(placement, envelopeDocumentId));
    }
  }

  return signerTabs;
}

function signerHasTabs(tabs: SignerTabBuckets): boolean {
  return (
    tabs.textTabs.length +
      tabs.dateTabs.length +
      tabs.dateSignedTabs.length +
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
  const values = stripParty2PrefillUnlessMultiOwner(
    enrichValuesFromSigners(
      expandPrefillValues(options.values),
      options.signers,
      counts.ownerCount,
    ),
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

    for (const placement of layout.placements) {
      if (!placementAllowed(placement, counts, values)) continue;

      const signerIndex = resolvePlacementSignerIndex(placement, options.signers, counts);
      const tabPlacement = placementPageOffset(placement, pageOffset);

      const bucket = ensureSigner(signerIndex);

      if (placement.type === 'date') {
        bucket.dateSignedTabs.push(toDateSignedTab(tabPlacement, envelopeDocId));
        continue;
      }

      if (placement.type === 'text') {
        if (
          options.skipTextDateTabs &&
          !shouldIncludeEmptyTextPlacement(placement)
        ) {
          continue;
        }
        const variable = placement.variable || '';
        const resolved = resolveTextPlacementValue(variable, values);
        const value = isFillAtSigningPlacement(placement) ? '' : resolved;
        if (isExhibitPrefillPlacement(placement) && !String(value || '').trim()) continue;
        if (!value && !shouldIncludeEmptyTextPlacement(placement)) continue;
        bucket.textTabs.push(toTextTab(tabPlacement, value, envelopeDocId));
        continue;
      }

      if (placement.type === 'signature') {
        bucket.signHereTabs.push(toSignTab(tabPlacement, envelopeDocId));
        continue;
      }

      if (placement.type === 'initial') {
        bucket.initialHereTabs.push(toSignTab(tabPlacement, envelopeDocId));
        continue;
      }

      if (placement.type === 'attachment') {
        bucket.signerAttachmentTabs.push(toAttachmentTab(tabPlacement, envelopeDocId));
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
          roleName: secondaryInput.roleName || resolveSecondarySignerRoleName(options.signers),
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
