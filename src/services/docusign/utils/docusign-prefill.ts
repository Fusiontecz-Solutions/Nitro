export type PrefillFieldInput = { id: string; value: string };

export type DocusignTextTabRef = {
  tabId?: string;
  tabLabel?: string;
  name?: string;
  value?: string;
};

/** Human-readable BoldSign/CRM labels → snake_case field id (for DocuSign tabLabel matching). */
const CRM_LABEL_TO_FIELD_ID: Record<string, string> = {
  legalname: 'client_legal_name',
  legal_name: 'client_legal_name',
  /** Balance Transfer: Business Legal Name → entity legal name (not client_legal_name). */
  businesslegalname: 'business_name',
  business_legal_name: 'business_name',
  businessname: 'business_name',
  business_name: 'business_name',
  /** Balance Transfer: Merchant Legal Name → CRM client_name. */
  merchantlegalname: 'client_name',
  merchant_legal_name: 'client_name',
  merchantname: 'client_name',
  merchant_name: 'client_name',
  clientdba: 'client_dba',
  client_dba: 'client_dba',
  physicaladdress: 'physical_address',
  physical_address: 'physical_address',
  clientnameby: 'client_name_by',
  client_name_by: 'client_name_by',
  businesssellerlegalname: 'client_legal_name',
  business_seller_legal_name: 'client_legal_name',
  sellerlegalname: 'client_legal_name',
  seller_legal_name: 'client_legal_name',
  authorizationsellername: 'authorization_client_name',
  authorization_seller_name: 'authorization_client_name',
  sellersname: 'authorization_client_name',
  sellers_name: 'authorization_client_name',
  sellername: 'authorization_client_name',
  seller_name: 'authorization_client_name',
  stateofincorporation: 'state_of_inc',
  state_of_incorporation: 'state_of_inc',
  doingbusinessas: 'doing_business_as',
  doing_business_as: 'doing_business_as',
  dba: 'doing_business_as',
  federaltaxidein: 'federal_tax_id_ein',
  federal_tax_id: 'federal_tax_id_ein',
  ein: 'federal_tax_id_ein',
  clientemail: 'client_email',
  clientphone: 'client_phone',
  clientname: 'client_name',
  agreementdate: 'agreement_date',
  agreement_date: 'agreement_date',
  agreementdated: 'agreement_date',
  agreement_dated: 'agreement_date',
  purchaseprice: 'purchase_price',
  purchaseamount: 'purchase_amount',
  purchase_amount: 'purchase_amount',
  businessaddress: 'business_address',
  business_address: 'business_address',
  merchantbusinessaddress1: 'business_address',
  merchantbusinessaddress: 'business_address',
  merchantcontactaddress1: 'business_address_contract',
  merchantcontactaddress: 'business_address_contract',
  businessaddresscity: 'business_address_city',
  businessaddressstate: 'business_address_state',
  businessaddresszip: 'business_address_zip',
  typeofentity: 'entity_type',
  type_of_entity: 'entity_type',
  entitytype: 'entity_type',
  entity_type: 'entity_type',
  typeofentity1: 'entity_type',
  type_of_entity_1: 'entity_type',
  remittance: 'remittance',
  estimatedremittance: 'remittance',
  estimated_remit: 'remittance',
  estimated_remitance: 'remittance',
  dailypayment: 'remittance',
  daily_payment: 'remittance',
  repayperperiod: 'remittance',
  repay_per_period: 'remittance',
  paymentperperiod: 'remittance',
  payment_per_period: 'remittance',
  purchasepercent: 'purchase_percent',
  purchase_percent: 'purchase_percent',
  specifiedpercentage: 'purchase_percent',
  specified_percentage: 'purchase_percent',
  purchasedpercent: 'purchase_percent',
  purchased_percent: 'purchase_percent',
  frequency: 'frequency',
  paymentterms: 'frequency',
  payment_terms: 'frequency',
  netfundprovided: 'net_to_merchant',
  net_fund_provided: 'net_to_merchant',
  nettomerchant: 'net_to_merchant',
  net_to_merchant: 'net_to_merchant',
  NetFundProvided: 'net_to_merchant',
  appendixunderwritingfees: 'appendix_underwriting_fees',
  appendix_underwriting_fees: 'appendix_underwriting_fees',
  underwriterfee: 'appendix_underwriting_fees',
  underwriter_fee: 'appendix_underwriting_fees',
  underwriterfees: 'appendix_underwriting_fees',
  underwriter_fees: 'appendix_underwriting_fees',
  dateofnewsecuredagreement: 'date_of_new_secured_agreement',
  date_of_new_secured_agreement: 'date_of_new_secured_agreement',
  dateofprevioussecuredagreement: 'date_of_previous_secured_agreement',
  date_of_previous_secured_agreement: 'date_of_previous_secured_agreement',
  remainingrtrbalance: 'remaining_rtr_balance',
  remaining_rtr_balance: 'remaining_rtr_balance',
  balance_transfer_client_legal_name: 'balance_transfer_client_legal_name',
  clientlegalnamemerchant: 'balance_transfer_client_legal_name',
};

/** Normalize CRM / DocuSign field keys for fuzzy matching (snake_case, spaces, case). */
export function normalizeFieldKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function buildPrefillValueMap(
  fields: PrefillFieldInput[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fields) {
    const id = String(f?.id ?? '').trim();
    const value = String(f?.value ?? '').trim();
    if (!id || !value) continue;
    const key = normalizeFieldKey(id);
    if (!map.has(key)) map.set(key, value);
    const alt = key.replace(/_/g, '');
    if (!map.has(alt)) map.set(alt, value);
  }
  for (const [aliasKey, fieldId] of Object.entries(CRM_LABEL_TO_FIELD_ID)) {
    const val = map.get(normalizeFieldKey(fieldId));
    if (val) map.set(aliasKey, val);
  }
  return map;
}

export function lookupPrefillValue(map: Map<string, string>, tabKey: string): string | undefined {
  const k = normalizeFieldKey(tabKey);
  if (map.has(k)) return map.get(k);
  const noUnderscore = k.replace(/_/g, '');
  if (map.has(noUnderscore)) return map.get(noUnderscore);
  const viaAlias = CRM_LABEL_TO_FIELD_ID[k];
  if (viaAlias) {
    const v = map.get(normalizeFieldKey(viaAlias));
    if (v) return v;
  }
  return undefined;
}

/** DocuSign tab group → property name used when setting prefilled values on create/update. */
export function tabGroupPrefillProperty(group: string): 'value' | 'numberValue' | 'selected' {
  if (group === 'numberTabs') return 'numberValue';
  if (group === 'checkboxTabs') return 'selected';
  return 'value';
}

export function resolvePrefillForTab(
  valueMap: Map<string, string>,
  tab: DocusignTextTabRef,
): string | undefined {
  const tabLabel = String(tab.tabLabel || '').trim();
  const tabName = String(tab.name || '').trim();
  if (
    tabName &&
    tabLabel &&
    normalizeFieldKey(tabName) !== normalizeFieldKey(tabLabel)
  ) {
    const byName = lookupPrefillValue(valueMap, tabName);
    if (byName) return byName;
  }
  const candidates = [
    tabLabel,
    tabName,
    tab.tabId,
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    const v = lookupPrefillValue(valueMap, c);
    if (v) return v;
  }
  return undefined;
}

/**
 * Match CRM prefill ids to DocuSign text tabs by tabLabel, name, or tabId.
 * Returns tabs ready for create (tabLabel) or update (tabId + value).
 */
export function matchPrefillFieldsToTextTabs(
  prefillFields: PrefillFieldInput[],
  templateTabs: DocusignTextTabRef[],
): Array<{ tabId?: string; tabLabel: string; value: string }> {
  const valueMap = buildPrefillValueMap(prefillFields);
  if (!valueMap.size || !templateTabs.length) return [];

  const matched: Array<{ tabId?: string; tabLabel: string; value: string }> = [];
  const usedTabIds = new Set<string>();

  for (const tab of templateTabs) {
    const tabId = tab.tabId ? String(tab.tabId) : '';
    const tabLabel = String(tab.tabLabel || tab.name || '').trim();
    const value = resolvePrefillForTab(valueMap, tab);
    if (!value) continue;
    if (tabId && usedTabIds.has(tabId)) continue;

    matched.push({
      ...(tabId ? { tabId } : {}),
      tabLabel: tabLabel || tabId || 'field',
      value,
    });
    if (tabId) usedTabIds.add(tabId);
  }

  return matched;
}

/** Fallback when template tabs are unknown: send by tabLabel = CRM field id. */
export function buildTextTabsFromPrefillIds(
  prefillFields: PrefillFieldInput[],
): Array<{ tabLabel: string; value: string }> {
  return (prefillFields || [])
    .filter((f) => f?.id && String(f.value ?? '').trim() !== '')
    .map((f) => ({
      tabLabel: String(f.id).trim(),
      value: String(f.value).trim(),
    }));
}

/** Map CRM-matched tabs to envelope tabIds using tabLabel (template tabIds ≠ envelope tabIds). */
export function mapMatchedTabsToEnvelopeTabIds(
  matched: Array<{ tabLabel: string; value: string; tabId?: string }>,
  envelopeTabs: DocusignTextTabRef[],
): Array<{ tabId: string; value: string }> {
  const byLabel = new Map<string, DocusignTextTabRef>();
  for (const t of envelopeTabs) {
    const label = normalizeFieldKey(String(t.tabLabel || t.name || ''));
    if (label && t.tabId) byLabel.set(label, t);
  }

  const out: Array<{ tabId: string; value: string }> = [];
  const used = new Set<string>();

  for (const m of matched) {
    const key = normalizeFieldKey(m.tabLabel);
    const env =
      byLabel.get(key) ||
      (m.tabId
        ? envelopeTabs.find((t) => String(t.tabId) === String(m.tabId))
        : undefined);
    const tabId = env?.tabId ? String(env.tabId) : '';
    if (!tabId || used.has(tabId)) continue;
    used.add(tabId);
    out.push({ tabId, value: m.value });
  }

  return out;
}

export function collectTabLabels(tabs: DocusignTextTabRef[], limit = 40): string[] {
  const out: string[] = [];
  for (const t of tabs) {
    const label = String(t.tabLabel || t.name || '').trim();
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}
