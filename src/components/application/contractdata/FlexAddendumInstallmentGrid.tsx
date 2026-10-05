import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ContractPrefillField } from "./Contract";
import {
    FLEX_INSTALLMENT_COLUMNS,
    matchFlexInstallmentFieldId,
    TIBERIAN_FLEX_INSTALLMENT_COLUMNS,
} from "./flexAddendumInstallmentRows";

type FlexAddendumInstallmentGridProps = {
    rows: readonly ContractPrefillField[];
    values: Record<string, string>;
    onChange: (id: string, value: string) => void;
    /** Prefix for input ids (keeps `htmlFor` unique per editor). */
    idPrefix: string;
    disabled?: boolean;
    inputClassName?: string;
};

/**
 * Flex Addendum prefill: Installment Date | Repayment Amount | Receivable Purchased
 * in three equal columns, one installment per row (Tiberian's copy adds a fourth,
 * Net Funds Provided). Layout only — field ids and values are the same ones the
 * flat grid used.
 */
export function FlexAddendumInstallmentGrid({
    rows,
    values,
    onChange,
    idPrefix,
    disabled = false,
    inputClassName,
}: FlexAddendumInstallmentGridProps) {
    const byInstallment = new Map<number, Map<string, ContractPrefillField>>();
    let tiberian = false;
    for (const row of rows) {
        const m = matchFlexInstallmentFieldId(row.id);
        if (!m) continue;
        if (m.tiberian) tiberian = true;
        if (!byInstallment.has(m.installment)) byInstallment.set(m.installment, new Map());
        byInstallment.get(m.installment)!.set(m.kind, row);
    }
    const installments = [...byInstallment.keys()].sort((a, b) => a - b);
    if (installments.length === 0) return null;
    const columns = tiberian ? TIBERIAN_FLEX_INSTALLMENT_COLUMNS : FLEX_INSTALLMENT_COLUMNS;
    const gridCols = tiberian ? "sm:grid-cols-4" : "sm:grid-cols-3";

    return (
        <div className="space-y-2">
            <div
                className={`hidden gap-3 sm:grid ${tiberian ? "grid-cols-4" : "grid-cols-3"}`}
                aria-hidden
            >
                {columns.map((col) => (
                    <p
                        key={col.kind}
                        className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase"
                    >
                        {col.title}
                    </p>
                ))}
            </div>
            {installments.map((n) => {
                const cells = byInstallment.get(n)!;
                return (
                    <div key={n} className={`grid grid-cols-1 gap-3 ${gridCols}`}>
                        {columns.map((col) => {
                            const row = cells.get(col.kind);
                            if (!row) return <div key={col.kind} aria-hidden />;
                            const inputId = `${idPrefix}${row.id}`;
                            return (
                                <div key={col.kind} className="relative space-y-1.5 sm:space-y-0">
                                    <Label
                                        htmlFor={inputId}
                                        className="text-xs font-medium sm:sr-only"
                                    >
                                        {`Installment ${n} — ${col.title}`}
                                    </Label>
                                    <div className="relative">
                                        {col.isDate ? (
                                            <span
                                                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[11px] font-semibold tabular-nums"
                                                aria-hidden
                                            >
                                                {n}.
                                            </span>
                                        ) : null}
                                        <Input
                                            id={inputId}
                                            value={values[row.id] ?? ""}
                                            onChange={(e) => onChange(String(row.id), e.target.value)}
                                            disabled={disabled}
                                            className={`${inputClassName ?? ""} ${
                                                col.isDate ? "pl-8" : ""
                                            }`.trim()}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
