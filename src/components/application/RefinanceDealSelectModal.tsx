import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn, formatNumberUS } from "@/lib/utils";

export type ClientDealForRefinance = {
    id: string;
    applicationId?: number | string | null;
    dealId?: string | null;
    type?: string | null;
    loanAmount?: number | string | null;
    currentQueue?: string | null;
    currentState?: string | null;
    createdAt?: string | null;
    /** Sum of position MCA estimated balances (preferred REFI payoff). */
    refinanceBalance?: number;
    previousDealDate?: string;
};

type RefinanceDealSelectModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    deals: ClientDealForRefinance[];
    loading?: boolean;
    selectedDealId?: string | null;
    onSelect: (deal: ClientDealForRefinance) => void;
    clientLabel?: string;
};

function formatUsd(value: unknown): string {
    const n =
        typeof value === "number"
            ? value
            : Number(String(value ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n)) return "—";
    return `$ ${formatNumberUS(n)}`;
}

export function RefinanceDealSelectModal({
    open,
    onOpenChange,
    deals,
    loading = false,
    selectedDealId = null,
    onSelect,
    clientLabel,
}: RefinanceDealSelectModalProps) {
    const rows = useMemo(() => deals ?? [], [deals]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85vh] max-w-5xl overflow-hidden p-0 sm:max-w-5xl">
                <DialogHeader className="border-b px-5 py-4 text-left">
                    <DialogTitle>Select previous deal to refinance</DialogTitle>
                    <DialogDescription>
                        {clientLabel
                            ? `Choose a deal for ${clientLabel}. REFI amount and previous deal date are taken from the selected deal.`
                            : "Choose a prior deal. REFI amount and previous deal date are taken from the selection."}
                    </DialogDescription>
                </DialogHeader>

                <div className="max-h-[55vh] overflow-auto px-2 pb-2">
                    {loading ? (
                        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Loading client deals…
                        </div>
                    ) : rows.length === 0 ? (
                        <div className="px-4 py-16 text-center text-sm text-muted-foreground">
                            No prior deals found for this client.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Deal</TableHead>
                                    <TableHead>Queue / State</TableHead>
                                    <TableHead>Created</TableHead>
                                    <TableHead className="text-right">REFI balance</TableHead>
                                    <TableHead className="w-[100px]" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {rows.map((deal) => {
                                    const selected = selectedDealId === deal.id;
                                    const dealLabel =
                                        deal.dealId ||
                                        (deal.applicationId != null
                                            ? `#${deal.applicationId}`
                                            : deal.id.slice(0, 8));
                                    return (
                                        <TableRow
                                            key={deal.id}
                                            className={cn(
                                                selected && "bg-emerald-50 dark:bg-emerald-950/30",
                                            )}
                                        >
                                            <TableCell className="font-medium">
                                                <div>{dealLabel}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {deal.type || "—"} · Loan{" "}
                                                    {formatUsd(deal.loanAmount)}
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {deal.currentQueue || "—"}
                                                {deal.currentState
                                                    ? ` / ${deal.currentState}`
                                                    : ""}
                                            </TableCell>
                                            <TableCell className="text-sm tabular-nums">
                                                {deal.previousDealDate || "—"}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold tabular-nums">
                                                {formatUsd(deal.refinanceBalance)}
                                            </TableCell>
                                            <TableCell>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant={selected ? "default" : "outline"}
                                                    onClick={() => onSelect(deal)}
                                                >
                                                    {selected ? "Selected" : "Select"}
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    )}
                </div>

                <DialogFooter className="border-t px-5 py-3">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {selectedDealId ? "Done" : "Cancel"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
