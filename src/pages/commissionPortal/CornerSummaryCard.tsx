import { cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react'

type CornerSummaryCardProps = {
    isDark: boolean
    title: string
    /** Optional line under the title (e.g. “Including all stages”). */
    subtitle?: string
    icon: ReactNode
    /** Icon size in px, controlled by caller. */
    iconSize?: number
    /** When true, count/suffix/amount show pulse placeholders (no text). */
    isLoading?: boolean
    /** Large number, top-left (e.g. deal count). */
    countValue: string
    /** Optional line under the count (e.g. “deals”, “paid deals”). */
    countSuffix?: string
    /** Small caption, bottom-left. */
    footLeft?: string
    /** Optional secondary line under `footLeft` (e.g. month-over-month change). */
    footNote?: string
    /** Optional class for the foot note (e.g. trend color). */
    footNoteClassName?: string
    /** Tiny label above the amount, bottom-right. */
    amountLabel?: string
    /** Main monetary (or summary) value, bottom-right. */
    amountValue: string
}

/** Compact KPI tile: title + icon, count, footer with caption and amount on separate rows. */
export function CornerSummaryCard({
    isDark,
    title,
    subtitle,
    icon,
    iconSize = 20,
    isLoading = false,
    countValue,
    countSuffix,
    footLeft,
    footNote,
    footNoteClassName,
    amountLabel,
    amountValue,
}: CornerSummaryCardProps) {
    const renderedIcon = isValidElement(icon)
        ? cloneElement(icon as ReactElement<{ size?: number; style?: CSSProperties }>, {
              size: iconSize,
              style: {
                  ...(icon.props as { style?: CSSProperties }).style,
                  width: iconSize,
                  height: iconSize,
              },
          })
        : icon

    return (
        <div
            className={`flex h-full min-h-[148px] flex-col overflow-hidden rounded-xl border px-3.5 pt-3 pb-3 shadow-lg ${
                isDark ? 'border-[#324154] bg-[#13161D]' : 'border-[#E2ECF4] bg-white'
            }`}
        >
            <div className="shrink-0">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <span className="block truncate text-[11px] font-semibold uppercase text-muted-foreground">
                            {title}
                        </span>
                        {subtitle ? (
                            <p className="mt-0.5 text-[10px] font-medium leading-snug text-muted-foreground">
                                {subtitle}
                            </p>
                        ) : null}
                    </div>
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-full p-1">
                        {renderedIcon}
                    </span>
                </div>
                <div className="mt-2.5 text-left">
                    {isLoading ? (
                        <span
                            className="inline-block h-8 w-12 rounded-md bg-muted/70 animate-pulse md:h-9 md:w-14"
                            aria-hidden
                        />
                    ) : (
                        <p className="text-xl font-bold tabular-nums leading-none text-foreground md:text-2xl">
                            {countValue}
                        </p>
                    )}
                    {!isLoading && countSuffix ? (
                        <p className="mt-1 text-[11px] font-medium leading-tight text-muted-foreground">
                            {countSuffix}
                        </p>
                    ) : null}
                </div>
            </div>

            <div className="min-h-3 flex-1" aria-hidden />

            <div
                className={`shrink-0 border-t pt-2.5 ${
                    isDark ? 'border-white/10' : 'border-border/60'
                }`}
            >
                {(footLeft || footNote) && (
                    <div className="min-w-0 w-full">
                        {footLeft ? (
                            <p className="text-[11px] font-medium leading-snug text-muted-foreground">
                                {footLeft}
                            </p>
                        ) : null}
                        {footNote ? (
                            <p
                                className={`mt-0.5 text-[10px] leading-snug ${
                                    footNoteClassName ??
                                    (isDark ? 'text-muted-foreground' : 'text-muted-foreground')
                                }`}
                            >
                                {footNote}
                            </p>
                        ) : null}
                    </div>
                )}
                <div
                    className={`w-full shrink-0 text-right ${
                        footLeft || footNote ? 'mt-1' : ''
                    }`}
                >
                    {amountLabel ? (
                        <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {amountLabel}
                        </p>
                    ) : null}
                    {isLoading ? (
                        <span
                            className="ml-auto inline-block h-6 w-14 rounded-md bg-muted/70 animate-pulse md:h-7 md:w-16"
                            aria-hidden
                        />
                    ) : (
                        <p className="text-base font-bold tabular-nums leading-tight text-foreground whitespace-nowrap md:text-lg">
                            {amountValue}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}
