import { Button } from "@/components/ui/button";
import type { Column } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

type DataTableSortHeaderProps<TData> = {
  column: Column<TData, unknown>;
  label: string;
  className?: string;
};

export default function DataTableSortHeader<TData>({
  column,
  label,
  className,
}: DataTableSortHeaderProps<TData>) {
  if (!column.getCanSort()) {
    return (
      <span className={className ?? "font-medium text-foreground uppercase tracking-wide"}>
        {label}
      </span>
    );
  }

  const sorted = column.getIsSorted();
  const Icon =
    sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;

  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto cursor-pointer p-0 font-medium text-foreground hover:bg-transparent hover:text-foreground"
      onClick={() => column.toggleSorting(sorted === "asc")}
      aria-label={`Sort by ${label}`}
    >
      <span className="uppercase tracking-wide">{label}</span>
      <Icon className="ml-1 h-3 w-3 shrink-0 opacity-70" aria-hidden />
    </Button>
  );
}
