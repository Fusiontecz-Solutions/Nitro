import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ContractPrefillField } from "./Contract";
import {
    FLEX_INSTALLMENT_COLUMNS,
    FLEX_INSTALLMENT_FIELD_RE,
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
 * in three equal columns, one installment per row. Layout only — field ids and
 * values are the same ones the flat grid used.
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
    for (const row of rows) {
        const m = String(row.id).match(FLEX_INSTALLMENT_FIELD_RE);
        if (!m) continue;
        const n = Number(m[2]);
        if (!byInstallment.has(n)) byInstallment.set(n, new Map());
        byInstallment.get(n)!.set(m[1], row);
    }
    const installments = [...byInstallment.keys()].sort((a, b) => a - b);
    if (installments.length === 0) return null;

    return (
        <div className="space-y-2">
            <div className="hidden grid-cols-3 gap-3 sm:grid" aria-hidden>
                {FLEX_INSTALLMENT_COLUMNS.map((col) => (
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
                    <div key={n} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        {FLEX_INSTALLMENT_COLUMNS.map((col) => {
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
                                        {col.kind === "installment_day" ? (
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
                                                col.kind === "installment_day" ? "pl-8" : ""
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
