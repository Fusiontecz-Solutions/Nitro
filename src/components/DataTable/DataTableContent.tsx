import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

import { Fragment, type ReactNode } from "react";
import {
    type Table as ReactTable,
    type Row,
    flexRender,
} from "@tanstack/react-table";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 } from "lucide-react";

const EXPAND_ROW_TRANSITION = {
    duration: 0.32,
    ease: [0.22, 1, 0.36, 1] as const,
};

const EXPAND_ROW_VARIANTS = {
    collapsed: { height: 0, opacity: 0 },
    open: { height: "auto", opacity: 1 },
};

const MotionTableRow = motion(TableRow);

interface DataTableContentProps<TData> {
    table: ReactTable<TData>;
    loading?: boolean;
    loadingMessage?: string;
    emptyMessage?: string;
    emptySubMessage?: string;
    /** Whole-row click (e.g. open record). Ignored when the click originates from interactive controls. */
    onRowClick?: (row: Row<TData>) => void;
    /** Fired when the pointer enters a row (e.g. prefetch detail). */
    onRowMouseEnter?: (row: Row<TData>) => void;
    /** When true, renders an extra row below the data row. */
    isRowExpanded?: (row: Row<TData>) => boolean;
    /** Content for the expandable row (full table width). */
    renderExpandedRow?: (row: Row<TData>) => ReactNode;
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
    const columnCount =
        table.getHeaderGroups()[0]?.headers.length || 1;
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
                        const expanded =
                            Boolean(isRowExpanded?.(row)) &&
                            Boolean(renderExpandedRow);
                        return (
                            <Fragment key={row.id}>
                                <TableRow
                                    data-state={row.getIsSelected() && "selected"}
                                    tabIndex={onRowClick ? 0 : undefined}
                                    className={`hover:bg-accent ${idx % 2 ? "bg-muted/50" : ""} ${row.getIsSelected() ? "bg-blue-50 dark:bg-blue-950" : ""} ${expanded ? "bg-amber-50/40 dark:bg-amber-950/20" : ""} ${onRowClick ? "cursor-pointer" : ""}`}
                                    onMouseEnter={() => onRowMouseEnter?.(row)}
                                    onClick={(e) => {
                                        if (!onRowClick) return;
                                        if (isInteractiveTableClickTarget(e.target)) return;
                                        onRowClick(row);
                                    }}
                                    onKeyDown={(e) => {
                                        if (!onRowClick) return;
                                        if (e.key !== "Enter" && e.key !== " ") return;
                                        e.preventDefault();
                                        onRowClick(row);
                                    }}
                                >
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell
                                            key={cell.id}
                                            className="text-left px-6 text-[0.85rem] text-foreground"
                                        >
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext(),
                                            )}
                                        </TableCell>
                                    ))}
                                </TableRow>
                                {renderExpandedRow ? (
                                    <AnimatePresence initial={false}>
                                        {expanded ? (
                                            <MotionTableRow
                                                key={`${row.id}-progress-expanded`}
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                transition={EXPAND_ROW_TRANSITION}
                                                className="hover:bg-transparent border-b border-slate-200/80 dark:border-slate-800"
                                            >
                                                <TableCell
                                                    colSpan={columnCount}
                                                    className="p-0"
                                                >
                                                    <motion.div
                                                        initial="collapsed"
                                                        animate="open"
                                                        exit="collapsed"
                                                        variants={EXPAND_ROW_VARIANTS}
                                                        transition={EXPAND_ROW_TRANSITION}
                                                        className="overflow-hidden"
                                                    >
                                                        <motion.div
                                                            initial={{ y: -10, opacity: 0 }}
                                                            animate={{ y: 0, opacity: 1 }}
                                                            exit={{ y: -8, opacity: 0 }}
                                                            transition={EXPAND_ROW_TRANSITION}
                                                        >
                                                            {renderExpandedRow(row)}
                                                        </motion.div>
                                                    </motion.div>
                                                </TableCell>
                                            </MotionTableRow>
                                        ) : null}
                                    </AnimatePresence>
                                ) : null}
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

