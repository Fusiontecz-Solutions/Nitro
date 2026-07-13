import {
  buildPrefillValueMap,
  normalizeFieldKey,
  type PrefillFieldInput,
} from './docusign-prefill';

/**
 * CRM / BoldSign field ids → exact `variable` on coordinate layouts (`*.layout.json`).
 * Keys are normalized lowercase unless the layout uses camelCase (e.g. typeOfEntity1).
 */
export const CRM_ID_TO_LAYOUT_VARIABLE: Record<string, string> = {
  agreement_date: 'agreement_date',
  signature_date: 'signature_date',
  signaturedate: 'Signature_date',
  date_by_which_amount_mustbe_received: 'date_by_which_amount_mustbe_received',
  entity_type: 'typeOfEntity1',
  typeofentity1: 'typeOfEntity1',
  federal_tax_id_ein: 'security_tax_ein',
  authorization_client_tax_id: 'security_tax_ein',
  paymentterms: 'frequency',
  netfundprovided: 'net_to_merchant',
  specified_percentage: 'purchase_percent',
  purchased_percent: 'purchase_percent',
  percent_of_business_income: 'percent_of_business_income',
  underwriter_fee: 'appendix_underwriting_fees',
  underwriterfee: 'appendix_underwriting_fees',
  underwriter_fees: 'appendix_underwriting_fees',
  client_name_by: 'client_name',
  merchant2_name: 'owner2_guarantor_name',
  receivable_purchase: 'purchase_amount',
  daily_payment_1: 'daily_payment',
  daily_payment_2: 'daily_payment',
  receivable_purchase_1: 'purchase_amount',
  receivable_purchase_2: 'purchase_amount',
  appendix_merchant2_name: 'owner2_guarantor_name',
  guaranty_guarantor2_name: 'owner2_guarantor_name',
};

/** Human labels aligned with CRM Deal Review / Contract prefill form. */
export const PREFILL_DISPLAY_LABEL_BY_VARIABLE: Record<string, string> = {
  client_legal_name: 'Legal name',
  state_of_inc: 'State of incorporation',
  doing_business_as: 'DBA',
  security_tax_ein: 'Tax ID / EIN',
  typeofentity1: 'Entity type',
  typeOfEntity1: 'Entity type',
  business_address: 'Street',
  business_address_city: 'City',
  business_address_state: 'State',
  business_address_zip: 'ZIP',
  business_address_contract: 'Contract street',
  business_address_contract_city: 'Contract city',
  business_address_contract_state: 'Contract state',
  business_address_contract_zip: 'Contract ZIP',
  guarantor_address: 'Guarantor street',
  guarantor_address_city: 'Guarantor city',
  guarantor_address_state: 'Guarantor state',
  guarantor_address_zip: 'Guarantor ZIP',
  client_email: 'Email',
  client_phone: 'Phone',
  guarantor_email: 'Guarantor email',
  guarantor_phone: 'Guarantor phone',
  purchase_price: 'Payback amount',
  purchase_amount: 'Offer amount',
  purchase_percent: 'Specified percentage',
  percent_of_business_income: 'Payment Terms',
  funder_name: 'Funder / provider name',
  remittance: 'Daily payment',
  frequency: 'Frequency',
  net_to_merchant: 'Net to merchant',
  client_name: 'Name',
  business_name_2: 'Business name 2',
  daily_payment: 'Daily payment',
  daily_payment_1: 'Payment amount — 1st installment (Day 1)',
  daily_payment_2: 'Payment amount — 2nd installment (Day 16)',
  installment_day_1: 'Installment day — 1st payment',
  installment_day_2: 'Installment day — 2nd payment',
  receivable_purchase: 'Receivable purchase',
  receivable_purchase_1: 'Receivables purchased — 1st installment (Day 1)',
  receivable_purchase_2: 'Receivables purchased — 2nd installment (Day 16)',
  addendum_date: 'Addendum date',
  agreement_date: 'Agreement date',
  date_of_new_secured_agreement: 'Date of new secured agreement',
  date_of_previous_secured_agreement: 'Date of previous secured agreement',
  remaining_rtr_balance: 'Remaining RTR balance',
  balance_transfer_client_legal_name: 'Client legal name (merchant)',
  business_legal_name: 'Business legal name',
  merchant_legal_name: 'Merchant legal name',
  owner1_guarantor_name: 'Owner 1 — Name',
  owner2_guarantor_name: 'Merchant 2 — Name',
  merchant2_name: 'Merchant 2 — Name',
  security_business_name: 'Business name',
  security_doing_business_as: 'DBA',
  security_business_address: 'Street',
  security_business_address_city: 'City',
  security_business_address_state: 'State',
  security_business_address_zip: 'ZIP',
  security_guarantor: 'Guarantor',
  guaranty_client_name: 'Name',
  guaranty_ss: 'SSN',
  guaranty_owner1_name: 'Owner 1 — Name',
  guaranty_owner2_name: 'Owner 2 — Name',
  appendix_underwriting_fees: 'Underwriting fees',
  appendix_client_name: 'Client name',
  appendix_merchant2_name: 'Merchant 2 — Name',
  authorization_application: 'Merchant name',
  authorization_client_bank_name: 'Bank name',
  authorization_client_bank_routing: 'Routing number',
  authorization_client_bank_account: 'Account number',
  authorization_client_name: 'Business name',
  authorization_client_name_print: 'Printed name',
  authorization_client_signer_name: 'Signer name',
  authorized_business_phone: 'Business phone (merchant fills)',
  signature_date: 'Agreement date',
  exhibit_owner_name: 'Exhibit owner',
};

export function getPrefillDisplayLabel(variable: string): string {
  const raw = String(variable || '').trim();
  if (!raw) return '';
  const norm = normalizeFieldKey(raw);
  return (
    PREFILL_DISPLAY_LABEL_BY_VARIABLE[raw] ||
    PREFILL_DISPLAY_LABEL_BY_VARIABLE[norm] ||
    PREFILL_DISPLAY_LABEL_BY_VARIABLE[CRM_ID_TO_LAYOUT_VARIABLE[norm] || ''] ||
    humanizeVariableId(raw)
  );
}

function humanizeVariableId(id: string): string {
  return String(id)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Normalize CRM prefill payload to layout `variable` keys (+ aliases). */
export function buildLayoutPrefillValueRecord(
  fields: PrefillFieldInput[],
): Record<string, string> {
  const map = buildPrefillValueMap(fields);
  const out: Record<string, string> = {};

  for (const [key, value] of map.entries()) {
    const v = String(value || '').trim();
    if (!v) continue;
    out[key] = v;

    const layoutVar = CRM_ID_TO_LAYOUT_VARIABLE[key];
    if (layoutVar) out[layoutVar] = v;

    const norm = normalizeFieldKey(key);
    if (norm !== key) out[norm] = v;
    const layoutFromNorm = CRM_ID_TO_LAYOUT_VARIABLE[norm];
    if (layoutFromNorm) out[layoutFromNorm] = v;

    if (!key.includes('_')) {
      for (const existingKey of Object.keys(out)) {
        if (!existingKey.includes('_')) continue;
        if (existingKey.replace(/_/g, '') === key && !out[existingKey]) {
          out[existingKey] = v;
        }
      }
    }
  }

  return out;
}
