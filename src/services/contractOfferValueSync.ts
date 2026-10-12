import prisma from '../config/prismaClient';
import {
  deriveFrequency,
  frequencySpecToStored,
  parseContractLengthDaysFromOfferTerm,
  parseDisclosureTermDaysFromOffer,
} from '../utils/deriveFrequencyFromTerm';
import { sanitizePaymentFrequencyForPersist } from '../utils/sanitizePaymentFrequency';

/**
 * Contract columns whose values are derived from the OfferDecision. When the offer is
 * re-scrubbed the contract keeps its creation-time snapshot, so ACH / disclosure / addendum
 * documents prefill the OLD amounts. These are refreshed from the live offer, and any
 * same-named entry in `Contract.contractPrefillOverrides` is dropped, because an override
 * wins over the column when the prefill payload is built.
 */
export const OFFER_DERIVED_CONTRACT_FIELDS = [
  'purchaseAmount',
  'purchasePrice',
  'remittance',
  'appendixUnderwritingFees',
] as const;

/** Extra override keys that mirror the offer money values under their document-facing names. */
const OFFER_DERIVED_OVERRIDE_KEYS = [
  ...OFFER_DERIVED_CONTRACT_FIELDS,
  'purchase_amount',
  'purchase_price',
  'funding_provided',
  'net_to_merchant',
  'total_remit',
  'disclosure_amount_financed',
  'disclosure_purchase_price',
  'disclosure_total_payment',
  'disclosure_estimated_payment',
  'estimated_payment',
  'estimated_payment_amount',
  'total_amount_business_fund',
];

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function moneyString(value: number | null): string | null {
  return value != null ? String(Math.round(value * 100) / 100) : null;
}

/**
 * Origination / underwriting fee in dollars. `OfferDecision.fees` holds either a percent
 * (the usual case — the column is Decimal(18,6) and the scrub screen captures a rate) or
 * an already-absolute dollar amount on older rows.
 *
 * Anything at or below 100 is read as a percent. The previous rule also treated a value
 * above 0.5% of the funded amount as dollars, which broke on small deals: a 10% fee on a
 * $1,000 advance resolved to $10 instead of $100, and on a re-scrubbed deal the percent
 * scaled against the OLD advance produced a fee larger than the purchase price itself
 * (a $10,000 advance's 10% staying $1,000 against a $1,000 advance).
 */
function resolveOfferFeeDollars(funded: number | null, feesRaw: unknown): string | null {
  const fees = numberOrNull(feesRaw);
  if (funded == null || funded <= 0 || fees == null || fees <= 0) return null;
  if (fees > 100) return moneyString(fees);
  return moneyString((funded * fees) / 100);
}

/** Per-payment (daily / weekly) remittance amount currently approved on the offer. */
function resolveRemittance(offer: {
  repayPerPeriod?: unknown;
  totalRemit?: unknown;
  term?: unknown;
}): string | null {
  const perPeriod = numberOrNull(offer.repayPerPeriod);
  if (perPeriod != null && perPeriod > 0) return moneyString(perPeriod);
  const totalRemit = numberOrNull(offer.totalRemit);
  const term = parseContractLengthDaysFromOfferTerm(offer.term);
  if (totalRemit != null && totalRemit > 0 && term != null && term > 0) {
    return moneyString(totalRemit / term);
  }
  return null;
}

/** Strip offer-derived keys so the refreshed columns are what the documents prefill from. */
export function stripStaleOfferOverrides(overrides: unknown): {
  next: Record<string, unknown>;
  changed: boolean;
} {
  const base =
    overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? { ...(overrides as Record<string, unknown>) }
      : {};
  let changed = false;
  for (const key of OFFER_DERIVED_OVERRIDE_KEYS) {
    if (key in base) {
      delete base[key];
      changed = true;
    }
  }
  return { next: base, changed };
}

/** The live OfferDecision fields every offer-derived contract value is computed from. */
export type OfferDecisionValueSource = {
  offer?: unknown;
  totalRemit?: unknown;
  term?: unknown;
  frequency?: unknown;
  repayPerPeriod?: unknown;
  fees?: unknown;
  /** Balance of the deal this one refinances, when it is a refi. */
  refinanceAmount?: unknown;
};

export type OfferDerivedContractValues = {
  approvedAmount: number | null;
  totalAmount: number | null;
  termDays: number | null;
  /**
   * Estimated term in calendar days for the disclosure: the offer's term read in its own
   * unit (weeks x 7 on a weekly deal), unlike `termDays`, which is the raw payment count
   * the contract length and the per-period remittance are derived from.
   */
  disclosureTermDays: number | null;
  purchaseAmount: string | null;
  purchasePrice: string | null;
  remittance: string | null;
  appendixUnderwritingFees: string | null;
  frequency: string | null;
  /**
   * Previous-deal balance this advance pays off. The state disclosure's page-3
   * itemization needs it to split the advance between the recipient and the
   * refinanced lender; a new deal has none.
   */
  refinanceAmount: number | null;
};

/**
 * Single definition of every contract value the offer drives. Used both to write the
 * contract row when the offer changes and to overlay API reads, so the Info Required
 * screen and the sent documents can never disagree about the current terms.
 */
export function resolveOfferDerivedContractValues(
  offer: OfferDecisionValueSource | null | undefined,
): OfferDerivedContractValues | null {
  if (!offer) return null;
  const approvedAmount = numberOrNull(offer.offer);
  const totalAmount = numberOrNull(offer.totalRemit);
  const termDays = parseContractLengthDaysFromOfferTerm(offer.term);
  const disclosureTermDays = parseDisclosureTermDaysFromOffer(offer.term, offer.frequency);
  const refinanceAmount = numberOrNull(offer.refinanceAmount);
  return {
    approvedAmount,
    totalAmount,
    termDays: termDays != null && termDays > 0 ? termDays : null,
    disclosureTermDays:
      disclosureTermDays != null && disclosureTermDays > 0 ? disclosureTermDays : null,
    purchaseAmount: moneyString(approvedAmount),
    purchasePrice: moneyString(totalAmount),
    remittance: resolveRemittance(offer),
    appendixUnderwritingFees: resolveOfferFeeDollars(approvedAmount, offer.fees),
    refinanceAmount: refinanceAmount != null && refinanceAmount > 0 ? refinanceAmount : null,
    /**
     * `OfferDecision.frequency` is a separately-set column that can go stale or blank
     * when the deal was re-scrubbed — the same drift `deriveFrequencyFromTerm.ts`
     * documents for its own callers ("the Excel frequency column must not be used for
     * persistence — always derive from term"). `term` ("10 Weeks" / "20 Days") is what
     * the offer screen actually captures the cadence into, so it wins whenever it
     * names a unit; the `frequency` column is only a fallback for terms that don't.
     */
    frequency:
      frequencySpecToStored(deriveFrequency(offer.term as string | null | undefined)) !== 'NA'
        ? frequencySpecToStored(deriveFrequency(offer.term as string | null | undefined))
        : sanitizePaymentFrequencyForPersist(offer.frequency) || null,
  };
}

/**
 * Overlay the live offer's values onto a contract row on its way out of the API, and
 * hide prefill overrides that the offer has since superseded.
 *
 * The Info Required step (disclosure / addendum prefill) renders straight from this
 * payload, so a contract row still holding creation-time amounts — or an override saved
 * against a previous offer — would otherwise keep showing the old numbers until someone
 * re-saved the offer. Read-only: the row is corrected in the response, and the write-side
 * sync remains what persists it.
 */
export function applyOfferDerivedValuesToContractRow<T extends Record<string, unknown>>(
  row: T | null | undefined,
): T | null | undefined {
  if (!row) return row;
  const derived = resolveOfferDerivedContractValues(
    row.offer as OfferDecisionValueSource | null | undefined,
  );
  if (!derived) return row;

  const out: Record<string, unknown> = { ...row };
  if (derived.approvedAmount != null) out.approvedAmount = derived.approvedAmount;
  if (derived.totalAmount != null) out.totalAmount = derived.totalAmount;
  if (derived.termDays != null) out.contractLenght = derived.termDays;
  if (derived.purchaseAmount != null) out.purchaseAmount = derived.purchaseAmount;
  if (derived.purchasePrice != null) out.purchasePrice = derived.purchasePrice;
  if (derived.remittance != null) out.remittance = derived.remittance;
  if (derived.appendixUnderwritingFees != null) {
    out.appendixUnderwritingFees = derived.appendixUnderwritingFees;
  }

  const { next, changed } = stripStaleOfferOverrides(row.contractPrefillOverrides);
  if (changed) out.contractPrefillOverrides = next;

  // The ACH and addendum rows are written once with the contract, so heal the
  // offer-driven amounts on them too when they are part of the same payload.
  if (Array.isArray(row.achs)) {
    out.achs = (row.achs as Array<Record<string, unknown>>).map((ach) => ({
      ...ach,
      ...(derived.purchaseAmount != null ? { paymentAmount: derived.purchaseAmount } : {}),
      ...(derived.frequency != null ? { frequency: derived.frequency } : {}),
    }));
  }
  if (Array.isArray(row.addendums)) {
    out.addendums = (row.addendums as Array<Record<string, unknown>>).map((addendum) => ({
      ...addendum,
      ...(derived.purchaseAmount != null
        ? { principalOwnerAmount1: derived.purchaseAmount }
        : {}),
      ...(derived.purchasePrice != null
        ? { principalOwnerAmount2: derived.purchasePrice }
        : {}),
    }));
  }

  return out as T;
}

/**
 * The optional $25 wire fee a deal can carry on top of the origination fee. It is a
 * document preference rather than an offer term, saved by the CRM as
 * `contractPrefillOverrides.includeWireFee` and defaulting to on, exactly as the
 * "Include $25 wire fee" checkbox resolves it.
 */
export const CONTRACT_WIRE_FEE_USD = 25;

export function resolveIncludeWireFee(value: unknown): boolean {
  if (value === false || value === 0) return false;
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  return true;
}

export function readIncludeWireFeeFromOverrides(overrides: unknown): boolean {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return true;
  const raw = (overrides as Record<string, unknown>).includeWireFee;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  return resolveIncludeWireFee(raw);
}

/**
 * Save the "$25 wire fee" choice a SignNow review was built with onto the contract.
 *
 * The checkbox is a live form value: the review request carries it, but nothing
 * wrote it back, so Send / the portal publish — which bake the merchant's copy
 * from the contract row — resolved it as "on" and printed TOTAL FEES $25 higher
 * than the review the preparer had just approved. Recording it here makes every
 * later step bake the same fees as the review, on every funder.
 *
 * A no-op when the value is absent or already stored; never throws.
 */
export async function persistIncludeWireFeePreference(
  target: { contractId?: number | string | null; applicationId?: string | null },
  value: unknown,
): Promise<void> {
  if (value === undefined || value === null || String(value).trim() === '') return;
  const contractId = Number(target.contractId);
  const appId = String(target.applicationId || '').trim();
  const where =
    Number.isFinite(contractId) && contractId > 0
      ? { id: contractId }
      : appId
        ? { applicationId: appId }
        : null;
  if (!where) return;
  const stored = resolveIncludeWireFee(value) ? 'true' : 'false';
  try {
    const contract = await prisma.contract.findUnique({
      where: where as { id: number } | { applicationId: string },
      select: { id: true, contractPrefillOverrides: true },
    });
    if (!contract) return;
    const raw = contract.contractPrefillOverrides;
    const overrides =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    if (String(overrides.includeWireFee ?? '').trim() === stored) return;
    await prisma.contract.update({
      where: { id: contract.id },
      data: { contractPrefillOverrides: { ...overrides, includeWireFee: stored } },
    });
  } catch (err) {
    console.warn('[contractOfferValueSync] could not save the wire fee preference', {
      contractId: target.contractId ?? null,
      applicationId: appId || null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Money values saved in the CRM's "Verify contract prefill" editor
 * (`Contract.contractPrefillOverrides`). What the preparer saved there is what
 * the SignNow review and the sent contract print, so these outrank the figures
 * re-derived from the offer.
 */
export type SavedOfferPrefillValues = {
  purchaseAmount?: number;
  purchasePrice?: number;
  remittance?: string;
  frequency?: string;
  appendixUnderwritingFees?: string;
  refinanceAmount?: number;
  /** Only set when the preparer entered it by hand (`_manualNetToMerchant`). */
  netToMerchant?: string;
};

export type ContractOfferPrefillSource = {
  values: OfferDerivedContractValues | null;
  /** Whether the deal's $25 wire fee is switched on. */
  includeWireFee: boolean;
  saved?: SavedOfferPrefillValues;
};

function savedMoney(value: unknown): number | undefined {
  const text = String(value ?? '').replace(/[$,\s]/g, '');
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** The money values the prefill editor saved, from `contractPrefillOverrides`. */
export function readSavedOfferPrefillFromOverrides(overrides: unknown): SavedOfferPrefillValues {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};
  const o = overrides as Record<string, unknown>;
  const out: SavedOfferPrefillValues = {};
  const purchaseAmount = savedMoney(o.purchaseAmount);
  if (purchaseAmount != null) out.purchaseAmount = purchaseAmount;
  const purchasePrice = savedMoney(o.purchasePrice);
  if (purchasePrice != null) out.purchasePrice = purchasePrice;
  const remittance = savedMoney(o.remittance);
  if (remittance != null) out.remittance = String(remittance);
  const frequency = sanitizePaymentFrequencyForPersist(o.frequency);
  if (frequency) out.frequency = frequency;
  const fees = savedMoney(o.appendixUnderwritingFees);
  if (fees != null) out.appendixUnderwritingFees = String(fees);
  const refinance = savedMoney(o.refinanceAmount);
  if (refinance != null) out.refinanceAmount = refinance;
  const net = savedMoney(o.netToMerchant);
  if (net != null && resolveIncludeWireFee(o._manualNetToMerchant ?? 'false')) {
    out.netToMerchant = String(net);
  }
  return out;
}

/**
 * The live offer's derived values for a contract, for callers that need to layer them
 * over a prefill payload the CRM screen may have cached against a superseded offer.
 */
export async function loadOfferDerivedValuesForContract(target: {
  contractId?: number | string | null;
  applicationId?: string | null;
}): Promise<ContractOfferPrefillSource> {
  const contractId = Number(target.contractId);
  const appId = String(target.applicationId || '').trim();
  const where =
    Number.isFinite(contractId) && contractId > 0
      ? { id: contractId }
      : appId
        ? { applicationId: appId }
        : null;
  if (!where) return { values: null, includeWireFee: true };

  try {
    const contract = await prisma.contract.findUnique({
      where: where as { id: number } | { applicationId: string },
      select: {
        contractPrefillOverrides: true,
        offer: {
          select: {
            offer: true,
            totalRemit: true,
            term: true,
            frequency: true,
            repayPerPeriod: true,
            fees: true,
            refinanceAmount: true,
          },
        },
      },
    });
    return {
      values: resolveOfferDerivedContractValues(contract?.offer),
      includeWireFee: readIncludeWireFeeFromOverrides(contract?.contractPrefillOverrides),
      saved: readSavedOfferPrefillFromOverrides(contract?.contractPrefillOverrides),
    };
  } catch (err) {
    console.warn('[contractOfferValueSync] could not load live offer values', {
      contractId: target.contractId ?? null,
      applicationId: appId || null,
      error: err instanceof Error ? err.message : String(err),
    });
    return { values: null, includeWireFee: true };
  }
}

/**
 * Re-derive every offer-driven value on a contract from the current OfferDecision:
 * contract columns, the ACH row, the addendum amounts, and stale prefill overrides.
 *
 * Called after an offer is saved/re-scrubbed so the ACH authorization and the state
 * disclosure are prefilled with the NEW terms instead of the amounts captured when the
 * contract row was first created. Returns false when there is nothing to sync.
 */
export async function syncContractValuesFromOfferDecision(
  applicationId: string,
  options?: {
    /**
     * Drop offer-derived prefill overrides (default). A regeneration whose offer did not
     * change passes false: the saved values were entered against this same offer, so they
     * stay exactly as they were.
     */
    stripOfferOverrides?: boolean;
  },
): Promise<boolean> {
  const appId = String(applicationId || '').trim();
  if (!appId) return false;

  const contract = await prisma.contract.findUnique({
    where: { applicationId: appId },
    select: {
      id: true,
      startDate: true,
      contractPrefillOverrides: true,
      offer: {
        select: {
          id: true,
          offer: true,
          totalRemit: true,
          term: true,
          frequency: true,
          repayPerPeriod: true,
          fees: true,
        },
      },
    },
  });
  if (!contract?.offer) return false;

  const derived = resolveOfferDerivedContractValues(contract.offer);
  if (!derived) return false;

  const data: Record<string, unknown> = {};
  if (derived.approvedAmount != null) {
    data.approvedAmount = derived.approvedAmount;
    data.purchaseAmount = derived.purchaseAmount;
  }
  if (derived.totalAmount != null) {
    data.totalAmount = derived.totalAmount;
    data.purchasePrice = derived.purchasePrice;
  }
  if (derived.termDays != null) {
    data.contractLenght = derived.termDays;
    const end = new Date(contract.startDate);
    end.setDate(end.getDate() + derived.termDays);
    data.endDate = end;
  }
  if (derived.remittance != null) data.remittance = derived.remittance;
  if (derived.appendixUnderwritingFees != null) {
    data.appendixUnderwritingFees = derived.appendixUnderwritingFees;
  }

  if (options?.stripOfferOverrides !== false) {
    const { next: strippedOverrides, changed: overridesChanged } = stripStaleOfferOverrides(
      contract.contractPrefillOverrides,
    );
    if (overridesChanged) data.contractPrefillOverrides = strippedOverrides;
  }

  if (Object.keys(data).length > 0) {
    await prisma.contract.update({ where: { id: contract.id }, data });
  }

  // The ACH row is created once with the contract and never refreshed, so the ACH
  // authorization form kept showing the original payment amount / cadence.
  const achPatch: Record<string, unknown> = {};
  if (data.purchaseAmount != null) achPatch.paymentAmount = data.purchaseAmount;
  if (derived.frequency) achPatch.frequency = derived.frequency;
  if (Object.keys(achPatch).length > 0) {
    await prisma.aCH.updateMany({ where: { contractId: contract.id }, data: achPatch });
  }

  const addendumPatch: Record<string, unknown> = {};
  if (data.purchaseAmount != null) addendumPatch.principalOwnerAmount1 = data.purchaseAmount;
  if (data.purchasePrice != null) addendumPatch.principalOwnerAmount2 = data.purchasePrice;
  if (Object.keys(addendumPatch).length > 0) {
    await prisma.addendum.updateMany({
      where: { contractId: contract.id },
      data: addendumPatch,
    });
  }

  return true;
}
