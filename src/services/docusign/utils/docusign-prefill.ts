export type PrefillFieldInput = { id: string; value: string };

export type DocusignTextTabRef = {
  tabId?: string;
  tabLabel?: string;
  name?: string;
  value?: string;
  pageNumber?: string | number;
};

/**
 * Tabs the signer fills blank (not CRM). Portal fields are label-only.
 * Contract pages 14–15 authorized business phone are CRM-prefilled + locked.
 */
const SIGNER_BLANK_PORTAL_LABELS = new Set([
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

function shouldSkipCrmPrefillForTab(tab: DocusignTextTabRef): boolean {
  const labels = [tab.tabLabel, tab.name]
    .map((s) => normalizeFieldKey(String(s || '')))
    .filter(Boolean);
  for (const raw of labels) {
    // Strip uniquify suffix (__p14_p45) added so DocuSign does not green-group tabs.
    const label = raw.replace(/__p\d+_[a-z0-9]+$/i, '').replace(/__page\d+$/i, '');
    if (SIGNER_BLANK_PORTAL_LABELS.has(label) || SIGNER_BLANK_PORTAL_LABELS.has(raw)) {
      return true;
    }
  }
  return false;
}

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
  authorizationclientsignername: 'authorization_client_signer_name',
  authorization_client_signer_name: 'authorization_client_signer_name',
  authorizationsignername: 'authorization_client_signer_name',
  authorization_signer_name: 'authorization_client_signer_name',
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
  addendumclientname: 'addendum_client_name',
  addendum_client_name: 'addendum_client_name',
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
  remittance: 'remittance',
  purchasepercent: 'purchase_percent',
  purchase_percent: 'purchase_percent',
  specifiedpercentage: 'purchase_percent',
  specified_percentage: 'purchase_percent',
  totalremit: 'remittance',
  total_remit: 'remittance',
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
  originationfee: 'appendix_underwriting_fees',
  origination_fee: 'appendix_underwriting_fees',
  originationFee: 'appendix_underwriting_fees',
};

/** Normalize CRM / DocuSign field keys for fuzzy matching (snake_case, spaces, case). */
export function normalizeFieldKey(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Envelope tabs for ACH / addenda use CRM-scoped labels (`ach_form_*`, `flex_addendum_*`)
 * after coordinate scoping. Prefill ids from the edit modal stay unprefixed — strip both ways.
 * Longer prefixes first so `ach_form_texas_` wins over `ach_form_`.
 */
const LAYOUT_SCOPED_TAB_PREFIXES = [
  'ach_form_texas_',
  'ach_form_',
  'pre_payment_addendum_',
  'flex_addendum_',
  'balance_transfer_',
  'disclosure_',
] as const;

/** Only ACH bare fields should be auto-seeded onto scoped ACH tab labels. */
const ACH_SCOPED_TAB_PREFIXES = ['ach_form_texas_', 'ach_form_'] as const;

function stripLayoutScopedTabPrefix(key: string): string {
  const k = normalizeFieldKey(key);
  for (const prefix of LAYOUT_SCOPED_TAB_PREFIXES) {
    if (k.startsWith(prefix) && k.length > prefix.length) {
      return k.slice(prefix.length);
    }
  }
  return k;
}

function isAchLikeBareFieldId(bare: string): boolean {
  const k = normalizeFieldKey(bare);
  return (
    k.startsWith('authorization_') ||
    k.startsWith('authorized_') ||
    k.startsWith('ach_authorization_') ||
    k.startsWith('ach_')
  );
}

function registerPrefillMapValue(
  map: Map<string, string>,
  rawKey: string,
  value: string,
  options?: { overwrite?: boolean },
): void {
  const key = normalizeFieldKey(rawKey);
  if (!key || !value) return;
  if (options?.overwrite || !map.has(key)) map.set(key, value);
  const alt = key.replace(/_/g, '');
  if (options?.overwrite || !map.has(alt)) map.set(alt, value);
}

/** Contract PDF “$___ per ____”: DAY / WEEK (not DAILY / WEEKLY). */
function normalizeContractFrequencyDisplay(value: string): string {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!text) return String(value ?? '').trim().toUpperCase();
  if (text === 'day' || text === 'daily') return 'DAY';
  if (text === 'week' || text === 'weekly') return 'WEEK';
  if (text === 'bi week' || text === 'biweekly') return 'BI-WEEK';
  if (text === 'month' || text === 'monthly') return 'MONTH';
  return String(value ?? '').trim().toUpperCase();
}

export function buildPrefillValueMap(
  fields: PrefillFieldInput[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const f of fields) {
    const id = String(f?.id ?? '').trim();
    // Contract / addendum / disclosure stamped + tab text must be ALL CAPS.
    let value = String(f?.value ?? '').trim().toUpperCase();
    if (!id || !value) continue;
    const key = normalizeFieldKey(id);
    // Contract PDF “$___ per ____”: DAY / WEEK (not DAILY / WEEKLY).
    if (
      key === 'frequency' ||
      key === 'paymentterms' ||
      key === 'payment_terms' ||
      key === 'paymentfrequency' ||
      key.endsWith('_frequency') ||
      key.endsWith('paymentterms')
    ) {
      value = normalizeContractFrequencyDisplay(value);
    }
    const bare = stripLayoutScopedTabPrefix(key);
    // Exact CRM field ids always win (e.g. balance_transfer_purchase_price Remaining Balance).
    registerPrefillMapValue(map, key, value, { overwrite: true });
    if (bare !== key) registerPrefillMapValue(map, bare, value);
    // Seed ACH scoped labels from unprefixed ACH edits only.
    // Do NOT broadcast main-contract purchase_price onto balance_transfer_purchase_price
    // (or flex_addendum_*) — that overwrote Remaining Balance with payback amount.
    if (isAchLikeBareFieldId(bare)) {
      for (const prefix of ACH_SCOPED_TAB_PREFIXES) {
        registerPrefillMapValue(map, `${prefix}${bare}`, value);
      }
    }
  }
  for (const [aliasKey, fieldId] of Object.entries(CRM_LABEL_TO_FIELD_ID)) {
    const val = map.get(normalizeFieldKey(fieldId));
    if (val) map.set(aliasKey, val);
  }
  return map;
}

function lookupPrefillValue(map: Map<string, string>, tabKey: string): string | undefined {
  const k = normalizeFieldKey(tabKey);
  if (!k) return undefined;
  if (map.has(k)) return map.get(k);
  const noUnderscore = k.replace(/_/g, '');
  if (map.has(noUnderscore)) return map.get(noUnderscore);

  // Unique Data Labels use `__p14_p45` suffix — match the bare CRM/layout variable.
  const bareUnique = k.replace(/__p\d+_[a-z0-9]+$/i, '').replace(/__page\d+$/i, '');
  if (bareUnique !== k) {
    if (map.has(bareUnique)) return map.get(bareUnique);
    const bareUniqueNoUs = bareUnique.replace(/_/g, '');
    if (map.has(bareUniqueNoUs)) return map.get(bareUniqueNoUs);
  }

  const scopedSource = bareUnique !== k ? bareUnique : k;
  const bare = stripLayoutScopedTabPrefix(scopedSource);
  if (bare !== scopedSource) {
    // Do not fall back from balance_transfer_purchase_price → purchase_price (payback).
    // Remaining Balance is a separate CRM-scoped value.
    const isProtectedScopedMoney =
      scopedSource === 'balance_transfer_purchase_price' ||
      scopedSource === 'flex_addendum_purchase_price';
    if (!isProtectedScopedMoney) {
      if (map.has(bare)) return map.get(bare);
      const bareNoUs = bare.replace(/_/g, '');
      if (map.has(bareNoUs)) return map.get(bareNoUs);
    }
  }

  const viaAlias =
    CRM_LABEL_TO_FIELD_ID[k] ||
    CRM_LABEL_TO_FIELD_ID[bare] ||
    CRM_LABEL_TO_FIELD_ID[bareUnique];
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
    // Contract pages 14/15 phone + page-16 portal fields stay blank for the signer.
    if (shouldSkipCrmPrefillForTab(tab)) continue;

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
      value: String(f.value).trim().toUpperCase(),
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
    if (!label || !t.tabId) continue;
    byLabel.set(label, t);
    const bare = stripLayoutScopedTabPrefix(label);
    if (bare !== label && !byLabel.has(bare)) byLabel.set(bare, t);
  }

  const out: Array<{ tabId: string; value: string }> = [];
  const used = new Set<string>();

  for (const m of matched) {
    const key = normalizeFieldKey(m.tabLabel);
    const bare = stripLayoutScopedTabPrefix(key);
    const env =
      byLabel.get(key) ||
      byLabel.get(bare) ||
      (bare !== key
        ? undefined
        : LAYOUT_SCOPED_TAB_PREFIXES.map((p) => byLabel.get(`${p}${bare}`)).find(Boolean)) ||
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
