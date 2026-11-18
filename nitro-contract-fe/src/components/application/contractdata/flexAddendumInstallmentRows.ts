/**
 * Flex Addendum installment table widgets.
 *
 * Nitro copy: `installment_day_N_p1` / `daily_payment_N_p1` / `receivable_purchase_N_p1`.
 * Tiberian copy: `payment_date_N` / `net_funds_provided_N` / `payment_amount_N` /
 * `receivables_purchased_N` — an extra "Net Funds Provided" column, no `_p1` suffix.
 */
export const FLEX_INSTALLMENT_FIELD_RE =
    /^(installment_day|daily_payment|receivable_purchase)_(\d+)_p1$/;

export const TIBERIAN_FLEX_INSTALLMENT_FIELD_RE =
    /^(payment_date|net_funds_provided|payment_amount|receivables_purchased)_(\d+)$/;

export type FlexInstallmentColumn = {
    kind: string;
    title: string;
    /** The column that carries the row number badge. */
    isDate?: boolean;
};

export const FLEX_INSTALLMENT_COLUMNS: readonly FlexInstallmentColumn[] = [
    { kind: "installment_day", title: "Installment Date", isDate: true },
    { kind: "daily_payment", title: "Repayment Amount" },
    { kind: "receivable_purchase", title: "Receivable Purchased" },
];

/**
 * Left-to-right order of the Tiberian PDF's printed headers. The template's
 * widget names are swapped against its own headers: `net_funds_provided_N`
 * sits under "Payment Amount" and `payment_amount_N` under "Net Funds
 * Provided", so each column is bound to the widget printed beneath it.
 */
export const TIBERIAN_FLEX_INSTALLMENT_COLUMNS: readonly FlexInstallmentColumn[] = [
    { kind: "payment_date", title: "Date", isDate: true },
    { kind: "net_funds_provided", title: "Payment Amount" },
    { kind: "payment_amount", title: "Net Funds Provided" },
    { kind: "receivables_purchased", title: "Receivables Purchased" },
];

/** `[kind, installment number]` for an installment widget, or null. */
export function matchFlexInstallmentFieldId(
    id: unknown,
): { kind: string; installment: number; tiberian: boolean } | null {
    const raw = String(id ?? "");
    const nitro = raw.match(FLEX_INSTALLMENT_FIELD_RE);
    if (nitro) return { kind: nitro[1], installment: Number(nitro[2]), tiberian: false };
    const tiberian = raw.match(TIBERIAN_FLEX_INSTALLMENT_FIELD_RE);
    if (tiberian) {
        return { kind: tiberian[1], installment: Number(tiberian[2]), tiberian: true };
    }
    return null;
}

export function isFlexInstallmentFieldId(id: unknown): boolean {
    return matchFlexInstallmentFieldId(id) !== null;
}

/** Split editor rows into the Flex installment table and everything else (order kept). */
export function splitFlexInstallmentRows<T extends { id: string }>(
    rows: readonly T[],
): { installmentRows: T[]; otherRows: T[] } {
    const installmentRows: T[] = [];
    const otherRows: T[] = [];
    for (const row of rows) {
        (isFlexInstallmentFieldId(row.id) ? installmentRows : otherRows).push(row);
    }
    return { installmentRows, otherRows };
}
