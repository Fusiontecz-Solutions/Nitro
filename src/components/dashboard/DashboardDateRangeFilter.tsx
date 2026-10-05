import { useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatDate,
  formatYmdET,
  getCurrentMonthDateRangeET,
  getWeekRangeET,
} from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";

export type DashboardDateRangeValue = {
  startDate: string;
  endDate: string;
};

type PresetId = "week" | "month" | "sixMonths" | "all" | "custom";

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "sixMonths", label: "Past 6 months" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

export function defaultDashboardDateRange(): DashboardDateRangeValue {
  const range = getCurrentMonthDateRangeET();
  return { startDate: range.start, endDate: range.end };
}

function rangeForPreset(id: Exclude<PresetId, "custom">): DashboardDateRangeValue {
  if (id === "all") return { startDate: "", endDate: "" };
  if (id === "month") return defaultDashboardDateRange();
  if (id === "week") {
    const week = getWeekRangeET(new Date());
    if (!week) return defaultDashboardDateRange();
    return { startDate: week.startYmd, endDate: week.endYmd };
  }
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 6);
  return { startDate: formatYmdET(start), endDate: formatYmdET(end) };
}

function guessPreset(startDate: string, endDate: string): PresetId {
  if (!startDate && !endDate) return "all";
  for (const id of ["week", "month", "sixMonths"] as const) {
    const preset = rangeForPreset(id);
    if (preset.startDate === startDate && preset.endDate === endDate) return id;
  }
  return "custom";
}

function displayLabel(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return "All time";
  const startLabel = startDate ? formatDate(startDate, startDate) : "…";
  const endLabel = endDate ? formatDate(endDate, endDate) : "…";
  return `${startLabel} – ${endLabel}`;
}

export function DashboardDateRangeFilter({
  startDate,
  endDate,
  onApply,
}: {
  startDate: string;
  endDate: string;
  onApply: (next: DashboardDateRangeValue) => void;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(startDate);
  const [draftEnd, setDraftEnd] = useState(endDate);
  const [preset, setPreset] = useState<PresetId>(() => guessPreset(startDate, endDate));

  useEffect(() => {
    if (!open) return;
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setPreset(guessPreset(startDate, endDate));
  }, [open, startDate, endDate]);

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    if (id === "custom") return;
    const next = rangeForPreset(id);
    setDraftStart(next.startDate);
    setDraftEnd(next.endDate);
  };

  const handleApply = () => {
    const nextStart = draftStart;
    let nextEnd = draftEnd;
    if (nextStart && nextEnd && nextStart > nextEnd) {
      nextEnd = nextStart;
    }
    onApply({ startDate: nextStart, endDate: nextEnd });
    setOpen(false);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`flex items-center gap-2 px-3 py-2 h-9 rounded-md transition-colors ${
            isDark
              ? "bg-[#141517] hover:bg-[#374151] text-white"
              : "bg-white hover:bg-gray-50 text-black border border-[var(--brand)]"
          }`}
          style={isDark ? { border: "1px solid rgba(118, 183, 226, 0.5)" } : {}}
        >
          <Calendar className={`h-4 w-4 ${isDark ? "text-white" : "text-black"}`} />
          <span className={`text-xs font-semibold ${isDark ? "text-white" : "text-black"}`}>
            DATE:
          </span>
          <span className={`text-sm ${isDark ? "text-white" : "text-black"}`}>
            {displayLabel(startDate, endDate)}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[280px] p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => applyPreset(item.id)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  preset === item.id
                    ? "bg-[var(--brand)] text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-foreground">Start Date</label>
            <Input
              type="date"
              value={draftStart}
              onChange={(e) => {
                setPreset("custom");
                setDraftStart(e.target.value);
              }}
              className="w-full"
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-foreground">End Date</label>
            <Input
              type="date"
              value={draftEnd}
              onChange={(e) => {
                setPreset("custom");
                setDraftEnd(e.target.value);
              }}
              className="w-full"
            />
          </div>
          <Button
            onClick={handleApply}
            className="w-full bg-[var(--brand)] hover:bg-[var(--brand)]/90 text-white"
          >
            Apply
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
