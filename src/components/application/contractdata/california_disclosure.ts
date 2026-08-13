import type { ContractPrefillField } from "./Contract";
import { PLATFORM_DISCLOSURE_FUNDER_NAME } from "./platformDocumentConfig";

/** BoldSign merge `roles[].formFields` row (camelCase; server normalizes to PascalCase). */
export type CaliforniaDisclosureMergeRoleFormField = {
    id: string;
    name?: string;
    fieldType: string;
    pageNumber: number;
    bounds: { x: number; y: number; width: number; height: number };
    value?: string;
    roleIndex?: number;
};

const textField = (
    id: string,
    pageNumber: number,
    x: number,
    y: number,
    width = 120,
): CaliforniaDisclosureMergeRoleFormField => ({
    id,
    name: id,
    fieldType: "TextBox",
    pageNumber,
    bounds: { x, y, width, height: 22 },
});

const signatureField = (
    id: string,
    pageNumber: number,
    x: number,
    y: number,
): CaliforniaDisclosureMergeRoleFormField => ({
    id,
    name: id,
    fieldType: "Signature",
    pageNumber,
    bounds: { x, y, width: 200, height: 34 },
});

const dateField = (
    id: string,
    pageNumber: number,
    x: number,
    y: number,
): CaliforniaDisclosureMergeRoleFormField => ({
    id,
    name: id,
    fieldType: "TextBox",
    pageNumber,
    bounds: { x, y, width: 120, height: 22 },
});

/** California daily disclosure PDF field coordinates (NO REFI default). */
export const californiaDisclosureMergeRoleFormFields: CaliforniaDisclosureMergeRoleFormField[] =
    [
        textField("funding_provided", 1, 188, 124),
        textField("funding_provided_direct", 1, 345, 149),
        textField("estimated_annual_percentage_rate", 1, 185, 292, 70),
        textField("avarage_monthly_income", 1, 293, 348),
        textField("finance_charge", 1, 187, 444),
        textField("payment_total", 1, 187, 497),
        textField("estimated_monthly_cost", 1, 189, 529),
        textField("estimated_payment", 1, 188, 583),
        textField("estimated_payment", 1, 312, 676),
        textField("payement_exceeded_percent", 1, 439, 676, 40),
        textField("monthly_income", 1, 411, 688),
        textField("payement_exceeded_percent", 2, 184, 160, 40),
        textField("estimated_term", 2, 184, 349, 60),
        textField("avarage_monthly_income", 2, 350, 402),
        textField("finance_charge", 2, 371, 437),
        signatureField("Signature1", 2, 72, 544),
        dateField("signature_date", 2, 252, 544),
        textField("disclosure_recipient_funds", 3, 445, 118),
        textField("disclosure_page3_line_1", 3, 446, 145),
        textField("disclosure_page3_subtotal", 3, 445, 174),
        textField("disclosure_broker_fee", 3, 447, 202),
        textField("disclosure_page3_net", 3, 444, 229),
    ];

/** California weekly disclosure PDF field coordinates (NO REFI default). */
export const weeklyCaliforniaDisclosureMergeRoleFormFields: CaliforniaDisclosureMergeRoleFormField[] =
    [
        textField("funding_provided", 1, 190, 146),
        textField("funding_provided_direct", 1, 443, 123),
        textField("estimated_annual_percentage_rate", 1, 183, 289, 70),
        textField("avarage_monthly_income", 1, 310, 342),
        textField("finance_charge", 1, 186, 448),
        textField("payment_total", 1, 188, 498),
        textField("estimated_monthly_cost", 1, 190, 533),
        textField("estimated_payment", 1, 181, 587),
        textField("estimated_payment", 2, 305, 103),
        textField("payement_exceeded_percent", 2, 462, 103, 40),
        textField("monthly_income", 2, 442, 114),
        textField("payement_exceeded_percent", 2, 184, 172, 40),
        textField("estimated_term", 2, 181, 360, 80),
        textField("avarage_monthly_income", 2, 346, 402),
        textField("finance_charge", 2, 369, 437),
        signatureField("Signature1", 2, 72, 544),
        dateField("signature_date", 2, 252, 544),
        textField("disclosure_recipient_funds", 3, 447, 116),
        textField("disclosure_page3_line_1", 3, 446, 145),
        textField("disclosure_page3_subtotal", 3, 446, 172),
        textField("disclosure_broker_fee", 3, 445, 201),
        textField("disclosure_page3_net", 3, 446, 227),
    ];

export function californiaDisclosureMergeRoleFormFieldsForRole(
    roleIndex: number,
): Array<CaliforniaDisclosureMergeRoleFormField & { roleIndex: number }> {
    return californiaDisclosureMergeRoleFormFields.map((field) => ({
        ...field,
        roleIndex,
    }));
}

export function weeklyCaliforniaDisclosureMergeRoleFormFieldsForRole(
    roleIndex: number,
): Array<CaliforniaDisclosureMergeRoleFormField & { roleIndex: number }> {
    return weeklyCaliforniaDisclosureMergeRoleFormFields.map((field) => ({
        ...field,
        roleIndex,
    }));
}

export interface CaliforniaDisclosureContractPrefillFields {
    fundingProvided?: string;
    /** CA REFI right-side “provided to you directly” (actual disbursement). */
    fundingProvidedDirect?: string;
    /** Previous deal date for REFI “agreement with us dated ___”. */
    previousAgreementDate?: string;
    estimatedAnnualPercentageRate?: string;
    estimatedPayment?: string;
    estimatedMonthlyCost?: string;
    paymentTotal?: string;
    estimatedTerm?: string;
    avarageMonthlyIncome?: string;
    payementExceededPercent?: string;
    monthlyIncome?: string;
    financeCharge?: string;
    funderName?: string;
    recipientName?: string;
    recipientFunds?: string;
    brokerFee?: string;
    page3Line1?: string;
    page3Line2?: string;
    page3Subtotal?: string;
    page3Net?: string;
    signatureDate?: string;
}

const FIELD_IDS = {
    fundingProvided: ["funding_provided"],
    fundingProvidedDirect: ["funding_provided_direct"],
    previousAgreementDate: ["previous_agreement_date", "previous_deal_date"],
    estimatedAnnualPercentageRate: ["estimated_annual_percentage_rate"],
    estimatedPayment: ["estimated_payment"],
    estimatedMonthlyCost: ["estimated_monthly_cost"],
    paymentTotal: ["payment_total"],
    estimatedTerm: ["estimated_term", "disclosure_term_days"],
    avarageMonthlyIncome: ["avarage_monthly_income"],
    payementExceededPercent: ["payement_exceeded_percent"],
    monthlyIncome: ["monthly_income"],
    financeCharge: ["finance_charge"],
    funderName: ["funder_name"],
    recipientName: ["client_name", "disclosure_merchant_name"],
    recipientFunds: ["disclosure_recipient_funds"],
    brokerFee: ["disclosure_broker_fee"],
    page3Line1: ["disclosure_page3_line_1"],
    page3Line2: ["disclosure_page3_line_2"],
    page3Subtotal: ["disclosure_page3_subtotal"],
    page3Net: ["disclosure_page3_net"],
    signatureDate: ["signature_date"],
} as const;

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim().toUpperCase();
    if (!trimmed) return [];
    return ids.map((id) => ({ id, label, value: trimmed }));
};

export function buildCaliforniaDisclosureContractPrefillFields({
    fundingProvided = "",
    fundingProvidedDirect = "",
    previousAgreementDate = "",
    estimatedAnnualPercentageRate = "",
    estimatedPayment = "",
    estimatedMonthlyCost = "",
    paymentTotal = "",
    estimatedTerm = "",
    avarageMonthlyIncome = "",
    payementExceededPercent = "",
    monthlyIncome = "",
    financeCharge = "",
    funderName = PLATFORM_DISCLOSURE_FUNDER_NAME.toUpperCase(),
    recipientName = "",
    recipientFunds = "",
    brokerFee = "",
    page3Line1 = "",
    page3Line2 = "",
    page3Subtotal = "",
    page3Net = "",
    signatureDate = "",
}: CaliforniaDisclosureContractPrefillFields = {}): ContractPrefillField[] {
    const direct =
        String(fundingProvidedDirect || "").trim() || String(fundingProvided || "").trim();
    return [
        ...mapIds(FIELD_IDS.fundingProvided, "Funding Provided", fundingProvided),
        ...mapIds(FIELD_IDS.fundingProvidedDirect, "Funding Provided Direct", direct),
        ...mapIds(
            FIELD_IDS.previousAgreementDate,
            "Previous Agreement Date",
            previousAgreementDate,
        ),
        ...mapIds(
            FIELD_IDS.estimatedAnnualPercentageRate,
            "Estimated Annual Percentage Rate",
            estimatedAnnualPercentageRate,
        ),
        ...mapIds(FIELD_IDS.estimatedPayment, "Estimated Payment", estimatedPayment),
        ...mapIds(FIELD_IDS.estimatedMonthlyCost, "Estimated Monthly Cost", estimatedMonthlyCost),
        ...mapIds(FIELD_IDS.paymentTotal, "Payment Total", paymentTotal),
        ...mapIds(FIELD_IDS.estimatedTerm, "Estimated Term", estimatedTerm),
        ...mapIds(FIELD_IDS.avarageMonthlyIncome, "Average Monthly Income", avarageMonthlyIncome),
        ...mapIds(
            FIELD_IDS.payementExceededPercent,
            "Payment Exceeded Percent",
            payementExceededPercent,
        ),
        ...mapIds(FIELD_IDS.monthlyIncome, "Monthly Income", monthlyIncome),
        ...mapIds(FIELD_IDS.financeCharge, "Finance Charge", financeCharge),
        ...mapIds(FIELD_IDS.funderName, "Funder Name", funderName),
        ...mapIds(FIELD_IDS.recipientName, "Merchant Name", recipientName),
        ...mapIds(FIELD_IDS.recipientFunds, "Recipient Funds", recipientFunds),
        ...mapIds(FIELD_IDS.brokerFee, "Broker Fee", brokerFee),
        ...mapIds(FIELD_IDS.page3Line1, "Page 3 Line 1", page3Line1),
        ...mapIds(FIELD_IDS.page3Line2, "Page 3 Line 2", page3Line2),
        ...mapIds(FIELD_IDS.page3Subtotal, "Page 3 Subtotal", page3Subtotal),
        ...mapIds(FIELD_IDS.page3Net, "Page 3 Net", page3Net),
        ...mapIds(FIELD_IDS.signatureDate, "Signature Date", signatureDate),
    ];
}

function parseMoney(value: string | undefined): number {
    const n = Number.parseFloat(String(value ?? "").replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

function formatUsdAmount(amount: number): string {
    return amount.toFixed(2);
}

/** Guide CA/NY: estimated term is always calendar days (weekly or daily weeks × 7). */
export function resolveCaliforniaEstimatedTermDays(args: {
    estimatedTermDays?: string;
    estimatedNumberOfPayments?: string;
    frequency?: string | null;
}): string {
    const fromDays = String(args.estimatedTermDays ?? "").trim();
    if (fromDays) return fromDays;

    const periods = Number.parseInt(String(args.estimatedNumberOfPayments ?? "").trim(), 10);
    if (!(periods > 0) || periods >= 40) return "";

    const frequency = String(args.frequency ?? "")
        .trim()
        .toLowerCase();
    const isWeekly = frequency.startsWith("week");
    /** Note: "daily".startsWith("day") is false — match "daily" explicitly. */
    const isDaily = frequency.startsWith("daily") || frequency === "day";
    if (isWeekly || isDaily || !frequency) {
        return String(periods * 7);
    }
    return "";
}

/**
 * California / NY-style page 3 amounts:
 *   No-Refi: subtotal = recipient_funds + line_1 + line_2; net = subtotal − broker_fee
 *   REFI:    1=actual disbursement, 2=origination, 3=refi balance → subtotal=1+2+3; net=subtotal−origination
 */
export function buildCaliforniaDisclosurePage3Amounts(args: {
    recipientFunds?: string;
    page3Line1?: string;
    page3Line2?: string;
    brokerFee?: string;
    isRefinance?: boolean;
}): {
    page3Line1: string;
    page3Line2: string;
    page3Subtotal: string;
    page3Net: string;
} {
    const recipient = parseMoney(args.recipientFunds);
    const line1 = parseMoney(args.page3Line1);
    const line2 = parseMoney(args.page3Line2);
    const broker = parseMoney(args.brokerFee);
    const subtotal = recipient + line1 + line2;
    const net = Math.max(0, subtotal - broker);
    return {
        page3Line1: formatUsdAmount(line1),
        page3Line2: formatUsdAmount(line2),
        page3Subtotal: formatUsdAmount(subtotal),
        page3Net: formatUsdAmount(net),
    };
}

/** REFI page-3 itemization values from normalized REFI money fields. */
export function buildCaliforniaRefinancePage3Amounts(args: {
    actualDisbursement: number;
    originationFee: number;
    previousRefiBalance: number;
}): {
    recipientFunds: string;
    page3Line1: string;
    page3Line2: string;
    page3Subtotal: string;
    page3Net: string;
    brokerFee: string;
} {
    const netAmount = Math.max(0, args.actualDisbursement);
    const origination = Math.max(0, args.originationFee);
    const refiBalance = Math.max(0, args.previousRefiBalance);
    const subtotal = netAmount + origination + refiBalance;
    const net = Math.max(0, subtotal - origination);
    return {
        recipientFunds: formatUsdAmount(netAmount),
        page3Line1: formatUsdAmount(origination),
        page3Line2: formatUsdAmount(refiBalance),
        page3Subtotal: formatUsdAmount(subtotal),
        page3Net: formatUsdAmount(net),
        brokerFee: formatUsdAmount(origination),
    };
}

export function isCaliforniaDisclosureState(state: string | null | undefined): boolean {
    const key = String(state ?? "")
        .trim()
        .toLowerCase();
    return key === "california" || key === "ca";
}
