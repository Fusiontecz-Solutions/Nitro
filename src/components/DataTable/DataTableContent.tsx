import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import {
    type Table as ReactTable,
    type Row,
    flexRender,
} from "@tanstack/react-table";
import { Fragment } from "react";
import { Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";

interface DataTableContentProps<TData> {
    table: ReactTable<TData>;
    loading?: boolean;
    loadingMessage?: string;
    emptyMessage?: string;
    emptySubMessage?: string;
    /** Whole-row click (e.g. open record). Ignored when the click originates from interactive controls. */
    onRowClick?: (row: Row<TData>) => void;
    onRowMouseEnter?: (row: Row<TData>) => void;
    isRowExpanded?: (row: Row<TData>) => boolean;
    renderExpandedRow?: (row: Row<TData>) => React.ReactNode;
}

function isInteractiveTableClickTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    // Omit [role='button'] so list rows stay clickable when cells use non-button widgets
    // that expose role="button"; real controls are still covered below.
    return Boolean(
        target.closest(
            "button, input, select, textarea, a, label, [data-row-click-ignore]",
        ),
    );
}

export default function DataTableContent<TData>({
    table,
    loading = false,
    loadingMessage = "Loading...",
    emptyMessage = "No data available",
    emptySubMessage,
    onRowClick,
    onRowMouseEnter,
    isRowExpanded,
    renderExpandedRow,
}: DataTableContentProps<TData>) {
    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="ml-2 text-muted-foreground">{loadingMessage}</span>
            </div>
        );
    }

    return (
        <Table>
            <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                            <TableHead key={header.id} className="text-left px-6 text-muted-foreground">
                                {header.isPlaceholder
                                    ? null
                                    : flexRender(
                                        header.column.columnDef.header,
                                        header.getContext()
                                    )}
                            </TableHead>
                        ))}
                    </TableRow>
                ))}
            </TableHeader>
            <TableBody>
                {table.getRowModel().rows.length > 0 ? (
                    table.getRowModel().rows.map((row, idx) => {
                        const expanded = Boolean(isRowExpanded?.(row) && renderExpandedRow);
                        const columnCount =
                            table.getHeaderGroups()[0]?.headers.length || 1;

                        return (
                            <Fragment key={row.id}>
                                <TableRow
                                    key={row.id}
                                    data-state={row.getIsSelected() && "selected"}
                                    tabIndex={onRowClick ? 0 : undefined}
                                    className={`hover:bg-accent ${idx % 2 ? 'bg-muted/50' : ''} ${row.getIsSelected() ? 'bg-blue-50 dark:bg-blue-950' : ''} ${onRowClick ? "cursor-pointer" : ""}`}
                                    onClick={(e) => {
                                        if (!onRowClick) return;
                                        if (isInteractiveTableClickTarget(e.target)) return;
                                        onRowClick(row);
                                    }}
                                    onMouseEnter={() => onRowMouseEnter?.(row)}
                                    onKeyDown={(e) => {
                                        if (!onRowClick) return;
                                        if (e.key !== "Enter" && e.key !== " ") return;
                                        e.preventDefault();
                                        onRowClick(row);
                                    }}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id} className="text-left px-6 text-[0.85rem] text-foreground">
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                                <AnimatePresence initial={false}>
                                    {expanded ? (
                                        <TableRow key={`${row.id}-expanded`}>
                                            <TableCell colSpan={columnCount} className="p-0">
                                                {renderExpandedRow?.(row)}
                                            </TableCell>
                                        </TableRow>
                                    ) : null}
                                </AnimatePresence>
                            </Fragment>
                        );
                    })
                ) : (
                    <TableRow>
                        <TableCell
                            colSpan={table.getHeaderGroups()[0]?.headers.length || 1}
                            className="h-24 text-left"
                        >
                            <div className="flex flex-col items-start justify-center py-10 text-muted-foreground font-poppins">
                                <p className="font-medium">{emptyMessage}</p>
                                {emptySubMessage && (
                                    <p className="text-sm">{emptySubMessage}</p>
                                )}
                            </div>
                        </TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
    );
}

