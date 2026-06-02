import { useSelector } from "react-redux";
import { Card, CardContent } from "../ui/card"
import type { RootState } from "@/redux/store";
import { Skeleton } from "../ui/skeleton";
import { useTheme } from "@/context/ThemeContext";
import { ChevronLeft } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { formatActionRequired } from "@/lib/formatActionRequired";
// import { Button } from "../ui/button";

interface ApplicationSummaryProps {
    isUnderwriter?: boolean;
    /** When provided (e.g. on application-detail overview for agent), only show data for this application — no static values */
    applicationId?: string | null;
    /** Called when back arrow is clicked */
    onBack?: () => void;
}

const ApplicationSummary = ({
    isUnderwriter,
    applicationId,
    onBack,
}: ApplicationSummaryProps) => {
    const { loading: fetchLoading, data: applicationData } = useSelector(
        (state: RootState) => state.applicationDetail
    );
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';

    // When applicationId is provided (e.g. agent on overview), only use data that matches the current application
    const normalizedApplicationId =
        applicationId === null || applicationId === undefined
            ? null
            : String(applicationId);

    const dataApplicationId = (applicationData as any)?.applicationId;
    const dataId = (applicationData as any)?._id;

    const appIdMatch =
        !normalizedApplicationId || !applicationData
            ? true
            : String(dataId ?? "") === normalizedApplicationId ||
            String(dataApplicationId ?? "") === normalizedApplicationId;

    const showDynamicData = appIdMatch && applicationData;
    const isLoading = fetchLoading;

    const clientName = showDynamicData
        ? (applicationData?.client as any)?.owner?.firstName + ' ' + (applicationData?.client as any)?.owner?.lastName
        : null;
    const businessName = showDynamicData ? (applicationData?.client as any)?.business?.name : null;
    const loanAmount = showDynamicData && applicationData?.loanAmount != null
        ? Number(applicationData.loanAmount)
        : null;
    let status: string | null = null;
    if (showDynamicData) {
        const q =
            (applicationData as any)?.currentQueue ??
            (applicationData as any)?.queue;
        if (q != null && String(q).trim() !== "") {
            status = String(q).trim();
        }
    }
    const actionRequired = showDynamicData ? formatActionRequired((applicationData as any)?.note) : "--";

    // Different gradients for light and dark mode
    const gradient = isDark
        ? "linear-gradient(135deg, #1F2837 0%, #243244 45%, #2E4258 100%)"
        : "linear-gradient(135deg, #3B8BD1 0%, #2566A9 50%, #0E416E 100%)";

    const panelTint = isDark ? "bg-white/10 border border-white/15" : "bg-white/30";

    const innerPanelClass = `grid gap-4 rounded-lg p-4 justify-center items-center shadow-md dark:shadow-lg ${panelTint} grid-cols-1 md:grid-cols-3 lg:grid-cols-5`;

    const standardFiveColumns = (
        <>
            <div className="text-white">
                {isLoading ? (
                    <div className="space-y-2 pr-12">
                        <Skeleton className="h-4 w-[150px] bg-white/30" />
                        <Skeleton className="h-4 w-[100px] bg-white/30" />
                    </div>
                ) : (
                    <>
                        <p className="text-sm font-medium opacity-90 mb-1">Borrower Name</p>
                        <p className="text-base font-semibold capitalize">{clientName ?? "-"}</p>
                    </>
                )}
            </div>
            <div className="text-white">
                {isLoading ? (
                    <div className="space-y-2 pr-12">
                        <Skeleton className="h-4 w-[150px] bg-white/30" />
                        <Skeleton className="h-4 w-[100px] bg-white/30" />
                    </div>
                ) : (
                    <>
                        <p className="text-sm font-medium opacity-90 mb-1">Business Name</p>
                        <p className="text-base font-semibold capitalize">{businessName ?? "-"}</p>
                    </>
                )}
            </div>
            <div className="text-white">
                {isLoading ? (
                    <div className="space-y-2 pr-12">
                        <Skeleton className="h-4 w-[150px] bg-white/30" />
                        <Skeleton className="h-4 w-[100px] bg-white/30" />
                    </div>
                ) : (
                    <>
                        <p className="text-sm font-medium opacity-90 mb-1">Requested Amount</p>
                        <p className="text-base font-semibold">
                            {loanAmount != null ? formatCurrency(loanAmount) : "-"}
                        </p>
                    </>
                )}
            </div>
            <div className="text-white">
                {isLoading ? (
                    <div className="space-y-2 pr-12">
                        <Skeleton className="h-4 w-[150px] bg-white/30" />
                        <Skeleton className="h-4 w-[100px] bg-white/30" />
                    </div>
                ) : (
                    <>
                        <p className="text-sm font-medium opacity-90 mb-1">Status</p>
                        <p className="text-base font-semibold capitalize">{status ?? "-"}</p>
                    </>
                )}
            </div>
            <div className="text-white text-left">
                {isLoading ? (
                    <div className="space-y-2 pr-12">
                        <Skeleton className="h-4 w-[150px] bg-white/30" />
                        <Skeleton className="h-4 w-[100px] bg-white/30" />
                    </div>
                ) : (
                    <>
                        <p className="text-sm font-medium opacity-90 mb-1">Action Required</p>
                        <p className="text-base font-semibold font-roboto whitespace-pre-wrap break-words">
                            {actionRequired}
                        </p>
                    </>
                )}
            </div>
        </>
    );

    return (
        <Card className={`border-0 rounded-lg shadow-xl overflow-hidden mb-6 py-0 ${isDark ? 'ring-1 ring-slate-500/30' : 'dark:border dark:border-border'}`}>
            <CardContent
                className="px-8 py-6"
                style={{ background: gradient }}
            >
                <div className="flex flex-wrap items-center gap-3 mb-5">
                    {onBack && (
                        <button
                            type="button"
                            onClick={onBack}
                            className="flex items-center justify-center w-9 h-9 rounded-full text-white hover:bg-white/20 transition-colors"
                            aria-label="Go back"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                    )}
                    <h2 className="text-white text-2xl font-[700] font-roboto uppercase tracking-wide">
                        Application Summary
                    </h2>
                </div>
                <div className={innerPanelClass}>
                    {standardFiveColumns}
                </div>
                {/* {isUnderwriter && (
                    <div className="flex gap-2 items-center">
                        <Button variant="outline" className="h-9 gap-2 w-fit">
                            <span className="w-fit bg-[#276D9C] text-white px-2 py-1 rounded-sm">Edit</span>
                        </Button>
                        <Button variant="outline" className="h-9 gap-2 bg-[#FFC3C3]">Delete</Button>
                    </div>
                )} */}
            </CardContent>
        </Card>
    )
}

export default ApplicationSummary;