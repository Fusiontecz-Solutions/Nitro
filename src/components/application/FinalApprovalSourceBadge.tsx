import { formatFinalApprovalSourceLabel } from "@/lib/finalApprovalSource";
import { cn } from "@/lib/utils";
import type { Application } from "@/types/applicationTypes";

export const FINAL_APPROVAL_SOURCE_BADGE_CLASS =
    "inline-flex max-w-full items-center rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-800 dark:bg-sky-950/50 dark:text-sky-200";

type FinalApprovalSourceBadgeProps = {
    source?: Application["finalApprovalSource"];
    className?: string;
};

export default function FinalApprovalSourceBadge({
    source,
    className,
}: FinalApprovalSourceBadgeProps) {
    const label = formatFinalApprovalSourceLabel(source);
    if (!label) return null;

    return (
        <span className={cn(FINAL_APPROVAL_SOURCE_BADGE_CLASS, "truncate", className)}>
            Sent from {label}
        </span>
    );
}
