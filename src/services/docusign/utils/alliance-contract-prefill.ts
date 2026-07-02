import { DOCUMENT_LAYOUT_KEYS } from '../layouts/document-layout.registry';

const ALLIANCE_CONTRACT_MONEY_TAB_IDS = new Set([
  'purchase_amount',
  'finance_charge',
  'purchase_price',
  'appendix_underwriting_fees',
  'net_to_merchant',
  'remittance',
]);

const BUSINESS_DAYS_PER_WEEK = 5;

function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const cleaned = String(value).trim().replace(/[$,\s]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatAllianceUsd(value: unknown): string {
  const n = parseMoney(value);
  if (n === null) return String(value ?? '').trim();
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function normalizeFrequencyKey(frequency: string): string {
  const f = String(frequency ?? '')
    .trim()
    .toLowerCase();
  if (f.includes('biweek') || f.includes('bi_week')) return 'biweekly';
  if (f.startsWith('week')) return 'weekly';
  if (f.startsWith('day')) return 'daily';
  if (f.startsWith('month')) return 'monthly';
  return f || 'daily';
}

function formatWeeksLabel(weeks: number): string {
  const n = Math.max(1, Math.round(weeks));
  return `${n} ${n === 1 ? 'week' : 'weeks'}`;
}

function resolveTermWeeks(values: Record<string, string>): number | null {
  const freqKey = normalizeFrequencyKey(values.frequency || '');
  const paymentsRaw =
    values.ach_authorization_account_holder_bank_number_of_transactions ||
    values.number_of_payments ||
    values.estimated_number_of_payments ||
    '';
  const payments = Math.max(
    1,
    Math.trunc(parseMoney(paymentsRaw) ?? 0) ||
      Math.trunc(Number(String(paymentsRaw).replace(/[^\d]/g, '')) || 0) ||
      1,
  );

  if (freqKey === 'daily') {
    return Math.max(1, Math.round(payments / BUSINESS_DAYS_PER_WEEK));
  }
  if (freqKey === 'weekly') {
    return payments;
  }
  if (freqKey === 'biweekly') {
    return payments * 2;
  }
  if (freqKey === 'monthly') {
    return payments * 4;
  }
  return payments;
}

const ALLIANCE_CONTRACT_ADDRESS_TAB_GROUPS: Array<[string, string, string, string]> = [
  ['business_address', 'business_address_city', 'business_address_state', 'business_address_zip'],
  [
    'business_address_contract',
    'business_address_contract_city',
    'business_address_contract_state',
    'business_address_contract_zip',
  ],
];

function stripDuplicateAddressSuffix(
  line: string,
  city: string,
  state: string,
  zip: string,
): string {
  let street = String(line ?? '').trim();
  if (!street || (!city && !state && !zip)) return street;

  const suffixCandidates = [
    [city, state, zip].filter(Boolean).join(', '),
    [city, state].filter(Boolean).join(', '),
    city,
  ].filter((s) => s.length > 0);

  for (const suffix of suffixCandidates) {
    const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const withComma = new RegExp(`,\\s*${escaped}\\s*$`, 'i');
    if (withComma.test(street)) {
      street = street.replace(withComma, '').trim();
      break;
    }
  }
  return street;
}

/** Alliance page 1: street tab is street-only; city/state/zip use separate tabs below. */
export function applyAllianceBridgeAddressPrefillValues(values: Record<string, string>): void {
  for (const [streetKey, cityKey, stateKey, zipKey] of ALLIANCE_CONTRACT_ADDRESS_TAB_GROUPS) {
    const city = String(values[cityKey] ?? '').trim();
    const state = String(values[stateKey] ?? '').trim();
    const zip = String(values[zipKey] ?? '').trim();
    if (!city && !state && !zip) continue;

    const streetOnly = stripDuplicateAddressSuffix(
      String(values[streetKey] ?? '').trim(),
      city,
      state,
      zip,
    );
    if (streetOnly) values[streetKey] = streetOnly;
  }
}

/** Map CRM Exhibit A values (`exhibit_a_value_N`) onto Alliance layout tabs (`exhibit_company_name_N`). */
export function applyAllianceBridgeExhibitPrefillValues(values: Record<string, string>): void {
  for (let i = 1; i <= 10; i += 1) {
    const companyKey = `exhibit_company_name_${i}`;
    const legacyKey = `exhibit_a_value_${i}`;
    const legacy = String(values[legacyKey] ?? '').trim();
    if (!String(values[companyKey] ?? '').trim() && legacy) {
      values[companyKey] = legacy;
    }
  }
}

export function isAllianceBridgeContractLayoutKey(layoutKey?: string | null): boolean {
  return String(layoutKey ?? '').trim() === DOCUMENT_LAYOUT_KEYS.allianceBridgeContract;
}

/** Alliance Texas contract: USD amounts with $ and page-1 addendum_dated as term weeks. */
export function applyAllianceBridgeContractPrefillValues(values: Record<string, string>): void {
  for (const id of ALLIANCE_CONTRACT_MONEY_TAB_IDS) {
    const raw = String(values[id] || '').trim();
    if (raw) values[id] = formatAllianceUsd(raw);
  }

  const offer = parseMoney(values.purchase_amount);
  const payback = parseMoney(values.purchase_price);
  const computedFinanceCharge =
    offer != null && payback != null && payback > offer ? payback - offer : null;
  const financeRaw = String(values.finance_charge || '').trim();
  if (financeRaw) {
    values.finance_charge = formatAllianceUsd(financeRaw);
  } else if (computedFinanceCharge != null) {
    values.finance_charge = formatAllianceUsd(computedFinanceCharge);
  }

  const weeks = resolveTermWeeks(values);
  if (weeks != null && Number.isFinite(weeks)) {
    values.addendum_dated = formatWeeksLabel(weeks);
  }

  applyAllianceBridgeAddressPrefillValues(values);
  applyAllianceBridgeExhibitPrefillValues(values);
}
