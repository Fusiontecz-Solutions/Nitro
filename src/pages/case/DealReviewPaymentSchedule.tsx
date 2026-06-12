import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
} from "react";
import {
  Calendar,
  CalendarDays,
  DollarSign,
  Info,
  Loader2,
  Pencil,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatCurrency, formatDateMonthDayYear } from "@/lib/utils";
import {
  getDefaultPaymentStartDate,
  getFrequencyScheduleSummary,
  getScheduleFrequencyLabel,
  getTodayInputDate,
  parsePaymentTerm,
  sumScheduleAmounts,
  toNextBusinessDay,
  type PaymentScheduleEntry,
} from "@/lib/paymentScheduleDates";

const SCHEDULE_INPUT_CLASS =
  "rounded-lg border-slate-200/90 bg-white text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-blue-500/25 dark:border-slate-600 dark:bg-slate-950";

const ROW_INPUT_CLASS = cn(
  SCHEDULE_INPUT_CLASS,
  "h-9 px-2.5 font-medium tabular-nums",
);

/** Row layout: fixed # / date / amount widths + space-between for even gaps. */
const SCHEDULE_ROW_LAYOUT =
  "flex w-full items-center justify-between gap-4 px-4 py-2.5 sm:gap-6";

const INDEX_COL_WIDTH = "w-8 shrink-0 text-right";
const DATE_COL_WIDTH_CLASS = "w-[11.5rem] shrink-0";
const AMOUNT_COL_WIDTH_CLASS = "w-[11.5rem] shrink-0";

export type DealReviewPaymentScheduleProps = {
  paymentStartDate: string;
  onPaymentStartDateChange: (value: string) => void;
  frequency: string;
  term: string;
  paymentAmount: number;
  schedule: PaymentScheduleEntry[];
  onPatchScheduleRow: (
    index: number,
    patch: { date?: string; amount?: number },
  ) => void;
  scheduleEndDate: string | null;
  effectiveFirstPaymentDate: string;
  skipsWeekendsForDaily: boolean;
  loadingOffer: boolean;
};

export default function DealReviewPaymentSchedule({
  paymentStartDate,
  onPaymentStartDateChange,
  frequency,
  term,
  paymentAmount,
  schedule,
  onPatchScheduleRow,
  scheduleEndDate,
  effectiveFirstPaymentDate,
  skipsWeekendsForDaily,
  loadingOffer,
}: DealReviewPaymentScheduleProps) {
  const paymentCount = parsePaymentTerm(term);
  const frequencyLabel = getScheduleFrequencyLabel(frequency);
  const summaryText = getFrequencyScheduleSummary(frequency, paymentCount);
  const minDate = useMemo(() => getTodayInputDate(), []);
  const totalScheduled = useMemo(() => sumScheduleAmounts(schedule), [schedule]);
  const needsSchedule = paymentCount > 0;
  const isScheduleDataReady = useMemo(() => {
    if (!needsSchedule) return true;
    return (
      Boolean(paymentStartDate) &&
      paymentAmount > 0 &&
      schedule.length === paymentCount &&
      schedule.every((row) => Boolean(row.date) && row.amount > 0)
    );
  }, [
    needsSchedule,
    paymentStartDate,
    paymentAmount,
    schedule,
    paymentCount,
  ]);
  const isLoading = loadingOffer || (needsSchedule && !isScheduleDataReady);
  const selectedDateLabel = paymentStartDate
    ? formatDateMonthDayYear(paymentStartDate)
    : "—";

  const handleQuickStart = (iso: string) => {
    onPaymentStartDateChange(
      frequencyLabel === "Daily" ? toNextBusinessDay(iso) : iso,
    );
  };

  return (
    <>
      <header className="relative overflow-hidden border-b border-slate-100/90 px-5 py-4 dark:border-slate-800">
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-50/90 via-white to-indigo-50/30 dark:from-blue-950/25 dark:via-[#1A1B1F] dark:to-indigo-950/15"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/20">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h4 className="text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                Payment schedule
              </h4>
              <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                Set the first debit, then adjust any date or amount below
              </p>
            </div>
          </div>
          {paymentCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-blue-200/80 bg-white/80 px-3 py-1 text-xs font-medium text-blue-800 shadow-sm backdrop-blur-sm dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-200">
              {frequencyLabel}
            </span>
          ) : null}
        </div>
      </header>

      <div className="space-y-5 p-5">
        {isLoading ? (
          <ScheduleLoadingState paymentCount={paymentCount} />
        ) : (
          <>
            {paymentCount > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="Payments"
                  value={String(paymentCount)}
                  hint="in schedule"
                />
                <StatCard
                  label="Per debit"
                  value={
                    paymentAmount > 0 ? formatCurrency(paymentAmount) : "—"
                  }
                  hint="default from offer"
                />
                <StatCard
                  label="First debit"
                  value={
                    effectiveFirstPaymentDate
                      ? formatDateMonthDayYear(effectiveFirstPaymentDate)
                      : selectedDateLabel
                  }
                  hint="row 1 date"
                  className="col-span-2 sm:col-span-1"
                />
                <StatCard
                  label="Total"
                  value={
                    totalScheduled > 0 ? formatCurrency(totalScheduled) : "—"
                  }
                  hint={
                    scheduleEndDate
                      ? `ends ${formatDateMonthDayYear(scheduleEndDate)}`
                      : "scheduled"
                  }
                  className="col-span-2 sm:col-span-1"
                />
              </div>
            ) : null}

            <div className="rounded-2xl border border-slate-200/70 bg-gradient-to-b from-slate-50/80 to-white p-4 shadow-sm dark:border-slate-700/80 dark:from-slate-900/40 dark:to-slate-900/20">
              <div className="mb-3 flex items-start gap-2">
                <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    First payment date
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {summaryText}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
                <div className="relative min-w-0 flex-1">
                  <Calendar
                    className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <Input
                    id="payment-start-date"
                    type="date"
                    min={minDate}
                    value={paymentStartDate}
                    onChange={(e) => onPaymentStartDateChange(e.target.value)}
                    className={cn(
                      SCHEDULE_INPUT_CLASS,
                      "h-11 cursor-pointer pl-10 pr-3 font-medium",
                    )}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleQuickStart(getDefaultPaymentStartDate())}
                  className="h-11 shrink-0 cursor-pointer rounded-xl border-dashed border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:border-blue-300 hover:bg-blue-50/50 hover:text-blue-800 dark:border-slate-600 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-blue-800 dark:hover:bg-blue-950/40"
                >
                  <CalendarDays className="mr-2 h-4 w-4 opacity-70" />
                  Next business day
                </Button>
              </div>
            </div>

            {skipsWeekendsForDaily ? (
              <div className="flex gap-3 rounded-xl border border-amber-200/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="leading-relaxed">
                  Daily debits use weekdays only. First debit:{" "}
                  <span className="font-semibold">
                    {formatDateMonthDayYear(effectiveFirstPaymentDate)}
                  </span>
                  .
                </p>
              </div>
            ) : null}

            {paymentCount === 0 ? (
              <EmptyScheduleState />
            ) : (
              <EditableScheduleList
                schedule={schedule}
                minDate={minDate}
                disabled={false}
                onPatchScheduleRow={onPatchScheduleRow}
              />
            )}
          </>
        )}
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200/70 bg-white px-3.5 py-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40",
        className,
      )}
    >
      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 truncate text-base font-semibold tracking-tight text-slate-900 dark:text-slate-50">
        {value}
      </p>
      <p className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-slate-500">
        {hint}
      </p>
    </div>
  );
}

function ScheduleLoadingState({ paymentCount }: { paymentCount: number }) {
  const skeletonRows = Math.min(Math.max(paymentCount, 3), 5);

  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600 dark:text-blue-400" />
        Loading payment schedule…
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={`stat-skeleton-${index}`}
            className="animate-pulse rounded-xl border border-slate-200/70 bg-white px-3.5 py-3 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40"
          >
            <div className="h-3 w-16 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="mt-2 h-5 w-20 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="mt-2 h-2.5 w-24 rounded bg-slate-100 dark:bg-slate-800" />
          </div>
        ))}
      </div>

      <div className="animate-pulse rounded-2xl border border-slate-200/70 bg-gradient-to-b from-slate-50/80 to-white p-4 shadow-sm dark:border-slate-700/80 dark:from-slate-900/40 dark:to-slate-900/20">
        <div className="mb-3 h-4 w-40 rounded bg-slate-200 dark:bg-slate-700" />
        <div className="h-3 w-64 max-w-full rounded bg-slate-100 dark:bg-slate-800" />
        <div className="mt-4 h-11 rounded-lg bg-slate-200 dark:bg-slate-700" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/80 dark:bg-slate-900/30">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="h-4 w-44 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-2 h-3 w-56 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {Array.from({ length: skeletonRows }).map((_, index) => (
            <li
              key={`row-skeleton-${index}`}
              className="flex animate-pulse items-center justify-between gap-4 px-4 py-3"
            >
              <div className="h-4 w-6 rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-9 w-[11.5rem] rounded-lg bg-slate-200 dark:bg-slate-700" />
              <div className="h-9 w-[11.5rem] rounded-lg bg-slate-200 dark:bg-slate-700" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EmptyScheduleState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-6 py-10 text-center dark:border-slate-700 dark:bg-slate-900/30">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <CalendarDays className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
        Term required to build schedule
      </p>
      <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-slate-400">
        Enter a valid term in the offer section above to preview payment dates.
      </p>
    </div>
  );
}

const EditableScheduleList = memo(function EditableScheduleList({
  schedule,
  minDate,
  disabled,
  onPatchScheduleRow,
}: {
  schedule: PaymentScheduleEntry[];
  minDate: string;
  disabled: boolean;
  onPatchScheduleRow: (
    index: number,
    patch: { date?: string; amount?: number },
  ) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm ring-1 ring-slate-900/[0.02] dark:border-slate-700/80 dark:bg-slate-900/30 dark:ring-white/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-4 py-3 dark:border-slate-800 dark:from-slate-900/60 dark:to-slate-900/30">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            <Pencil className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              All scheduled debits
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {schedule.length} payment{schedule.length === 1 ? "" : "s"} · tap
              to edit date or amount
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          SCHEDULE_ROW_LAYOUT,
          "hidden border-b border-slate-100 bg-slate-50/90 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-400 sm:flex",
        )}
      >
        <span className={INDEX_COL_WIDTH}>#</span>
        <span
          className={cn(
            DATE_COL_WIDTH_CLASS,
            "flex items-center gap-1.5 text-left",
          )}
        >
          <Calendar className="h-3 w-3 shrink-0" />
          Date
        </span>
        <span
          className={cn(
            AMOUNT_COL_WIDTH_CLASS,
            "flex items-center  gap-1.5 text-right",
          )}
        >
          <DollarSign className="h-3 w-3 shrink-0" />
          Amount
        </span>
      </div>

      <ul className="max-h-[min(52vh,28rem)] list-none divide-y divide-slate-100 overflow-y-auto [scrollbar-gutter:stable] [scrollbar-width:thin] dark:divide-slate-800">
        {schedule.map((row, idx) => (
          <PaymentScheduleRow
            key={row.index}
            index={row.index}
            date={row.date}
            amount={row.amount}
            rowTone={idx % 2 === 0 ? "even" : "odd"}
            minDate={minDate}
            disabled={disabled}
            onPatchScheduleRow={onPatchScheduleRow}
          />
        ))}
      </ul>
    </div>
  );
});

function scheduleRowPropsAreEqual(
  prev: PaymentScheduleRowProps,
  next: PaymentScheduleRowProps,
) {
  return (
    prev.index === next.index &&
    prev.date === next.date &&
    prev.amount === next.amount &&
    prev.rowTone === next.rowTone &&
    prev.minDate === next.minDate &&
    prev.disabled === next.disabled &&
    prev.onPatchScheduleRow === next.onPatchScheduleRow
  );
}

type PaymentScheduleRowProps = {
  index: number;
  date: string;
  amount: number;
  rowTone: "even" | "odd";
  minDate: string;
  disabled: boolean;
  onPatchScheduleRow: (
    index: number,
    patch: { date?: string; amount?: number },
  ) => void;
};

const PaymentScheduleRow = memo(function PaymentScheduleRow({
  index,
  date,
  amount,
  rowTone,
  minDate,
  disabled,
  onPatchScheduleRow,
}: PaymentScheduleRowProps) {
  const [dateText, setDateText] = useState(date);
  const [amountText, setAmountText] = useState(
    amount > 0 ? String(amount) : "",
  );
  const dateFocusedRef = useRef(false);
  const amountFocusedRef = useRef(false);

  useEffect(() => {
    if (!dateFocusedRef.current) {
      setDateText(date);
    }
  }, [date]);

  useEffect(() => {
    if (!amountFocusedRef.current) {
      setAmountText(amount > 0 ? String(amount) : "");
    }
  }, [amount]);

  const commitDate = () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText) && dateText !== date) {
      onPatchScheduleRow(index, { date: dateText });
      return;
    }
    setDateText(date);
  };

  const commitAmount = () => {
    const parsed = Number(amountText);
    const next =
      amountText.trim() === "" || !Number.isFinite(parsed) ? 0 : parsed;
    const rounded = Math.round(next * 100) / 100;
    const display = rounded > 0 ? String(rounded) : "";
    setAmountText(display);
    if (rounded !== amount) {
      onPatchScheduleRow(index, { amount: rounded });
    }
  };

  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-3 py-3",
        "sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-4 sm:py-2.5",
        rowTone === "even"
          ? "bg-white dark:bg-slate-900/20"
          : "bg-slate-50/40 dark:bg-slate-900/40",
      )}
    >
      <span
        className={cn(
          INDEX_COL_WIDTH,
          "text-sm font-semibold tabular-nums text-black-700 dark:text-blue-300",
        )}
      >
        {index}.
      </span>

      <div className={cn("w-full", DATE_COL_WIDTH_CLASS, "max-sm:shrink")}>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:sr-only">
          Date
        </label>
        <Input
          type="date"
          min={minDate}
          value={dateText}
          disabled={disabled}
          onFocus={() => {
            dateFocusedRef.current = true;
          }}
          onChange={(e) => setDateText(e.target.value)}
          onBlur={() => {
            dateFocusedRef.current = false;
            commitDate();
          }}
          className={cn(ROW_INPUT_CLASS, "w-full cursor-pointer")}
          aria-label={`Payment ${index} date`}
        />
      </div>

      <div className={cn("w-full", AMOUNT_COL_WIDTH_CLASS, "max-sm:shrink")}>
        <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:sr-only">
          Amount
        </label>
        <Input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={amountText}
          disabled={disabled}
          onFocus={(event: FocusEvent<HTMLInputElement>) => {
            amountFocusedRef.current = true;
            event.target.select();
          }}
          onChange={(e) => setAmountText(e.target.value)}
          onBlur={() => {
            amountFocusedRef.current = false;
            commitAmount();
          }}
          className={cn(ROW_INPUT_CLASS, "w-full")}
          aria-label={`Payment ${index} amount`}
        />
      </div>
    </li>
  );
}, scheduleRowPropsAreEqual);
