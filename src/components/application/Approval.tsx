import { useEffect, useMemo, useState } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import { useDispatch, useSelector } from "react-redux";
import { CheckCircle2, Loader2, Calculator as CalculatorIcon, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "react-toastify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/context/ThemeContext";
import type { RootState } from "@/redux/store";
import type { AppDispatch } from "@/redux/store";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import { getApplicationById } from "@/redux/actions/applicationActions";
import { axiosGet, axiosPost } from "@/redux/axios";
import type { TermsOffer } from "@/types/termsOfferTypes";
import { inferFeePercentFromFeesRaw } from "@/lib/offerDecisionFees";
import IsoApproveReviewDialog from "./IsoApproveReviewDialog";

// Yup validation schema
const approvalSchema = yup.object({
    advanceAmount: yup.number().required("Purchase Amount is required").min(0, "Must be at least 0"),
    term: yup.number().required("Term is required").min(1, "Must be at least 1"),
    upsell: yup.number().required("Upsell is required").min(0, "Must be at least 0"),
    originationFeePercent: yup
        .number()
        .required("Origination fee % is required")
        .min(0, "Min 0%")
        .max(100, "Max 100%"),
});

interface ApprovalFormData {
    advanceAmount: number;
    term: number;
    upsell: number;
    /** Percent of purchase amount; default 10%. */
    originationFeePercent: number;
}

const usdCurrencyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

const usdNumberFormatter = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
});

const formatCurrency = (value: number | null | undefined) => {
    if (value == null || Number.isNaN(value)) return "—";
    return usdCurrencyFormatter.format(value);
};

// Formats a number with US thousand separators (no currency symbol),
// e.g. 59998 -> "59,998". Returns "" for nullish/NaN so the input stays clean.
const formatNumberUS = (value: number | null | undefined) => {
    if (value == null || Number.isNaN(value)) return "";
    return usdNumberFormatter.format(value);
};

// Strips formatting characters (commas, spaces, $) so the user can type freely
// and we still get a clean numeric value for the form state.
const parseFormattedNumber = (raw: string): number => {
    const cleaned = String(raw).replace(/[^0-9.\-]/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : 0;
};

const toValidNumber = (value: unknown): number | null => {
    if (value == null || String(value).trim() === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

// Custom Slider Component
interface SliderProps {
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step?: number;
    disabled?: boolean;
}

const CustomSlider = ({ value, onChange, min, max, step = 1, disabled = false }: SliderProps) => {
    const safeMax = Number.isFinite(max) ? max : min;
    const safeMin = Number.isFinite(min) ? min : 0;
    const range = Math.max(0, safeMax - safeMin);
    const rawValue = Number.isFinite(value) ? value : safeMin;
    const clampedValue = range === 0 ? safeMin : Math.min(safeMax, Math.max(safeMin, rawValue));
    const percentage = range === 0 ? 0 : ((clampedValue - safeMin) / range) * 100;

    return (
        <div className="relative w-full h-4">
            {/* Track */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                    className="h-full bg-[#374151]"
                    style={{ width: `${percentage}%` }}
                />
            </div>

            {/* Range input */}
            <input
                type="range"
                min={safeMin}
                max={safeMax}
                step={step}
                value={clampedValue}
                    disabled={disabled}
                onChange={(e) => onChange(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />

            {/* Thumb */}
            <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-[#111827] rounded-full shadow-md border-2 border-background"
                style={{ left: `calc(${percentage}% - 8px)` }}
            />
        </div>
    );
};

// Circular Progress Ring – shows current form values (dynamic from underwriter data)
interface CircularProgressProps {
    advanceAmount: number;
    term: number;
    upsell: number;
    paymentLabel: string;
    periodicPaymentFormatted: string;
    isDark?: boolean;
}

const CircularProgress = ({
    advanceAmount,
    term,
    upsell,
    paymentLabel,
    periodicPaymentFormatted,
    isDark = false,
}: CircularProgressProps) => {
    const rings = [
        { percentage: Math.min(100, (advanceAmount / 100000) * 75), color: "#111827", radius: 80 },
        { percentage: Math.min(100, (term / 24) * 100), color: "#374151", radius: 60 },
        { percentage: Math.min(100, (upsell / 50) * 100), color: "#6B7280", radius: 40 },
    ];

    const trackStroke = isDark ? "#334155" : "#E5E7EB";
    const cardClass = isDark
        ? "bg-slate-950/95 shadow-xl shadow-black/40 border border-slate-700/80"
        : "bg-white/95 backdrop-blur-sm shadow-lg border border-gray-100";
    const labelClass = isDark ? "text-slate-400" : "text-gray-600";
    const valueClass = "font-semibold text-[#111827] dark:text-gray-200 text-right whitespace-nowrap tabular-nums";

    const summaryRows = [
        { label: "Purchase amount", value: formatCurrency(advanceAmount) },
        { label: "Term (months)", value: String(term) },
        { label: paymentLabel, value: periodicPaymentFormatted },
        { label: "Upsell", value: `${upsell}%` },
    ];

    return (
        <div className="relative w-[17.5rem] h-[17.5rem] mx-auto">
            <svg viewBox="0 0 200 200" className="w-full h-full -rotate-90">
                {rings.map((ring, index) => {
                    const circumference = 2 * Math.PI * ring.radius;
                    const strokeDasharray = circumference;
                    const strokeDashoffset = circumference - (ring.percentage / 100) * circumference;

                    return (
                        <g key={index}>
                            <circle cx="100" cy="100" r={ring.radius} fill="none" stroke={trackStroke} strokeWidth="12" />
                            <circle
                                cx="100"
                                cy="100"
                                r={ring.radius}
                                fill="none"
                                stroke={ring.color}
                                strokeWidth="12"
                                strokeLinecap="round"
                                strokeDasharray={strokeDasharray}
                                strokeDashoffset={strokeDashoffset}
                            />
                        </g>
                    );
                })}
            </svg>
            <div
                className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl p-3.5 w-[min(92%,11.5rem)] ${cardClass}`}
            >
                <p className={`text-[10px] font-semibold uppercase tracking-wide mb-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>
                    Calculator snapshot
                </p>
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[11px] leading-snug">
                    {summaryRows.map((row) => (
                        <div key={row.label} className="contents">
                            <span className={`${labelClass} min-w-0`}>{row.label}</span>
                            <span className={valueClass}>{row.value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

type ApprovalProps = {
    readOnly?: boolean;
    // Used for public/unregistered visitors: keep the UI in "read-only data" mode
    // but allow editing the calculator values.
    allowCalculatorEdit?: boolean;
    compactSpacing?: boolean;
    // Kept for compatibility with existing callers; UI action is currently disabled.
    showSendToClient?: boolean;
    applicationData?: any;
    termsOffers?: TermsOffer[];
    /** Preloaded offer decision (e.g. public approval page) — skips client fetch. */
    offerDecision?: Record<string, unknown> | null;
};

const Approval = ({
    readOnly = false,
    allowCalculatorEdit = false,
    compactSpacing = false,
    applicationData: applicationDataProp,
    termsOffers: termsOffersProp,
    offerDecision: offerDecisionProp,
}: ApprovalProps) => {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const dispatch = useDispatch<AppDispatch>();

    const { data: applicationDataRedux } = useSelector((state: RootState) => state.applicationDetail);
    const { data: termsOffersRedux, loading: termsOffersLoadingRedux } = useSelector((state: RootState) => state.termsOffers);
    const [offerDecisionData, setOfferDecisionData] = useState<any>(null);
    const resolvedOfferDecision = offerDecisionProp ?? offerDecisionData;

    const applicationData = applicationDataProp ?? applicationDataRedux;
    const termsOffers = termsOffersProp ?? termsOffersRedux;
    const termsOffersLoading = termsOffersProp != null ? false : termsOffersLoadingRedux;

    const applicationId = (applicationData as { _id?: string; id?: string })?.id ?? (applicationData as { _id?: string })?._id;
    const offerDecisionApplicationId = (applicationData as { applicationId?: string | number })?.applicationId ?? applicationId;

    /**
     * Approval action state.
     *
     * `currentlyApproved` reflects the persisted application status so the button
     * stays correctly disabled when re-rendered (page reload, redux refresh,
     * second tab, etc.).
     */
    const [isApproving, setIsApproving] = useState(false);
    const [locallyApproved, setLocallyApproved] = useState(false);
    // Calculator sliders + buy rate summary collapsed until user clicks Calculator.
    const [showCalculator, setShowCalculator] = useState(false);
    const [reviewOpen, setReviewOpen] = useState(false);
    const [approvalStatusOverride, setApprovalStatusOverride] = useState<{
        currentQueue?: string;
        currentState?: string;
    } | null>(null);

    /**
     * Stable idempotency key per mount + applicationId — protects against
     * accidental double-clicks, retried network errors, and cached email links
     * that could otherwise trigger duplicate transitions on the server.
     */
    const idempotencyKey = useMemo(() => {
        if (!applicationId) return "";
        const random = Math.random().toString(36).slice(2, 10);
        return `approve-${applicationId}-${Date.now().toString(36)}-${random}`;
    }, [applicationId]);

    const handleApproveApplication = async () => {
        if (!applicationId) {
            toast.error("Missing application id; please refresh and try again.");
            return;
        }
        if (isApproving || isApproved) return;

        const toastId = toast.loading("Submitting approval…");
        setIsApproving(true);

        try {
            const res = await axiosPost(
                `/applications/${applicationId}/approve`,
                {},
                {
                    headers: { "Idempotency-Key": idempotencyKey },
                },
            );

            const body = res?.data as {
                success?: boolean;
                message?: string;
                alreadyApproved?: boolean;
                data?: {
                    currentQueue?: string;
                    currentState?: string;
                    id?: string;
                    _id?: string;
                };
            };
            if (!body?.success) {
                throw new Error(body?.message || "Failed to approve application");
            }

            setApprovalStatusOverride({
                currentQueue: body?.data?.currentQueue ?? "Approved",
                currentState: body?.data?.currentState ?? "Approved",
            });
            setLocallyApproved(true);

            // Keep global app state synced so other tabs/cards pick up queue/state change.
            const refetchId = body?.data?.id ?? body?.data?._id ?? applicationId;
            if (refetchId) {
                void dispatch(getApplicationById(refetchId as string));
            }

            toast.update(toastId, {
                render: body.alreadyApproved
                    ? "This application was already approved."
                    : "Application approved successfully.",
                type: "success",
                isLoading: false,
                autoClose: 3000,
            });
        } catch (err: any) {
            const message =
                err?.response?.data?.message ||
                err?.message ||
                "Failed to approve application";
            toast.update(toastId, {
                render: message,
                type: "error",
                isLoading: false,
                autoClose: 4000,
            });
        } finally {
            setIsApproving(false);
        }
    };

    /**
     * A deal is considered "approved" for this button once it has reached the
     * approval transition or anything past it. ISO approvals advance straight to
     * the Contract Pending stage, so we treat the whole contract/funding workflow
     * as approved to keep the button disabled after a reload.
     */
    const POST_APPROVAL_TOKENS = new Set<string>([
        "approved",
        "completed",
        "contractpending",
        "contractgenerated",
        "contractsent",
        "contractout",
        "contractsout",
        "contractcancelled",
        "contractsigned",
        "signedcontracts",
        "fundingcall",
        "disbursment",
        "disbursement",
        "funded",
        "final",
    ]);
    const normalizeStageToken = (value: unknown) =>
        String(value ?? "")
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, "");
    const effectiveQueueToken = normalizeStageToken(
        approvalStatusOverride?.currentQueue ?? (applicationData as any)?.currentQueue ?? "",
    );
    const effectiveStateToken = normalizeStageToken(
        approvalStatusOverride?.currentState ?? (applicationData as any)?.currentState ?? "",
    );
    const currentlyApproved =
        POST_APPROVAL_TOKENS.has(effectiveQueueToken) ||
        POST_APPROVAL_TOKENS.has(effectiveStateToken);
    const isApproved = currentlyApproved || locallyApproved;

    // Fetch underwriter terms offers for this application (skip when preloaded or in read-only mode)
    useEffect(() => {
        if (readOnly) return;
        if (!applicationId) return;
        if (termsOffersProp != null) return;

        if (applicationId) {
            dispatch(getTermsOffers({ application: applicationId }));
        }
    }, [applicationId, dispatch, readOnly, termsOffersProp]);

    // Fetch persisted offer decision by application id (DB source of truth)
    useEffect(() => {
        if (offerDecisionProp != null) {
            return;
        }
        const loadOfferDecision = async () => {
            if (!offerDecisionApplicationId) {
                setOfferDecisionData(null);
                return;
            }
            try {
                const res = await axiosGet("/offer-decisions", {
                    params: { application: offerDecisionApplicationId },
                });
                const apiData = (res.data && res.data.data) || null;
                setOfferDecisionData(apiData);
            } catch {
                setOfferDecisionData(null);
            }
        };
        void loadOfferDecision();
    }, [offerDecisionApplicationId, offerDecisionProp]);

    const latestTermsOffer: TermsOffer | undefined = termsOffers?.[0];

    /** Only show offer figures after Decision Making "Approve & Save" (persisted approved offer). */
    const savedOfferAmount = toValidNumber(resolvedOfferDecision?.offer);
    const savedTerm = toValidNumber(resolvedOfferDecision?.term);
    const savedRate =
        toValidNumber(resolvedOfferDecision?.rate) ??
        toValidNumber(resolvedOfferDecision?.factorRate) ??
        toValidNumber(resolvedOfferDecision?.buyRate);
    const hasSavedOffer =
        resolvedOfferDecision?.decision === "approved" &&
        savedOfferAmount != null &&
        savedOfferAmount > 0;

    const calculatorEditable = (allowCalculatorEdit || !readOnly) && hasSavedOffer;

    const resolvedOfferAmount = hasSavedOffer ? savedOfferAmount : 0;
    const resolvedTerm =
        hasSavedOffer && savedTerm != null && savedTerm > 0 ? savedTerm : 1;
    const resolvedUpsell = hasSavedOffer
        ? (toValidNumber(applicationData?.commissionPercentage) ??
          toValidNumber(latestTermsOffer?.commissionPercent) ??
          0)
        : 0;
    const resolvedOriginationFeePercent = hasSavedOffer
        ? (inferFeePercentFromFeesRaw(
              resolvedOfferDecision?.fees,
              savedOfferAmount ?? 0,
              savedOfferAmount != null && savedRate != null
                  ? savedOfferAmount * savedRate
                  : null,
          ) ?? 0)
        : 0;
    const {
        control,
        formState: { errors },
        reset,
    } = useForm<ApprovalFormData>({
        resolver: yupResolver(approvalSchema) as any,
        defaultValues: {
            advanceAmount: resolvedOfferAmount,
            term: resolvedTerm,
            upsell: resolvedUpsell,
            originationFeePercent: resolvedOriginationFeePercent,
        },
    });

    // Keep form values synced to real persisted values (offer-decision first).
    useEffect(() => {
        reset({
            advanceAmount: resolvedOfferAmount,
            term: resolvedTerm,
            upsell: resolvedUpsell,
            originationFeePercent: resolvedOriginationFeePercent,
        });
    }, [
        resolvedOfferDecision?._id,
        latestTermsOffer?._id,
        resolvedOfferAmount,
        resolvedTerm,
        resolvedUpsell,
        resolvedOriginationFeePercent,
        reset,
    ]);

    const advanceAmount = useWatch({ control, name: "advanceAmount", defaultValue: resolvedOfferAmount });
    const term = useWatch({ control, name: "term", defaultValue: resolvedTerm });
    const upsell = useWatch({ control, name: "upsell", defaultValue: resolvedUpsell });
    const originationFeePercent = useWatch({
        control,
        name: "originationFeePercent",
        defaultValue: resolvedOriginationFeePercent,
    });
    const buyRateNum = hasSavedOffer && savedRate != null && savedRate > 0 ? savedRate : null;
    const calculatorPurchaseAmount = hasSavedOffer
        ? Math.max(0, toValidNumber(advanceAmount) ?? 0)
        : 0;
    const calculatorTerm = hasSavedOffer ? Math.max(1, toValidNumber(term) ?? 1) : 1;
    const calculatorUpsell = hasSavedOffer ? Math.max(0, toValidNumber(upsell) ?? 0) : 0;
    const calculatorPaybackAmount =
        buyRateNum != null ? calculatorPurchaseAmount * buyRateNum : null;
    const calculatorPaymentAmount =
        calculatorPaybackAmount != null && calculatorTerm > 0
            ? calculatorPaybackAmount / calculatorTerm
            : null;
    const centerGaugePeriodicPayment = formatCurrency(calculatorPaymentAmount);

    // Applicant summary — only financial fields when Decision Making offer was saved.
    const applicantSummary = (() => {
        const client = applicationData?.client as any;
        const borrowerName = client?.owner ? `${client.owner.firstName || ""} ${client.owner.lastName || ""}`.trim() : null;
        const businessName = client?.business?.name ?? null;

        const normalizedFrequency = String(resolvedOfferDecision?.frequency ?? "").trim();
        const frequency =
            normalizedFrequency === "Weekly" ||
            normalizedFrequency === "Monthly" ||
            normalizedFrequency === "Daily" ||
            normalizedFrequency === "Bi-Weekly"
                ? normalizedFrequency
                : "—";

        return {
            borrowerName: borrowerName || "—",
            businessName: businessName || "—",
            loanAmount: hasSavedOffer ? formatCurrency(savedOfferAmount) : "—",
            factorRate:
                hasSavedOffer && buyRateNum != null ? buyRateNum.toFixed(3) : "—",
            tenure:
                hasSavedOffer && savedTerm != null && savedTerm > 0
                    ? `${savedTerm}`
                    : "—",
            frequency: hasSavedOffer ? frequency : "—",
        };
    })();

    const centerGaugePaymentLabel =
        applicantSummary.frequency && applicantSummary.frequency !== "—"
            ? `${applicantSummary.frequency} Payment`
            : "Payment";

    // Woodmere brand: black / slate-gray gradients (logo palette)
    const gradient = isDark
        ? "linear-gradient(135deg, #374151 0%, #1F2937 45%, #000000 100%)"
        : "linear-gradient(135deg, #6F7887 0%, #374151 50%, #111827 100%)";

    const summaryPanelClass = isDark
        ? "bg-white/8 border border-white/12 backdrop-blur-sm rounded-lg"
        : "bg-white/12 border border-white/20 backdrop-blur-sm rounded-lg";

    // const handleSendToClient = async () => {
    //     if (!canSendToClient) return;

    //     if (!applicationId) {
    //         toast.error("No application selected");
    //         return;
    //     }

    //     if (emailSent) {
    //         return;
    //     }

    //     const toastId = toast.loading("Sending approval email to client...");
    //     setIsSendingEmail(true);

    //     try {
    //         await dispatch(sendApprovalEmail(applicationId)).unwrap();
    //         setEmailSent(true);
    //         toast.update(toastId, {
    //             render: "Email sent successfully",
    //             type: "success",
    //             isLoading: false,
    //             autoClose: 3000,
    //         });
    //     } catch (error: any) {
    //         const message =
    //             (typeof error === "string" && error) ||
    //             error?.message ||
    //             "Failed to send approval email";
    //         toast.update(toastId, {
    //             render: message,
    //             type: "error",
    //             isLoading: false,
    //             autoClose: 4000,
    //         });
    //     } finally {
    //         setIsSendingEmail(false);
    //     }
    // };

    return (
        <div className={compactSpacing ? "space-y-4" : "space-y-6"}>
            {/* Calculator toggle + Approve (opens review dialog) */}
            <div className="flex items-center justify-between gap-3">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCalculator((v) => !v)}
                    className="gap-1.5"
                    aria-expanded={showCalculator}
                >
                    <CalculatorIcon className="w-4 h-4" />
                    Calculator
                    {showCalculator ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </Button>
                {applicationId ? (
                    <Button
                        type="button"
                        onClick={() => setReviewOpen(true)}
                        disabled={isApproving || isApproved || !hasSavedOffer}
                        title={!hasSavedOffer ? "An offer must be saved in Decision Making before approval." : undefined}
                        className={`shrink-0 cursor-pointer font-semibold px-5 py-2 rounded-md text-white shadow-sm transition-colors disabled:cursor-not-allowed ${
                            isApproved
                                ? "bg-[#16A34A] hover:bg-[#16A34A] disabled:opacity-100"
                                : "bg-[#22C55E] hover:bg-[#16A34A] disabled:opacity-60"
                        }`}
                        aria-label={isApproved ? "Application approved" : "Review and approve application"}
                    >
                        {isApproving ? (
                            <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Approving…</span>
                        ) : isApproved ? (
                            <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Approved</span>
                        ) : (
                            "Approve"
                        )}
                    </Button>
                ) : null}
            </div>

            {/* Applicant Summary — always visible below Calculator button */}
            <Card className={`border-0 shadow-lg overflow-hidden py-0 ${isDark ? "ring-1 ring-gray-600/30" : "ring-1 ring-gray-300/40"}`}>
                <CardContent
                    className={compactSpacing ? "p-4 pt-4" : "p-6"}
                    style={{ background: gradient }}
                >
                    <h2 className={`text-white font-bold uppercase tracking-wider ${compactSpacing ? "mb-2 text-xl" : "mb-4 text-2xl"}`}>
                        CALCULATE YOUR OWN APPROVAL
                    </h2>
                    <p className={`text-gray-300 text-sm ${compactSpacing ? "mb-3" : "mb-4"}`}>Applicant Summary</p>

                    <div className={`${summaryPanelClass} ${compactSpacing ? "p-3" : "p-4"}`}>
                        <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 text-white ${compactSpacing ? "gap-3" : "gap-4"}`}>
                            <div>
                                <p className="text-xs font-medium text-gray-300 mb-1">Borrower Name</p>
                                <p className="text-sm font-semibold">{applicantSummary.borrowerName}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-gray-300 mb-1">Business Name</p>
                                <p className="text-sm font-semibold">{applicantSummary.businessName}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-gray-300 mb-1">Loan Amount</p>
                                <p className="text-sm font-semibold">{applicantSummary.loanAmount}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-gray-300 mb-1">Factor Rate</p>
                                <p className="text-sm font-semibold">{applicantSummary.factorRate}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-gray-300 mb-1">Terms</p>
                                <p className="text-sm font-semibold">{applicantSummary.tenure}</p>
                            </div>
                            <div>
                                <p className="text-xs font-medium text-gray-300 mb-1">Frequency</p>
                                <p className="text-sm font-semibold">{applicantSummary.frequency}</p>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Calculator fields + Buy Rate Summary — toggled by Calculator button */}
            {showCalculator && (
            <div className={compactSpacing ? "grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5" : "grid grid-cols-1 gap-6 lg:grid-cols-3"}>
                {!hasSavedOffer ? (
                    <div className="lg:col-span-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                        No approval offer has been saved yet. The underwriter must complete the offer in Decision Making and click <strong>Approve &amp; Save</strong> before amounts appear here.
                    </div>
                ) : (
                <>
                <div className="lg:col-span-2">
                    {/* Sliders Section */}
                    <div>
                        <p className="text-sm text-foreground mb-4">
                            If customer takes less than the max approval, they are able to take additional
                            funding when needed.
                        </p>
                        <div className={compactSpacing ? "grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-6" : "grid grid-cols-1 gap-8 md:grid-cols-2"}>
                            <div className={compactSpacing ? "space-y-5" : "space-y-6"}>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-gray-700">
                                            Purchase Amount ($)
                                        </label>
                                        <span className="text-sm font-semibold text-[#111827] dark:text-gray-200">
                                            {termsOffersLoading ? "—" : formatCurrency(advanceAmount ?? 0)}
                                        </span>
                                    </div>
                                    <Controller
                                        name="advanceAmount"
                                        control={control}
                                        render={({ field }) => (
                                            <CustomSlider
                                                disabled={!calculatorEditable}
                                                value={field.value ?? resolvedOfferAmount}
                                                onChange={field.onChange}
                                                min={0}
                                                max={Math.max(resolvedOfferAmount, field.value ?? 0)}
                                                step={1000}
                                            />
                                        )}
                                    />
                                    <Controller
                                        name="advanceAmount"
                                        control={control}
                                        render={({ field }) => (
                                            <Input
                                                type="text"
                                                inputMode="numeric"
                                                value={formatNumberUS(field.value)}
                                                onChange={(e) =>
                                                    field.onChange(
                                                        Math.max(0, parseFormattedNumber(e.target.value)),
                                                    )
                                                }
                                                disabled={!calculatorEditable}
                                                className="h-10 border-gray-300"
                                            />
                                        )}
                                    />
                                    {errors.advanceAmount && (
                                        <p className="text-red-500 text-xs">{errors.advanceAmount.message}</p>
                                    )}
                                </div>

                                {/* Est. Term Slider */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-gray-700">
                                            Est. Term 
                                        </label>
                                        {/* <span className="text-sm font-semibold text-[#111827] dark:text-gray-200">{term ?? 24}</span> */}
                                    </div>
                                    <Controller
                                        name="term"
                                        control={control}
                                        render={({ field }) => (
                                            <CustomSlider
                                                disabled={!calculatorEditable}
                                                value={field.value ?? resolvedTerm}
                                                onChange={field.onChange}
                                                min={1}
                                                max={24}
                                                step={1}
                                            />
                                        )}
                                    />
                                    <Controller
                                        name="term"
                                        control={control}
                                        render={({ field }) => (
                                            <Input
                                                type="number"
                                                value={field.value}
                                                onChange={(e) => field.onChange(Math.max(1, Number(e.target.value) || 1))}
                                                disabled={!calculatorEditable}
                                                className="h-10 border-gray-300 [appearance:auto] [&::-webkit-inner-spin-button]:appearance-auto [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:appearance-auto [&::-webkit-outer-spin-button]:opacity-100"
                                            />
                                        )}
                                    />
                                    {errors.term && (
                                        <p className="text-red-500 text-xs">{errors.term.message}</p>
                                    )}
                                </div>

                                {/* Upsell Slider */}
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-medium text-gray-700">Upsell (%)</label>
                                        {/* <span className="text-sm font-semibold text-[#111827] dark:text-gray-200">{upsell ?? 0}</span> */}
                                    </div>
                                    <Controller
                                        name="upsell"
                                        control={control}
                                        render={({ field }) => (
                                            <CustomSlider
                                                disabled={!calculatorEditable}
                                                value={field.value ?? resolvedUpsell}
                                                onChange={field.onChange}
                                                min={1}
                                                max={50}
                                                step={1}
                                            />
                                        )}
                                    />
                                    <Controller
                                        name="upsell"
                                        control={control}
                                        render={({ field }) => (
                                            <Input
                                                type="number"
                                                value={field.value}
                                                onChange={(e) => {
                                                    field.onChange(Math.max(0, Number(e.target.value) || 0));
                                                }}
                                                disabled={!calculatorEditable}
                                                className="h-10 border-gray-300 [appearance:auto] [&::-webkit-inner-spin-button]:appearance-auto [&::-webkit-inner-spin-button]:opacity-100 [&::-webkit-outer-spin-button]:appearance-auto [&::-webkit-outer-spin-button]:opacity-100"
                                            />
                                        )}
                                    />
                                    {errors.upsell && (
                                        <p className="text-red-500 text-xs">{errors.upsell.message}</p>
                                    )}
                                </div>
                            </div>
                            <div className="flex justify-center items-center">
                                <CircularProgress
                                    advanceAmount={advanceAmount ?? 0}
                                    term={term ?? resolvedTerm}
                                    upsell={upsell ?? resolvedUpsell}
                                    paymentLabel={centerGaugePaymentLabel}
                                    periodicPaymentFormatted={centerGaugePeriodicPayment}
                                    isDark={isDark}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column - Buy Rate Summary (dynamic from underwriter terms offer + form) */}
                <div className="lg:col-span-1">
                    <Card className="border border-gray-200 shadow-sm sticky top-4">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-foreground text-lg font-semibold">
                                Buy Rate Summary
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {termsOffersLoading ? (
                                <p className="text-sm text-muted-foreground py-4">Loading approval details…</p>
                            ) : (
                                <div className="space-y-4">
                                    {(() => {
                                        const t = latestTermsOffer;
                                        const advance = calculatorPurchaseAmount;
                                        const payback = formatCurrency(calculatorPaybackAmount);
                                        const periodicPayment = formatCurrency(calculatorPaymentAmount);
                                        const paymentLabel = `${applicantSummary.frequency} Payment`;
                                        const buyRate = buyRateNum != null ? buyRateNum.toFixed(3) : "—";
                                        const upsellPercent = calculatorUpsell;
                                        const upsellVal = upsellPercent != null ? `${upsellPercent}%` : "—";
                                        const sellRate =
                                            buyRateNum != null && upsellPercent != null
                                                ? (buyRateNum + (buyRateNum * upsellPercent) / 100).toFixed(3)
                                                : "—";
                                        const purchaseNum = Number(advance) || 0;
                                        const originationPct = originationFeePercent ?? 10;
                                        const originationDollar = purchaseNum * (originationPct / 100);
                                        const originationSummary = formatCurrency(originationDollar);
                                        // const applicationFee = "—";
                                        // const professionalFee = t ? "- $0" : "—";
                                        const position = resolvedOfferDecision?.position ?? t?.position ?? "—";
                                        const rows = [
                                            { label: "Purchase Amount", value: formatCurrency(advance), highlight: true },
                                            { label: "Payback Amount", value: payback },
                                            { label: paymentLabel, value: periodicPayment },
                                            { label: "Buy Rate", value: buyRate },
                                            { label: "Upsell", value: upsellVal, isUpsell: true },
                                            { label: "Sell Rate", value: sellRate },
                                            { label: "Origination Fee", value: originationSummary, isOrigination: true },
                                            // { label: "Application Fee", value: applicationFee, negative: true },
                                            // { label: "Professional Fee", value: professionalFee, negative: true },
                                            { label: "Position", value: position, position: true },
                                        ];
                                        return rows.map((item, index) => {
                                            if ("isOrigination" in item && item.isOrigination) {
                                                return (
                                                    <div key={index} className="w-full">
                                                        <div className="flex w-full items-center gap-2 py-2">
                                                            <div className="flex w-[55%] min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
                                                                <span className="shrink-0 text-sm font-medium leading-tight text-[#111827] dark:text-gray-200">
                                                                    {item.label}
                                                                </span>
                                                                {calculatorEditable ? (
                                                                    <div className="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-input bg-background px-2 shadow-sm">
                                                                        <Controller
                                                                            name="originationFeePercent"
                                                                            control={control}
                                                                            render={({ field }) => (
                                                                                <Input
                                                                                    type="number"
                                                                                    min={0}
                                                                                    max={100}
                                                                                    step={0.5}
                                                                                    value={field.value}
                                                                                    onChange={(e) =>
                                                                                        field.onChange(Number(e.target.value))
                                                                                    }
                                                                                    className="h-7 w-14 min-w-[3.5rem] border-0 bg-transparent p-0 pr-1 text-right text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                                                                                />
                                                                            )}
                                                                        />
                                                                        <span className="truncate text-xs text-muted-foreground">
                                                                            % 
                                                                        </span>
                                                                    </div>
                                                                ) : (
                                                                    <span className="truncate text-xs text-muted-foreground">
                                                                        ({originationPct}% of purchase)
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <span className="w-[45%] shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                                                                {item.value}
                                                            </span>
                                                        </div>
                                                        {errors.originationFeePercent && (
                                                            <p className="pb-1 pl-[55%] text-right text-xs text-red-500">
                                                                {errors.originationFeePercent.message}
                                                            </p>
                                                        )}
                                                    </div>
                                                );
                                            }

                                            if ("isUpsell" in item && item.isUpsell) {
                                                return (
                                                    <div key={index} className="w-full">
                                                        <div className="flex w-full items-center gap-2 py-2">
                                                            <div className="flex w-[55%] min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1">
                                                                <span className="shrink-0 text-sm font-medium leading-tight text-[#111827] dark:text-gray-200">
                                                                    {item.label}
                                                                </span>
                                                                <div className="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-md border border-input bg-background px-2 shadow-sm">
                                                                    <Controller
                                                                        name="upsell"
                                                                        control={control}
                                                                        render={({ field }) => (
                                                                            <Input
                                                                                type="number"
                                                                                min={0}
                                                                                max={50}
                                                                                step={1}
                                                                                value={field.value}
                                                                                onChange={(e) => {
                                                                                    const n = Number(e.target.value);
                                                                                    const clamped = Number.isFinite(n)
                                                                                        ? Math.min(50, Math.max(0, n))
                                                                                        : 0;
                                                                                    field.onChange(clamped);
                                                                                }}
                                                                                disabled={!calculatorEditable}
                                                                                className="h-7 w-14 min-w-[3.5rem] border-0 bg-transparent p-0 pr-1 text-right text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-70"
                                                                            />
                                                                        )}
                                                                    />
                                                                    <span className="truncate text-xs text-muted-foreground">
                                                                        %
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <span className="w-[45%] shrink-0 text-right text-sm font-semibold tabular-nums text-foreground">
                                                                {item.value}
                                                            </span>
                                                        </div>
                                                        {errors.upsell && (
                                                            <p className="pb-1 pl-[55%] text-right text-xs text-red-500">
                                                                {errors.upsell.message}
                                                            </p>
                                                        )}
                                                    </div>
                                                );
                                            }

                                            return (
                                                <div key={index} className="flex w-full items-center justify-between gap-2 py-2">
                                                    <span className="w-[55%] shrink-0 text-sm font-medium text-[#111827] dark:text-gray-200">{item.label}</span>
                                                    <span className="w-[45%] min-w-0 text-right text-sm font-semibold text-foreground break-words">
                                                        {item.value}
                                                    </span>
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
                </>
                )}
            </div>
            )}

            <IsoApproveReviewDialog
                open={reviewOpen}
                onOpenChange={setReviewOpen}
                applicationData={applicationData}
                summary={{
                    borrowerName: applicantSummary.borrowerName,
                    businessName: applicantSummary.businessName,
                    loanAmount: applicantSummary.loanAmount,
                    factorRate: applicantSummary.factorRate,
                    term: applicantSummary.tenure,
                    frequency: applicantSummary.frequency,
                    purchaseAmount: formatCurrency(calculatorPurchaseAmount),
                    payback: formatCurrency(calculatorPaybackAmount),
                    payment: formatCurrency(calculatorPaymentAmount),
                }}
                onApprove={handleApproveApplication}
                approving={isApproving}
            />
        </div>
    );
};

export default Approval;
