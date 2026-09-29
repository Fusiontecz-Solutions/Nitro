/** Flex Addendum installment table widgets: `installment_day_N_p1` / `daily_payment_N_p1` / `receivable_purchase_N_p1`. */
export const FLEX_INSTALLMENT_FIELD_RE =
    /^(installment_day|daily_payment|receivable_purchase)_(\d+)_p1$/;

export const FLEX_INSTALLMENT_COLUMNS = [
    { kind: "installment_day", title: "Installment Date" },
    { kind: "daily_payment", title: "Repayment Amount" },
    { kind: "receivable_purchase", title: "Receivable Purchased" },
] as const;

export function isFlexInstallmentFieldId(id: unknown): boolean {
    return FLEX_INSTALLMENT_FIELD_RE.test(String(id ?? ""));
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
