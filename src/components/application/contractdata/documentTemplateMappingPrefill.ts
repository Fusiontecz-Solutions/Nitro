import type { ContractPrefillField } from "./Contract";
import {
    buildBalanceTransferSheetContractPrefillFields,
    type BalanceTransferSheetContractPrefillFields,
} from "./BALANCE_TRANSFER_SHEET_ADDENDUM";
import {
    buildBarclaysBuyoutBlankAddendumContractPrefillFields,
    type BarclaysBuyoutBlankAddendumContractPrefillFields,
} from "./Barclays_buyout_blank_ADDENDUM";
import {
    buildBarclaysFlexAddendumContractPrefillFields,
    type BarclaysFlexAddendumContractPrefillFields,
} from "./BARCLAYS_FLEX_ADDENDUM";
import {
    buildDiscoverAdvanceEpoAddendumContractPrefillFields,
    type DiscoverAdvanceEpoAddendumContractPrefillFields,
} from "./Discover_Advance_EPO_ADDENDUM";
import {
    buildDiscoverRefiBalanceTransferAddendumContractPrefillFields,
    type DiscoverRefiBalanceTransferAddendumContractPrefillFields,
} from "./DISCOVER_REFI_BALANCE_TRANSFER_ADDENDUM";
import {
    buildStateDisclosurePrefillContextFromContract,
    getStateDisclosurePrefillFieldsByName,
    getStateDisclosurePrefillFieldsByStateFrequency,
    type StateDisclosureContext,
} from "./stateDisclosurePrefill";

/** Stored on `Contract.contractPrefillOverrides` alongside main prefill keys. */
export const DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY = "documentTemplatePrefillByMappingId";

const DUMMY = ".";

function str(v: unknown): string {
    return String(v ?? "").trim();
}

function normalizeKey(value: string | null | undefined): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_");
}

function disclosureDummyContext(): StateDisclosureContext {
    const d = (): string => DUMMY;
    return {
        fundingProvided: d(),
        fundingDisbursed: d(),
        feesDeducted: d(),
        totalRepayment: d(),
        totalDollarCost: d(),
        financeCharge: d(),
        estimatedPayment: d(),
        estimatedAnnualPercentageRate: d(),
        averageMonthlyIncome: d(),
        paymentExceededPercent: d(),
        estimatedTerm: d(),
        estimatedNumberOfPayments: d(),
        prepayment: d(),
        recipientName: d(),
        recipientAddress: d(),
        signatureDate: d(),
        prepaymentReceivedByDate: d(),
        prepaymentDiscountAmount: d(),
    };
}

function mergeFieldRows(
    allDefs: ContractPrefillField[],
    computed: ContractPrefillField[],
    savedForRow: Record<string, string> | null | undefined,
): ContractPrefillField[] {
    const computedById = new Map(computed.map((f) => [f.id, f]));
    const saved = savedForRow ?? {};
    return allDefs.map((def) => {
        const fromSaved = saved[def.id];
        if (fromSaved !== undefined) {
            return { id: def.id, label: def.label, value: String(fromSaved) };
        }
        return {
            id: def.id,
            label: def.label,
            value: computedById.get(def.id)?.value ?? "",
        };
    });
}

function stateDisclosureAllDefs(
    name: string | null | undefined,
    state: string | null | undefined,
    frequency: string | null | undefined,
): ContractPrefillField[] {
    const dummy = disclosureDummyContext();
    const byName = getStateDisclosurePrefillFieldsByName(name, dummy);
    if (byName.length > 0) return byName;
    return getStateDisclosurePrefillFieldsByStateFrequency({
        state,
        frequency,
        context: dummy,
    });
}

function stateDisclosureComputed(
    name: string | null | undefined,
    state: string | null | undefined,
    frequency: string | null | undefined,
    context: StateDisclosureContext,
): ContractPrefillField[] {
    const byName = getStateDisclosurePrefillFieldsByName(name, context);
    if (byName.length > 0) return byName;
    return getStateDisclosurePrefillFieldsByStateFrequency({
        state,
        frequency,
        context,
    });
}

function dotBalanceTransfer(): BalanceTransferSheetContractPrefillFields {
    return {
        clientName: DUMMY,
        businessName: DUMMY,
        clientDba: DUMMY,
        physicalAddress: DUMMY,
        date: DUMMY,
        clientNameBy: DUMMY,
        clientLegalName: DUMMY,
    };
}

function buildBalanceTransferComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
): ContractPrefillField[] {
    const c = contract ?? {};
    const line = [str(c.businessAddress), str(c.businessAddressCity), str(c.businessAddressState), str(c.businessAddressZip)]
        .filter(Boolean)
        .join(", ");
    return buildBalanceTransferSheetContractPrefillFields({
        clientName: str(c.clientName) || sctx.recipientName,
        businessName: str(c.legalName) || str(c.customerName),
        clientDba: str(c.doingBusinessAs) || str(c.dba),
        physicalAddress: line || sctx.recipientAddress,
        date: sctx.signatureDate,
        clientNameBy: str(c.clientName) || sctx.recipientName,
        clientLegalName: str(c.legalName) || str(c.customerName) || sctx.recipientName,
    });
}

function buildBarclaysBuyoutComputed(
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
): ContractPrefillField[] {
    const c = contract ?? {};
    return buildBarclaysBuyoutBlankAddendumContractPrefillFields({
        addendumEnteredDate: sctx.signatureDate,
        addendumAgreementDate: sctx.signatureDate,
        clientName: sctx.recipientName,
        agreeName: sctx.recipientName,
        advanceRemit: sctx.estimatedPayment,
        agreementTo: str(c.authorizationApplication),
        amountOfDirecltyDisbursed: sctx.fundingDisbursed,
        transferFundTo: "",
        nameOfBank: str(c.authorizationClientBankName),
        abaRouting: str(c.authorizationClientBankRouting),
        checkingAccount: str(c.authorizationClientBankAccount),
        transferAmount: sctx.totalRepayment,
        ownerName: sctx.recipientName,
    });
}

function dotBarclaysBuyout(): BarclaysBuyoutBlankAddendumContractPrefillFields {
    return {
        addendumEnteredDate: DUMMY,
        addendumAgreementDate: DUMMY,
        clientName: DUMMY,
        agreeName: DUMMY,
        advanceRemit: DUMMY,
        agreementTo: DUMMY,
        amountOfDirecltyDisbursed: DUMMY,
        transferFundTo: DUMMY,
        nameOfBank: DUMMY,
        abaRouting: DUMMY,
        checkingAccount: DUMMY,
        transferAmount: DUMMY,
        ownerName: DUMMY,
    };
}

function buildBarclaysFlexComputed(contract: Record<string, unknown> | null, sctx: StateDisclosureContext): ContractPrefillField[] {
    const c = contract ?? {};
    return buildBarclaysFlexAddendumContractPrefillFields({
        addendumDated: sctx.signatureDate,
        agreementDate: sctx.signatureDate,
        clientNameAddendum: str(c.legalName) || sctx.recipientName,
        clientName: str(c.clientName) || sctx.recipientName,
    });
}

function dotBarclaysFlex(): BarclaysFlexAddendumContractPrefillFields {
    return {
        addendumDated: DUMMY,
        agreementDate: DUMMY,
        clientNameAddendum: DUMMY,
        clientName: DUMMY,
    };
}

function buildDiscoverEpoComputed(contract: Record<string, unknown> | null, sctx: StateDisclosureContext): ContractPrefillField[] {
    const c = contract ?? {};
    const offer = (c.offer ?? null) as Record<string, unknown> | null;
    const payFmt = (n: number) =>
        new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
    let p60 = "";
    let p90 = "";
    let p120 = "";
    const total = Number(c.purchasePrice ?? offer?.totalRemit ?? offer?.paybackAmount);
    if (Number.isFinite(total)) {
        p60 = payFmt(total * (60 / 100));
        p90 = payFmt(total * (90 / 100));
        p120 = payFmt(total * (120 / 100));
    }
    return buildDiscoverAdvanceEpoAddendumContractPrefillFields({
        loanAgreementDated: sctx.signatureDate,
        borrowerName: sctx.recipientName,
        payingToDiscoverAgent60: p60,
        payingToDiscoverAgent90: p90,
        payingToDiscoverAgent120: p120,
        printBorrowerName1: str(c.clientName) || sctx.recipientName,
        printBorrowerTitle1: str(c["ownerTitle"]),
        printBorrowerName2: str(c["owner1GuarantorName"]),
        printBorrowerTitle2: "",
    });
}

function dotDiscoverEpo(): DiscoverAdvanceEpoAddendumContractPrefillFields {
    return {
        loanAgreementDated: DUMMY,
        borrowerName: DUMMY,
        payingToDiscoverAgent60: DUMMY,
        payingToDiscoverAgent90: DUMMY,
        payingToDiscoverAgent120: DUMMY,
        printBorrowerName1: DUMMY,
        printBorrowerTitle1: DUMMY,
        printBorrowerName2: DUMMY,
        printBorrowerTitle2: DUMMY,
    };
}

function buildDiscoverRefiComputed(contract: Record<string, unknown> | null, sctx: StateDisclosureContext): ContractPrefillField[] {
    const c = contract ?? {};
    return buildDiscoverRefiBalanceTransferAddendumContractPrefillFields({
        loanAgreementDated: sctx.signatureDate,
        borrowerName: sctx.recipientName,
        borrowerPay: sctx.estimatedPayment,
        financialDate: sctx.signatureDate,
        previousFinancingDirectlyTo: "",
        borrowerName1: str(c.clientName) || sctx.recipientName,
        borrowerTitle1: str(c["ownerTitle"]),
    });
}

function dotDiscoverRefi(): DiscoverRefiBalanceTransferAddendumContractPrefillFields {
    return {
        loanAgreementDated: DUMMY,
        borrowerName: DUMMY,
        borrowerPay: DUMMY,
        financialDate: DUMMY,
        previousFinancingDirectlyTo: DUMMY,
        borrowerName1: DUMMY,
        borrowerTitle1: DUMMY,
    };
}

function matches(norm: string, ...needles: string[]): boolean {
    return needles.every((n) => norm.includes(n));
}

type AddendumKind =
    | "balance_transfer_sheet"
    | "barclays_buyout_blank"
    | "barclays_flex"
    | "discover_epo"
    | "discover_refi_balance";

function resolveAddendumKind(normName: string): AddendumKind | null {
    if (matches(normName, "balance", "transfer") && normName.includes("sheet")) return "balance_transfer_sheet";
    if (normName.includes("buyout") && normName.includes("blank")) return "barclays_buyout_blank";
    if (normName.includes("barclays") && normName.includes("flex")) return "barclays_flex";
    if (normName.includes("discover") && normName.includes("epo")) return "discover_epo";
    if (normName.includes("discover") && (normName.includes("refi") || normName.includes("balance_transfer")))
        return "discover_refi_balance";
    return null;
}

function addendumAllDefs(kind: AddendumKind): ContractPrefillField[] {
    switch (kind) {
        case "balance_transfer_sheet":
            return buildBalanceTransferSheetContractPrefillFields(dotBalanceTransfer());
        case "barclays_buyout_blank":
            return buildBarclaysBuyoutBlankAddendumContractPrefillFields(dotBarclaysBuyout());
        case "barclays_flex":
            return buildBarclaysFlexAddendumContractPrefillFields(dotBarclaysFlex());
        case "discover_epo":
            return buildDiscoverAdvanceEpoAddendumContractPrefillFields(dotDiscoverEpo());
        case "discover_refi_balance":
            return buildDiscoverRefiBalanceTransferAddendumContractPrefillFields(dotDiscoverRefi());
        default:
            return [];
    }
}

function addendumComputed(
    kind: AddendumKind,
    contract: Record<string, unknown> | null,
    sctx: StateDisclosureContext,
): ContractPrefillField[] {
    switch (kind) {
        case "balance_transfer_sheet":
            return buildBalanceTransferComputed(contract, sctx);
        case "barclays_buyout_blank":
            return buildBarclaysBuyoutComputed(contract, sctx);
        case "barclays_flex":
            return buildBarclaysFlexComputed(contract, sctx);
        case "discover_epo":
            return buildDiscoverEpoComputed(contract, sctx);
        case "discover_refi_balance":
            return buildDiscoverRefiComputed(contract, sctx);
        default:
            return [];
    }
}

export function parseDocumentTemplatePrefillByMappingId(raw: unknown): Record<string, Record<string, string>> {
    if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
    const blob = (raw as Record<string, unknown>)[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
    if (blob == null || typeof blob !== "object" || Array.isArray(blob)) return {};
    const out: Record<string, Record<string, string>> = {};
    for (const [mappingId, row] of Object.entries(blob)) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const inner: Record<string, string> = {};
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
            inner[k] = String(v ?? "");
        }
        out[mappingId] = inner;
    }
    return out;
}

/**
 * Rows for the template-mapping editor: every BoldSign field id for this template, labels from builders,
 * values from CRM-derived defaults merged with optional saved overrides for this mapping row.
 */
export function getDocumentTemplatePrefillFieldRowsForEditor(options: {
    templateName?: string | null;
    templateState?: string | null;
    templateFrequency?: string | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    agreementDate?: string;
    savedOverridesForMapping?: Record<string, string> | null;
}): ContractPrefillField[] {
    const sctx = buildStateDisclosurePrefillContextFromContract({
        contract: options.contract ?? null,
        application: options.application ?? null,
        agreementDate: options.agreementDate,
    });

    const name = options.templateName;
    const state = options.templateState;
    const frequency = options.templateFrequency;

    const stAll = stateDisclosureAllDefs(name, state, frequency);
    if (stAll.length > 0) {
        const computed = stateDisclosureComputed(name, state, frequency, sctx);
        return mergeFieldRows(stAll, computed, options.savedOverridesForMapping);
    }

    const norm = normalizeKey(name ?? "");
    const addendum = resolveAddendumKind(norm);
    if (addendum) {
        const all = addendumAllDefs(addendum);
        const computed = addendumComputed(addendum, options.contract ?? null, sctx);
        return mergeFieldRows(all, computed, options.savedOverridesForMapping);
    }

    return [];
}

export function applyDocumentTemplateMappingPrefillOverrides(args: {
    prefillFieldsPayload: Array<{ id: string; value: string }>;
    mergedTemplateIds: string[];
    templateMappingRows: Array<{ id: string; template?: { templateId?: string } | null }>;
    contractPrefillOverridesRaw: unknown;
}): Array<{ id: string; value: string }> {
    const blob = parseDocumentTemplatePrefillByMappingId(args.contractPrefillOverridesRaw);
    const mergedSet = new Set(args.mergedTemplateIds.map((x) => String(x).trim()).filter(Boolean));
    const byId = new Map(args.prefillFieldsPayload.map((f) => [f.id, { ...f }]));

    for (const row of args.templateMappingRows) {
        const tid = String(row.template?.templateId ?? "").trim();
        if (!tid || !mergedSet.has(tid)) continue;
        const perMap = blob[row.id];
        if (!perMap) continue;
        for (const [fieldId, val] of Object.entries(perMap)) {
            const v = String(val ?? "").trim();
            if (!v) continue;
            byId.set(fieldId, { id: fieldId, value: v });
        }
    }
    return Array.from(byId.values());
}
