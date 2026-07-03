import { formatUSD, parseMoneyInput } from "@/utils/formatCurrency";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import { isAllianceFunderProfile, isTexasContractState } from "@/hooks/useFunderProfiles";
import {
    normalizeDisclosureTemplateFrequencyKey,
    resolveNumberOfPaymentsPrefillValue,
    resolveOfferFrequencyLabel,
    type NetToMerchantPrefillSources,
} from "./Contract";
import { PLATFORM_LAYOUT_KEYS } from "./platformDocumentConfig";

type AlliancePrefillField = { id: string; label: string; value: string };

export const ALLIANCE_CONTRACT_MONEY_TAB_IDS = new Set([
    "purchase_amount",
    "finance_charge",
    "purchase_price",
    "appendix_underwriting_fees",
    "net_to_merchant",
    "remittance",
]);

const ALLIANCE_CONTRACT_MONEY_FIELD_ALIASES: Record<string, readonly string[]> = {
    purchase_amount: [
        "purchaseamount",
        "receivable_purchase",
        "receivable_purchase_1",
        "receivable_purchase_2",
    ],
    purchase_price: [
        "purchaseprice",
        "total_repayment_amount",
        "disclosure_total_payment",
        "estimatedtotalpaymentamount",
    ],
    finance_charge: ["financecharge", "total_dollar_cost", "disclosure_finance_charge"],
    appendix_underwriting_fees: ["underwriter_fee", "underwriterfee", "underwriter_fees"],
    net_to_merchant: ["netfundprovided", "net_fund_provided", "NetFundProvided"],
    remittance: [
        "daily_payment",
        "dailypayment",
        "estimated_payment",
        "estimated_payment_amount",
        "estimatedremittance",
    ],
};

function normalizeAllianceMoneyFieldKey(fieldId?: string | null): string | null {
    const raw = String(fieldId ?? "").trim();
    if (!raw) return null;
    const snake = raw
        .replace(/([a-z])([A-Z])/g, "$1_$2")
        .replace(/[\s-]+/g, "_")
        .toLowerCase();
    if (ALLIANCE_CONTRACT_MONEY_TAB_IDS.has(raw)) return raw;
    if (ALLIANCE_CONTRACT_MONEY_TAB_IDS.has(snake)) return snake;
    for (const canonical of ALLIANCE_CONTRACT_MONEY_TAB_IDS) {
        const aliases = ALLIANCE_CONTRACT_MONEY_FIELD_ALIASES[canonical] || [];
        if (aliases.some((alias) => alias.toLowerCase() === snake || alias === raw)) {
            return canonical;
        }
    }
    return null;
}

function hydrateAllianceMoneyCanonicalValues(values: Record<string, string>): void {
    for (const canonical of ALLIANCE_CONTRACT_MONEY_TAB_IDS) {
        if (String(values[canonical] ?? "").trim()) continue;
        for (const alias of ALLIANCE_CONTRACT_MONEY_FIELD_ALIASES[canonical] || []) {
            const raw = String(values[alias] ?? "").trim();
            if (raw) {
                values[canonical] = raw;
                break;
            }
        }
        if (String(values[canonical] ?? "").trim()) continue;
        for (const [key, val] of Object.entries(values)) {
            if (normalizeAllianceMoneyFieldKey(key) === canonical && String(val ?? "").trim()) {
                values[canonical] = String(val).trim();
                break;
            }
        }
    }
}

function propagateAllianceMoneyFormattedValues(values: Record<string, string>): void {
    for (const canonical of ALLIANCE_CONTRACT_MONEY_TAB_IDS) {
        const formatted = String(values[canonical] ?? "").trim();
        if (!formatted) continue;
        for (const alias of ALLIANCE_CONTRACT_MONEY_FIELD_ALIASES[canonical] || []) {
            values[alias] = formatted;
        }
    }
}

const ALLIANCE_CONTRACT_ADDRESS_TAB_GROUPS: Array<[string, string, string, string]> = [
    ["business_address", "business_address_city", "business_address_state", "business_address_zip"],
    [
        "business_address_contract",
        "business_address_contract_city",
        "business_address_contract_state",
        "business_address_contract_zip",
    ],
];

function stripDuplicateAddressSuffix(
    line: string,
    city: string,
    state: string,
    zip: string,
): string {
    let street = String(line ?? "").trim();
    if (!street || (!city && !state && !zip)) return street;

    const suffixCandidates = [
        [city, state, zip].filter(Boolean).join(", "),
        [city, state].filter(Boolean).join(", "),
        city,
    ].filter((s) => s.length > 0);

    for (const suffix of suffixCandidates) {
        const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const withComma = new RegExp(`,\\s*${escaped}\\s*$`, "i");
        if (withComma.test(street)) {
            street = street.replace(withComma, "").trim();
            break;
        }
    }
    return street;
}

function applyAllianceBridgeAddressPrefillToFields(
    fields: AlliancePrefillField[],
): AlliancePrefillField[] {
    const byId = new Map(fields.map((f) => [f.id, { ...f }]));
    for (const [streetKey, cityKey, stateKey, zipKey] of ALLIANCE_CONTRACT_ADDRESS_TAB_GROUPS) {
        const city = String(byId.get(cityKey)?.value ?? "").trim();
        const state = String(byId.get(stateKey)?.value ?? "").trim();
        const zip = String(byId.get(zipKey)?.value ?? "").trim();
        if (!city && !state && !zip) continue;

        const currentStreet = String(byId.get(streetKey)?.value ?? "").trim();
        const streetOnly = stripDuplicateAddressSuffix(currentStreet, city, state, zip);
        if (!streetOnly) continue;

        const existing = byId.get(streetKey);
        if (existing) {
            byId.set(streetKey, { ...existing, value: streetOnly });
        } else {
            byId.set(streetKey, { id: streetKey, label: streetKey, value: streetOnly });
        }
    }
    return fields.map((field) => byId.get(field.id) ?? field);
}

function applyAllianceBridgeExhibitPrefillToFields(
    fields: AlliancePrefillField[],
): AlliancePrefillField[] {
    const byId = new Map(fields.map((f) => [f.id, { ...f }]));
    for (let i = 1; i <= 10; i += 1) {
        const allianceId = `exhibit_company_name_${i}`;
        const legacyId = `exhibit_a_value_${i}`;
        const value =
            String(byId.get(allianceId)?.value ?? "").trim() ||
            String(byId.get(legacyId)?.value ?? "").trim();
        if (!value) {
            byId.delete(allianceId);
            byId.delete(legacyId);
            continue;
        }
        byId.set(allianceId, {
            id: allianceId,
            label: byId.get(allianceId)?.label ?? allianceId,
            value,
        });
        byId.set(legacyId, {
            id: legacyId,
            label: byId.get(legacyId)?.label ?? legacyId,
            value,
        });
    }
    const ordered = fields
        .map((field) => byId.get(field.id))
        .filter((field): field is AlliancePrefillField => Boolean(field?.value?.trim()));
    for (const [id, field] of byId.entries()) {
        if (!ordered.some((row) => row.id === id) && field.value.trim()) {
            ordered.push(field);
        }
    }
    return ordered;
}

export function isAllianceBridgeContractLayoutKey(layoutKey?: string | null): boolean {
    return String(layoutKey ?? "").trim() === PLATFORM_LAYOUT_KEYS.allianceBridgeContract;
}

/** True when Alliance Texas prefill should run (incl. production `funder_*` storage keys). */
export function shouldApplyAllianceBridgeContractPrefill(args: {
    layoutKey?: string | null;
    funderName?: string | null;
    state?: string | null;
    profile?: Pick<FunderProfile, "name" | "displayName" | "mainContractLayoutKey" | "organization" | "legalName" | "contactEmail"> | null;
}): boolean {
    const layoutKey = String(args.layoutKey ?? "").trim();
    if (isAllianceBridgeContractLayoutKey(layoutKey)) return true;
    if (!isTexasContractState(args.state)) return false;
    const profile = args.profile;
    const allianceFunder =
        (profile && isAllianceFunderProfile(profile)) ||
        (args.funderName &&
            isAllianceFunderProfile({
                name: args.funderName,
                mainContractLayoutKey: layoutKey,
            }));
    if (!allianceFunder) return false;
    return layoutKey.startsWith("funder_") || isAllianceBridgeContractLayoutKey(layoutKey);
}

export function formatAllianceContractMoneyValue(value: unknown): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return "";
    const formatted = formatUSD(trimmed, { fallback: "" });
    return formatted || trimmed;
}

export function formatAllianceContractWeeksLabel(weeks: number): string {
    const n = Math.max(1, Math.round(weeks));
    return `${n} ${n === 1 ? "week" : "weeks"}`;
}

/** Term length in weeks for Alliance page 1 (1 week = 5 business days for daily deals). */
export function resolveAllianceContractTermWeeks(args: {
    frequency?: string | null;
    numberOfPayments?: unknown;
}): number | null {
    const freqKey = normalizeDisclosureTemplateFrequencyKey(String(args.frequency ?? ""));
    const paymentsRaw = args.numberOfPayments;
    const payments =
        Math.max(
            1,
            Math.trunc(parseMoneyInput(paymentsRaw) ?? 0) ||
                Math.trunc(Number(String(paymentsRaw ?? "").replace(/[^\d]/g, "")) || 0) ||
                1,
        );

    if (freqKey === "daily") {
        return Math.max(1, Math.round(payments / 5));
    }
    if (freqKey === "weekly") {
        return payments;
    }
    if (freqKey === "biweekly") {
        return payments * 2;
    }
    if (freqKey === "monthly") {
        return payments * 4;
    }
    return payments;
}

export function resolveAllianceContractTermWeeksLabel(sources: NetToMerchantPrefillSources): string {
    const frequency =
        resolveOfferFrequencyLabel(sources) ||
        String(sources.prefill?.frequency ?? "").trim();
    const numberOfPayments =
        resolveNumberOfPaymentsPrefillValue(sources) ||
        String(
            sources.prefill?.achAuthorizationAccountHolderBankNumberOfTransactions ?? "",
        ).trim();
    const weeks = resolveAllianceContractTermWeeks({ frequency, numberOfPayments });
    if (weeks == null || !Number.isFinite(weeks)) return "";
    return formatAllianceContractWeeksLabel(weeks);
}

function resolveAllianceFinanceChargeValue(
    fieldsById: Map<string, AlliancePrefillField>,
    sources: NetToMerchantPrefillSources,
): string {
    const existing = String(fieldsById.get("finance_charge")?.value ?? "").trim();
    if (existing) return formatAllianceContractMoneyValue(existing);

    const offer =
        parseMoneyInput(fieldsById.get("purchase_amount")?.value) ??
        parseMoneyInput(sources.prefill?.purchaseAmount);
    const payback =
        parseMoneyInput(fieldsById.get("purchase_price")?.value) ??
        parseMoneyInput(sources.prefill?.purchasePrice);
    if (offer == null || payback == null || payback <= offer) return "";
    return formatAllianceContractMoneyValue(payback - offer);
}

export function applyAllianceBridgeContractPrefillToFields(
    fields: AlliancePrefillField[],
    sources: NetToMerchantPrefillSources,
): AlliancePrefillField[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const valueRecord: Record<string, string> = {};
    for (const field of fields) {
        const value = String(field.value ?? "").trim();
        if (!value) continue;
        valueRecord[field.id] = value;
        const snake = field.id
            .replace(/([a-z])([A-Z])/g, "$1_$2")
            .replace(/[\s-]+/g, "_")
            .toLowerCase();
        if (snake !== field.id) valueRecord[snake] = value;
    }
    hydrateAllianceMoneyCanonicalValues(valueRecord);
    const weeksLabel = resolveAllianceContractTermWeeksLabel(sources);
    const financeCharge = resolveAllianceFinanceChargeValue(
        new Map(
            Object.entries(valueRecord).map(([id, value]) => [
                id,
                { id, label: id, value },
            ]),
        ),
        sources,
    );
    if (financeCharge) valueRecord.finance_charge = financeCharge;

    for (const id of ALLIANCE_CONTRACT_MONEY_TAB_IDS) {
        const raw = String(valueRecord[id] ?? "").trim();
        if (!raw) continue;
        valueRecord[id] = formatAllianceContractMoneyValue(raw);
    }
    propagateAllianceMoneyFormattedValues(valueRecord);

    const updated = fields.map((field) => {
        const moneyKey = normalizeAllianceMoneyFieldKey(field.id);
        if (moneyKey) {
            const value = String(valueRecord[moneyKey] ?? "").trim();
            return value ? { ...field, value } : field;
        }
        if (field.id === "addendum_dated" && weeksLabel) {
            return { ...field, label: "Term (weeks)", value: weeksLabel };
        }
        return field;
    });

    if (financeCharge && !byId.has("finance_charge") && !updated.some((f) => f.id === "finance_charge")) {
        updated.push({
            id: "finance_charge",
            label: "Finance Charge",
            value: financeCharge,
        });
    }

    return applyAllianceBridgeExhibitPrefillToFields(
        applyAllianceBridgeAddressPrefillToFields(updated),
    );
}

export function applyAllianceBridgeContractPrefillToPayload(
    payload: Array<{ id: string; value: string }>,
    sources: NetToMerchantPrefillSources,
): Array<{ id: string; value: string }> {
    const fields = applyAllianceBridgeContractPrefillToFields(
        payload.map((row) => ({
            id: row.id,
            label: row.id,
            value: row.value,
        })),
        sources,
    );
    const byId = new Map(payload.map((row) => [row.id, row]));
    for (const field of fields) {
        const value = String(field.value ?? "").trim();
        if (!value) continue;
        byId.set(field.id, { id: field.id, value });
    }
    const orderedIds = [
        ...payload.map((row) => row.id),
        ...fields.map((field) => field.id).filter((id) => !payload.some((row) => row.id === id)),
    ];
    const seen = new Set<string>();
    const out: Array<{ id: string; value: string }> = [];
    for (const id of orderedIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const row = byId.get(id);
        if (row?.value?.trim()) out.push(row);
    }
    return out;
}
