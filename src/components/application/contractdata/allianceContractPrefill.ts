import { formatUSD, parseMoneyInput } from "@/utils/formatCurrency";
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

export function formatAllianceContractMoneyValue(value: unknown): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return "";
    return formatUSD(trimmed, { fallback: trimmed });
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
    const weeksLabel = resolveAllianceContractTermWeeksLabel(sources);
    const financeCharge = resolveAllianceFinanceChargeValue(byId, sources);

    const updated = fields.map((field) => {
        if (ALLIANCE_CONTRACT_MONEY_TAB_IDS.has(field.id)) {
            return { ...field, value: formatAllianceContractMoneyValue(field.value) };
        }
        if (field.id === "finance_charge") {
            const value = financeCharge || formatAllianceContractMoneyValue(field.value);
            return value ? { ...field, value } : field;
        }
        if (field.id === "addendum_dated" && weeksLabel) {
            return { ...field, label: "Term (weeks)", value: weeksLabel };
        }
        return field;
    });

    if (financeCharge && !byId.has("finance_charge")) {
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
