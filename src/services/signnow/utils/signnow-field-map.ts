/**
 * Map SignNow unique field names (often `{crmId}_p{page}`) back to CRM prefill ids.
 */

const STRIP_PAGE_OWNER1 =
  /_p\d+(?:_s1|_g1|_ach|_rpa|_exc|_exhibit|_disc|_disclosure|_ds)?$/i;

const OWNER2_NAME_KEYS = [
  'owner2_guarantor_name',
  'guaranty_owner2_name',
  'guaranty_guarantor2_name',
  'merchant2_name',
  'appendix_merchant2_name',
  'addendum_dated_principal_owner2_name',
  'business_name_2',
];

const ALIASES: Record<string, string[]> = {
  merchant_contact_name: ['client_name', 'guaranty_guarantor1_name', 'owner1_guarantor_name'],
  merchant_contact_email: ['client_email', 'billing_email', 'guarantor_email'],
  merchant_contact_phone: ['client_phone', 'guarantor_phone', 'billing_phone'],
  remittance_start_date: ['agreement_date'],
  purchase_percent: ['specified_percentage', 'purchase_percent'],
  specified_percentage: ['purchase_percent'],
  doing_business_as: ['security_doing_business_as', 'ach_authorization_account_holder_dba', 'dba'],
  client_legal_name: ['legal_name', 'business_legal_name'],
  entity_type: ['type_of_entity', 'form_of_business_entity'],
  security_tax_ein: ['ein', 'tax_id', 'federal_ein', 'federal_tax_id'],
  owner_print_title: ['owner_print_title', 'owner_title', 'guarantor_print_title'],
  owner2_guarantor_name: OWNER2_NAME_KEYS,
  owner2_print_title: ['owner2_print_title'],
  owner2_email: ['owner2_email'],
  owner2_phone: ['owner2_phone', 'guarantor2_phone', 'client_phone2'],
  guaranty_owner2_name: OWNER2_NAME_KEYS,
  guaranty_guarantor2_name: OWNER2_NAME_KEYS,
  merchant2_name: OWNER2_NAME_KEYS,
  guaranty_guarantor1_name: [
    'guaranty_guarantor1_name',
    'guaranty_owner1_name',
    'owner1_guarantor_name',
    'client_name',
  ],
  guaranty_ss: ['guaranty_owner1_ss', 'guaranty_guarantor1_ss'],
  guaranty_owner1_ss: ['guaranty_guarantor1_ss', 'guaranty_ss'],
  guaranty_guarantor1_ss: ['guaranty_owner1_ss', 'guaranty_ss'],
  guaranty_owner2_ss: ['guaranty_guarantor2_ss'],
  guaranty_guarantor2_ss: ['guaranty_owner2_ss'],
  guarantor_name: [
    'owner1_guarantor_name',
    'guaranty_guarantor1_name',
    'guaranty_owner1_name',
    'client_name',
    'merchant_contact_name',
  ],
  guarantor_email: ['client_email', 'merchant_contact_email'],
  guarantor_phone: ['client_phone', 'merchant_contact_phone'],
  guarantor2_phone: ['owner2_phone', 'client_phone2'],
  guarantor2_address: ['owner2_address', 'guarantor2_address'],
  client_phone2: ['owner2_phone', 'guarantor2_phone'],
  client_email_s2: ['owner2_email', 'client_email', 'merchant_contact_email'],
  owner_print_title_s2: ['owner2_print_title'],
  client_phone_s2: ['owner2_phone', 'guarantor2_phone', 'client_phone', 'guarantor_phone'],
  client_phone2_s2: ['client_phone2', 'owner2_phone', 'client_phone'],
  client_name_s2: [
    ...OWNER2_NAME_KEYS,
    'client_name',
    'owner1_guarantor_name',
    'merchant_contact_name',
  ],
  ach_account_holder_name: [
    'ach_authorization_account_holder_name',
    'authorization_client_name',
    'client_legal_name',
    'client_name',
  ],
  ach_account_holder_dba: [
    'ach_authorization_account_holder_dba',
    'doing_business_as',
    'dba',
    'security_doing_business_as',
  ],
  ach_account_holder_address: [
    'ach_authorization_account_holder_address',
    'business_address',
    'business_address_contract',
  ],
  ach_bank_name: [
    'ach_authorization_account_holder_bank_name',
    'authorization_client_bank_name',
  ],
  ach_bank_portal: ['ach_authorization_bank_portal_website'],
  ach_bank_account: [
    'ach_authorization_account_holder_bank_account_number',
    'authorization_client_bank_account',
  ],
  ach_bank_routing: [
    'ach_authorization_account_holder_bank_routing_number',
    'authorization_client_bank_routing',
  ],
  ach_username: ['ach_authorization_username'],
  ach_password: ['ach_authorization_password'],
  ach_security_q1: [
    'ach_authorization_security_question1',
    'ach_authorization_security_answer1',
  ],
  ach_security_q2: [
    'ach_authorization_security_question2',
    'ach_authorization_security_answer2',
  ],
  ach_security_q3: [
    'ach_authorization_security_question3',
    'ach_authorization_security_answer3',
  ],
  ref_personal1_name: ['ach_authorization_reference_name1'],
  ref_personal1_phone: [
    'ach_authorization_reference_number_1',
    'ach_authorization_reference_number1',
  ],
  ref_personal1_relationship: ['ach_authorization_reference_relationship1'],
  ref_personal2_name: ['ach_authorization_reference_name2'],
  ref_personal2_phone: [
    'ach_authorization_reference_number2',
    'ach_authorization_reference_number_2',
  ],
  ref_personal2_relationship: ['ach_authorization_reference_relationship2'],
  ref_biz2_company: [
    'ach_authorization_reference_relationship4',
    'ref_biz2_company',
  ],
  ref_biz2_contact: ['ach_authorization_reference_name4', 'ref_biz2_contact'],
  ref_biz2_phone: [
    'ach_authorization_reference_number4',
    'ref_biz2_phone',
  ],
  landlord_company: ['landlord_company'],
  landlord_contact: ['landlord_contact'],
  landlord_phone: ['landlord_phone'],
  emergency_name: ['emergency_name'],
  emergency_relationship: ['emergency_relationship'],
  emergency_phone: ['emergency_phone'],
  emergency_email: ['emergency_email'],
  signature_date_s2: ['signature_date', 'agreement_date', 'disclosure_date'],
  email_address: ['client_email', 'merchant_contact_email', 'guarantor_email'],
  primary_phone: ['client_phone', 'guarantor_phone', 'merchant_contact_phone'],
  primary_phone_number: ['client_phone', 'guarantor_phone'],
  secondary_phone: ['client_phone2', 'owner2_phone', 'client_phone'],
  ref_biz1_company: [
    'ach_authorization_reference_relationship3',
    'ach_authorization_reference_name3',
  ],
  ref_biz1_contact: ['ach_authorization_reference_name3'],
  ref_biz1_phone: [
    'ach_authorization_reference_number3',
    'ach_authorization_reference_number_3',
  ],
  ref_business1_company: [
    'ach_authorization_reference_relationship3',
    'ach_authorization_reference_name3',
  ],
  ref_business1_contact: ['ach_authorization_reference_name3'],
  ref_business1_name: ['ach_authorization_reference_name3'],
  ref_business1_phone: [
    'ach_authorization_reference_number3',
    'ach_authorization_reference_number_3',
  ],
  business_ref1_company: [
    'ach_authorization_reference_relationship3',
    'ach_authorization_reference_name3',
  ],
  business_ref1_contact: ['ach_authorization_reference_name3'],
  business_ref1_phone: [
    'ach_authorization_reference_number3',
    'ach_authorization_reference_number_3',
  ],
  business_address: [
    'business_address_contract',
    'ach_account_holder_address',
    'ach_authorization_account_holder_address',
  ],
  assignment_merchant_line1: ['client_legal_name', 'client_name'],
  assignment_merchant_line2: ['doing_business_as', 'exhibit_a_value_1'],
  assignment_merchant_line3: ['exhibit_a_value_1', 'exhibit_a_value_2'],
  assignment_merchant_line4: ['exhibit_a_value_2', 'exhibit_a_value_3'],
  assignment_merchant_line5: ['exhibit_a_value_3', 'exhibit_a_value_4'],
  assignment_merchant_line6: ['exhibit_a_value_4', 'exhibit_a_value_5'],
  assignment_merchant_line7: ['exhibit_a_value_5', 'exhibit_a_value_6'],
  assignment_merchant_line8: ['exhibit_a_value_6', 'exhibit_a_value_7'],
  assignment_merchant_line9: ['exhibit_a_value_7', 'exhibit_a_value_8'],
  assignment_merchant_line10: ['exhibit_a_value_8', 'exhibit_a_value_9'],
  assignment_merchant_line11: ['exhibit_a_value_9', 'exhibit_a_value_10'],
  assignment_merchant_line12: ['exhibit_a_value_10'],
  assignment_merchant_line13: ['exhibit_a_value_10'],
  case_id: ['application_id', 'case_id'],
  appendix_underwriting_fees: [
    'total_fees',
    'origination_fee',
    'underwriting_fee',
    'disclosure_broker_fee',
  ],
  // Page-1 contract + later ACH program fee — must always resolve from CRM money keys.
  ach_program_fee: [
    'monthly_fee',
    'program_fee',
    'ach_monthly_fee',
    'monthly_program_fee',
    'ach_program_fee_amount',
    'program_fee_amount',
    'ach_program_fee_p1',
  ],
  monthly_fee: ['ach_program_fee', 'program_fee', 'ach_monthly_fee', 'monthly_program_fee'],
  program_fee: ['ach_program_fee', 'monthly_fee', 'ach_monthly_fee'],
  total_fees: [
    'appendix_underwriting_fees',
    'origination_fee',
    'underwriting_fee',
    'underwriter_fee',
    'underwriterfee',
    'disclosure_broker_fee',
    'total_dollar_cost',
    'finance_charge',
  ],
  // PDF header PURCHASE PRICE = funding / offer.
  purchase_price: [
    'purchase_amount',
    'approved_amount',
    'offer_amount',
    'total_amount_business_fund',
    'disclosure_purchase_price',
  ],
  // PDF header PURCHASED AMOUNT = payback / receivables purchased.
  purchased_amount: [
    'payment_total',
    'disclosure_total_payment',
    'total_repayment_amount',
    'total_of_payments',
    'payback_amount',
    'estimated_total_payment',
  ],
  purchase_amount: [
    'purchase_price',
    'funding_provided',
    'approved_amount',
    'offer_amount',
    'total_amount_business_fund',
    'disclosure_amount_financed',
  ],
  funding_provided: [
    'purchase_amount',
    'purchased_amount',
    'approved_amount',
    'total_amount_business_fund',
  ],
  funding_provided_direct: ['net_to_merchant', 'disbursement_amount', 'funding_provided'],
  frequency: ['frequency', 'paymentterms', 'payment_terms'],
  // ACH Weekly addendum — same CRM ids as PCM_CONTRACT, unique names use `_p1_ach`.
  billing_name: ['client_name', 'ach_account_holder_name', 'merchant_contact_name'],
  billing_address: [
    'business_address',
    'business_address_contract',
    'ach_account_holder_address',
  ],
  billing_city: ['business_address_city', 'business_address_contract_city'],
  billing_state: ['business_address_state', 'business_address_contract_state'],
  billing_zip: ['business_address_zip', 'business_address_contract_zip'],
  billing_phone: ['client_phone', 'merchant_contact_phone'],
  billing_email: ['client_email', 'merchant_contact_email'],
  bank_name: [
    'ach_bank_name',
    'ach_authorization_account_holder_bank_name',
    'authorization_client_bank_name',
  ],
  routing_number: [
    'ach_bank_routing',
    'ach_authorization_account_holder_bank_routing_number',
    'authorization_client_bank_routing',
  ],
  account_number: [
    'ach_bank_account',
    'ach_authorization_account_holder_bank_account_number',
    'authorization_client_bank_account',
  ],
  weekly_payment: ['remittance'],
  ach_amount: ['remittance'],
  print_name: ['client_name', 'owner1_guarantor_name', 'merchant_contact_name'],
  print_title: ['owner_print_title'],
  // State disclosure — SignNow unique names map back to calculator / PDF ids.
  disclosure_amount_financed: [
    'total_amount_business_fund',
    'funding_provided',
    'amount_financed',
    'purchase_amount',
  ],
  total_amount_business_fund: ['disclosure_amount_financed', 'funding_provided'],
  disclosure_recipient_funds: [
    'total_amount_of_fund_disbursed',
    'total_amount_fund_disbursed',
    'disbursement_amount',
    'net_to_merchant',
  ],
  total_amount_of_fund_disbursed: ['disclosure_recipient_funds'],
  total_amount_fund_disbursed: ['disclosure_recipient_funds'],
  disclosure_finance_charge: ['total_dollar_cost', 'finance_charge'],
  total_dollar_cost: ['disclosure_finance_charge'],
  disclosure_estimated_payment: [
    'estimated_payment_amount',
    'estimated_payment',
    'daily_payment',
  ],
  estimated_payment_amount: ['disclosure_estimated_payment', 'estimated_payment'],
  estimated_payment: ['disclosure_estimated_payment', 'estimated_payment_amount'],
  disclosure_total_payment: [
    'total_amount_tobe_paid_to_provider',
    'total_amount_to_be_paid',
    'total_repayment_amount',
    'total_of_payments',
  ],
  total_amount_tobe_paid_to_provider: ['disclosure_total_payment'],
  disclosure_payment_terms: [
    'percent_of_business_income',
    'payment_exceeded_percent',
    'payment_terms_percent',
  ],
  percent_of_business_income: ['disclosure_payment_terms', 'payment_exceeded_percent'],
  payment_exceeded_percent: ['disclosure_payment_terms', 'percent_of_business_income'],
  disclosure_apr: ['estimated_annual_percentage_rate'],
  estimated_annual_percentage_rate: ['disclosure_apr'],
  disclosure_avg_monthly_revenue: [
    'monthly_income',
    'avarage_monthly_income',
    'etimated_average_income',
  ],
  monthly_income: ['disclosure_avg_monthly_revenue'],
  disclosure_term_days: ['estimated_term', 'estimated_number_of_payement'],
  estimated_term: ['disclosure_term_days'],
  disclosure_monthly_cost: ['estimated_monthly_cost'],
  estimated_monthly_cost: ['disclosure_monthly_cost'],
  disclosure_broker_fee: ['appendix_underwriting_fees'],
  disclosure_date: ['signature_date', 'agreement_date', 'signature1_date'],
  signature_date: ['disclosure_date', 'agreement_date'],
  recipient_name: ['client_name', 'disclosure_name', 'disclosure_merchant_name'],
  disclosure_name: ['client_name', 'recipient_name'],
  disclosure_merchant_name: ['client_name', 'recipient_name', 'disclosure_name'],
  funder_name: ['disclosure_funder_name'],
  // PayOff addendum unique names differ from the CRM tab ids.
  addendum_p_funder_and_business_namefull: [
    'addendum_p_funder_and_business_name',
    'client_legal_name',
    'legal_name',
    'business_legal_name',
  ],
  addendum_p_funder_and_business_namehalf: [
    'addendum_p_funder_and_business_name',
    'doing_business_as',
    'dba',
    'client_legal_name',
    'legal_name',
  ],
  addendum_p_pay_up_to_amount: [
    'previous_refi_balance',
    'refinance_amount',
    'disclosure_page3_line_2',
  ],
  addendum_p_print_name: [
    'client_name',
    'owner1_guarantor_name',
    'merchant_contact_name',
  ],
  // Monthly Fee — unique names already include `_p1`; map to main contract ids.
  authorization_client_name: [
    'client_legal_name',
    'legal_name',
    'business_legal_name',
    'authorization_client_name',
  ],
  authorized_business_phone: ['client_phone', 'merchant_contact_phone', 'guarantor_phone'],
  authorization_client_name_print: [
    'client_name',
    'owner1_guarantor_name',
    'authorization_client_name_print',
  ],
  authorization_client_bank_name: [
    'ach_bank_name',
    'ach_authorization_account_holder_bank_name',
  ],
  authorization_client_bank_routing: [
    'ach_bank_routing',
    'ach_authorization_account_holder_bank_routing_number',
  ],
  authorization_client_bank_account: [
    'ach_bank_account',
    'ach_authorization_account_holder_bank_account_number',
  ],
  disclosure_page3_third_parties: ['disclosure_page3_third_parties'],
  previous_lender_name: ['previous_lender_name'],
  disclosure_page3_line_1: [
    'appendix_underwriting_fees',
    'total_fees',
    'origination_fee',
    'underwriter_fee',
    'disclosure_broker_fee',
    'disclosure_fees_deducted',
  ],
  disclosure_page3_line_2: ['refinance_amount', 'previous_refi_balance'],
  disclosure_page3_net: [
    'disclosure_amount_financed',
    'disclosure_recipient_funds',
    'net_to_merchant',
  ],
  disclosure_page3_subtotal: ['disclosure_page3_subtotal'],
  // CA-style disclosure page 1 — SignNow still uses default "Text Field N" names.
  'text field 1': [
    'funding_provided',
    'disclosure_amount_financed',
    'purchase_amount',
    'total_amount_business_fund',
  ],
  'text field 2': [
    'funding_provided_direct',
    'disclosure_recipient_funds',
    'net_to_merchant',
  ],
  'text field 3': ['disclosure_apr', 'estimated_annual_percentage_rate'],
  'text field 4': [
    'disclosure_avg_monthly_revenue',
    'avarage_monthly_income',
    'monthly_income',
  ],
  'text field 5': ['disclosure_finance_charge', 'finance_charge', 'total_dollar_cost'],
  'text field 6': [
    'disclosure_total_payment',
    'payment_total',
    'purchase_price',
  ],
  'text field 7': ['disclosure_monthly_cost', 'estimated_monthly_cost'],
  'text field 8': [
    'disclosure_estimated_payment',
    'estimated_payment',
    'estimated_payment_amount',
    'remittance',
  ],
  'text field 9': [
    'disclosure_payment_frequency',
    'payment_frequency',
    'frequency',
  ],
  'text field 13': [
    'ach_authorization_security_question3',
    'ach_authorization_security_answer3',
    'ach_security_q3',
  ],
  'text field 22': [
    'ref_biz1_contact',
    'ach_authorization_reference_name3',
  ],
  // Nitro Advance agreement — page 22 Title widget (default SignNow name).
  'text field 29': [
    'owner_print_title',
    'print_title',
    'guarantor_print_title',
    'owner_title',
  ],
  'text field 32': ['owner2_print_title', 'owner2_title'],
  'date and time 1': ['agreement_date', 'signature_date', 'disclosure_date'],
  bussiness_reference1_contact_nummber: [
    'ref_biz1_contact',
    'ach_authorization_reference_name3',
  ],
  // Nitro Advance agreement page-1 money table (default SignNow widget names).
  'text field 34': [
    'total_fees',
    'appendix_underwriting_fees',
    'origination_fee',
    'underwriting_fee',
    'disclosure_broker_fee',
  ],
  'text field 35': [
    'purchased_amount',
    'payment_total',
    'disclosure_total_payment',
    'total_repayment_amount',
    'total_of_payments',
    'payback_amount',
    'estimated_total_payment',
  ],
  'text field 36': [
    'purchase_price',
    'purchase_amount',
    'approved_amount',
    'offer_amount',
    'total_amount_business_fund',
    'disclosure_purchase_price',
    'funding_provided',
  ],
};

/** SignNow Monthly Fee often keeps default "Text Field N" names. Order matches the PDF. */
export const MONTHLY_FEE_TEXT_FIELD_CRM_IDS = [
  'authorization_client_name',
  'authorized_business_phone',
  'business_address',
  'ach_account_holder_name',
  'ach_account_holder_dba',
  'ach_account_holder_address',
  'authorization_client_bank_name',
  'authorization_client_bank_routing',
  'authorization_client_bank_account',
  'ach_program_fee',
  // Text Field 11 is the "or Amount" / Variable Amount box — not a date.
  '',
  'remittance_start_date',
  'estimated_number_of_payments',
  'authorization_client_name_print',
];

export function isMonthlyFeeForcedBlankField(fieldName: string): boolean {
  const numbered = String(fieldName || '')
    .trim()
    .match(/^text field\s*(\d+)$/i);
  if (!numbered) return false;
  return MONTHLY_FEE_TEXT_FIELD_CRM_IDS[Number(numbered[1]) - 1] === '';
}

export function isMonthlyFeeDocumentName(value: unknown): boolean {
  const n = String(value || '')
    .trim()
    .toLowerCase();
  return n.includes('monthly') && n.includes('fee');
}

/** Addenda, disclosures, ACH, and similar extras — not the main agreement. */
export function isSupplementalSignNowDocumentName(value: unknown): boolean {
  const n = String(value || '')
    .trim()
    .toLowerCase();
  if (!n) return false;
  if (/agreement|pcm[_ ]?contract|^contract$/.test(n) && !/addendum|disclosure/.test(n)) {
    return false;
  }
  return /addendum|disclosure|exhibit|\bach\b|authorization|epa|payoff|flex|weekly|monthly/.test(
    n,
  );
}

export function isObsidianDocumentName(value: unknown): boolean {
  return String(value || '')
    .trim()
    .toLowerCase()
    .includes('obsidian');
}

export type SignNowPrefillDocumentKind = 'monthly_fee' | 'obsidian_agreement';

export type SignNowPrefillOptions = { documentKind?: SignNowPrefillDocumentKind };

/**
 * Obsidian Agreement 1 still uses default "Text Field N" names on the page-1
 * money row and a few later leftovers. Coordinates match Nitro's named columns:
 * purchase_price / purchased_amount / purchase_percent / remittance / total_fees / net.
 * Tiny widgets are the printed `$` / `%` prefixes sitting beside those amounts.
 * Only apply when the document is the Obsidian agreement — Nitro TF 22 is a
 * business-reference contact, not a dollar sign.
 */
export const OBSIDIAN_AGREEMENT_TEXT_FIELDS: Record<
  number,
  { crmId?: string; literal?: string }
> = {
  15: { literal: '$' },
  16: { literal: '$' },
  17: { literal: '%' },
  18: { literal: '$' },
  21: { literal: '$' },
  22: { literal: '$' },
  23: { crmId: 'purchase_price' },
  24: { crmId: 'purchased_amount' },
  25: { crmId: 'purchase_percent' },
  27: { crmId: 'total_fees' },
  32: { crmId: 'owner2_print_title' },
  88: { crmId: 'ref_personal1_name' },
  91: { crmId: 'ref_personal2_phone' },
};

export function signNowPrefillDocumentKind(
  documentName?: unknown,
  fieldNames?: string[],
): SignNowPrefillDocumentKind | undefined {
  if (isMonthlyFeeDocumentName(documentName)) return 'monthly_fee';
  if (isObsidianDocumentName(documentName)) return 'obsidian_agreement';
  const names = (fieldNames || []).map((n) => String(n || '').trim().toLowerCase());
  if (
    names.includes('text field 23') &&
    names.includes('text field 27') &&
    names.some((n) => n.startsWith('authorization_client_name'))
  ) {
    return 'obsidian_agreement';
  }
  return undefined;
}

export function signNowPrefillOptionsForDocument(
  documentName?: unknown,
  fieldNames?: string[],
): SignNowPrefillOptions | undefined {
  const documentKind = signNowPrefillDocumentKind(documentName, fieldNames);
  return documentKind ? { documentKind } : undefined;
}

/** Page-20 ACH bank slots the merchant signer must complete. */
const MERCHANT_REQUIRED_P20_ACH = new Set([
  'ach_bank_name',
  'ach_bank_portal',
  'ach_bank_account',
  'ach_bank_routing',
  'ach_username',
  'ach_password',
  'ach_security_q1',
  'ach_security_q2',
  'ach_security_q3',
]);

/**
 * Agreement page 20 bank fields (and Text Field 13 = security Q/A 3).
 * SignNow page_number is 0-based, so the viewer "page 20" is often 19.
 */
export function isMerchantRequiredPage20AchField(
  fieldName: string,
  pageNumber?: number,
): boolean {
  const raw = String(fieldName || '').trim();
  if (!raw) return false;
  const n = raw.toLowerCase();
  const canon = canonicalizeSignNowFieldName(raw);
  const namedP20 = /_p20\b/i.test(n);
  const onPage20 = pageNumber === 19 || pageNumber === 20;
  if (MERCHANT_REQUIRED_P20_ACH.has(canon)) {
    return namedP20 || onPage20;
  }
  if (canon === 'text field 13' || /^text[\s_]*field[\s_]*13$/i.test(n)) {
    return namedP20 || onPage20;
  }
  return false;
}

export function shouldSkipSignNowPrefill(
  fieldName: string,
  options?: SignNowPrefillOptions,
): boolean {
  const n = String(fieldName || '').trim();
  if (!n) return true;
  const textFieldMatch = n.match(/^text field\s*(\d+)$/i);
  if (textFieldMatch) {
    const num = Number(textFieldMatch[1]);
    if (options?.documentKind === 'monthly_fee') {
      return !Number.isFinite(num) || num < 1 || num > MONTHLY_FEE_TEXT_FIELD_CRM_IDS.length;
    }
    if (options?.documentKind === 'obsidian_agreement' && OBSIDIAN_AGREEMENT_TEXT_FIELDS[num]) {
      return false;
    }
    const aliasKey = `text field ${num}`;
    if (ALIASES[aliasKey]) return false;
    // 1–9 are the CA disclosure page-1 money/APR slots on the SignNow template.
    if (!Number.isFinite(num) || num < 1 || num > 9) return true;
  }
  if (/^date and time\s*\d+$/i.test(n)) {
    const aliasKey = n.toLowerCase().replace(/\s+/g, ' ').trim();
    return !ALIASES[aliasKey];
  }
  const lower = n.toLowerCase();
  // Signature/initial widgets — keep `signature_date` (disclosure text tab).
  if (lower.startsWith('signature_') && !lower.includes('date')) return true;
  if (lower.startsWith('initial_') && !lower.includes('date')) return true;
  return false;
}

export function canonicalizeSignNowFieldName(fieldName: string): string {
  const lower = String(fieldName || '')
    .trim()
    .toLowerCase();
  // Disclosure / leftover widgets keep spaced default names for alias lookup.
  if (/^text field\s*\d+/i.test(lower) || /^date and time\s*\d+/i.test(lower)) {
    return lower.replace(/\s+/g, ' ').trim();
  }
  return (
    lower
      // SignNow sometimes suffixes print-name widgets with a trailing " T".
      .replace(/\s+t$/i, '')
      .replace(/[\s-]+/g, '_')
      .replace(/((?:[a-z0-9]+_)+[a-z0-9]+)\1$/i, '$1')
      .replace(/_p\d+_s2$/i, '_s2')
      .replace(/_p\d+_g2$/i, '_g2')
      .replace(STRIP_PAGE_OWNER1, '')
      .replace(/_s1$/i, '')
      .replace(/_g1$/i, '')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .trim()
  );
}

function parsePrefillMoney(value: string): number | null {
  const n = Number(String(value || '').replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isNaPrefillValue(value: string): boolean {
  return /^n\/a$/i.test(String(value || '').trim());
}

function isZeroMoneyPrefill(value: string): boolean {
  const n = parsePrefillMoney(value);
  return n != null && n === 0;
}

/** Calculator defaults that must not hide a real Verify Prefill value. */
function isWeakSignNowPrefillHit(canon: string, value: string): boolean {
  const v = String(value || '').trim();
  if (!v) return true;
  if (isNaPrefillValue(v)) {
    return (
      /^disclosure_page3_3[abc]$/.test(canon) ||
      canon === 'disclosure_page3_third_parties' ||
      canon === 'disclosure_page3_line_2' ||
      canon === 'previous_lender_name'
    );
  }
  if (canon === 'disclosure_page3_third_parties' || canon === 'disclosure_page3_line_2') {
    return isZeroMoneyPrefill(v);
  }
  return false;
}

function formatPrefillMoney(value: number): string {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.round(value * 100) / 100);
}

/**
 * Guarantee page-1 purchase columns + ach_program_fee resolve from CRM deal money.
 * Derives total_fees from offer − net when the fee field itself is blank.
 */
function resolveForcedContractMoneyField(
  canon: string,
  map: Map<string, string>,
): string {
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const hit = mapGet(map, key);
      if (hit && !/^enter text$/i.test(hit)) return hit;
    }
    return '';
  };

  if (canon === 'purchase_price') {
    return first(
      'purchase_price',
      'purchase_amount',
      'approved_amount',
      'offer_amount',
      'total_amount_business_fund',
      'disclosure_purchase_price',
    );
  }

  if (canon === 'purchased_amount') {
    return first(
      'purchased_amount',
      'payment_total',
      'disclosure_total_payment',
      'total_repayment_amount',
      'total_of_payments',
      'payback_amount',
      'estimated_total_payment',
    );
  }

  if (canon === 'purchase_amount') {
    return first(
      'purchase_amount',
      'purchase_price',
      'funding_provided',
      'approved_amount',
      'offer_amount',
      'total_amount_business_fund',
      'disclosure_amount_financed',
      'disclosure_purchase_price',
    );
  }

  if (canon === 'total_fees') {
    const explicit = first(
      'total_fees',
      'appendix_underwriting_fees',
      'origination_fee',
      'underwriting_fee',
      'underwriter_fee',
      'disclosure_broker_fee',
    );
    if (explicit) return explicit;
    const offer = parsePrefillMoney(
      first(
        'purchase_amount',
        'purchase_price',
        'funding_provided',
        'approved_amount',
      ),
    );
    const net = parsePrefillMoney(
      first('net_to_merchant', 'funding_provided_direct', 'disbursement_amount'),
    );
    if (offer != null && net != null && offer >= net) {
      return formatPrefillMoney(offer - net);
    }
    return '';
  }

  if (canon === 'disclosure_page3_line_1') {
    return first(
      'disclosure_page3_line_1',
      'appendix_underwriting_fees',
      'total_fees',
      'origination_fee',
      'underwriter_fee',
      'disclosure_broker_fee',
      'disclosure_fees_deducted',
    );
  }

  if (canon === 'disclosure_page3_line_2') {
    const firstStrong = (...keys: string[]) => {
      for (const key of keys) {
        const hit = mapGet(map, key);
        if (hit && !isWeakSignNowPrefillHit('disclosure_page3_line_2', hit)) return hit;
      }
      return '';
    };
    return (
      firstStrong(
        'disclosure_page3_line_2',
        'refinance_amount',
        'previous_refi_balance',
      ) ||
      first(
        'disclosure_page3_line_2',
        'refinance_amount',
        'previous_refi_balance',
      )
    );
  }

  if (canon === 'disclosure_page3_net') {
    return first(
      'disclosure_page3_net',
      'disclosure_amount_financed',
      'disclosure_recipient_funds',
      'net_to_merchant',
    );
  }

  if (canon === 'ach_program_fee') {
    return first(
      'ach_program_fee',
      'monthly_fee',
      'program_fee',
      'ach_monthly_fee',
      'monthly_program_fee',
      'ach_program_fee_amount',
      'program_fee_amount',
      'ach_program_fee_p1',
    );
  }

  // Agreement widgets that still use default SignNow "Text Field N" names.
  if (canon === 'text field 34' || canon === 'text_field_34') {
    return resolveForcedContractMoneyField('total_fees', map);
  }
  if (canon === 'text field 35' || canon === 'text_field_35') {
    return resolveForcedContractMoneyField('purchased_amount', map);
  }
  if (canon === 'text field 36' || canon === 'text_field_36') {
    return (
      resolveForcedContractMoneyField('purchase_price', map) ||
      resolveForcedContractMoneyField('purchased_amount', map)
    );
  }
  if (canon === 'text field 29' || canon === 'text_field_29') {
    return (
      first(
        'owner_print_title',
        'print_title',
        'guarantor_print_title',
        'owner_title',
      ) || 'OWNER'
    );
  }
  if (canon === 'text field 32' || canon === 'text_field_32') {
    return first('owner2_print_title', 'owner2_title') || 'OWNER';
  }

  if (
    canon === 'owner_print_title' ||
    canon === 'print_title' ||
    canon === 'guarantor_print_title' ||
    canon === 'owner_title'
  ) {
    return (
      first(
        'owner_print_title',
        'print_title',
        'guarantor_print_title',
        'owner_title',
      ) || 'OWNER'
    );
  }

  return '';
}

/** Seller #2 / Owner 2 / Guarantor #2 slots on the SignNow template. */
export function isSignNowParty2Field(fieldName: string): boolean {
  const n = String(fieldName || '').toLowerCase();
  if (!n) return false;
  if (/_p\d+_s2(?:_|$)/.test(n) || /_s2$/.test(n)) return true;
  if (/_p\d+_g2(?:_|$)/.test(n) || /_g2$/.test(n)) return true;
  return /owner2|owner_2|guarantor2|guarantor_2|merchant2|merchant_2|seller.?2|business_name_2|appendix_merchant2/.test(
    n,
  );
}

function hasDistinctParty2Prefill(prefill: Record<string, string>): boolean {
  const name1 = String(
    prefill.client_name ||
      prefill.owner1_guarantor_name ||
      prefill.merchant_contact_name ||
      '',
  )
    .trim()
    .toLowerCase();
  const name2 = String(
    prefill.owner2_guarantor_name ||
      prefill.guaranty_owner2_name ||
      prefill.guaranty_guarantor2_name ||
      prefill.merchant2_name ||
      '',
  )
    .trim()
    .toLowerCase();
  const email1 = String(
    prefill.client_email || prefill.merchant_contact_email || '',
  )
    .trim()
    .toLowerCase();
  const email2 = String(prefill.owner2_email || prefill.client_email2 || '')
    .trim()
    .toLowerCase();
  if (name2 && name2 !== name1) return true;
  if (email2 && email2 !== email1) return true;
  return false;
}

function lookupMap(prefill: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  const prefer = (key: string, v: string) => {
    const existing = map.get(key);
    if (!existing) {
      map.set(key, v);
      return;
    }
    if (isNaPrefillValue(existing) && !isNaPrefillValue(v)) {
      map.set(key, v);
      return;
    }
    const existingN = parsePrefillMoney(existing);
    const incomingN = parsePrefillMoney(v);
    if (existingN === 0 && incomingN != null && incomingN > 0) {
      map.set(key, v);
    }
  };
  for (const [key, value] of Object.entries(prefill)) {
    const v = String(value ?? '').trim();
    if (!v) continue;
    const k = String(key || '').trim();
    if (!k) continue;
    prefer(k, v);
    prefer(k.toLowerCase(), v);
    const canon = canonicalizeSignNowFieldName(k);
    if (canon) prefer(canon, v);
  }
  return map;
}

function mapGet(map: Map<string, string>, key: string): string {
  return map.get(key) || map.get(key.toLowerCase()) || '';
}

/** SignNow uses one blank for "Security Question / Answer". */
function combineSecurityQa(
  map: Map<string, string>,
  index: 1 | 2 | 3,
): string {
  const q = mapGet(map, `ach_authorization_security_question${index}`);
  const a = mapGet(map, `ach_authorization_security_answer${index}`);
  if (q && a) return `${q} / ${a}`;
  return q || a;
}

function isSignNowOwner1FallbackParty2Field(fieldName: string): boolean {
  const n = String(fieldName || '').toLowerCase();
  // Last contract page contact slots exist only on `_s2` in the SignNow template.
  if (!/_p26_s2/.test(n)) return false;
  return /client_email|client_phone|client_name|signature_date/.test(n);
}

export function resolveSignNowPrefillValue(
  fieldName: string,
  prefill: Record<string, string>,
  options?: SignNowPrefillOptions,
): string {
  if (shouldSkipSignNowPrefill(fieldName, options)) return '';
  /** Main contract page 14 ACH Program Fee blank — always 0.00, not the monthly addendum fee. */
  if (/ach_program_fee_p13/i.test(String(fieldName || ''))) return '0.00';
  if (
    isSignNowParty2Field(fieldName) &&
    !hasDistinctParty2Prefill(prefill) &&
    !isSignNowOwner1FallbackParty2Field(fieldName)
  ) {
    return '';
  }
  const map = lookupMap(prefill);
  const raw = String(fieldName || '').trim();
  const lower = raw.toLowerCase();
  const canon = canonicalizeSignNowFieldName(raw);

  if (options?.documentKind === 'monthly_fee') {
    const numbered = raw.match(/^text field\s*(\d+)$/i);
    if (numbered) {
      const crmId = MONTHLY_FEE_TEXT_FIELD_CRM_IDS[Number(numbered[1]) - 1];
      if (crmId === '') return '';
      if (crmId) {
        const fromMonthly = resolveSignNowPrefillValue(crmId, prefill);
        if (fromMonthly) return fromMonthly;
      }
    }
  }

  if (options?.documentKind === 'obsidian_agreement') {
    const numbered = raw.match(/^text field\s*(\d+)$/i);
    if (numbered) {
      const spec = OBSIDIAN_AGREEMENT_TEXT_FIELDS[Number(numbered[1])];
      if (spec?.literal) return spec.literal;
      if (spec?.crmId) {
        const fromObsidian = resolveSignNowPrefillValue(spec.crmId, prefill);
        if (fromObsidian) return fromObsidian;
      }
    }
    // Template mislabeled personal-1 phone as personal-2; TF 91 is the real #2.
    if (canon === 'ref_personal2_phone') {
      const personal1 =
        mapGet(map, 'ref_personal1_phone') ||
        mapGet(map, 'ach_authorization_reference_number1') ||
        mapGet(map, 'ach_authorization_reference_number_1');
      if (personal1) return personal1;
    }
  }

  const securityMatch = canon.match(/^ach_security_q([123])$/);
  if (securityMatch) {
    const combined = combineSecurityQa(
      map,
      Number(securityMatch[1]) as 1 | 2 | 3,
    );
    if (combined) return combined;
  }

  if (canon === 'previous_lender_name') {
    const explicit = mapGet(map, 'previous_lender_name');
    if (explicit && !/^n\/a$/i.test(explicit)) return explicit;
    const line2 = parsePrefillMoney(
      mapGet(map, 'disclosure_page3_line_2') ||
        mapGet(map, 'refinance_amount') ||
        mapGet(map, 'previous_refi_balance'),
    );
    if (line2 != null && line2 > 0) {
      return (
        mapGet(map, 'funder_name') ||
        mapGet(map, 'disclosure_funder_name') ||
        ''
      );
    }
    return '';
  }

  const tryKeys = [
    raw,
    lower,
    canon,
    ...((options?.documentKind === 'monthly_fee' ||
      options?.documentKind === 'obsidian_agreement') &&
    /^text field\s*\d+$/i.test(raw)
      ? []
      : ALIASES[canon] || []),
  ];
  for (const key of tryKeys) {
    const hit = mapGet(map, key);
    if (hit && !isWeakSignNowPrefillHit(canon, hit)) return hit;
  }
  const forcedMoney = resolveForcedContractMoneyField(canon, map);
  if (forcedMoney && !isWeakSignNowPrefillHit(canon, forcedMoney)) return forcedMoney;
  if (forcedMoney) return forcedMoney;
  if (/^disclosure_page3_3[abc]$/.test(canon)) return '';
  if (canon === 'disclosure_page3_third_parties') return '0.00';
  return '';
}

/** Match CRM values onto the unique names that actually exist on a SignNow document. */
export function buildSignNowDocumentPrefillTexts(
  fieldNames: string[],
  prefill: Record<string, string>,
  options?: SignNowPrefillOptions,
): Array<{ field_name: string; prefilled_text: string }> {
  options = options?.documentKind
    ? options
    : signNowPrefillOptionsForDocument(undefined, fieldNames) || options;
  const out: Array<{ field_name: string; prefilled_text: string }> = [];
  const seen = new Set<string>();
  for (const name of fieldNames) {
    const fieldName = String(name || '').trim();
    if (!fieldName || seen.has(fieldName) || shouldSkipSignNowPrefill(fieldName, options)) {
      continue;
    }
    const value = formatSignNowPrefillValue(
      resolveSignNowPrefillValue(fieldName, prefill, options),
      fieldName,
    );
    if (!value || /^enter text$/i.test(value)) continue;
    seen.add(fieldName);
    out.push({ field_name: fieldName, prefilled_text: value });
  }
  return out;
}

const SIGNNOW_PAGE_SUFFIXES = [
  '',
  '_p1',
  '_p2',
  '_p3',
  '_p1_disc',
  '_p1_disclosure',
  '_p1_ach',
  '_p1_s1',
];

/** When the document field list is unavailable, emit CRM ids plus known unique names. */
export function expandSignNowPrefillForUnguidedPut(
  prefill: Record<string, string>,
): Array<{ field_name: string; prefilled_text: string }> {
  const byName = new Map<string, string>();
  const put = (name: string, value: string) => {
    const fieldName = String(name || '').trim();
    const prefilled = formatSignNowPrefillValue(value, fieldName);
    if (!fieldName || !prefilled || shouldSkipSignNowPrefill(fieldName)) return;
    if (!byName.has(fieldName)) byName.set(fieldName, prefilled);
  };

  for (const [key, value] of Object.entries(prefill)) {
    for (const suffix of SIGNNOW_PAGE_SUFFIXES) put(`${key}${suffix}`, value);
  }
  for (const snName of Object.keys(ALIASES)) {
    const value = resolveSignNowPrefillValue(snName, prefill);
    if (!value) continue;
    put(snName, value);
    for (const suffix of SIGNNOW_PAGE_SUFFIXES) {
      if (suffix) put(`${snName}${suffix}`, value);
    }
  }
  for (let i = 1; i <= 9; i += 1) {
    const value = resolveSignNowPrefillValue(`Text Field ${i}`, prefill);
    if (!value) continue;
    put(`Text Field ${i}`, value);
    put(`text field ${i}`, value);
  }
  const printName = resolveSignNowPrefillValue('addendum_p_print_name', prefill);
  if (printName) put('addendum_p_print_name_p1 T', printName);

  return [...byName.entries()].map(([field_name, prefilled_text]) => ({
    field_name,
    prefilled_text,
  }));
}

export function formatSignNowPrefillValue(value: string, fieldName?: string): string {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const yyyy = d.getUTCFullYear();
      return `${mm}/${dd}/${yyyy}`;
    }
  }
  const name = String(fieldName || '').toLowerCase();
  // SignNow phone widgets often use a Number/phone regex that rejects dashes
  // (e.g. "561-577-8267" → whole prefill-texts batch fails → agreement stays empty).
  if (/(?:^|_)(?:phone|mobile|fax)(?:_|$)/i.test(name) || /phone_number/i.test(name)) {
    const digits = v.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
    return digits;
  }
  // PDF already prints `$` before origination / ACH program fee blanks.
  if (
    /(?:^|_)(?:origination_fee|underwriter_fee|underwriting_fee|appendix_underwriting|ach_program_fee)(?:_|$)/i.test(
      name,
    )
  ) {
    return v.replace(/^\$+\s*/g, '').trim();
  }
  return v;
}
