"use client";

import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import { Coins, Loader2, Save } from "lucide-react";
import type { AppDispatch, RootState } from "@/redux/store";
import { Button } from "@/components/ui/button";
import {
  getApplicationByApplicationId,
  updateApplication,
} from "@/redux/actions/applicationActions";
import { normalizeRoleKey, resolveEffectiveRole } from "@/lib/sessionRole";
import {
  formatCurrency,
  formatNumberUS,
  formatNumberUSForInput,
  parseNumberUS,
} from "@/lib/utils";
import type { UpdateApplicationPayload } from "@/types/applicationTypes";

type DisbursementCommissionSectionProps = {
  applicationRecordId: string | null;
  refetchApplicationId?: string | null;
  /** `embedded` renders inside Deal Review dialog; `standalone` is the full page card. */
  variant?: "standalone" | "embedded";
  /** When set (e.g. dialog offer advance), used instead of resolving from application. */
  offerAmountOverride?: number | null;
};

function toValidNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value).replace(/[$,%\s]/g, "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function getIsoDisplayName(app: Record<string, unknown> | null | undefined): string {
  if (!app) return "—";
  const iso = app.iso as Record<string, unknown> | undefined;
  if (iso?.name && String(iso.name).trim()) return String(iso.name).trim();
  if (app.isoName && String(app.isoName).trim()) return String(app.isoName).trim();

  const agent = app.referringAgent;
  if (agent && typeof agent === "object") {
    const a = agent as Record<string, unknown>;
    const full = [a.firstName, a.lastName].filter(Boolean).join(" ").trim();
    if (full) return full;
    if (a.name && String(a.name).trim()) return String(a.name).trim();
    if (a.email && String(a.email).trim()) return String(a.email).trim();
  }
  if (typeof agent === "string" && agent.trim()) return agent.trim();
  return "—";
}

function getApprovingUnderwriterName(
  app: Record<string, unknown> | null | undefined,
): string {
  if (!app) return "—";
  const approved = app.approvedByUnderwriter as Record<string, unknown> | undefined;
  if (!approved) return "—";
  const full = [approved.firstName, approved.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (approved.email && String(approved.email).trim()) return String(approved.email).trim();
  return "—";
}

/** Resolve the application's offer/advance amount across the shapes the API returns. */
function resolveOfferAmount(
  app: Record<string, unknown> | null | undefined,
): number | null {
  if (!app) return null;

  const direct = toValidNumber(app.loanAmount);
  if (direct != null && direct > 0) return direct;

  const termsOffers = app.termsOffers as
    | { approvedAmount?: number | string | null }[]
    | undefined;
  if (Array.isArray(termsOffers) && termsOffers.length) {
    const approved = toValidNumber(termsOffers[0]?.approvedAmount);
    if (approved != null && approved > 0) return approved;
  }

  const offerDecision = app.OfferDecision as
    | { offer?: number | string | Record<string, unknown> | null }
    | null
    | undefined;
  if (offerDecision) {
    const offer = offerDecision.offer;
    if (offer != null && typeof offer === "object") {
      const inner = offer as Record<string, unknown>;
      const innerOffer =
        toValidNumber(inner.offer) ?? toValidNumber(inner.approvedAmount);
      if (innerOffer != null && innerOffer > 0) return innerOffer;
    } else {
      const flat = toValidNumber(offer);
      if (flat != null && flat > 0) return flat;
    }
  }

  return direct;
}

/** Commission dollars as a percentage of the offer amount, e.g. 5000 / 100000 → 5. */
function computeCommissionPercent(
  amount: number | null,
  offer: number | null,
): number | null {
  if (amount == null || offer == null || offer <= 0) return null;
  return (amount / offer) * 100;
}

function formatPercentLabel(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return "—";
  return `${percent.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function formatAmountDraft(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return formatNumberUS(value);
}

function parseAmountDraft(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = parseNumberUS(trimmed);
  return Number.isFinite(n) ? n : null;
}

function parsePercentDraft(raw: string): number | null {
  const trimmed = raw.trim().replace(/%/g, "");
  if (!trimmed) return null;
  const n = parseNumberUS(trimmed);
  return Number.isFinite(n) ? n : null;
}

function formatPercentDraft(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function amountFromPercent(percent: number, offer: number): number {
  return (offer * percent) / 100;
}

type PercentInputProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
};

function PercentInput({
  id,
  value,
  onChange,
  placeholder = "0",
}: PercentInputProps) {
  return (
    <div className="flex h-11 w-full items-stretch overflow-hidden rounded-md border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-[#1e60a3]/20 dark:border-slate-600 dark:bg-slate-900">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(formatNumberUSForInput(e.target.value.replace(/%/g, "")))}
        onBlur={() => {
          const parsed = parsePercentDraft(value);
          if (parsed != null) {
            onChange(formatPercentDraft(parsed));
          }
        }}
        className="min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-semibold tabular-nums text-slate-800 outline-none dark:text-slate-100"
      />
      <span className="flex shrink-0 select-none items-center pr-3 text-sm font-medium text-slate-500 dark:text-slate-400">
        %
      </span>
    </div>
  );
}

type CurrencyAmountInputProps = {
  id: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
};

function CurrencyAmountInput({
  id,
  value,
  onChange,
  placeholder = "0.00",
}: CurrencyAmountInputProps) {
  return (
    <div className="flex h-11 w-full items-stretch overflow-hidden rounded-md border border-slate-200 bg-white focus-within:ring-2 focus-within:ring-[#1e60a3]/20 dark:border-slate-600 dark:bg-slate-900">
      <span className="flex shrink-0 select-none items-center pl-3 text-sm font-medium text-slate-500 dark:text-slate-400">
        $
      </span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(formatNumberUSForInput(e.target.value))}
        onBlur={() => {
          const parsed = parseAmountDraft(value);
          if (parsed != null) {
            onChange(formatNumberUS(parsed));
          }
        }}
        className="min-w-0 flex-1 border-0 bg-transparent px-2 pr-3 text-sm font-semibold tabular-nums text-slate-800 outline-none dark:text-slate-100"
      />
    </div>
  );
}

function CommissionSectionHeading({ title }: { title: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100/90 px-5 py-3.5 dark:border-slate-800">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Coins className="h-4 w-4" />
        </div>
        <h4 className="text-sm font-semibold tracking-tight text-slate-800 dark:text-slate-100">
          {title}
        </h4>
      </div>
    </div>
  );
}

function CommissionReadOnlyParty({
  role,
  name,
  amount,
  percent,
}: {
  role: string;
  name: string;
  amount: number | null;
  percent: number | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-4 py-3.5 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          {role}
        </span>
        <span className="inline-flex items-center rounded-full bg-[#1e60a3]/10 px-2 py-0.5 text-[11px] font-bold text-[#1e60a3] dark:bg-sky-500/15 dark:text-sky-300">
          {percent != null ? formatPercentLabel(percent) : "—"}
        </span>
      </div>
      <p
        className="mt-1 truncate text-sm font-semibold text-slate-800 dark:text-slate-100"
        title={name}
      >
        {name}
      </p>
      <p className="mt-1 text-base font-bold tabular-nums text-slate-900 dark:text-slate-50">
        {amount != null ? formatCurrency(amount) : "—"}
      </p>
      <p className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
        {percent != null ? "of offer advance" : "Not set"}
      </p>
    </div>
  );
}

export function DisbursementCommissionSection({
  applicationRecordId,
  refetchApplicationId,
  variant = "standalone",
  offerAmountOverride,
}: DisbursementCommissionSectionProps) {
  const dispatch = useDispatch<AppDispatch>();
  const loginUser = useSelector((state: RootState) => state.login?.data?.user);
  const applicationDetail = useSelector(
    (state: RootState) => state.applicationDetail.data,
  );

  const roleKey = normalizeRoleKey(resolveEffectiveRole(loginUser));
  const canEditCommission =
    roleKey === "SUPER_ADMIN" || roleKey === "OPERATIONS";

  const appRecord = applicationDetail as Record<string, unknown> | null;

  const isoName = useMemo(() => getIsoDisplayName(appRecord), [appRecord]);
  const underwriterName = useMemo(
    () => getApprovingUnderwriterName(appRecord),
    [appRecord],
  );

  const resolvedOfferAmount = useMemo(
    () => resolveOfferAmount(appRecord),
    [appRecord],
  );
  const offerAmount =
    offerAmountOverride != null && offerAmountOverride > 0
      ? offerAmountOverride
      : resolvedOfferAmount;

  const storedIsoAmount = useMemo(
    () => toValidNumber(appRecord?.commissionAmount),
    [appRecord],
  );
  const storedUnderwriterAmount = useMemo(
    () => toValidNumber(appRecord?.underwriterCommissionAmount),
    [appRecord],
  );
  const storedIsoPercent = useMemo(() => {
    const fromDb = toValidNumber(appRecord?.commissionPercentage);
    if (fromDb != null) return fromDb;
    return computeCommissionPercent(storedIsoAmount, offerAmount);
  }, [appRecord, storedIsoAmount, offerAmount]);
  const storedUnderwriterPercent = useMemo(() => {
    const fromDb = toValidNumber(appRecord?.underwriterCommissionPercentage);
    if (fromDb != null) return fromDb;
    return computeCommissionPercent(storedUnderwriterAmount, offerAmount);
  }, [appRecord, storedUnderwriterAmount, offerAmount]);

  const [isoAmountDraft, setIsoAmountDraft] = useState("");
  const [underwriterAmountDraft, setUnderwriterAmountDraft] = useState("");
  const [isoPercentDraft, setIsoPercentDraft] = useState("");
  const [underwriterPercentDraft, setUnderwriterPercentDraft] = useState("");
  const [isoBaseline, setIsoBaseline] = useState<number | null>(null);
  const [underwriterBaseline, setUnderwriterBaseline] = useState<number | null>(null);
  const [isoPercentBaseline, setIsoPercentBaseline] = useState<number | null>(null);
  const [underwriterPercentBaseline, setUnderwriterPercentBaseline] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setIsoAmountDraft(formatAmountDraft(storedIsoAmount));
    setIsoBaseline(storedIsoAmount);
    setIsoPercentDraft(formatPercentDraft(storedIsoPercent));
    setIsoPercentBaseline(storedIsoPercent);
    setUnderwriterAmountDraft(formatAmountDraft(storedUnderwriterAmount));
    setUnderwriterBaseline(storedUnderwriterAmount);
    setUnderwriterPercentDraft(formatPercentDraft(storedUnderwriterPercent));
    setUnderwriterPercentBaseline(storedUnderwriterPercent);
  }, [
    storedIsoAmount,
    storedUnderwriterAmount,
    storedIsoPercent,
    storedUnderwriterPercent,
    applicationRecordId,
  ]);

  const draftIsoAmount = useMemo(
    () => parseAmountDraft(isoAmountDraft),
    [isoAmountDraft],
  );
  const draftUnderwriterAmount = useMemo(
    () => parseAmountDraft(underwriterAmountDraft),
    [underwriterAmountDraft],
  );

  const draftIsoPercent = useMemo(
    () => parsePercentDraft(isoPercentDraft),
    [isoPercentDraft],
  );
  const draftUnderwriterPercent = useMemo(
    () => parsePercentDraft(underwriterPercentDraft),
    [underwriterPercentDraft],
  );

  const isoPercent = useMemo(
    () => draftIsoPercent ?? computeCommissionPercent(draftIsoAmount, offerAmount),
    [draftIsoPercent, draftIsoAmount, offerAmount],
  );
  const underwriterPercent = useMemo(
    () =>
      draftUnderwriterPercent ??
      computeCommissionPercent(draftUnderwriterAmount, offerAmount),
    [draftUnderwriterPercent, draftUnderwriterAmount, offerAmount],
  );

  const syncIsoFromAmount = (rawAmount: string) => {
    setIsoAmountDraft(rawAmount);
    const amount = parseAmountDraft(rawAmount);
    if (amount != null && offerAmount != null && offerAmount > 0) {
      setIsoPercentDraft(formatPercentDraft(computeCommissionPercent(amount, offerAmount)));
      return;
    }
    if (!rawAmount.trim()) {
      setIsoPercentDraft("");
    }
  };

  const syncIsoFromPercent = (rawPercent: string) => {
    setIsoPercentDraft(rawPercent);
    const percent = parsePercentDraft(rawPercent);
    if (percent != null && offerAmount != null && offerAmount > 0) {
      setIsoAmountDraft(formatAmountDraft(amountFromPercent(percent, offerAmount)));
      return;
    }
    if (!rawPercent.trim()) {
      setIsoAmountDraft("");
    }
  };

  const syncUnderwriterFromAmount = (rawAmount: string) => {
    setUnderwriterAmountDraft(rawAmount);
    const amount = parseAmountDraft(rawAmount);
    if (amount != null && offerAmount != null && offerAmount > 0) {
      setUnderwriterPercentDraft(
        formatPercentDraft(computeCommissionPercent(amount, offerAmount)),
      );
      return;
    }
    if (!rawAmount.trim()) {
      setUnderwriterPercentDraft("");
    }
  };

  const syncUnderwriterFromPercent = (rawPercent: string) => {
    setUnderwriterPercentDraft(rawPercent);
    const percent = parsePercentDraft(rawPercent);
    if (percent != null && offerAmount != null && offerAmount > 0) {
      setUnderwriterAmountDraft(
        formatAmountDraft(amountFromPercent(percent, offerAmount)),
      );
      return;
    }
    if (!rawPercent.trim()) {
      setUnderwriterAmountDraft("");
    }
  };

  const valueChanged = (
    draft: number | null,
    baseline: number | null,
  ): boolean => {
    if ((draft ?? null) === (baseline ?? null)) return false;
    if (
      draft != null &&
      baseline != null &&
      Math.abs(draft - baseline) < 0.005
    ) {
      return false;
    }
    return true;
  };

  const amountsChanged = useMemo(() => {
    return (
      valueChanged(draftIsoAmount, isoBaseline) ||
      valueChanged(draftUnderwriterAmount, underwriterBaseline) ||
      valueChanged(draftIsoPercent, isoPercentBaseline) ||
      valueChanged(draftUnderwriterPercent, underwriterPercentBaseline)
    );
  }, [
    draftIsoAmount,
    draftUnderwriterAmount,
    draftIsoPercent,
    draftUnderwriterPercent,
    isoBaseline,
    underwriterBaseline,
    isoPercentBaseline,
    underwriterPercentBaseline,
  ]);

  const canSave = useMemo(() => {
    if (isoAmountDraft.trim() && draftIsoAmount == null) return false;
    if (underwriterAmountDraft.trim() && draftUnderwriterAmount == null) return false;
    if (isoPercentDraft.trim() && draftIsoPercent == null) return false;
    if (underwriterPercentDraft.trim() && draftUnderwriterPercent == null) return false;
    if (draftIsoAmount != null && draftIsoAmount < 0) return false;
    if (draftUnderwriterAmount != null && draftUnderwriterAmount < 0) return false;
    if (draftIsoPercent != null && (draftIsoPercent < 0 || draftIsoPercent > 100)) return false;
    if (
      draftUnderwriterPercent != null &&
      (draftUnderwriterPercent < 0 || draftUnderwriterPercent > 100)
    ) {
      return false;
    }
    return amountsChanged;
  }, [
    isoAmountDraft,
    underwriterAmountDraft,
    isoPercentDraft,
    underwriterPercentDraft,
    draftIsoAmount,
    draftUnderwriterAmount,
    draftIsoPercent,
    draftUnderwriterPercent,
    amountsChanged,
  ]);

  const handleSave = async () => {
    if (!applicationRecordId) {
      toast.error("Application record is not loaded.");
      return;
    }
    if (isoAmountDraft.trim() && draftIsoAmount == null) {
      toast.error("Enter a valid ISO commission amount.");
      return;
    }
    if (underwriterAmountDraft.trim() && draftUnderwriterAmount == null) {
      toast.error("Enter a valid underwriter commission amount.");
      return;
    }
    if (draftIsoAmount != null && draftIsoAmount < 0) {
      toast.error("ISO commission amount cannot be negative.");
      return;
    }
    if (draftUnderwriterAmount != null && draftUnderwriterAmount < 0) {
      toast.error("Underwriter commission amount cannot be negative.");
      return;
    }

    if (isoPercentDraft.trim() && draftIsoPercent == null) {
      toast.error("Enter a valid ISO commission percent.");
      return;
    }
    if (underwriterPercentDraft.trim() && draftUnderwriterPercent == null) {
      toast.error("Enter a valid underwriter commission percent.");
      return;
    }
    if (draftIsoPercent != null && (draftIsoPercent < 0 || draftIsoPercent > 100)) {
      toast.error("ISO commission percent must be between 0 and 100.");
      return;
    }
    if (
      draftUnderwriterPercent != null &&
      (draftUnderwriterPercent < 0 || draftUnderwriterPercent > 100)
    ) {
      toast.error("Underwriter commission percent must be between 0 and 100.");
      return;
    }

    const resolvedIsoAmount =
      draftIsoAmount ??
      (draftIsoPercent != null && offerAmount != null && offerAmount > 0
        ? amountFromPercent(draftIsoPercent, offerAmount)
        : null);
    const resolvedUnderwriterAmount =
      draftUnderwriterAmount ??
      (draftUnderwriterPercent != null && offerAmount != null && offerAmount > 0
        ? amountFromPercent(draftUnderwriterPercent, offerAmount)
        : null);
    const resolvedIsoPercent =
      draftIsoPercent ??
      computeCommissionPercent(resolvedIsoAmount, offerAmount);
    const resolvedUnderwriterPercent =
      draftUnderwriterPercent ??
      computeCommissionPercent(resolvedUnderwriterAmount, offerAmount);

    const payload: UpdateApplicationPayload = {};
    if (valueChanged(resolvedIsoAmount, isoBaseline)) {
      payload.commissionAmount = resolvedIsoAmount ?? null;
    }
    if (valueChanged(resolvedUnderwriterAmount, underwriterBaseline)) {
      payload.underwriterCommissionAmount = resolvedUnderwriterAmount ?? null;
    }
    if (valueChanged(resolvedIsoPercent, isoPercentBaseline)) {
      payload.commissionPercentage = resolvedIsoPercent ?? undefined;
    }
    if (valueChanged(resolvedUnderwriterPercent, underwriterPercentBaseline)) {
      payload.underwriterCommissionPercentage =
        resolvedUnderwriterPercent ?? undefined;
    }

    if (Object.keys(payload).length === 0) {
      toast.info("No commission changes to save.");
      return;
    }

    setSaving(true);
    try {
      await dispatch(
        updateApplication({
          id: applicationRecordId,
          data: payload,
        }),
      ).unwrap();

      setIsoBaseline(resolvedIsoAmount);
      setUnderwriterBaseline(resolvedUnderwriterAmount);
      setIsoPercentBaseline(resolvedIsoPercent);
      setUnderwriterPercentBaseline(resolvedUnderwriterPercent);
      if (resolvedIsoAmount != null) {
        setIsoAmountDraft(formatNumberUS(resolvedIsoAmount));
      }
      if (resolvedUnderwriterAmount != null) {
        setUnderwriterAmountDraft(formatNumberUS(resolvedUnderwriterAmount));
      }
      if (resolvedIsoPercent != null) {
        setIsoPercentDraft(formatPercentDraft(resolvedIsoPercent));
      }
      if (resolvedUnderwriterPercent != null) {
        setUnderwriterPercentDraft(formatPercentDraft(resolvedUnderwriterPercent));
      }

      if (refetchApplicationId) {
        void dispatch(getApplicationByApplicationId(String(refetchApplicationId)));
      }

      toast.success("Commission amounts saved.");
    } catch (err: unknown) {
      const message =
        typeof err === "string"
          ? err
          : (err as { message?: string })?.message;
      toast.error(message || "Failed to save commission amounts.");
    } finally {
      setSaving(false);
    }
  };

  const effectiveIsoAmount =
    draftIsoAmount ??
    (draftIsoPercent != null && offerAmount != null && offerAmount > 0
      ? amountFromPercent(draftIsoPercent, offerAmount)
      : storedIsoAmount);
  const effectiveUnderwriterAmount =
    draftUnderwriterAmount ??
    (draftUnderwriterPercent != null && offerAmount != null && offerAmount > 0
      ? amountFromPercent(draftUnderwriterPercent, offerAmount)
      : storedUnderwriterAmount);

  const totalCommission =
    (effectiveIsoAmount ?? 0) + (effectiveUnderwriterAmount ?? 0);
  const totalPercent = computeCommissionPercent(totalCommission, offerAmount);

  if (!canEditCommission) {
    if (variant === "standalone") return null;

    return (
      <>
        <CommissionSectionHeading title="Commission on Deal" />
        <div className="grid grid-cols-1 gap-4 px-4 py-5 sm:grid-cols-2">
          <CommissionReadOnlyParty
            role="ISO"
            name={isoName}
            amount={storedIsoAmount}
            percent={storedIsoPercent ?? computeCommissionPercent(storedIsoAmount, offerAmount)}
          />
          <CommissionReadOnlyParty
            role="Underwriter"
            name={underwriterName}
            amount={storedUnderwriterAmount}
            percent={
              storedUnderwriterPercent ??
              computeCommissionPercent(storedUnderwriterAmount, offerAmount)
            }
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100/90 px-5 py-3 dark:border-slate-800">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Total commission
          </span>
          <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(totalCommission)}
            {totalPercent != null ? (
              <span className="ml-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                ({formatPercentLabel(totalPercent)} of advance)
              </span>
            ) : null}
          </span>
        </div>
      </>
    );
  }

  const offerAmountBadge = (
    <div className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
      <span className="uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Offer Amount
      </span>
      <span className="font-bold tabular-nums text-slate-800 dark:text-slate-100">
        {offerAmount != null ? `$${formatNumberUS(offerAmount)}` : "—"}
      </span>
      <span className="text-slate-300 dark:text-slate-600">•</span>
      <span className="text-slate-500 dark:text-slate-400">
        Enter percent or amount — the other field updates automatically.
      </span>
    </div>
  );

  const commissionFields = (
    <>
      <div
        className={
          variant === "embedded"
            ? "grid grid-cols-1 gap-6 px-4 py-5 sm:grid-cols-2"
            : "grid grid-cols-1 gap-6 sm:grid-cols-2 md:gap-8"
        }
      >
        <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-900/30">
          <label className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300">
            ISO
          </label>
          <div className="w-full border border-slate-200 rounded-md py-2.5 px-3 text-sm font-medium bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-200">
            {isoName}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="disbursement-iso-commission-percent"
                className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300"
              >
                Percent
              </label>
              <PercentInput
                id="disbursement-iso-commission-percent"
                value={isoPercentDraft}
                onChange={syncIsoFromPercent}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="disbursement-iso-commission-amount"
                className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300"
              >
                Amount
              </label>
              <CurrencyAmountInput
                id="disbursement-iso-commission-amount"
                value={isoAmountDraft}
                onChange={syncIsoFromAmount}
              />
            </div>
          </div>
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {offerAmount != null && offerAmount > 0 ? (
              isoPercent != null ? (
                <>
                  <span className="font-bold text-[#1e60a3] dark:text-sky-400">
                    {formatPercentLabel(isoPercent)}
                  </span>{" "}
                  of offer amount
                  {draftIsoAmount != null ? (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        {formatCurrency(draftIsoAmount)}
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                "Enter percent or amount"
              )
            ) : (
              "Offer amount unavailable"
            )}
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-slate-200/80 bg-slate-50/40 p-4 dark:border-slate-800 dark:bg-slate-900/30">
          <label className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300">
            Underwriter
          </label>
          <div className="w-full border border-slate-200 rounded-md py-2.5 px-3 text-sm font-medium bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-200">
            {underwriterName}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor="disbursement-underwriter-commission-percent"
                className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300"
              >
                Percent
              </label>
              <PercentInput
                id="disbursement-underwriter-commission-percent"
                value={underwriterPercentDraft}
                onChange={syncUnderwriterFromPercent}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="disbursement-underwriter-commission-amount"
                className="text-xs font-semibold text-slate-700 block uppercase tracking-wide dark:text-slate-300"
              >
                Amount
              </label>
              <CurrencyAmountInput
                id="disbursement-underwriter-commission-amount"
                value={underwriterAmountDraft}
                onChange={syncUnderwriterFromAmount}
              />
            </div>
          </div>
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
            {offerAmount != null && offerAmount > 0 ? (
              underwriterPercent != null ? (
                <>
                  <span className="font-bold text-[#1e60a3] dark:text-sky-400">
                    {formatPercentLabel(underwriterPercent)}
                  </span>{" "}
                  of offer amount
                  {draftUnderwriterAmount != null ? (
                    <>
                      {" "}
                      ·{" "}
                      <span className="font-bold text-slate-700 dark:text-slate-200">
                        {formatCurrency(draftUnderwriterAmount)}
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                "Enter percent or amount"
              )
            ) : (
              "Offer amount unavailable"
            )}
          </p>
        </div>
      </div>

      <div
        className={
          variant === "embedded"
            ? "space-y-3 border-t border-slate-100/90 px-5 py-3 dark:border-slate-800"
            : "mt-6 flex flex-wrap justify-end gap-3"
        }
      >
        {variant === "embedded" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total commission
            </span>
            <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-slate-100">
              {formatCurrency(totalCommission)}
              {totalPercent != null ? (
                <span className="ml-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  ({formatPercentLabel(totalPercent)} of advance)
                </span>
              ) : null}
            </span>
          </div>
        ) : null}
        <div className={variant === "embedded" ? "flex justify-end" : ""}>
          <Button
            type="button"
            variant="default"
            disabled={!applicationRecordId || saving || !canSave}
            onClick={() => void handleSave()}
            className="min-w-[9rem] cursor-pointer rounded-lg px-6 font-semibold disabled:opacity-60"
          >
            {saving ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Save className="h-4 w-4" />
                Save Commission
              </span>
            )}
          </Button>
        </div>
      </div>
    </>
  );

  if (variant === "embedded") {
    return (
      <>
        <CommissionSectionHeading title="Commission on Deal" />
        <div className="space-y-4 px-4 pb-2 pt-4">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Set ISO and underwriter commission by percent or amount before confirming disbursement.
          </p>
          {offerAmountBadge}
        </div>
        {commissionFields}
      </>
    );
  }

  return (
    <div className="bg-white px-4 py-5 md:px-6 md:py-6 rounded-lg shadow-md border border-slate-100 dark:border-slate-700 dark:bg-[#141517] dark:shadow-lg dark:shadow-black/20">
      <div className="mb-6 pb-3 border-b border-slate-100 dark:border-slate-700">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wide dark:text-slate-100">
            Commission
          </h3>
          <span className="text-[10px] bg-amber-50 text-amber-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-tighter dark:bg-amber-950/50 dark:text-amber-200">
            Ops / Super Admin
          </span>
        </div>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Set ISO and underwriter commission amounts for this application before disbursement.
        </p>
        <div className="mt-3">{offerAmountBadge}</div>
      </div>
      {commissionFields}
    </div>
  );
}
