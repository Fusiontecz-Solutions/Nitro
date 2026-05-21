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
  businesslegalname: 'client_legal_name',
  business_legal_name: 'client_legal_name',
  businesssellerlegalname: 'client_legal_name',
  business_seller_legal_name: 'client_legal_name',
  sellerlegalname: 'client_legal_name',
  seller_legal_name: 'client_legal_name',
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
  businessaddresscity: 'business_address_city',
  businessaddressstate: 'business_address_state',
  businessaddresszip: 'business_address_zip',
  typeofentity: 'entity_type',
  type_of_entity: 'entity_type',
  entitytype: 'entity_type',
  entity_type: 'entity_type',
  remittance: 'remittance',
  purchasepercent: 'purchase_percent',
  purchase_percent: 'purchase_percent',
  frequency: 'frequency',
  paymentterms: 'frequency',
  payment_terms: 'frequency',
  netfundprovided: 'net_to_merchant',
  net_fund_provided: 'net_to_merchant',
  nettomerchant: 'net_to_merchant',
  net_to_merchant: 'net_to_merchant',
  NetFundProvided: 'net_to_merchant',
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

function lookupPrefillValue(map: Map<string, string>, tabKey: string): string | undefined {
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
    const candidates = [tabLabel, tab.tabLabel, tab.name, tabId].filter(Boolean) as string[];

    let value: string | undefined;
    for (const c of candidates) {
      value = lookupPrefillValue(valueMap, c);
      if (value) break;
    }
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
