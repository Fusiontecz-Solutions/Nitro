import { cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from "react";

type DashboardStatCardProps = {
  isDark: boolean;
  title: string;
  icon: ReactNode;
  /** Icon size in px, controlled by caller. */
  iconSize?: number;
  /** When true, count and amount show pulse placeholders. */
  isLoading?: boolean;
  /** Large number, top-left (e.g. submission count). */
  countValue: string;
  /** Line under the count (e.g. "Submissions"). */
  countSuffix?: string;
  /** Caption above the amount (e.g. "Total assigned amount"). */
  footLeft?: string;
  /** Main monetary value, bottom-right. */
  amountValue: string;
};

/**
 * Compact KPI tile used on the Agent / Underwriter dashboards (Katam dashboard style):
 * uppercase title + colored icon, count, divider, uppercase caption and amount.
 */
export function DashboardStatCard({
  isDark,
  title,
  icon,
  iconSize = 24,
  isLoading = false,
  countValue,
  countSuffix,
  footLeft,
  amountValue,
}: DashboardStatCardProps) {
  const renderedIcon = isValidElement(icon)
    ? cloneElement(icon as ReactElement<{ size?: number; style?: CSSProperties }>, {
        size: iconSize,
        style: {
          ...(icon.props as { style?: CSSProperties }).style,
          width: iconSize,
          height: iconSize,
        },
      })
    : icon;

  return (
    <div
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border px-3 pb-2 shadow-lg ${
        isDark ? "border-[#324154] bg-[#13161D]" : "border-[#E2ECF4] bg-white"
      }`}
    >
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate text-[11px] font-semibold uppercase text-muted-foreground">{title}</span>
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full p-1">{renderedIcon}</span>
        </div>
        <div className="mt-1.5 text-left">
          {isLoading ? (
            <span className="inline-block h-8 w-12 animate-pulse rounded-md bg-muted/70 md:h-9 md:w-14" aria-hidden />
          ) : (
            <p className="text-xl font-bold leading-none tabular-nums text-foreground md:text-2xl">{countValue}</p>
          )}
          {!isLoading && countSuffix ? (
            <p className="mt-0.5 text-[11px] font-medium uppercase leading-tight text-muted-foreground">{countSuffix}</p>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1" aria-hidden />

      <div className={`mt-2 shrink-0 border-t pt-2 ${isDark ? "border-white/10" : "border-border/60"}`}>
        {footLeft ? (
          <p className="text-[11px] font-medium uppercase leading-snug text-muted-foreground">{footLeft}</p>
        ) : null}
        <div className={`w-full shrink-0 text-right ${footLeft ? "mt-1" : ""}`}>
          {isLoading ? (
            <span className="ml-auto inline-block h-6 w-14 animate-pulse rounded-md bg-muted/70 md:h-7 md:w-16" aria-hidden />
          ) : (
            <p className="whitespace-nowrap text-base font-bold leading-tight tabular-nums text-foreground md:text-lg">
              {amountValue}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
