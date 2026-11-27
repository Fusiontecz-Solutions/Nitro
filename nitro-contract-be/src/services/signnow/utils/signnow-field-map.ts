/**
 * Map SignNow unique field names (often `{crmId}_p{page}`) back to CRM prefill ids.
 */

import {
  composeFullAddress,
  digitsOnlyPhone,
  digitsOnlySsn,
  formatSsn,
  formatUsPhone,
  isPhoneFieldName,
  isSsnFieldName,
  widgetAcceptsDashes,
  type SigningWidgetInfo,
} from '../../../utils/contactFormat';

const STRIP_PAGE_OWNER1 =
  /_p\d+(?:_s1|_g1|_achd|_ach|_rpa|_exc|_exhibit|_disc|_disclosure|_ds)?$/i;

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
  security_tax_ein: ['ein', 'tax_id', 'federal_ein', 'federal_tax_id', 'federal_tax_id_ein', 'authorization_client_tax_id'],
  federal_tax_id_ein: ['security_tax_ein', 'ein', 'tax_id', 'federal_ein', 'federal_tax_id', 'authorization_client_tax_id'],
  federal_tax_id_ein_s2: ['federal_tax_id_ein', 'security_tax_ein', 'ein', 'tax_id', 'authorization_client_tax_id'],
  security_tax_ein_s2: ['security_tax_ein', 'federal_tax_id_ein', 'ein', 'tax_id', 'authorization_client_tax_id'],
  authorization_client_tax_id: ['security_tax_ein', 'federal_tax_id_ein', 'ein', 'tax_id'],
  authorization_client_tax_id_s2: ['authorization_client_tax_id', 'security_tax_ein', 'federal_tax_id_ein', 'ein'],
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
  /** Tiberian Flex Addendum owner block (see `TIBERIAN_FLEX_ADDENDUM_FIELD_NAMES`). */
  owner_guarantor_1_name: [
    'owner1_guarantor_name',
    'guaranty_guarantor1_name',
    'guaranty_owner1_name',
    'client_name',
  ],
  owner_guarantor_2_name: OWNER2_NAME_KEYS,
  owner_guarantor_1_ssn: ['guaranty_ss', 'guaranty_owner1_ss', 'guaranty_guarantor1_ss'],
  owner_guarantor_2_ssn: ['guaranty_owner2_ss', 'guaranty_guarantor2_ss'],
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
  /**
   * Owner 2's address widget when the template names it with the `_g2` / `_s2`
   * signer suffix (e.g. `guarantor_address_p23_g2`). Without this the widget
   * canonicalised to a name nothing answered, so Owner 2's address line came
   * back empty — and it must never fall back to Owner 1's keys.
   */
  guarantor_address_s2: ['owner2_address', 'guarantor2_address'],
  guarantor_address_city_s2: ['owner2_address_city', 'guarantor2_address_city'],
  guarantor_address_state_s2: ['owner2_address_state', 'guarantor2_address_state'],
  guarantor_address_zip_s2: ['owner2_address_zip', 'guarantor2_address_zip'],
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
  /** Personal Guarantor (#2) print-name widgets (e.g. page 22/23 `client_name_p23_g2`). */
  client_name_g2: [
    ...OWNER2_NAME_KEYS,
    'client_name',
    'owner1_guarantor_name',
    'merchant_contact_name',
  ],
  ach_account_holder_name: [
    'ach_authorization_account_holder_name',
    'authorization_client_name',
    'client_name',
    'client_legal_name',
  ],
  /**
   * Only a real DBA fills the "Account Holder DBA" line. The chain used to end
   * in `client_legal_name`, so a deal with no DBA printed the business name on
   * the agreement's page-20 ACH block (`ach_account_holder_dba_p19`) too.
   */
  ach_account_holder_dba: [
    'ach_authorization_account_holder_dba',
    'doing_business_as',
    'dba',
    'security_doing_business_as',
  ],
  /**
   * The ACH account holder address is Owner 1's address, not the business
   * physical address: the ACH block already prints the business address on its
   * own line, so resolving both from `business_address` printed the same street
   * twice. It resolves from the holder keys the CRM sends first, then from
   * Owner 1's address (`business_address_contract` / `guarantor_address`), and
   * never from `business_address`.
   */
  ach_account_holder_address: [
    'ach_authorization_account_holder_address',
    'business_address_contract',
    'guarantor_address',
    'owner1_address',
    'owner_address',
    'owner_home_address',
  ],
  ach_account_holder_address_city: [
    'ach_authorization_account_holder_city',
    'business_address_contract_city',
    'guarantor_address_city',
    'owner1_address_city',
  ],
  ach_account_holder_address_state: [
    'ach_authorization_account_holder_state',
    'business_address_contract_state',
    'guarantor_address_state',
    'owner1_address_state',
  ],
  ach_account_holder_address_zip: [
    'ach_authorization_account_holder_zip',
    'business_address_contract_zip',
    'guarantor_address_zip',
    'owner1_address_zip',
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
  /** Personal Guarantor (#2) date widgets (e.g. page 22/23 `signature_date_p23_g2`). */
  signature_date_g2: ['signature_date', 'agreement_date', 'disclosure_date'],
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
  /**
   * Business (Application → Business section) physical address. Deliberately has
   * no `business_address_contract` fallback: that key is the Merchant / Owner 1
   * home address and the two are separate entries in the CRM, so aliasing them
   * made both widgets print whichever one happened to be populated.
   */
  business_address: ['security_business_address'],
  business_address_city: ['security_business_address_city'],
  business_address_state: ['security_business_address_state'],
  business_address_zip: ['security_business_address_zip'],
  /**
   * Merchant / Owner 1 home address — the "Merchant" block on the agreement and
   * the addendums' contact-address line. Resolves from the owner/guarantor keys
   * only, never from `business_address`.
   */
  business_address_contract: [
    'guarantor_address',
    'owner1_address',
    'owner_address',
    'owner_home_address',
  ],
  business_address_contract_city: [
    'guarantor_address_city',
    'owner1_address_city',
    'owner_address_city',
    'owner_home_address_city',
  ],
  business_address_contract_state: [
    'guarantor_address_state',
    'owner1_address_state',
    'owner_address_state',
    'owner_home_address_state',
  ],
  business_address_contract_zip: [
    'guarantor_address_zip',
    'owner1_address_zip',
    'owner_address_zip',
    'owner_home_address_zip',
  ],
  guarantor_address: ['business_address_contract', 'owner1_address', 'owner_address'],
  guarantor_address_city: ['business_address_contract_city', 'owner1_address_city'],
  guarantor_address_state: ['business_address_contract_state', 'owner1_address_state'],
  guarantor_address_zip: ['business_address_contract_zip', 'owner1_address_zip'],
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
  /** Page-1 INITIAL INSTALLMENT cadence next to the dollar amount. */
  page1_installmentblock_frequency: ['frequency', 'paymentterms', 'payment_terms'],
  page1_installment_block_frequency: ['frequency', 'paymentterms', 'payment_terms'],
  installmentblock_frequency: ['frequency', 'paymentterms', 'payment_terms'],
  // ACH Weekly addendum — same CRM ids as PCM_CONTRACT, unique names use `_p1_ach`.
  billing_name: ['client_name', 'ach_account_holder_name', 'merchant_contact_name'],
  billing_address: ['business_address'],
  billing_city: ['business_address_city'],
  billing_state: ['business_address_state'],
  billing_zip: ['business_address_zip'],
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
  printed_name: ['print_name', 'client_name', 'owner1_guarantor_name', 'merchant_contact_name'],
  printed_names: ['print_name', 'client_name', 'owner1_guarantor_name', 'merchant_contact_name'],
  print_names: ['print_name', 'client_name', 'owner1_guarantor_name', 'merchant_contact_name'],
  date: ['agreement_date', 'signature_date', 'disclosure_date', 'remittance_start_date'],
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
  /**
   * The disclosure's page-2 widget is `finance_charge_p2`, which canonicalizes to
   * `finance_charge`. Without this reverse alias the line only ever filled when
   * the CRM posted that exact id, so the page-2 FINANCE CHARGE box was blank on
   * every funder whenever the value arrived as `disclosure_finance_charge`.
   */
  finance_charge: ['disclosure_finance_charge', 'total_dollar_cost'],
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
  /**
   * Every funder's disclosure names this widget `payement_exceeded_percent_p2_s1`
   * — the template's own misspelling. Only the correctly spelled id was aliased,
   * so the "percent of business income" line resolved nothing and stayed blank.
   */
  payement_exceeded_percent: [
    'disclosure_payment_terms',
    'percent_of_business_income',
    'payment_exceeded_percent',
  ],
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
  // The PayOff addendum's "Merchant DBA" line: a real DBA or blank, never the
  // merchant name printed on the line above it.
  addendum_p_funder_and_business_namehalf: [
    'doing_business_as',
    'dba',
    'security_doing_business_as',
    'ach_authorization_account_holder_dba',
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
  addendum_p_print_title: ['owner_print_title'],
  addendum_p_addendum_dated: ['agreement_date', 'signature_date', 'disclosure_date'],
  // Exhibit A has no dedicated "which owner" CRM field; the primary owner/guarantor
  // is the only reasonable single-owner value for this widget.
  exhibit_owner_name: ['owner1_guarantor_name', 'client_name', 'merchant_contact_name'],
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
  disclosure_page3_subtotal: [
    'disclosure_page3_subtotal',
    // The itemization always adds back up to the advance (see
    // `buildDisclosurePrefillDefaults`), so the advance is the right floor here.
    'disclosure_amount_financed',
    'funding_provided',
  ],
  disclouser_pg2_frequency: [
    'disclouser_pg2_frequency',
    'disclosure_payment_frequency',
    'payment_frequency',
    'frequency',
  ],
  /**
   * Unit label printed beside the Estimated Term on disclosure page 2. The term
   * is always calendar days, so this reads "DAYS" (set by
   * `buildOfferPrefillOverrides`) and must never fall back to the payment
   * cadence. Same widget name on the Nitro, Obsidian and Tiberian disclosures.
   */
  page2_frequency: ['page2_frequency'],
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
  /**
   * TOTAL AMOUNT TO BE PAID — the payback, so it must never fall back to
   * `purchase_price`, which is the funded advance and printed the wrong number
   * on the page-1 money row whenever the CRM posted no disclosure total.
   */
  'text field 6': [
    'disclosure_total_payment',
    'payment_total',
    'purchased_amount',
    'payback_amount',
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
  /**
   * Tiberian Funding agreement page-2 money row. It names what Nitro leaves on
   * SignNow defaults: `p1_totalfee` = `Text Field 34` (TOTAL FEES), while
   * PURCHASED AMOUNT / PURCHASE PRICE arrive as `purchased_amount` and
   * `Text Field 36`, which the shared entries already cover. The computed
   * underwriting + ACH total in `resolveForcedContractMoneyField` takes
   * precedence; this chain is the fallback when that comes back empty.
   */
  p1_totalfee: [
    'total_fees',
    'appendix_underwriting_fees',
    'origination_fee',
    'underwriting_fee',
    'disclosure_broker_fee',
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

/**
 * Monthly Fee "Account Holder Information" block — the **Authorized Holder
 * Name** line.
 *
 * The block prints two names side by side: "(Authorized Holder Name)" and
 * "(Authorized Holder Business Name)". The second one is the business
 * (`ach_account_holder_dba`); the first is Owner 1, the person who authorizes
 * the debit. But `ach_account_holder_name`'s alias chain leads with the CRM's
 * ACH-block holder field and `authorization_client_name`, both of which carry
 * the business legal name, so both lines came out reading
 * "RE-NEW-IT RENOVATIONS, LLC".
 *
 * These CRM ids are Owner 1's personal name only — no business-name key is in
 * the list, so the line can never fall back to the value already printed
 * beside it.
 */
export const MONTHLY_FEE_HOLDER_NAME_CRM_IDS = [
  'client_name',
  'owner1_guarantor_name',
  'guaranty_guarantor1_name',
  'merchant_contact_name',
] as const;

/**
 * True for the Monthly Fee block's Authorized Holder Name widget, in both of
 * the places that block appears: the standalone "Monthly Fee" addendum and the
 * same block printed at the end of the agreement itself (verified against the
 * live Obsidian templates — agreement bb15a185… and addendum 343d2d92… both
 * name it `ach_account_holder_name_p1`).
 *
 * Deliberately narrow. The agreement's own page-20 ACH block
 * (`ach_account_holder_name_p19`), the ACH Daily / Weekly authorizations
 * (`ach_account_holder_name_p1_ach`) and Exhibit C are bank-authorization forms
 * whose account holder is legitimately the business, and they keep resolving
 * through the unchanged `ach_account_holder_name` chain.
 */
export function isMonthlyFeeAccountHolderNameField(
  fieldName: string,
  options?: SignNowPrefillOptions,
): boolean {
  if (options?.documentKind === 'exhibit_c') return false;
  const n = String(fieldName || '').trim().toLowerCase();
  if (n === 'ach_account_holder_name_p1') return true;
  return (
    options?.documentKind === 'monthly_fee' &&
    canonicalizeSignNowFieldName(n) === 'ach_account_holder_name'
  );
}

/**
 * Monthly Fee's bottom "Print Name" line (`authorization_client_name_print_p1`,
 * `Text Field 14` on the numbered copy) — the merchant who signs, i.e. Owner 1.
 *
 * The CRM's Monthly Fee tab filled it from the ACH holder name, which falls
 * back to the business legal name, and that saved value outranked every alias
 * because the resolver tries the widget's own name first. So the line printed
 * the business name already shown on "Authorized Business Name" above it. It
 * resolves from the same Owner 1 keys as the holder name, never a business key.
 */
export function isMonthlyFeePrintNameField(
  fieldName: string,
  options?: SignNowPrefillOptions,
): boolean {
  if (options?.documentKind === 'exhibit_c') return false;
  const n = String(fieldName || '').trim().toLowerCase();
  if (n === 'authorization_client_name_print_p1') return true;
  return (
    options?.documentKind === 'monthly_fee' &&
    canonicalizeSignNowFieldName(n) === 'authorization_client_name_print'
  );
}

/** Monthly Fee numbered slots whose crm id means Owner 1, not the business. */
const MONTHLY_FEE_OWNER1_TEXT_FIELD_CRM_IDS = new Set([
  'ach_account_holder_address',
  'ach_account_holder_name',
  'authorization_client_name_print',
]);

/**
 * The bank-authorization blocks print their holder address as
 * "c. Account Holder Business Address:" — Exhibit C on every funder (Nitro and
 * Tiberian's named `ach_account_holder_address_p1`, Obsidian's positional
 * `Text Field 3`) and the agreement's own ACH page (`ach_account_holder_address_p19`).
 * That line is the business's physical address. Resolving it through the
 * `ach_account_holder_address` chain printed Owner 1's home address there.
 *
 * The Monthly Fee block is the exception and keeps Owner 1's address: it prints
 * the business address on a line of its own above the holder block (see
 * `MONTHLY_FEE_TEXT_FIELD_CRM_IDS`), and it names its holder widget
 * `ach_account_holder_address_p1` both as a standalone addendum and on the last
 * page of the agreement — the same rule `isMonthlyFeeAccountHolderNameField`
 * uses for the holder name beside it.
 */
export function isAccountHolderBusinessAddressField(
  fieldName: string,
  options?: SignNowPrefillOptions,
): boolean {
  const n = String(fieldName || '').trim().toLowerCase();
  const canon = canonicalizeSignNowFieldName(n);
  if (canon !== 'ach_account_holder_address' && canon !== 'ach_authorization_account_holder_address') {
    return false;
  }
  if (options?.documentKind === 'exhibit_c') return true;
  if (options?.documentKind === 'monthly_fee') return false;
  return n !== 'ach_account_holder_address_p1';
}

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

export function isExhibitCDocumentName(value: unknown): boolean {
  const n = String(value || '')
    .trim()
    .toLowerCase();
  if (!n || isMonthlyFeeDocumentName(n)) return false;
  // ACH Daily may be titled "Extra Exhibit C …" — treat as ACH Daily, not Exhibit C ×N.
  if (/\bach\b/.test(n) && /daily/.test(n) && !/weekly/.test(n)) return false;
  return /exhibit[\s_-]*c\b/.test(n) || n.includes('exhibitc');
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

/** "ACH weekly" is the live template's document name. */
export function isAchWeeklyDocumentName(value: unknown): boolean {
  const n = String(value || '')
    .trim()
    .toLowerCase();
  if (!n) return false;
  return /\bach\b/.test(n) && /week/.test(n);
}

/**
 * The recurring-bank (ACH) payment authorization page, daily or weekly. Every
 * funder ships its own copy — "ACH Daily", "RECURRING BANK (ACH) PAYMENT
 * AUTHORIZATION - Daily..", "ACH DAILY TIBERIAN FUNDING" — and all of them carry
 * byte-identical widget names (`*_p1_ach`). Those names are shared across
 * funders, so, exactly as with the disclosures, an ACH authorization must never
 * be classified by the funder in its title: the agreement layouts keyed off that
 * funder name (`OBSIDIAN_AGREEMENT_TEXT_FIELDS`, `TIBERIAN_AGREEMENT_TEXT_FIELDS`)
 * would then claim the page's widgets and stamp contract values into its bank row.
 */
export function isAchAuthorizationDocumentName(value: unknown): boolean {
  const n = String(value || '')
    .trim()
    .toLowerCase();
  if (!n) return false;
  return /\bach\b/.test(n) && /(daily|week)/.test(n);
}

/**
 * Every funder ships its own copy of the state disclosure ("Disclosure Obsidian
 * Capital Group", "Tiberian Funding - Disclosure", "Disclosure - Nitro Advance")
 * and all three carry byte-identical widget names — the CA page-1 `Text Field 1`-`8`
 * money row, `*_p2` page-2 slots and `*_p3` page-3 ledger. Those names are shared
 * across funders, so a disclosure must never be classified by the funder in its
 * title: the agreement layouts keyed off that funder name (`OBSIDIAN_AGREEMENT_TEXT_FIELDS`,
 * `TIBERIAN_AGREEMENT_TEXT_FIELDS`) would then claim the disclosure's numbered
 * widgets and stamp contract values into the disclosure's money row.
 */
export function isDisclosureDocumentName(value: unknown): boolean {
  const n = String(value || '')
    .trim()
    .toLowerCase();
  if (!n) return false;
  return n.includes('disclosure') || n.includes('disclouser');
}

/**
 * Field-name signature of the state disclosure, for the copies whose title
 * carries only the funder ("TIBERIAN FUNDING") and so never matches
 * `isDisclosureDocumentName`. All three funders' disclosures ship byte-identical
 * widget names, and `estimated_term_p2` / `disclouser_pg2_frequency` exist on no
 * other document in the package, so the pair cannot match an agreement.
 */
export function hasDisclosureFieldSignature(fieldNames?: string[]): boolean {
  const names = new Set(
    (fieldNames || []).map((n) => String(n || '').trim().toLowerCase()),
  );
  if (!names.size) return false;
  return (
    names.has('estimated_term_p2') &&
    (names.has('disclouser_pg2_frequency') ||
      names.has('page2_frequency') ||
      names.has('disclosure_page3_net_p3'))
  );
}

export function isObsidianDocumentName(value: unknown): boolean {
  return String(value || '')
    .trim()
    .toLowerCase()
    .includes('obsidian');
}

/**
 * Tiberian Funding's contract template is the Nitro Advance agreement plus one
 * extra page (viewer page 22, "Declaration of Ordinary Course of Business"), so
 * every page from 22 on is shifted by one. The widget *names* keep the original
 * `_p22`…`_p26` suffixes, so name-driven mapping still lines up; only the new
 * page's `_pg22` widgets and a handful of renamed slots need Tiberian-specific
 * handling (see `TIBERIAN_AGREEMENT_TEXT_FIELDS` / `TIBERIAN_PG22_FIELD_CRM_IDS`).
 */
export function isTiberianDocumentName(value: unknown): boolean {
  return String(value || '')
    .trim()
    .toLowerCase()
    .includes('tiberian');
}

/**
 * Nitro Advance's own main agreement ("Agreement - Nitro Advance") — not the
 * Obsidian / Tiberian copies of the same layout, and not a Nitro addendum,
 * disclosure or exhibit.
 */
export function isNitroAgreementDocumentName(value: unknown): boolean {
  const name = String(value || '').trim().toLowerCase();
  if (!name.includes('nitro') || !name.includes('agreement')) return false;
  if (isObsidianDocumentName(name) || isTiberianDocumentName(name)) return false;
  return !isSupplementalSignNowDocumentName(name);
}

export type SignNowPrefillDocumentKind =
  | 'monthly_fee'
  | 'obsidian_agreement'
  | 'tiberian_agreement'
  | 'exhibit_c'
  | 'ach_weekly'
  | 'payoff_addendum';

export type SignNowPrefillOptions = {
  documentKind?: SignNowPrefillDocumentKind;
  /**
   * Canonical names of every widget the document actually carries. It is what
   * lets an address widget know whether the page has companion city/state/zip
   * boxes beside it: a guarantor address block that has them stays street-only,
   * while the same widget on a page that has none is composed into the full
   * `street, city, state zip` line instead of printing half an address.
   */
  documentFieldCanons?: ReadonlySet<string>;
  /**
   * An Exhibit C copy that carries its own entity (`Exhibit C (2)` for a second
   * business). Its holder name and DBA lines print only what that entity
   * holds: the generic chains end in `client_legal_name`, which is the deal's
   * merchant, so a blank line on the extra copy used to show Exhibit C #1's
   * business instead of staying blank as it is in the CRM.
   */
  exhibitCEntityOnly?: boolean;
};

/** Keys an entity-only Exhibit C copy may read its holder name / DBA from. */
const EXHIBIT_C_ENTITY_OWN_KEYS: Record<string, readonly string[]> = {
  ach_account_holder_name: ['ach_account_holder_name', 'ach_authorization_account_holder_name'],
  ach_account_holder_dba: ['ach_account_holder_dba', 'ach_authorization_account_holder_dba'],
};

/** Keys the main Exhibit C may read its DBA line from — never the legal name. */
const EXHIBIT_C_DBA_KEYS: readonly string[] = [
  'ach_account_holder_dba',
  'ach_authorization_account_holder_dba',
  'doing_business_as',
  'dba',
  'security_doing_business_as',
];

/** Canonical widget names of the fields a document carries, for `documentFieldCanons`. */
export function signNowDocumentFieldCanons(fieldNames?: string[]): Set<string> | undefined {
  if (!Array.isArray(fieldNames) || !fieldNames.length) return undefined;
  const out = new Set<string>();
  for (const name of fieldNames) {
    const canon = canonicalizeSignNowFieldName(String(name || ''));
    if (canon) out.add(canon);
  }
  return out.size ? out : undefined;
}

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
  /**
   * Second widget inside the INITIAL INSTALLMENT box, beside the amount: the
   * cadence, printed as Daily / Weekly / Bi-Weekly / Monthly off the same CRM
   * frequency the disclosure reads. The amount widget (`remittance`) keeps the
   * dollars alone — appending the cadence there stacked "1,499.00Daily".
   */
  92: { crmId: 'page1_installmentblock_frequency' },
};

/**
 * ACH Weekly bottom-section widget names do not match their position on the PDF.
 * Verified against the live template (document 136150ac…, page 0) with
 * `npx ts-node --transpile-only src/scripts/inspectSignNowAchTemplates.ts`:
 *
 *   y=667  signature_p1_ach        -> "Account Holder's Signature:"
 *   y=676  Text Field 1            -> the "Date:" box on that same line
 *   y=691  signature_date_p1_ach   -> the "Printed Names:" line below it
 *
 * So the widget called `signature_date_p1_ach` is physically the printed-name
 * box, and the unnamed `Text Field 1` is physically the date box. Filling them
 * by name put an amount in Date (the CA-disclosure `text field 1` alias) and a
 * date in Printed Names. ACH Daily needs none of this: its equivalent widget is
 * properly named `authorization_client_name_print_p1_ach`.
 *
 * The clean permanent fix is to rename these two widgets in the SignNow
 * template; until then this table routes each one by its verified position.
 */
export const ACH_WEEKLY_POSITIONAL_FIELD_CRM_IDS: Record<string, string[]> = {
  // Physically the "Date:" box. `ach_weekly_signature_date_p1_ach` is the ACH-scoped id
  // the CRM emits for it — the bare `Text Field 1` id is the CA / NY disclosure's
  // "Funding Provided" amount and must never be written by this document.
  'text field 1': [
    'ach_weekly_signature_date_p1_ach',
    'agreement_date',
    'signature_date',
    'disclosure_date',
  ],
  // Physically the "Printed Names:" line.
  signature_date_p1_ach: [
    'print_name',
    'client_name',
    'owner1_guarantor_name',
    'merchant_contact_name',
  ],
};

/**
 * Tiberian agreement — the "THIS FORM MUST BE FILLED OUT BEFORE FUNDING"
 * reference page (page index 22; Nitro's is 21). Nitro names its three Contact
 * Information widgets `guarantor_name_p22` / `guarantor_phone_p22` /
 * `guarantor_email_p22`; the Tiberian copy ships them with SignNow's default
 * names. The numbers are matched by position against the live template
 * (document adf5b131…, page index 22): 283 sits on the "Guarantor Name" line
 * (x=109 y=129), 285 on "Phone number" (x=100 y=153), 287 on "Email"
 * (x=67 y=176) — the same boxes as Nitro's named widgets.
 *
 * Every other numbered widget on the Tiberian template is deliberately absent:
 * `Text Field 438`-`443` on the page-2 money row are the printed `$` / `%`
 * glyphs beside the amounts and must keep their own prefilled text, and
 * `Text Field 22` is the business-reference-1 contact already covered by the
 * shared `text field 22` alias.
 */
export const TIBERIAN_AGREEMENT_TEXT_FIELDS: Record<number, string> = {
  283: 'guarantor_name',
  285: 'guarantor_phone',
  287: 'guarantor_email',
};

/**
 * Tiberian agreement — the extra page 22 ("DECLARATION OF ORDINARY COURSE OF
 * BUSINESS") that Nitro and Obsidian do not have. SignNow named these widgets
 * with a `_pg22` suffix rather than the `_p22` the rest of the template uses,
 * so `canonicalizeSignNowFieldName` leaves them untouched and they need an
 * explicit mapping. Each entry resolves through the normal CRM id so the value
 * matches the same field everywhere else on the contract — `agreement_date`
 * still falls back to today's US date, and `owner2_guarantor_name` still blanks
 * out when the deal has no distinct second owner.
 *
 * These four names exist only on the Tiberian template, so the mapping cannot
 * change what any other funder's contract resolves.
 */
export const TIBERIAN_PG22_FIELD_CRM_IDS: Record<string, string> = {
  /** "…Agreement ("Agreement"), dated ____" */
  date_pg22: 'agreement_date',
  /** "…and ____ ("Merchant") on behalf of Merchant." */
  merchant_pg22: 'client_legal_name',
  /** "AUTHORIZED ACCOUNT HOLDER FOR THE SELLER #1 — Name: ____" */
  seller_pg22: 'client_name',
  /** Same block, Seller #2. */
  seller2_pg22: 'owner2_guarantor_name',
};

/**
 * "Addendum to Contract — Waiver of Personal Service" page (viewer page 23;
 * page index 22 on the Nitro and Obsidian agreements, 23 on Tiberian, which
 * inserts an extra Declaration page ahead of it).
 *
 * The page carries two service-of-process blocks. Item 3 is the MERCHANT's —
 * the business's own email and its physical address — and item 4 is the
 * GUARANTOR's, which is Owner 1's personal email and home address. But the
 * template names the merchant's two widgets `client_email_p23` and
 * `business_address_contract_p23`, and both of those canonicalise to Owner 1
 * keys (`client_email` is Owner 1's email; `business_address_contract` is the
 * Merchant / Owner 1 home address). So the page went out with Owner 1's email
 * and Owner 1's home address printed on *both* blocks, and the merchant's own
 * service address never appeared at all.
 *
 * These are the exact live widget names, verified against all three funder
 * templates (Nitro group 15308be2…, Tiberian 13ab1bd4…, Obsidian) — every
 * funder ships the same four names, so one table fixes every funder. They are
 * matched on the raw widget name *before* canonicalisation, so the override
 * cannot reach `client_email` / `business_address_contract` anywhere else in
 * the package: page 2's merchant block and the ACH / Exhibit C addendums keep
 * resolving exactly as they do today.
 *
 * Only the merchant block is listed. `guarantor_email_p23` and
 * `guarantor_address_p23` already resolve to Owner 1 through the normal alias
 * chain, which is what item 4 is supposed to print.
 */
export const WAIVER_OF_SERVICE_MERCHANT_FIELD_CRM_IDS: Record<string, string[]> = {
  /** Item 3 — "MERCHANT … ACCEPT SERVICE … BY ELECTRONIC MAIL ("EMAIL") AT ___". */
  client_email_p23: ['business_email', 'client_email'],
  /** Item 3 — "… OR BY UNITED STATES POSTAL SERVICE AT ___" (business physical address). */
  business_address_contract_p23: ['business_address'],
};

/**
 * Exhibit C ACH block, by position.
 *
 * Nitro's Exhibit C names every widget (`ach_account_holder_dba_p1`, …), but the
 * Obsidian Capital Group copy of the same page ships with SignNow's default
 * names — `Text Field 1` … `Text Field 11` — and nothing else. Verified against
 * the live Obsidian template (document a03909e9…, page 0) and Nitro's named
 * template (3621713302…), whose widgets sit on the same lines:
 *
 *   y=337/338  Text Field 1   <-> ach_account_holder_name_p1
 *   y=362      Text Field 2   <-> ach_account_holder_dba_p1
 *   y=388      Text Field 3   <-> ach_account_holder_address_p1
 *   y=470/472  Text Field 4   <-> ach_bank_name_p1
 *   y=494/496  Text Field 5   <-> ach_bank_portal_p1
 *   y=521/522  Text Field 6   <-> ach_bank_account_p1
 *   y=545/549  Text Field 7   <-> ach_bank_routing_p1
 *   y=571/573  Text Field 8   <-> ach_username_p1
 *   y=598      Text Field 9   <-> ach_password_p1
 *   y=622/623  Text Field 10  <-> ach_security_q1_p1
 *   y=648/647  Text Field 11  <-> ach_security_q2_p1
 *
 * Resolving those names through the shared alias table filled the Account
 * Holder / bank lines with the CA disclosure's page-1 money row — the
 * `7,175.00` DBA and `600.00` Business Address the merchant saw. Suppressing
 * them instead left the same lines permanently blank, because on this template
 * there is no other widget behind them. Routing each one by its verified
 * position is what actually fills the page.
 *
 * `''` marks a slot the merchant fills in the signing session (bank portal,
 * credentials, security answers). The CRM never has those values, and stamping
 * anything there would sit under the signer's own box.
 */
export const EXHIBIT_C_TEXT_FIELD_CRM_IDS: Record<number, string> = {
  1: 'ach_account_holder_name',
  2: 'ach_account_holder_dba',
  3: 'ach_account_holder_address',
  4: 'ach_bank_name',
  5: '',
  6: 'ach_bank_account',
  7: 'ach_bank_routing',
  8: '',
  9: '',
  10: '',
  11: '',
};

/**
 * Tiberian Funding's Exhibit C (template 52b24e67…, document a1ff8038…,
 * "EXHIBIT C -") is the third copy of this page, and it is the *named* layout,
 * not the numbered one: every widget carries the same unique name as Nitro's
 * template, on the same lines (within 4pt), so nothing here needs a positional
 * table and `EXHIBIT_C_TEXT_FIELD_CRM_IDS` above stays Obsidian-only.
 *
 * Verified against the live template:
 *
 *   y=64   agreement_date_p1              y=468  ach_bank_name_p1
 *   y=79   client_legal_name_p1           y=493  ach_bank_portal_p1      (signer)
 *   y=79   client_name_p1                 y=519  ach_bank_account_p1
 *   y=334  ach_account_holder_name_p1     y=546  ach_bank_routing_p1
 *   y=358  ach_account_holder_dba_p1      y=572  ach_username_p1         (signer)
 *   y=386  ach_account_holder_address_p1  y=595  ach_password_p1         (signer)
 *                                         y=621  ach_security_q1_p1      (signer)
 *                                         y=644  ach_security_q2_p1      (signer)
 *   y=722  initial_g1_p1                  y=731  initial_g2_p1
 *
 * The only divergence from Nitro's copy is a SignNow role: Tiberian left
 * `ach_bank_portal_p1` on the Owner role where Nitro assigns it to Recipient 1.
 * That is deliberately *not* mirrored into the mapping — the bank portal is a
 * credential the CRM never holds, so `EXHIBIT_C_REQUIRED_UNIQUE_NAMES` keeps it
 * an empty merchant-filled widget on every funder's copy, exactly as the
 * Obsidian `Text Field 5` slot is. The role is corrected at publish time by the
 * same reassignment that covers the other merchant-required ACH widgets.
 *
 * This list is asserted end to end in `signnow-field-map.test.ts` so a rename on
 * the Tiberian template fails a test instead of silently emptying the page.
 */
export const TIBERIAN_EXHIBIT_C_FIELD_NAMES = [
  'agreement_date_p1',
  'client_legal_name_p1',
  'client_name_p1',
  'ach_account_holder_name_p1',
  'ach_account_holder_dba_p1',
  'ach_account_holder_address_p1',
  'ach_bank_name_p1',
  'ach_bank_portal_p1',
  'ach_bank_account_p1',
  'ach_bank_routing_p1',
  'ach_username_p1',
  'ach_password_p1',
  'ach_security_q1_p1',
  'ach_security_q2_p1',
  'initial_g1_p1',
  'initial_g2_p1',
] as const;

/**
 * Tiberian Funding's Exhibit A Addendum (template 1dd030c4…, document
 * 62f8e35e…, "EXHIBIT A TF-") is the second copy of the Nitro Advance Exhibit A
 * page, and — like the Tiberian Exhibit C — it ships the *named* layout: every
 * one of its 39 widgets carries the exact same unique name as the Nitro /
 * Obsidian template (a3f75789…, document 2c50504c…, "Exhibit A - Nitro
 * Advance"), on the same lines. The two name sets were diffed against the live
 * SignNow API and are identical, so the Tiberian copy needs no funder-specific
 * mapping at all: it resolves through the same aliases Obsidian's copy does and
 * `signNowPrefillDocumentKind` leaves both without a documentKind (the title
 * carries no funder, and "Exhibit A" is not an Exhibit C / disclosure / monthly
 * fee name).
 *
 * The inventory below is the live order, top to bottom:
 *
 *   y=106  agreement_date_p1             y=396  exhibit_a_value_7_p1
 *   y=146  client_legal_name_p1          y=435  exhibit_a_value_8_p1
 *   y=161  doing_business_as_p1          y=480  exhibit_a_value_9_p1
 *   y=188  exhibit_a_value_1_p1          y=522  exhibit_a_value_10_p1
 *   …      addendum_ein_N_p1             y=560  exhibit_a_value_11_p1
 *   …      addendum_type_of_entity_N_p1  y=602  signature_p1      (Recipient 1)
 *                                        y=647  exhibit_owner_name_p1
 *                                        y=667  guaranty_ss_p1
 *                                        y=689  owner_print_title_p1
 *                                        y=710  Initials 1 / 2    (signers)
 *
 * Two quirks are the PDF's own and are mirrored on both funders' templates:
 * the seller table skips `exhibit_a_value_6_p1`, and from row 7 down the EIN
 * column runs one behind the legal-name column (`exhibit_a_value_7_p1` sits
 * beside `addendum_ein_6_p1`). Neither changes what the CRM resolves.
 *
 * Rows 4-11 stay empty on *both* funders' copies: `Addendum` only stores three
 * sellers (`legalName1..3` / `ein1..3` / `typeOfEntity1..3`), which is what
 * `loadContractPrefillDefaults` reads into `exhibit_a_value_1..3`,
 * `addendum_ein_1..3` and `addendum_type_of_entity_1..3`. Tiberian additionally
 * marks several of those empty rows `required` on the Owner role; the merchant
 * publish already clears `required` on any un-prefilled Owner widget, so the
 * flag cannot block a send.
 *
 * This list is asserted end to end in `signnow-field-map.test.ts` so a rename on
 * the Tiberian template fails a test instead of silently emptying the page.
 */
export const TIBERIAN_EXHIBIT_A_FIELD_NAMES = [
  'agreement_date_p1',
  'client_legal_name_p1',
  'doing_business_as_p1',
  'exhibit_a_value_1_p1',
  'addendum_ein_1_p1',
  'addendum_type_of_entity_1_p1',
  'exhibit_a_value_2_p1',
  'addendum_ein_2_p1',
  'addendum_type_of_entity_2_p1',
  'exhibit_a_value_3_p1',
  'addendum_ein_3_p1',
  'addendum_type_of_entity_3_p1',
  'exhibit_a_value_4_p1',
  'addendum_ein_4_p1',
  'addendum_type_of_entity_4_p1',
  'exhibit_a_value_5_p1',
  'addendum_ein_5_p1',
  'addendum_type_of_entity_5_p1',
  'exhibit_a_value_7_p1',
  'addendum_ein_6_p1',
  'addendum_type_of_entity_7_p1',
  'exhibit_a_value_8_p1',
  'addendum_ein_7_p1',
  'addendum_type_of_entity_8_p1',
  'exhibit_a_value_9_p1',
  'addendum_ein_8_p1',
  'addendum_type_of_entity_9_p1',
  'exhibit_a_value_10_p1',
  'addendum_ein_9_p1',
  'addendum_type_of_entity_10_p1',
  'exhibit_a_value_11_p1',
  'addendum_ein_10_p1',
  'addendum_type_of_entity_11_p1',
  'signature_p1',
  'exhibit_owner_name_p1',
  'guaranty_ss_p1',
  'owner_print_title_p1',
  'Initials 1',
  'Initials 2',
] as const;

/**
 * Exhibit A's seller table, one entry per printed row, in the order the live
 * template lays them out. Every funder's Exhibit A ships the same names (the
 * inventories were diffed through `src/scripts/inspectAddendumWidgets.ts`), so
 * this table is funder-agnostic.
 *
 * The three columns are NOT numbered in step: the legal-name column skips
 * `exhibit_a_value_6_p1`, so from row 6 down it runs one ahead of the EIN
 * column (`exhibit_a_value_7_p1` sits beside `addendum_ein_6_p1`). Pairing the
 * columns by their numeric suffix would therefore print row 6's EIN against
 * row 7's name; they are paired by printed row here instead.
 */
export const EXHIBIT_A_ENTITY_ROWS: ReadonlyArray<{
  legalNameKey: string;
  einKey: string;
  entityTypeKey: string;
}> = [
  { legalNameKey: 'exhibit_a_value_1', einKey: 'addendum_ein_1', entityTypeKey: 'addendum_type_of_entity_1' },
  { legalNameKey: 'exhibit_a_value_2', einKey: 'addendum_ein_2', entityTypeKey: 'addendum_type_of_entity_2' },
  { legalNameKey: 'exhibit_a_value_3', einKey: 'addendum_ein_3', entityTypeKey: 'addendum_type_of_entity_3' },
  { legalNameKey: 'exhibit_a_value_4', einKey: 'addendum_ein_4', entityTypeKey: 'addendum_type_of_entity_4' },
  { legalNameKey: 'exhibit_a_value_5', einKey: 'addendum_ein_5', entityTypeKey: 'addendum_type_of_entity_5' },
  { legalNameKey: 'exhibit_a_value_7', einKey: 'addendum_ein_6', entityTypeKey: 'addendum_type_of_entity_7' },
  { legalNameKey: 'exhibit_a_value_8', einKey: 'addendum_ein_7', entityTypeKey: 'addendum_type_of_entity_8' },
  { legalNameKey: 'exhibit_a_value_9', einKey: 'addendum_ein_8', entityTypeKey: 'addendum_type_of_entity_9' },
  { legalNameKey: 'exhibit_a_value_10', einKey: 'addendum_ein_9', entityTypeKey: 'addendum_type_of_entity_10' },
  { legalNameKey: 'exhibit_a_value_11', einKey: 'addendum_ein_10', entityTypeKey: 'addendum_type_of_entity_11' },
];

type ExhibitAEntityColumn = 'legal_name' | 'ein' | 'entity_type';

const EXHIBIT_A_ENTITY_CELL_BY_CANON = (() => {
  const map = new Map<string, { rowIndex: number; column: ExhibitAEntityColumn }>();
  EXHIBIT_A_ENTITY_ROWS.forEach((row, rowIndex) => {
    map.set(row.legalNameKey, { rowIndex, column: 'legal_name' });
    map.set(row.einKey, { rowIndex, column: 'ein' });
    map.set(row.entityTypeKey, { rowIndex, column: 'entity_type' });
  });
  return map;
})();

/**
 * The Exhibit A seller row a widget belongs to, or `null` for anything else on
 * the page (the header legal name, the signature block).
 */
export function exhibitAEntityCellForCanon(
  canon: string,
): { rowIndex: number; column: ExhibitAEntityColumn } | null {
  return EXHIBIT_A_ENTITY_CELL_BY_CANON.get(canon) || null;
}

/**
 * Resolve one cell of the Exhibit A seller table.
 *
 * A row prints only when it has a seller of its own. Row 1 is the merchant on
 * the deal, so it falls back to the contract's own legal name / EIN; rows 2-10
 * are the ADDITIONAL entities and have no fallback at all — they come from the
 * `Addendum` record's `legalName{n}` / `ein{n}` / `typeOfEntity{n}` columns or
 * they stay blank.
 *
 * Without that rule every `addendum_ein_{n}` widget matched
 * `isBusinessEinField` and picked up the application's EIN through the generic
 * `ein` / `tax_id` fallback chain, so Exhibit A printed the merchant's EIN on
 * all ten rows beside nine empty legal-name lines.
 */
function resolveExhibitAEntityCell(
  cell: { rowIndex: number; column: ExhibitAEntityColumn },
  map: Map<string, string>,
): string {
  const row = EXHIBIT_A_ENTITY_ROWS[cell.rowIndex];
  if (!row) return '';
  const isPrimary = cell.rowIndex === 0;
  const legalName =
    mapGet(map, row.legalNameKey) ||
    (isPrimary
      ? mapGet(map, 'client_legal_name') ||
        mapGet(map, 'legal_name') ||
        mapGet(map, 'business_legal_name')
      : '');
  // No seller on this line — the EIN and entity-type boxes beside it stay empty.
  if (!legalName) return '';
  if (cell.column === 'legal_name') return legalName;
  if (cell.column === 'ein') {
    return (
      mapGet(map, row.einKey) ||
      (isPrimary
        ? mapGet(map, 'federal_tax_id_ein') ||
          mapGet(map, 'security_tax_ein') ||
          mapGet(map, 'ein') ||
          mapGet(map, 'tax_id')
        : '')
    );
  }
  return mapGet(map, row.entityTypeKey);
}

/**
 * Tiberian Funding's EPA Addendum (early-payoff schedule; template 6af7ebdf…,
 * document 245bb4d1…, "EPA TF CT") is the third copy of this page, and — like
 * the Tiberian Exhibit C and Exhibit A — it ships the *named* layout: all 18 of
 * its widgets carry the exact same unique names as the Nitro catalog copy
 * (084719db…, document 056c5d2a…, "EPA Nitro Advance") and the Obsidian copy
 * (fbb2f217…, document 1817868a…, "EPA- OBSIDIAN CAPITAL GROUP"), on the same
 * lines. The three name sets were diffed against the live SignNow API and are
 * identical, so the Tiberian copy needs no funder-specific mapping at all: it
 * resolves through the same ids Obsidian's does, and `signNowPrefillDocumentKind`
 * leaves all three without a documentKind — "EPA TF CT" carries no funder name,
 * and an EPA is not an Exhibit C / disclosure / monthly-fee title.
 *
 * The inventory below is the live order, top to bottom:
 *
 *   y=211  agreement_date_p1             y=456  epo_received_date_4_p1
 *   y=231  client_legal_name_p1          y=456  epo_amount_received_4_p1
 *   y=392  epo_amount_received_1_p1      y=477  epo_received_date_5_p1
 *   y=394  epo_received_date_1_p1        y=477  epo_amount_received_5_p1
 *   y=416  epo_received_date_2_p1        y=573  signature_p1    (Recipient 1)
 *   y=416  epo_amount_received_2_p1      y=573  Signature 2     (Recipient 2)
 *   y=434  epo_amount_received_3_p1      y=605  owner1_guarantor_name_p1
 *   y=435  epo_received_date_3_p1        y=605  owner2_guarantor_name_p1
 *                                        y=622  guaranty_ss_p1
 *                                        y=622  guaranty_owner2_ss_p1
 *
 * Ledger rows 4 and 5 stay empty on *all three* funders' copies, the same way
 * Exhibit A rows 4-11 do: `EPO` only stores three payments
 * (`amountReceived1..3` / `receivedDate1..3`), which is what
 * `loadContractPrefillDefaults` reads into `epo_amount_received_1..3` and
 * `epo_received_date_1..3`. Rows 4/5 are therefore left to the signer rather
 * than stamped, and adding them would need an `EPO` schema change first.
 *
 * This list is asserted end to end in `signnow-field-map.test.ts` so a rename on
 * the Tiberian template fails a test instead of silently emptying the page.
 */
export const TIBERIAN_EPA_FIELD_NAMES = [
  'agreement_date_p1',
  'client_legal_name_p1',
  'epo_received_date_1_p1',
  'epo_amount_received_1_p1',
  'epo_received_date_2_p1',
  'epo_amount_received_2_p1',
  'epo_received_date_3_p1',
  'epo_amount_received_3_p1',
  'epo_received_date_4_p1',
  'epo_amount_received_4_p1',
  'epo_received_date_5_p1',
  'epo_amount_received_5_p1',
  'signature_p1',
  'Signature 2',
  'owner1_guarantor_name_p1',
  'owner2_guarantor_name_p1',
  'guaranty_ss_p1',
  'guaranty_owner2_ss_p1',
] as const;

/**
 * Tiberian Funding's Flex Addendum (document group template 18be4342…,
 * document ebff2427…, "FLEX TIBERIAN FUNDING (1)"), read off the live SignNow
 * API. Unlike the Tiberian Exhibit A / Exhibit C / EPA copies it does NOT share
 * the Nitro widget names: the Nitro Flex copy (b5c267f0…) has a three-column,
 * 10-row table (`installment_day_N_p1` / `daily_payment_N_p1` /
 * `receivable_purchase_N_p1`), while Tiberian's has 24 rows and an extra
 * "Net Funds Provided" column, with no `_p1` suffix. Left to right:
 *
 *   x=39 payment_date_N | x=188 net_funds_provided_N | x=323 payment_amount_N
 *   | x=460 receivables_purchased_N            (N = 1..24, y=165..542)
 *
 *   y=641  owner_guarantor_1_signature (Recipient 1)
 *          owner_guarantor_2_signature (Recipient 2)
 *   y=669  owner_guarantor_1_name      owner_guarantor_2_name
 *   y=691  owner_guarantor_1_ssn       owner_guarantor_2_ssn
 *
 * The widget names are swapped against the PDF's printed headers (Date |
 * Payment Amount | Net Funds Provided | Receivables Purchased): x=188
 * `net_funds_provided_N` prints under "Payment Amount" and x=323
 * `payment_amount_N` under "Net Funds Provided". The CRM editor binds each
 * header to the widget printed beneath it, so the tab saves the right value
 * under each name and nothing here needs to swap.
 *
 * The table widgets have no package-wide meaning: they resolve only from the
 * values typed into this document's tab in the CRM (see
 * `signnow-document-tab-values.ts`) and stay blank otherwise. The owner block
 * resolves through the `owner_guarantor_*` aliases.
 *
 * Asserted in `signnow-field-map.test.ts` so a rename on the Tiberian template
 * fails a test instead of silently emptying the page.
 */
export const TIBERIAN_FLEX_ADDENDUM_FIELD_NAMES = [
  ...Array.from({ length: 24 }, (_, i) => [
    `payment_date_${i + 1}`,
    `net_funds_provided_${i + 1}`,
    `payment_amount_${i + 1}`,
    `receivables_purchased_${i + 1}`,
  ]).flat(),
  'owner_guarantor_1_signature',
  'owner_guarantor_2_signature',
  'owner_guarantor_1_name',
  'owner_guarantor_2_name',
  'owner_guarantor_1_ssn',
  'owner_guarantor_2_ssn',
];

/**
 * Tiberian Funding's ACH Daily Addendum ("ACH Daily", template d68dd23d…,
 * document 4e472889…) is a third copy of the same RECURRING BANK (ACH) PAYMENT
 * AUTHORIZATION page Nitro (5741b00c…) and Obsidian (634cbdac…, "RECURRING BANK
 * (ACH) PAYMENT AUTHORIZATION - Daily..") already ship. All three carry the
 * *same* 14 widget names — the live inventories were diffed through
 * `src/scripts/inspectAchDailyTemplates.ts` and share every name, with none on
 * either side — so the Tiberian copy needs no funder-specific mapping: it
 * resolves through the same `_p1_ach` aliases Obsidian's copy does, and
 * `signNowPrefillDocumentKind` leaves all three without a documentKind (the
 * titles carry no funder, and an ACH *Daily* name is deliberately excluded from
 * `isExhibitCDocumentName` and never matches `isAchWeeklyDocumentName`).
 *
 * The inventory below is the live order, top to bottom:
 *
 *   y=200  client_name_p1_ach             y=363  ach_account_holder_name_p1_ach
 *   y=218  remittance_p1_ach              y=379  ach_bank_name_p1_ach
 *   y=218  remittance_start_date_p1_ach   y=393  ach_bank_account_p1_ach
 *   y=232  purchase_amount_p1_ach         y=393  ach_bank_routing_p1_ach
 *   y=279  business_address_p1_ach        y=649  signature_p1_ach  (Recipient 1)
 *   y=297  merchant_contact_phone_p1_ach  y=663  signature_date_p1_ach
 *   y=297  merchant_contact_email_p1_ach  y=681  authorization_client_name_print_p1_ach
 *
 * `signature_p1_ach` is the signer's own widget and is never a prefill target.
 * `signature_date_p1_ach` and `authorization_client_name_print_p1_ach` are the
 * bottom Date / Printed Name pair; unlike ACH Weekly — whose template misnames
 * that pair and needs the `ACH_WEEKLY_POSITIONAL_FIELD_CRM_IDS` remap — ACH
 * Daily names both correctly on every funder's copy, so no remap applies.
 *
 * The only divergence from Obsidian's copy is that Tiberian leaves the Owner
 * text widgets `required: false` where Obsidian marks them `required: true`.
 * That changes nothing here: the merchant publish clears `required` on any
 * un-prefilled Owner widget, and every one of these is CRM-filled anyway.
 *
 * This list is asserted end to end in `signnow-field-map.test.ts` so a rename on
 * the Tiberian template fails a test instead of silently emptying the page.
 */
export const TIBERIAN_ACH_DAILY_FIELD_NAMES = [
  'client_name_p1_ach',
  'remittance_p1_ach',
  'remittance_start_date_p1_ach',
  'purchase_amount_p1_ach',
  'business_address_p1_ach',
  'merchant_contact_phone_p1_ach',
  'merchant_contact_email_p1_ach',
  'ach_account_holder_name_p1_ach',
  'ach_bank_name_p1_ach',
  'ach_bank_account_p1_ach',
  'ach_bank_routing_p1_ach',
  'signature_p1_ach',
  'signature_date_p1_ach',
  'authorization_client_name_print_p1_ach',
] as const;

/** Exhibit C numbered slots the merchant fills — kept as empty signer widgets. */
const EXHIBIT_C_MERCHANT_TEXT_FIELD_NUMBERS = new Set([1, 5, 8, 9, 10, 11]);

/** `Text Field N` on an Exhibit C layout, N as a number (0 when it is not one). */
export function exhibitCTextFieldNumber(fieldName: string): number {
  const match = String(fieldName || '')
    .trim()
    .match(/^text[\s_]*field[\s_]*(\d+)$/i);
  if (!match) return 0;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : 0;
}

/**
 * True when the title itself says the document is the main agreement.
 *
 * `hasDisclosureFieldSignature` is the other half of this guard, and it can
 * only see widget names — which a merchant publish deletes as it bakes their
 * values into page text. So on a resend the Tiberian disclosure, titled just
 * "TIBERIAN FUNDING", arrived with no widget names left and nothing but the
 * funder name in its title, and `isTiberianDocumentName` claimed it as that
 * funder's agreement.
 *
 * Requiring the word as well means a funder name alone never classifies a
 * document as an agreement; the field-name signatures further down still
 * recognise an agreement that arrives with no usable title.
 */
function looksLikeAgreementDocumentName(value: unknown): boolean {
  return /agreement|contract/i.test(String(value || '').trim());
}

/**
 * The PayOff Addendum (refi) — every funder's copy. Its only numbered widget is
 * the `,` printed between the signer's name and title (`Text Field 7` on
 * Obsidian, `Text Field 5` on Tiberian, `Text Field 13` on Nitro), which the
 * CA-disclosure / ACH aliases for those numbers overwrote with the monthly cost,
 * the finance charge or a security answer.
 */
function isPayoffAddendumDocument(documentName: unknown, fieldNames?: string[]): boolean {
  const name = String(documentName || '');
  if (/pay\s*-?\s*off/i.test(name) && !isDisclosureDocumentName(name)) return true;
  const names = new Set((fieldNames || []).map((n) => String(n || '').trim().toLowerCase()));
  return (
    names.has('addendum_p_pay_up_to_amount_p1') &&
    names.has('net_to_merchant_p1') &&
    names.size <= 20
  );
}

export function signNowPrefillDocumentKind(
  documentName?: unknown,
  fieldNames?: string[],
): SignNowPrefillDocumentKind | undefined {
  if (isMonthlyFeeDocumentName(documentName)) return 'monthly_fee';
  if (isExhibitCDocumentName(documentName)) return 'exhibit_c';
  if (isPayoffAddendumDocument(documentName, fieldNames)) return 'payoff_addendum';
  // A funder's disclosure carries the funder name too — never let it be read as
  // that funder's agreement (see `isDisclosureDocumentName`). Tiberian's copy is
  // titled just "TIBERIAN FUNDING", with no word the title test can see, so the
  // widget signature has to carry the same protection.
  if (
    !isDisclosureDocumentName(documentName) &&
    !hasDisclosureFieldSignature(fieldNames) &&
    !isAchAuthorizationDocumentName(documentName) &&
    looksLikeAgreementDocumentName(documentName)
  ) {
    if (isObsidianDocumentName(documentName)) return 'obsidian_agreement';
    if (isTiberianDocumentName(documentName)) return 'tiberian_agreement';
  }
  const names = (fieldNames || []).map((n) => String(n || '').trim().toLowerCase());
  /**
   * Field-name signature of the Tiberian agreement, for the prefill paths that
   * run without a document name. `merchant_pg22` only exists on its extra
   * Declaration page and `p1_totalfee` only on its page-2 money row, so the
   * pair cannot match Nitro's or Obsidian's copy of the same contract.
   */
  if (names.includes('merchant_pg22') && names.includes('p1_totalfee')) {
    return 'tiberian_agreement';
  }
  if (
    names.includes('text field 23') &&
    names.includes('text field 27') &&
    names.some((n) => n.startsWith('authorization_client_name'))
  ) {
    return 'obsidian_agreement';
  }
  if (
    names.some((n) => n === 'ach_account_holder_name_p1') &&
    names.some((n) => n === 'ach_bank_portal_p1') &&
    names.some((n) => n === 'ach_username_p1') &&
    names.length <= 40
  ) {
    return 'exhibit_c';
  }
  if (isAchWeeklyDocumentName(documentName)) return 'ach_weekly';
  // Field-name signature of the ACH Weekly PDF (see the positional table above).
  if (
    names.includes('text field 1') &&
    names.includes('signature_date_p1_ach') &&
    names.includes('remittance_start_date_p1_ach')
  ) {
    return 'ach_weekly';
  }
  return undefined;
}

export function signNowPrefillOptionsForDocument(
  documentName?: unknown,
  fieldNames?: string[],
): SignNowPrefillOptions | undefined {
  const documentKind = signNowPrefillDocumentKind(documentName, fieldNames);
  const documentFieldCanons = signNowDocumentFieldCanons(fieldNames);
  if (!documentKind && !documentFieldCanons) return undefined;
  return {
    ...(documentKind ? { documentKind } : {}),
    ...(documentFieldCanons ? { documentFieldCanons } : {}),
  };
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

/** Exhibit C orange slots the merchant signer must complete. Blue owner fields stay prefilled. */
const MERCHANT_REQUIRED_EXHIBIT_C = new Set([
  'ach_account_holder_name',
  'ach_bank_portal',
  'ach_username',
  'ach_password',
  'ach_security_q1',
  'ach_security_q2',
]);

/** Exact SignNow unique names Signer 1 must fill on Exhibit C (same flow as page 20). */
export const EXHIBIT_C_REQUIRED_UNIQUE_NAMES = [
  'ach_account_holder_name_p1',
  'ach_bank_portal_p1',
  'ach_username_p1',
  'ach_password_p1',
  'ach_security_q1_p1',
  'ach_security_q2_p1',
] as const;

export function isDedicatedExhibitCRequiredField(fieldName: string): boolean {
  const n = String(fieldName || '').trim().toLowerCase();
  return (EXHIBIT_C_REQUIRED_UNIQUE_NAMES as readonly string[]).includes(n);
}

/**
 * Exhibit C merchant-required unique names (`*_p1`). Scoped so Monthly Fee /
 * ACH Weekly (`*_p1_ach`) are not treated as signer-required.
 */
export function isMerchantRequiredExhibitCField(
  fieldName: string,
  pageNumber?: number,
  options?: SignNowPrefillOptions,
): boolean {
  const raw = String(fieldName || '').trim();
  if (!raw) return false;
  if (options?.documentKind && options.documentKind !== 'exhibit_c') return false;
  if (isDedicatedExhibitCRequiredField(raw)) return true;
  /**
   * The Obsidian copy of Exhibit C names none of its widgets, so its merchant
   * slots arrive as `Text Field 1/5/8/9/10/11` (see
   * `EXHIBIT_C_TEXT_FIELD_CRM_IDS`). They are the same bank-portal / credential
   * / security blanks the named Nitro template marks required, and must stay
   * empty signer widgets rather than be baked or dropped.
   */
  const numberedSlot = exhibitCTextFieldNumber(raw);
  if (numberedSlot) {
    return (
      options?.documentKind === 'exhibit_c' &&
      EXHIBIT_C_MERCHANT_TEXT_FIELD_NUMBERS.has(numberedSlot)
    );
  }
  const n = raw.toLowerCase();
  if (/_p20\b/i.test(n) || pageNumber === 19 || pageNumber === 20) return false;
  if (/_p1_achd\b|_p\d+_achd\b|_p1_ach\b|_p\d+_ach\b/i.test(n)) return false;
  const canon = canonicalizeSignNowFieldName(raw);
  if (!MERCHANT_REQUIRED_EXHIBIT_C.has(canon)) return false;
  const namedP1 = /_p1(?:_|$)/i.test(n);
  const onFirstPages = pageNumber === 0 || pageNumber === 1;
  const onExhibitCPage =
    options?.documentKind === 'exhibit_c' && onFirstPages;
  return namedP1 || onExhibitCPage || onFirstPages;
}

/**
 * Contract page 22 reference / landlord / emergency slots the merchant must complete.
 * Unique names match the SignNow template; `Text Field 22` is the biz-ref-1 contact.
 */
export const CONTRACT_P22_REQUIRED_UNIQUE_NAMES = [
  'ref_personal1_name_p22',
  'ref_personal1_phone_p22',
  'ref_personal2_name_p22',
  'ref_personal2_phone_p22',
  'ref_biz1_company_p22',
  'ref_biz1_phone_p22',
  'ref_biz2_company_p22',
  'ref_biz2_contact_p22',
  'ref_biz2_phone_p22',
  'landlord_company_p22',
  'landlord_contact_p22',
  'landlord_phone_p22',
  'emergency_name_p22',
  'emergency_relationship_p22',
  'emergency_phone_p22',
  'emergency_email_p22',
] as const;

const MERCHANT_REQUIRED_P22_REFERENCES = new Set([
  'ref_personal1_name',
  'ref_personal1_phone',
  'ref_personal2_name',
  'ref_personal2_phone',
  'ref_biz1_company',
  'ref_biz1_contact',
  'ref_biz1_phone',
  'ref_biz2_company',
  'ref_biz2_contact',
  'ref_biz2_phone',
  'landlord_company',
  'landlord_contact',
  'landlord_phone',
  'emergency_name',
  'emergency_relationship',
  'emergency_phone',
  'emergency_email',
]);

export function isDedicatedContractP22RequiredField(fieldName: string): boolean {
  const n = String(fieldName || '').trim().toLowerCase();
  return (CONTRACT_P22_REQUIRED_UNIQUE_NAMES as readonly string[]).includes(n);
}

function isContractPage22TextField22(
  fieldName: string,
  pageNumber?: number,
  options?: SignNowPrefillOptions,
): boolean {
  if (
    options?.documentKind === 'monthly_fee' ||
    options?.documentKind === 'obsidian_agreement' ||
    options?.documentKind === 'exhibit_c'
  ) {
    return false;
  }
  const n = String(fieldName || '').trim().toLowerCase();
  if (n !== 'text field 22' && n !== 'text_field_22') return false;
  return pageNumber === 21 || pageNumber === 22;
}

/**
 * Agreement page 22 personal/business references, landlord, and emergency contact.
 * SignNow page_number is 0-based, so the viewer "page 22" is often 21.
 * `Text Field 22` is scoped to page 22 so Obsidian's dollar-sign widget stays untouched.
 */
export function isMerchantRequiredPage22ReferenceField(
  fieldName: string,
  pageNumber?: number,
  options?: SignNowPrefillOptions,
): boolean {
  const raw = String(fieldName || '').trim();
  if (!raw) return false;
  if (
    options?.documentKind === 'monthly_fee' ||
    options?.documentKind === 'obsidian_agreement' ||
    options?.documentKind === 'exhibit_c'
  ) {
    return false;
  }
  if (isDedicatedContractP22RequiredField(raw)) return true;
  if (isContractPage22TextField22(raw, pageNumber, options)) return true;
  const n = raw.toLowerCase();
  const canon = canonicalizeSignNowFieldName(raw);
  const namedP22 = /_p22\b/i.test(n);
  const onPage22 = pageNumber === 21 || pageNumber === 22;
  if (MERCHANT_REQUIRED_P22_REFERENCES.has(canon)) {
    return namedP22 || onPage22;
  }
  return false;
}

/**
 * Page-20 ACH / Exhibit C orange widgets use the 16pt addendum face.
 * Page-22 contract references keep the existing contract field size.
 */
export function usesAddendumFillableFont(
  fieldName: string,
  pageNumber?: number,
  options?: SignNowPrefillOptions,
): boolean {
  if (isMerchantRequiredPage22ReferenceField(fieldName, pageNumber, options)) {
    return false;
  }
  return isMerchantRequiredSignerField(fieldName, pageNumber, options);
}

/** Page-20 ACH, Exhibit C orange, or contract page-22 reference fields. */
export function isMerchantRequiredSignerField(
  fieldName: string,
  pageNumber?: number,
  options?: SignNowPrefillOptions,
): boolean {
  return (
    isMerchantRequiredPage20AchField(fieldName, pageNumber) ||
    isMerchantRequiredExhibitCField(fieldName, pageNumber, options) ||
    isMerchantRequiredPage22ReferenceField(fieldName, pageNumber, options)
  );
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
    /**
     * Tiberian's reference-page Contact Information slots. Anything else
     * numbered on that template is a printed `$` / `%` glyph whose own
     * prefilled text must survive, so it stays skipped by the rules below.
     */
    if (options?.documentKind === 'tiberian_agreement') {
      if (TIBERIAN_AGREEMENT_TEXT_FIELDS[num]) return false;
      const aliased = ALIASES[`text field ${num}`];
      return !aliased;
    }
    // Exhibit C's numbered widgets mean what its own layout says (see
    // `EXHIBIT_C_TEXT_FIELD_CRM_IDS`); a number that layout does not use is not
    // a CA-disclosure slot either, so nothing is written to it.
    if (options?.documentKind === 'exhibit_c') {
      return !(num in EXHIBIT_C_TEXT_FIELD_CRM_IDS);
    }
    // The PayOff Addendum's numbered widgets are printed punctuation (see
    // `isPayoffAddendumDocument`); their template text must survive.
    if (options?.documentKind === 'payoff_addendum') return true;
    const aliasKey = `text field ${num}`;
    if (ALIASES[aliasKey]) return false;
    // 1–9 are the CA disclosure page-1 money/APR slots on the SignNow template.
    if (!Number.isFinite(num) || num < 1 || num > 9) return true;
  }
  if (/^date and time\s*\d+$/i.test(n)) {
    const aliasKey = n.toLowerCase().replace(/\s+/g, ' ').trim();
    return !ALIASES[aliasKey];
  }
  if (/^date(?:\s+\d+)?$/i.test(n)) return false;
  const lower = n.toLowerCase();
  const canon = canonicalizeSignNowFieldName(n);
  // Notification of Assignment merchant list stays blank — no business names.
  // Tiberian transposed the last one to `assignment_merchant13_line_p24`.
  if (
    /^assignment_merchant_line\d+$/.test(canon) ||
    /assignment_merchant_line/i.test(lower) ||
    /assignment_merchant\d+_line/i.test(lower)
  ) {
    return true;
  }
  /**
   * Signature/initial widgets — keep `signature_date` (disclosure text tab).
   * Tiberian's copy carries SignNow defaults (`Signature8_pg22`, `Initials 47`)
   * and a few typo'd names (`initia2_g1_p19`, `initial_g21_p6`), so the prefix
   * test is name-shape based rather than an exact `signature_` / `initial_`.
   */
  if (/^signature/.test(lower) && !lower.includes('date')) return true;
  if (/^initia/.test(lower) && !lower.includes('date')) return true;
  return false;
}

/** Page-3 Date widget (`remittance_start_date_p3`) and Monthly Fee / ACH start dates. */
export function isRemittanceStartDateField(fieldName: string): boolean {
  const canon = canonicalizeSignNowFieldName(fieldName);
  if (canon === 'remittance_start_date') return true;
  return isSendDayDateField(canon, fieldName);
}

function isUsDatePrefillValue(value: string): boolean {
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(String(value || '').trim());
}

function isMoneyPrefillValue(value: string): boolean {
  const t = String(value || '').trim();
  if (!t || isUsDatePrefillValue(t)) return false;
  return /^\$?-?\d[\d,]*\.\d{2}$/.test(t);
}

function isSendDayDateField(canon: string, raw: string): boolean {
  const n = String(canon || raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!n || n.includes('previous')) return false;
  if (n === 'date' || /^date_\d+$/.test(n)) return true;
  return (
    n === 'agreement_date' ||
    n === 'signature_date' ||
    n === 'signature_date2' ||
    n === 'signature1_date' ||
    n === 'signature2_date' ||
    n === 'disclosure_date' ||
    n === 'disclosure_date2' ||
    n === 'remittance_start_date' ||
    /(?:^|_)(agreement_date|signature_date|disclosure_date|signature1_date|signature2_date)(?:_|$)/.test(
      n,
    ) ||
    /_dated(?:_|$)/.test(n)
  );
}

function isNameLikeField(canon: string, raw: string): boolean {
  const n = `${canon} ${raw}`.toLowerCase();
  return /print(?:ed)?[_ ]?names?|client_name|billing_name|account_holder_name|guarantor_name|merchant_contact_name|recipient_name/.test(
    n,
  );
}

function isBusinessEinField(canon: string, raw: string): boolean {
  const n = `${canon} ${raw}`.toLowerCase();
  if (/ssn|social/.test(n)) return false;
  return /(?:ein|tax_id|federal_tax|authorization_client_tax)/.test(n);
}

/** US calendar day in Eastern Time — remittance start / agreement date fallback. */
export function currentSignNowUsDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}/${get('day')}/${get('year')}`;
}

/**
 * SignNow Date widgets store the day they were placed (e.g. 08/19/2026).
 * Prefer CRM agreement/signature date, then today — never the template default.
 */
function resolveRemittanceStartDate(map: Map<string, string>): string {
  return (
    mapGet(map, 'agreement_date') ||
    mapGet(map, 'signature_date') ||
    mapGet(map, 'disclosure_date') ||
    currentSignNowUsDate()
  );
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
      // Guarantor #2 widgets share the same CRM values as seller/signer #2.
      .replace(/_p\d+_g2$/i, '_g2')
      .replace(/_g2$/i, '_s2')
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
/** Flat ACH/program fee charged when the deal's ACH box is checked. */
const SIGNNOW_DEFAULT_ACH_PROGRAM_FEE = 25;

const SIGNNOW_ACH_ENABLED_KEYS = [
  'ach_enabled',
  'ach_selected',
  'ach_checked',
  'ach_fee_enabled',
  'monthly_fee_enabled',
  'program_fee_enabled',
  'has_ach_fee',
];

function isTruthyPrefillFlag(value: string): boolean {
  return /^(1|y|yes|true|on|checked|x)$/i.test(String(value || '').trim());
}

/**
 * The deal's standalone ACH program fee: the CRM amount when it sends one,
 * otherwise the flat $25 whenever the deal's ACH box is checked. Zero/blank
 * amount with no flag means the box is unchecked.
 *
 * This is a recurring charge on the ACH addendum, NOT part of the agreement's
 * TOTAL FEES column — that column is the origination fee plus the optional $25
 * wire fee only.
 */
export function resolveAchProgramFeeAmount(map: Map<string, string>): number {
  for (const key of [
    'ach_program_fee',
    'monthly_fee',
    'program_fee',
    'ach_monthly_fee',
    'monthly_program_fee',
    'ach_program_fee_amount',
    'program_fee_amount',
    'ach_program_fee_p1',
  ]) {
    const amount = parsePrefillMoney(mapGet(map, key));
    if (amount != null && amount > 0) return amount;
  }
  for (const key of SIGNNOW_ACH_ENABLED_KEYS) {
    if (isTruthyPrefillFlag(mapGet(map, key))) {
      return SIGNNOW_DEFAULT_ACH_PROGRAM_FEE;
    }
  }
  return 0;
}

/**
 * Page-2 TOTAL FEES widget. Nitro leaves it on SignNow's default `Text Field 34`
 * (mapped through the alias table); Tiberian names it `p1_totalfee`. Both must
 * reach the computed TOTAL FEES (underwriting + optional wire fee) rather than
 * the bare fee field.
 */
function isTotalFeesField(canon: string): boolean {
  return canon === 'total_fees' || canon === 'p1_totalfee';
}

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
    // A CRM-supplied grand total already includes the ACH fee — use it verbatim.
    const explicitTotal = first('total_fees');
    if (explicitTotal && !isZeroMoneyPrefill(explicitTotal)) return explicitTotal;

    const offer = parsePrefillMoney(
      first(
        'purchase_amount',
        'purchase_price',
        'funding_provided',
        'approved_amount',
      ),
    );
    const underwritingRaw = first(
      'appendix_underwriting_fees',
      'origination_fee',
      'underwriting_fee',
      'underwriter_fee',
      'disclosure_broker_fee',
    );
    const underwriting = underwritingRaw
      ? parsePrefillMoney(underwritingRaw)
      : null;
    // A fee that swallows the whole purchase price is a stale value scaled against a
    // larger, superseded offer — not a fee. Printing it broke the row's own arithmetic
    // (PURCHASE PRICE − TOTAL FEES = NET AMOUNT), so fall through to the net instead.
    // An absent amount parses as 0 here, so only a positive offer can veto the fee.
    const offerForFeeCheck = offer != null && offer > 0 ? offer : null;
    // TOTAL FEES is the origination fee (which already carries the $25 wire fee
    // when the deal's checkbox is ticked). The ACH/monthly program fee is billed
    // separately and must NOT be added here — doing so inflated the printed
    // TOTAL FEES past the CRM's own figure on every funder.
    if (
      underwriting != null &&
      underwriting > 0 &&
      (offerForFeeCheck == null || underwriting < offerForFeeCheck)
    ) {
      return formatPrefillMoney(underwriting);
    }

    const net = parsePrefillMoney(
      first('net_to_merchant', 'funding_provided_direct', 'disbursement_amount'),
    );
    if (offer != null && net != null && offer >= net && offer - net > 0) {
      // offer − net already nets out every deducted fee.
      return formatPrefillMoney(offer - net);
    }
    return explicitTotal || '';
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

/** Owner 1 CRM keys that must not fill a distinct Owner 2 / `_s2` slot. */
function isOwner1ContactAlias(key: string): boolean {
  const k = String(key || '').toLowerCase();
  if (!k) return false;
  if (/owner2|guarantor2|merchant2|phone2|email2|_s2$|_g2$/.test(k)) return false;
  return (
    k === 'client_phone' ||
    k === 'guarantor_phone' ||
    k === 'client_email' ||
    k === 'guarantor_email' ||
    k === 'client_name' ||
    k === 'guarantor_name' ||
    k.startsWith('merchant_contact_') ||
    k.startsWith('owner1_')
  );
}

/** D/B/A, Account Holder DBA, Merchant DBA — on every funder's contract and addendum. */
const DBA_WIDGET_RE =
  /(?:^|_)dba\d*(?:_|$)|doing_business|holder_dba|merchant_dba|funder_and_business_namehalf/i;

/** Keys that carry the business's legal name, which a DBA line must never repeat. */
const BUSINESS_LEGAL_NAME_KEYS: readonly string[] = [
  'client_legal_name',
  'legal_name',
  'business_legal_name',
  'merchant_legal_name',
  'security_business_name',
  'addendum_p_funder_and_business_name',
];

function isDbaWidget(fieldName: string, options?: SignNowPrefillOptions): boolean {
  const raw = String(fieldName || '').trim();
  const slot = options?.documentKind === 'exhibit_c' ? exhibitCTextFieldNumber(raw) : null;
  const id = slot ? EXHIBIT_C_TEXT_FIELD_CRM_IDS[slot] || '' : canonicalizeSignNowFieldName(raw);
  // Monthly Fee prints `ach_account_holder_dba_p1` as "Authorized Holder
  // Business Name", so the business name is that line's correct value.
  if (options?.documentKind === 'monthly_fee' && /ach_account_holder_dba/i.test(id)) return false;
  return DBA_WIDGET_RE.test(id);
}

/**
 * Any D/B/A line — the agreement's, the addendums', Exhibit C's. The CRM owns
 * it: when it resolves blank it is cleared, and text already on the widget is
 * never read back as its value. Otherwise a DBA one earlier send stamped there
 * (an Exhibit C (2) entity's, on a reused Tiberian group) kept printing on the
 * agreement after the CRM's DBA was blank.
 */
export function isSignNowDbaWidget(fieldName: string, options?: SignNowPrefillOptions): boolean {
  return isDbaWidget(fieldName, options);
}

function normalizeBusinessName(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A DBA widget prints only a real DBA. Earlier CRM builds filled a blank DBA
 * with the business name and saved it into the per-template prefill, so the
 * value arriving here can be the legal name under a DBA key; that prints blank.
 */
/** Prefix of the keys holding a value edited on this exact widget in SignNow Review. */
export const SIGNNOW_REVIEW_EDIT_KEY_PREFIX = '__signnow_review_edit__:';

export function resolveSignNowPrefillValue(
  fieldName: string,
  prefill: Record<string, string>,
  options?: SignNowPrefillOptions,
): string {
  // What the preparer typed on this widget in SignNow Review outranks every CRM
  // source, the computed TOTAL FEES / positional Exhibit C rows included.
  const edited = String(
    prefill[`${SIGNNOW_REVIEW_EDIT_KEY_PREFIX}${String(fieldName || '').trim()}`] ?? '',
  ).trim();
  if (edited && !shouldSkipSignNowPrefill(fieldName, options)) return edited;
  const value = resolveSignNowPrefillValueUnguarded(fieldName, prefill, options);
  if (!value || !isDbaWidget(fieldName, options)) return value;
  // An entity-only Exhibit C copy reads its DBA from that entity's own record
  // (see EXHIBIT_C_ENTITY_OWN_KEYS), never a fallback, so it prints exactly
  // what the CRM shows for that copy even when it matches the legal name.
  if (options?.documentKind === 'exhibit_c' && options.exhibitCEntityOnly) return value;
  const dba = normalizeBusinessName(value);
  const map = lookupMap(prefill);
  const echoesLegalName = BUSINESS_LEGAL_NAME_KEYS.some(
    (key) => normalizeBusinessName(mapGet(map, key)) === dba,
  );
  return echoesLegalName ? '' : value;
}

function resolveSignNowPrefillValueUnguarded(
  fieldName: string,
  prefill: Record<string, string>,
  options?: SignNowPrefillOptions,
): string {
  if (shouldSkipSignNowPrefill(fieldName, options)) return '';
  /** Main contract page 14 ACH Program Fee blank — always 0.00, not the monthly addendum fee. */
  if (/ach_program_fee_p13/i.test(String(fieldName || ''))) return '0.00';
  const raw = String(fieldName || '').trim();
  const lower = raw.toLowerCase();
  const canon = canonicalizeSignNowFieldName(raw);
  const party2Field = isSignNowParty2Field(fieldName);
  const distinctParty2 = hasDistinctParty2Prefill(prefill);
  const allowOwner1Party2Fallback = isSignNowOwner1FallbackParty2Field(fieldName);
  const einField = isBusinessEinField(canon, raw);
  if (party2Field && !distinctParty2 && !allowOwner1Party2Fallback && !einField) {
    return '';
  }
  /**
   * Exhibit C and ACH Daily print the same `ach_account_holder_address_p1`
   * widget as their "Account Holder Business Address", so the package-wide value
   * under that name is the business. The Monthly Fee's holder block is Owner 1,
   * so it resolves without that shared entry, through the holder / guarantor
   * alias chain.
   */
  if (options?.documentKind === 'monthly_fee' && canon === 'ach_account_holder_address') {
    const sharedKeys = Object.keys(prefill).filter(
      (key) => key.trim().toLowerCase() === 'ach_account_holder_address_p1',
    );
    if (sharedKeys.length) {
      const withoutShared = { ...prefill };
      for (const key of sharedKeys) delete withoutShared[key];
      return resolveSignNowPrefillValue(fieldName, withoutShared, options);
    }
  }
  const map = lookupMap(prefill);

  if (options?.documentKind === 'ach_weekly') {
    const positional =
      ACH_WEEKLY_POSITIONAL_FIELD_CRM_IDS[lower] ||
      ACH_WEEKLY_POSITIONAL_FIELD_CRM_IDS[canon];
    if (positional) {
      for (const crmId of positional) {
        const hit = mapGet(map, crmId);
        if (hit) return formatSignNowPrefillValue(hit, fieldName);
      }
      // Never fall through to the generic aliases: `text field 1` there is the
      // California disclosure amount, which is exactly the wrong value here.
      return '';
    }
  }

  if (options?.documentKind === 'exhibit_c') {
    const slot = exhibitCTextFieldNumber(raw);
    // The generic DBA chain ends in `client_legal_name`, so a blank DBA printed
    // the business name on the "Account Holder DBA" line. Exhibit C reads only
    // real DBA values and leaves the line blank otherwise, as it is in the CRM.
    if ((slot ? EXHIBIT_C_TEXT_FIELD_CRM_IDS[slot] : canon) === 'ach_account_holder_dba') {
      const dbaKeys = options.exhibitCEntityOnly
        ? EXHIBIT_C_ENTITY_OWN_KEYS.ach_account_holder_dba
        : EXHIBIT_C_DBA_KEYS;
      for (const key of dbaKeys) {
        const hit = mapGet(map, key);
        if (hit) return options.exhibitCEntityOnly ? formatSignNowPrefillValue(hit, fieldName) : hit;
      }
      return '';
    }
    if (options.exhibitCEntityOnly) {
      const ownKeys = EXHIBIT_C_ENTITY_OWN_KEYS[slot ? EXHIBIT_C_TEXT_FIELD_CRM_IDS[slot] : canon];
      if (ownKeys) {
        for (const key of ownKeys) {
          const hit = mapGet(map, key);
          if (hit) return formatSignNowPrefillValue(hit, fieldName);
        }
        return '';
      }
    }
    if (slot) {
      const crmId = EXHIBIT_C_TEXT_FIELD_CRM_IDS[slot];
      // Merchant-filled slot, or a number this layout does not use. Never fall
      // through to the generic aliases: `text field 2` there is the CA
      // disclosure's "Funds Provided Directly" amount, which is how the Account
      // Holder DBA line came out as `7,175.00`.
      if (!crmId) return '';
      return resolveSignNowPrefillValue(crmId, prefill);
    }
  }

  if (options?.documentKind === 'monthly_fee') {
    const numbered = raw.match(/^text field\s*(\d+)$/i);
    if (numbered) {
      const crmId = MONTHLY_FEE_TEXT_FIELD_CRM_IDS[Number(numbered[1]) - 1];
      if (crmId === '') return '';
      if (crmId) {
        // The holder address, holder name and print name keep their Monthly Fee
        // meaning (Owner 1); resolved bare, the address would read as an
        // Account Holder Business Address and both names as the business.
        const fromMonthly = resolveSignNowPrefillValue(
          crmId,
          prefill,
          MONTHLY_FEE_OWNER1_TEXT_FIELD_CRM_IDS.has(crmId) ? options : undefined,
        );
        if (fromMonthly) return fromMonthly;
      }
    }
  }

  if (options?.documentKind === 'tiberian_agreement') {
    const numbered = raw.match(/^text field\s*(\d+)$/i);
    if (numbered) {
      const crmId = TIBERIAN_AGREEMENT_TEXT_FIELDS[Number(numbered[1])];
      // A number this layout does not name is a printed `$` / `%` glyph or a
      // slot the shared aliases already cover — never fall through to the CA
      // disclosure's `text field 1`-`9` money slots.
      if (crmId) return resolveSignNowPrefillValue(crmId, prefill);
    }
  }

  /** Tiberian's extra Declaration page (see `TIBERIAN_PG22_FIELD_CRM_IDS`). */
  const tiberianPg22 = TIBERIAN_PG22_FIELD_CRM_IDS[canon];
  if (tiberianPg22) {
    return resolveSignNowPrefillValue(tiberianPg22, prefill, options);
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

  /**
   * Waiver-of-Personal-Service page: the MERCHANT block resolves from the
   * business's own email / physical address, never from Owner 1's (see
   * `WAIVER_OF_SERVICE_MERCHANT_FIELD_CRM_IDS`). Returning '' when the business
   * has neither is deliberate — falling through to the generic aliases is what
   * printed Owner 1's home address on the merchant line in the first place.
   */
  const waiverMerchantIds = WAIVER_OF_SERVICE_MERCHANT_FIELD_CRM_IDS[lower];
  if (waiverMerchantIds) {
    for (const crmId of waiverMerchantIds) {
      const resolved = resolveSignNowPrefillValue(crmId, prefill, options);
      if (resolved) return resolved;
    }
    return '';
  }

  /**
   * Monthly Fee Authorized Holder Name — Owner 1, never the business name
   * printed beside it (see `MONTHLY_FEE_HOLDER_NAME_CRM_IDS`).
   */
  if (isMonthlyFeeAccountHolderNameField(raw, options) || isMonthlyFeePrintNameField(raw, options)) {
    for (const crmId of MONTHLY_FEE_HOLDER_NAME_CRM_IDS) {
      const holder = mapGet(map, crmId);
      if (holder) return formatSignNowPrefillValue(holder, fieldName);
    }
    return '';
  }

  /**
   * "Account Holder Business Address" — the business physical address, composed
   * with its city/state/zip, and never Owner 1's (see
   * `isAccountHolderBusinessAddressField`). A deal with no business address on
   * file leaves the line blank rather than printing another party's address.
   */
  if (isAccountHolderBusinessAddressField(raw, options)) {
    return resolveSignNowPrefillValue('business_address', prefill);
  }

  if (isRemittanceStartDateField(raw)) {
    return resolveRemittanceStartDate(map);
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

  if (isInstallmentFrequencyWidget(raw, canon)) {
    const freq = installmentFrequencyFromMap(map);
    if (freq) return freq;
  }

  /**
   * Exhibit A's seller table resolves by printed row, never through the generic
   * alias chain: its EIN boxes would otherwise all inherit the merchant's EIN.
   */
  const exhibitAEntityCell = exhibitAEntityCellForCanon(canon);
  if (exhibitAEntityCell) {
    return formatSignNowPrefillValue(
      resolveExhibitAEntityCell(exhibitAEntityCell, map),
      fieldName,
    );
  }

  /**
   * TOTAL FEES is the underwriting fee plus the $25 wire fee only when the deal's
   * box is ticked — never the ACH program fee — so it is computed here rather
   * than let the alias chain return the bare fee field.
   */
  if (isTotalFeesField(canon)) {
    const total = resolveForcedContractMoneyField('total_fees', map);
    if (total) return formatSignNowPrefillValue(total, fieldName);
  }

  const einCanon = einField ? canon.replace(/_s2$/i, '').replace(/_g2$/i, '') : canon;
  const aliases = ALIASES[canon] || ALIASES[einCanon] || [];
  const party2Aliases =
    party2Field && distinctParty2 && !allowOwner1Party2Fallback && !einField
      ? aliases.filter((key) => !isOwner1ContactAlias(key))
      : aliases;
  const candidateKeys = [
    raw,
    lower,
    canon,
    ...(einField && einCanon !== canon ? [einCanon] : []),
    ...(einField
      ? ['security_tax_ein', 'federal_tax_id_ein', 'ein', 'tax_id', 'authorization_client_tax_id']
      : []),
    /**
     * A numbered widget on a layout we recognise means whatever that layout says
     * it means, never what another document's `Text Field N` happens to mean.
     * Monthly Fee and the Obsidian agreement fall through to here when their own
     * table has no entry for the number; Exhibit C never does, because its whole
     * ACH block is numbered and is resolved positionally above.
     */
    ...((options?.documentKind === 'monthly_fee' ||
      options?.documentKind === 'obsidian_agreement') &&
    /^text field\s*\d+$/i.test(raw)
      ? []
      : party2Aliases),
  ];
  /**
   * The ACH account holder's address is Owner 1's address, never the business
   * physical address (see the `ach_account_holder_address` alias chain). The CRM
   * screen mirrored the business street onto the holder key, so the Monthly Fee
   * and Exhibit C addendums printed the same street on both lines — and then
   * composed it with Owner 1's city/state/zip, because those are the only
   * siblings the holder key has. When the holder value is that duplicate and
   * Owner 1 has an address of his own, the holder keys drop out and the widget
   * resolves through Owner 1 like the chain always intended.
   */
  const tryKeys = achHolderAddressShouldFollowOwner1(canon, map)
    ? candidateKeys.filter((key) => !isAchHolderAddressSourceKey(key))
    : candidateKeys;
  const nameField = isNameLikeField(canon, raw);
  const dateField = isSendDayDateField(canon, raw);
  /**
   * Default `Text Field N` widget names are reused by unrelated documents, so a value
   * another document put in the shared prefill map can land in the wrong slot. Outside
   * the two layouts that genuinely map a numbered widget to a date (ACH Weekly's "Date:"
   * box, Monthly Fee's remittance start date), a numbered widget is never a date.
   */
  const numberedWidgetField =
    /^text field\s*\d+$/i.test(raw) &&
    options?.documentKind !== 'ach_weekly' &&
    options?.documentKind !== 'monthly_fee';
  const valueAllowed = (value: string): boolean => {
    if (!value || isWeakSignNowPrefillHit(canon, value)) return false;
    if (dateField && isMoneyPrefillValue(value)) return false;
    if (numberedWidgetField && isUsDatePrefillValue(value)) return false;
    if (nameField && (isMoneyPrefillValue(value) || isUsDatePrefillValue(value))) return false;
    return true;
  };
  let hit = '';
  let hitKey = '';
  for (const key of tryKeys) {
    const value = mapGet(map, key);
    if (valueAllowed(value)) {
      hit = value;
      hitKey = key;
      break;
    }
  }
  if (!hit && dateField) {
    hit = resolveRemittanceStartDate(map);
  }
  if (!hit && nameField) {
    hit =
      mapGet(map, 'client_name') ||
      mapGet(map, 'owner1_guarantor_name') ||
      mapGet(map, 'merchant_contact_name') ||
      mapGet(map, 'print_name');
    if (hit && !valueAllowed(hit)) hit = '';
  }
  if (!hit) {
    const forcedMoney = resolveForcedContractMoneyField(canon, map);
    if (forcedMoney && valueAllowed(forcedMoney)) hit = forcedMoney;
    else if (forcedMoney && !dateField && !nameField) hit = forcedMoney;
  }
  if (!hit) {
    if (/^disclosure_page3_3[abc]$/.test(canon)) return '';
    if (canon === 'disclosure_page3_third_parties') return '0.00';
    return '';
  }
  // Page-1 INITIAL INSTALLMENT amount stays dollars-only. Cadence is a separate
  // `page1_installmentBlock_frequency` widget; appending here stacked DailyDaily.
  if (isPage1InitialInstallmentAmountField(raw)) {
    return stripInstallmentFrequencyFromAmount(hit);
  }
  /**
   * The merchant / business address line on the contract page 2 and on every
   * addendum that carries one (ACH Daily, ACH Weekly, Exhibit C, Monthly Fee)
   * is a single widget with no companion city/state/zip widgets beside it,
   * unlike the address blocks elsewhere in the package — so leaving it
   * street-only prints an incomplete address with no way to fix it from a
   * nearby field. Fold in the matching city/state/zip prefill values whenever
   * the resolved value is still a bare street. Guarantor / Signer 1 /
   * Recipient 1 address widgets are deliberately left untouched.
   */
  if (isFullAddressField(canon) || isStandaloneAddressWidget(canon, options)) {
    const composed = composeFullAddressFromSiblings(hit, canon, hitKey, aliases, map);
    if (composed) return composed;
  }
  return hit;
}

/**
 * The CRM keys and canons that carry the ACH account holder's OWN address, in
 * either spelling the prefill map uses for them.
 */
function isAchHolderAddressSourceKey(key: unknown): boolean {
  return /^ach_(?:authorization_)?account_holder_(?:address|city|state|zip)(?:_|$)/.test(
    String(key || '').trim().toLowerCase(),
  );
}

/** Address parts the holder block and Owner 1's block both split across. */
const ACH_HOLDER_ADDRESS_PART_SUFFIXES = ['', '_city', '_state', '_zip'] as const;

function achHolderAddressPartSuffix(canon: string): string | null {
  for (const suffix of ACH_HOLDER_ADDRESS_PART_SUFFIXES) {
    if (
      canon === `ach_account_holder_address${suffix}` ||
      canon === `ach_authorization_account_holder_address${suffix}`
    ) {
      return suffix;
    }
  }
  // The CRM spells the holder's city/state/zip without the `address` segment.
  for (const suffix of ACH_HOLDER_ADDRESS_PART_SUFFIXES.slice(1)) {
    if (canon === `ach_authorization_account_holder${suffix}`) return suffix;
  }
  return null;
}

function normalizedAddressText(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when the ACH account-holder address on this deal is nothing but a copy of
 * the business physical address and Owner 1 has a real address of his own.
 *
 * Business, Owner 1 and ACH account-holder addresses are three separate CRM
 * entries that must never stand in for one another; a holder value identical to
 * the business street is the CRM screen having mirrored one onto the other, not
 * a deal whose holder really banks from the shop.
 */
function achHolderAddressShouldFollowOwner1(canon: string, map: Map<string, string>): boolean {
  if (achHolderAddressPartSuffix(canon) == null) return false;
  const holderStreet = normalizedAddressText(
    mapGet(map, 'ach_authorization_account_holder_address') ||
      mapGet(map, 'ach_account_holder_address'),
  );
  if (!holderStreet) return false;
  const businessStreet = normalizedAddressText(
    mapGet(map, 'business_address') || mapGet(map, 'security_business_address'),
  );
  if (!businessStreet || holderStreet !== businessStreet) return false;
  const ownerStreet = normalizedAddressText(
    mapGet(map, 'business_address_contract') ||
      mapGet(map, 'guarantor_address') ||
      mapGet(map, 'owner1_address') ||
      mapGet(map, 'owner_address'),
  );
  return Boolean(ownerStreet) && ownerStreet !== businessStreet;
}

const FULL_ADDRESS_CANON_KEYS = new Set([
  'business_address',
  'business_address_contract',
  'ach_account_holder_address',
  'ach_authorization_account_holder_address',
]);

/** A street that already ends in a zip (`… GA 31088`, `… 31088-1234`) is composed. */
function streetAlreadyCarriesZip(street: string, zip: string): boolean {
  const value = String(street || '').trim();
  if (!value) return false;
  // A comma alone (e.g. a suite typed into address line 2) does not mean the
  // street already carries city/state/zip — only a zip actually appearing in it
  // does. Checking for any comma wrongly skipped composition whenever the street
  // itself happened to contain one.
  if (zip && value.includes(zip)) return true;
  return /\d{5}(?:-\d{4})?$/.test(value);
}

/**
 * Composes `street, city, state zip` for an address widget, reading the
 * `_city` / `_state` / `_zip` siblings from the first prefill key that actually
 * has them: the key that supplied the street, then the canon, then the canon's
 * own alias chain.
 *
 * The alias fallback is what makes an addendum print a full address. The CRM
 * sends the Monthly Fee / Exhibit C holder address under
 * `ach_account_holder_address` and the ACH pages under the widget's own name
 * (`business_address_p1_ach`), while the city/state/zip only ever travel under
 * `business_address_*` — so looking at the street's own prefix alone left those
 * pages street-only. Walking the alias chain is safe because an address canon's
 * aliases stay inside one address family by construction: the business physical
 * address and Owner 1's home address (`business_address_contract`) never alias
 * each other, so a fallback cannot pair one address's street with the other's
 * city.
 */
function composeFullAddressFromSiblings(
  street: string,
  canon: string,
  hitKey: string,
  aliases: string[],
  map: Map<string, string>,
): string {
  const prefixes: string[] = [];
  const push = (key: unknown) => {
    const value = String(key || '')
      .trim()
      .toLowerCase();
    if (value && !prefixes.includes(value)) prefixes.push(value);
  };
  // `hitKey` can be the raw widget name itself (e.g. `business_address_p1_ach`) when
  // the prefill map holds that exact key; only a genuine CRM alias (the canon itself
  // or one of its aliases) has real `_city`/`_state`/`_zip` siblings.
  if (hitKey === canon || aliases.includes(hitKey)) push(hitKey);
  push(canon);
  for (const alias of aliases) {
    // `business_address_contract` is an address key whose name does not end in
    // "address", and it is where Owner 1's city/state/zip live — the holder
    // address resolves through it, so it has to be walked like any other.
    if (/address(_contract)?$/.test(alias)) push(alias);
  }
  for (const prefix of prefixes) {
    const city = mapGet(map, `${prefix}_city`);
    const state = mapGet(map, `${prefix}_state`);
    const zip = mapGet(map, `${prefix}_zip`);
    if (!city && !state && !zip) continue;
    if (streetAlreadyCarriesZip(street, zip)) return '';
    return composeFullAddress(street, city, state, zip);
  }
  return '';
}

function isFullAddressField(canon: string): boolean {
  return FULL_ADDRESS_CANON_KEYS.has(canon);
}

/**
 * Address widgets that carry companion city/state/zip boxes on some pages and
 * stand alone on others — the guarantor / owner blocks. Owner 1's address is
 * stored split across `business_address_contract{,_city,_state,_zip}` while
 * Owner 2's arrives as one line, so a standalone Owner 1 widget printed a bare
 * street ("3205 COVE CREEK ROAD") next to Owner 2's full address.
 */
const STANDALONE_ADDRESS_CANON_KEYS = new Set([
  'guarantor_address',
  'guarantor_address_s2',
  'guarantor2_address',
  'owner1_address',
  'owner2_address',
  'owner_address',
  'owner_home_address',
  'merchant_contact_address',
  'recipient_address',
]);

/**
 * True when the widget is one of those blocks *and* the document it sits on has
 * no `_city` / `_state` / `_zip` widget of its own for it. Without the
 * document's field list we cannot tell the two layouts apart, so the widget is
 * left street-only — composing blindly would duplicate the city on the pages
 * that do have the companion boxes.
 */
function isStandaloneAddressWidget(canon: string, options?: SignNowPrefillOptions): boolean {
  if (!STANDALONE_ADDRESS_CANON_KEYS.has(canon)) return false;
  const canons = options?.documentFieldCanons;
  if (!canons) return false;
  return !['_city', '_state', '_zip'].some((suffix) => canons.has(`${canon}${suffix}`));
}

/** Match CRM values onto the unique names that actually exist on a SignNow document. */
export function buildSignNowDocumentPrefillTexts(
  fieldNames: string[],
  prefill: Record<string, string>,
  options?: SignNowPrefillOptions,
  widgets?: Map<string, SigningWidgetInfo>,
): Array<{ field_name: string; prefilled_text: string }> {
  options = options?.documentKind
    ? options
    : signNowPrefillOptionsForDocument(undefined, fieldNames) || options;
  // A caller that passed its own options (document kind from the title) still
  // needs the document's widget list for the standalone-address decision.
  if (options && !options.documentFieldCanons) {
    const documentFieldCanons = signNowDocumentFieldCanons(fieldNames);
    if (documentFieldCanons) options = { ...options, documentFieldCanons };
  }
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
      widgets?.get(fieldName),
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
  '_p1_achd',
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

function formatInstallmentBlockFrequencyLabel(value: string): string {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!text) return '';
  if (text === 'day' || text === 'daily') return 'Daily';
  if (text === 'week' || text === 'weekly') return 'Weekly';
  if (text === 'bi week' || text === 'biweekly') return 'Bi-Weekly';
  if (text === 'month' || text === 'monthly') return 'Monthly';
  return String(value || '').trim();
}

function isInstallmentBlockFrequencyField(fieldName: string): boolean {
  const n = String(fieldName || '').toLowerCase();
  return /installment[_]?block[_]?frequency/.test(n) || /page1.*frequen/.test(n);
}

function isInstallmentFrequencyWidget(fieldName: string, canon: string): boolean {
  if (isInstallmentBlockFrequencyField(fieldName)) return true;
  return canon === 'frequency' || canon === 'paymentterms' || canon === 'payment_terms';
}

function isPage1InitialInstallmentAmountField(fieldName: string): boolean {
  return /^remittance$/i.test(String(fieldName || '').trim());
}

function installmentFrequencyFromMap(map: Map<string, string>): string {
  return formatInstallmentBlockFrequencyLabel(
    mapGet(map, 'frequency') ||
      mapGet(map, 'paymentterms') ||
      mapGet(map, 'payment_terms') ||
      mapGet(map, 'paymentfrequency') ||
      // Same keys the disclosure frequency reads, so page 1 cannot disagree with it.
      mapGet(map, 'payment_frequency') ||
      mapGet(map, 'disclosure_payment_frequency') ||
      mapGet(map, 'page1_installmentblock_frequency'),
  );
}

const INSTALLMENT_FREQUENCY_SUFFIX =
  /(?:\s*(Daily|Weekly|Monthly|Bi-Weekly|Day|Week|Month|Bi-Week))+$/i;

function stripInstallmentFrequencyFromAmount(amount: string): string {
  return String(amount || '').replace(INSTALLMENT_FREQUENCY_SUFFIX, '').trim();
}

export function formatSignNowPrefillValue(
  value: string,
  fieldName?: string,
  widget?: SigningWidgetInfo,
): string {
  const v = String(value || '').trim();
  if (!v) return '';
  if (isPage1InitialInstallmentAmountField(fieldName || '')) {
    return stripInstallmentFrequencyFromAmount(v);
  }
  if (isInstallmentBlockFrequencyField(fieldName || '')) {
    return formatInstallmentBlockFrequencyLabel(v);
  }
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
  // Phone / SSN print in the CRM's canonical dashed format, but only on widgets
  // that accept dashes. A Number validator rejects "561-577-8267" and takes the
  // whole prefill-texts batch down with it, leaving the agreement blank — so an
  // unknown or validated widget falls back to digits.
  if (isPhoneFieldName(name)) {
    return widgetAcceptsDashes(widget) ? formatUsPhone(v) : digitsOnlyPhone(v);
  }
  if (isSsnFieldName(name)) {
    return widgetAcceptsDashes(widget) ? formatSsn(v) : digitsOnlySsn(v);
  }
  // PDF already prints `$` before origination / ACH program fee blanks.
  if (
    /(?:^|_)(?:origination_fee|underwriter_fee|underwriting_fee|appendix_underwriting|ach_program_fee)(?:_|$)/i.test(
      name,
    )
  ) {
    return v.replace(/^\$+\s*/g, '').trim();
  }
  return keepsCrmCase(name, widget) ? v : v.toUpperCase();
}

/**
 * CRM text prints in CAPITAL LETTERS on every SignNow document, except where
 * case carries meaning: logins and security answers, e-mail / web addresses,
 * and choice widgets whose value must match one of the template's options.
 */
const CASE_SENSITIVE_PREFILL_FIELD_RE =
  /e_?mail|password|passwd|user_?name|security_(?:q|question|answer)|portal|website|web_site|(?:^|_)url(?:_|$)/i;

const CHOICE_WIDGET_TYPES = new Set([
  'checkbox',
  'checkmark',
  'radiobutton',
  'radio',
  'dropdown',
  'enumeration',
  'list',
]);

function keepsCrmCase(fieldName: string, widget?: SigningWidgetInfo): boolean {
  if (CASE_SENSITIVE_PREFILL_FIELD_RE.test(fieldName)) return true;
  const type = String(widget?.type || '').trim().toLowerCase();
  return CHOICE_WIDGET_TYPES.has(type);
}

