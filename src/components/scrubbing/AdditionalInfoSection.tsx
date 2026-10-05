import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useSelector } from "react-redux";
import type { RootState } from "@/redux/store";
import { axiosDelete, axiosGet, axiosPost } from "@/redux/axios";
import {
  EMPTY_ADDITIONAL_INFO,
  SOURCE_OF_REVENUE_OPTIONS,
  additionalInfoHasData,
  additionalInfoSignature,
  additionalInfoStorageKey,
  decodeAdditionalInfoNote,
  encodeAdditionalInfoNote,
  getAdditionalInfoDisplayRows,
  isAdditionalInfoNoteContent,
  normalizeAdditionalInfo,
  syncWireCreditFromPositions,
  formatWireAmount,
  formatWireTotal,
  parseWireAmount,
  wireGroupByMonth,
  wireMonthLabel,
  type AdditionalInfo,
  type WireRow,
} from "@/components/scrubbing/lib/additionalInfo";

const SOURCE_DROPDOWN_MAX_HEIGHT = 288;
const SOURCE_DROPDOWN_GAP = 4;
const CARD_BORDER = "#E2E8F0";
const WIRE_BORDER = "var(--ledgerx-border, #E2E8F0)";
const WIRE_HEADER_FILL = "rgba(174, 214, 239, 0.85)";
/** Solid band across the top of each wire table: green for credit, dark red for debit. */
const WIRE_SIDE_TAB_COLOR: Record<string, string> = {
  credit: "#3d7a18",
  debit: "#a72c2c",
};
/** Both properties, so a copy into email keeps whichever it understands. */
function wireSideTabStyle(side: string): CSSProperties {
  const fill = WIRE_SIDE_TAB_COLOR[side] || WIRE_SIDE_TAB_COLOR.credit;
  return { background: fill, backgroundColor: fill };
}
/** Literal capitals, not CSS text-transform, so they survive a copy into email. */
const WIRE_SIDE_LABEL: Record<string, string> = {
  credit: "Credit",
  debit: "Debit",
};
/** Credit and Debit sit side by side under one heading, so each owns half the width. */
const WIRE_SIDE_ORDER: Array<"debit" | "credit"> = ["debit", "credit"];

const WIRE_HEADING_FILL = "rgba(174, 214, 239, 0.75)";
/** Full-width band the "Critical Wire Transactions" heading sits in, above both sides. */
const WIRE_HEADING_CELL_STYLE: CSSProperties = {
  background: WIRE_HEADING_FILL,
  backgroundColor: WIRE_HEADING_FILL,
  borderColor: WIRE_BORDER,
};

const EM_DASH = "\u2014";
const CARET_CLOSED = "\u25B8";
const CARET_OPEN = "\u25BE";
const MINUS_GLYPH = "\u2212";
const NO_WIRES_HINT: Record<string, string> = {
  credit: 'No credit wires. Click "+ Add credit".',
  debit: 'No debit wires. Click "+ Add debit".',
};
const HEADER_BG = "rgba(174, 214, 239, 0.75)";

type AdditionalInfoSectionProps = {
  value?: AdditionalInfo;
  onChange?: (next: AdditionalInfo) => void;
  readOnly?: boolean;
};

export function AdditionalInfoPreview({
  value = EMPTY_ADDITIONAL_INFO,
  className = "",
}: {
  value?: AdditionalInfo;
  className?: string;
}) {
  const rows = getAdditionalInfoDisplayRows(value);
  if (rows.length === 0) return null;

  return (
    <div
      className={`w-full overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm dark:border-slate-700 dark:bg-[#141517] ${className}`.trim()}
    >
      <div
        className="flex h-10 items-center justify-between gap-4 rounded-t-lg px-4 py-3"
        style={{ backgroundColor: HEADER_BG }}
      >
        <span className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-100">
          Additional Info
        </span>
      </div>
      <div className="overflow-x-auto bg-white dark:bg-[#141517]">
        <table className="w-full min-w-[700px] table-fixed border-collapse text-sm [&_td]:px-2 [&_td]:py-1.5">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "78%" }} />
          </colgroup>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.label}
                className={`bg-white dark:bg-[#141517] ${index < rows.length - 1 ? "border-b border-[#E2E8F0] dark:border-slate-700" : ""}`}
              >
                <td className="border-r border-[#E2E8F0] px-3 py-2 align-top text-sm font-medium text-[#143c2e] dark:border-slate-700 dark:text-slate-200">
                  {row.label}
                </td>
                <td
                  className="px-3 py-2 align-middle text-sm font-medium text-[#3d5c86] dark:text-slate-200"
                  style={{ whiteSpace: "pre-wrap" }}
                >
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdditionalInfoSection({
  value = EMPTY_ADDITIONAL_INFO,
  onChange,
  readOnly = false,
}: AdditionalInfoSectionProps) {
  const data = normalizeAdditionalInfo(value);
  const [showSourceDropdown, setShowSourceDropdown] = useState(false);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | null>(null);
  const [customSourceInput, setCustomSourceInput] = useState("");
  const sourceFieldRef = useRef<HTMLDivElement | null>(null);
  const sourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const sourceDropdownRef = useRef<HTMLDivElement | null>(null);

  const updateDropdownPosition = () => {
    const trigger = sourceTriggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gap = SOURCE_DROPDOWN_GAP;
    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const openUpward =
      spaceBelow < Math.min(SOURCE_DROPDOWN_MAX_HEIGHT, 200) &&
      spaceAbove > spaceBelow;
    const available = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.max(
      120,
      Math.min(SOURCE_DROPDOWN_MAX_HEIGHT, available),
    );
    const width = Math.min(Math.max(rect.width, 180), 420);

    if (openUpward) {
      setDropdownStyle({
        position: "fixed",
        left: rect.left,
        width,
        bottom: window.innerHeight - rect.top + gap,
        maxHeight,
        zIndex: 60,
      });
    } else {
      setDropdownStyle({
        position: "fixed",
        left: rect.left,
        width,
        top: rect.bottom + gap,
        maxHeight,
        zIndex: 60,
      });
    }
  };

  useEffect(() => {
    if (!showSourceDropdown) return undefined;

    updateDropdownPosition();

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inField =
        sourceFieldRef.current && sourceFieldRef.current.contains(target);
      const inDropdown =
        sourceDropdownRef.current && sourceDropdownRef.current.contains(target);
      if (!inField && !inDropdown) {
        setShowSourceDropdown(false);
      }
    };
    const handleReposition = () => updateDropdownPosition();

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [showSourceDropdown]);

  useEffect(() => {
    if (!showSourceDropdown) return;
    updateDropdownPosition();
  }, [showSourceDropdown, data.sourceOfRevenue]);

  const [collapsedWireMonths, setCollapsedWireMonths] = useState<
    Record<string, boolean>
  >({});

  const updateField = <K extends keyof AdditionalInfo>(
    field: K,
    nextValue: AdditionalInfo[K],
  ) => {
    if (readOnly || typeof onChange !== "function") return;
    onChange({
      ...data,
      [field]: nextValue,
    });
  };

  // ── Critical Wire Transactions ────────────────────────────────────────────
  const wire = data.wire;
  const setWireSide = (side: "credit" | "debit", rows: WireRow[]) =>
    updateField("wire", { ...wire, [side]: rows });
  const addWireRow = (side: "credit" | "debit") =>
    setWireSide(side, [...wire[side], { date: "", amount: "", description: "" }]);
  const changeWireRow = (
    side: "credit" | "debit",
    index: number,
    field: keyof WireRow,
    value: string,
  ) =>
    setWireSide(
      side,
      wire[side].map((r, i) => (i === index ? { ...r, [field]: value } : r)),
    );
  const removeWireRow = (side: "credit" | "debit", index: number) => {
    const rows = wire[side];
    const removed = rows[index];
    const nextRows = rows.filter((_, i) => i !== index);
    const positionId = String(removed?.positionId ?? "");
    if (positionId) {
      // Remember it, or the Positions sync would put the row straight back.
      updateField("wire", {
        ...wire,
        [side]: nextRows,
        positionWiresDismissed: wire.positionWiresDismissed.includes(positionId)
          ? wire.positionWiresDismissed
          : [...wire.positionWiresDismissed, positionId],
      });
      return;
    }
    setWireSide(side, nextRows);
  };
  const wireRowMonthKey = (r: { date?: string }) =>
    /^\d{4}-\d{2}/.test(String(r.date || "")) ? String(r.date).slice(0, 7) : "Undated";

  /**
   * Hold a side's month grouping still while one of its date fields has focus.
   *
   * Chromium reports every step inside an open date picker - the month arrows
   * included - as an input event, which React delivers as onChange. Regrouping
   * on that would move the row under a different month, so React unmounts the
   * focused input and mounts a new one, and the open picker goes with it.
   * Freezing each row's month key on focus keeps the element in place for the
   * whole interaction; the rows regroup on blur.
   */
  const [wireGroupFreeze, setWireGroupFreeze] = useState<{
    side: string;
    keys: Record<number, string>;
  } | null>(null);
  const freezeWireGroups = (side: "credit" | "debit") => {
    const keys: Record<number, string> = {};
    wire[side].forEach((r, idx) => {
      keys[idx] = wireRowMonthKey(r);
    });
    setWireGroupFreeze({ side, keys });
  };
  const unfreezeWireGroups = () => setWireGroupFreeze(null);

  /** Group a side's rows by month, keeping each row's index so it stays editable. */
  const wireMonthGroups = (side: "credit" | "debit") => {
    const frozen =
      wireGroupFreeze && wireGroupFreeze.side === side ? wireGroupFreeze.keys : null;
    return wireGroupByMonth(
      wire[side].map((r, idx) => ({
        ...r,
        idx,
        date: frozen && frozen[idx] != null ? frozen[idx] : r.date,
      })),
    ).map(([key, entries]) => [
      key,
      entries.map((e) => ({ ...e, date: wire[side][e.idx].date })),
    ]) as Array<[string, Array<WireRow & { idx: number }>]>;
  };
  const toggleWireMonth = (side: string, key: string) =>
    setCollapsedWireMonths((prev) => ({
      ...prev,
      [`${side}:${key}`]: !prev[`${side}:${key}`],
    }));


  const toggleSource = (option: string) => {
    const selected = Array.isArray(data.sourceOfRevenue)
      ? data.sourceOfRevenue
      : [];
    const next = selected.includes(option)
      ? selected.filter((v) => v !== option)
      : [...selected, option];
    updateField("sourceOfRevenue", next);
  };

  const removeSource = (option: string) => {
    const selected = Array.isArray(data.sourceOfRevenue)
      ? data.sourceOfRevenue
      : [];
    updateField(
      "sourceOfRevenue",
      selected.filter((v) => v !== option),
    );
  };

  const commitCustomSource = () => {
    const trimmed = customSourceInput.trim();
    if (!trimmed) {
      setCustomSourceInput("");
      return;
    }
    const selected = Array.isArray(data.sourceOfRevenue)
      ? data.sourceOfRevenue
      : [];
    if (!selected.includes(trimmed)) {
      updateField("sourceOfRevenue", [...selected, trimmed]);
    }
    setCustomSourceInput("");
  };

  const selectedSources = Array.isArray(data.sourceOfRevenue)
    ? data.sourceOfRevenue
    : [];

  const sourceDropdown =
    !readOnly &&
    showSourceDropdown &&
    dropdownStyle &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={sourceDropdownRef}
        className="overflow-hidden overflow-y-auto rounded-xl border bg-white text-sm shadow-xl dark:border-slate-700 dark:bg-[#141517]"
        style={{
          ...dropdownStyle,
          borderColor: CARD_BORDER,
        }}
      >
        {SOURCE_OF_REVENUE_OPTIONS.map((opt) => {
          const isSelected = selectedSources.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggleSource(opt)}
              className="flex w-full items-center justify-between gap-3 border-b px-4 py-2.5 text-left last:border-b-0 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              style={{ borderColor: "rgba(148, 163, 184, 0.16)" }}
            >
              <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                {opt}
              </span>
              <span
                className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                  isSelected
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                }`}
              >
                {isSelected ? "Selected" : "Select"}
              </span>
            </button>
          );
        })}
      </div>,
      document.body,
    );

  const inputClass =
    "w-full rounded border border-[#E2E8F0] bg-white px-2 py-1.5 text-sm font-medium text-[#3d5c86] focus:outline-none focus:ring-0 disabled:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:disabled:bg-slate-800/70";

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-[#E2E8F0] bg-white shadow-sm dark:border-slate-700 dark:bg-[#141517]">
      <div
        className="flex h-10 items-center justify-between gap-4 rounded-t-lg px-4 py-3"
        style={{ backgroundColor: HEADER_BG }}
      >
        <span className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-100">
          Additional Info
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[700px] table-fixed border-collapse text-sm [&_td]:px-2 [&_td]:py-1.5">
          <colgroup>
            <col style={{ width: "22%" }} />
            <col style={{ width: "78%" }} />
          </colgroup>
          <tbody>
            <tr className="border-b border-[#E2E8F0] bg-white dark:border-slate-700 dark:bg-[#141517]">
              <td className="border-r border-[#E2E8F0] px-3 py-2 align-middle text-sm font-medium text-[#143c2e] dark:border-slate-700 dark:text-slate-200">
                Source of revenue
              </td>
              <td className="px-3 py-2 align-middle">
                <div className="flex w-full flex-col gap-1.5" ref={sourceFieldRef}>
                  <button
                    ref={sourceTriggerRef}
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      if (readOnly) return;
                      setShowSourceDropdown((prev) => {
                        const next = !prev;
                        if (next) {
                          requestAnimationFrame(() => updateDropdownPosition());
                        } else {
                          setDropdownStyle(null);
                        }
                        return next;
                      });
                    }}
                    className="flex min-h-[38px] w-full flex-wrap items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-sm text-slate-800 focus:outline-none disabled:cursor-default dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {selectedSources.length > 0 ? (
                      selectedSources.map((name) => (
                        <span
                          key={name}
                          className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs shadow-sm dark:border-slate-600 dark:bg-slate-800"
                        >
                          <span>{name}</span>
                          {!readOnly ? (
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                removeSource(name);
                              }}
                              className="cursor-pointer text-[10px] text-slate-400 hover:text-slate-700"
                            >
                              ✕
                            </span>
                          ) : null}
                        </span>
                      ))
                    ) : (
                      <span className="px-1 text-xs text-slate-400">
                        Select source of revenue
                      </span>
                    )}
                    {!readOnly ? (
                      <span className="ml-auto text-base text-slate-400">▾</span>
                    ) : null}
                  </button>
                  {sourceDropdown}
                  {!readOnly ? (
                    <input
                      type="text"
                      value={customSourceInput}
                      onChange={(e) => setCustomSourceInput(e.target.value)}
                      onBlur={commitCustomSource}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitCustomSource();
                        }
                      }}
                      placeholder="+ Enter custom source of revenue"
                      className="w-full rounded border border-[#E2E8F0] bg-slate-50/80 px-2 py-1 text-xs text-slate-600 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-0 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200"
                      aria-label="Enter custom source of revenue (optional)"
                    />
                  ) : null}
                </div>
              </td>
            </tr>

            <tr className="border-b border-[#E2E8F0] bg-white dark:border-slate-700 dark:bg-[#141517]">
              <td className="border-r border-[#E2E8F0] px-3 py-2 align-middle text-sm font-medium text-[#143c2e] dark:border-slate-700 dark:text-slate-200">
                Business Model
              </td>
              <td className="px-3 py-2 align-middle">
                <input
                  type="text"
                  value={data.businessModel}
                  disabled={readOnly}
                  onChange={(e) => updateField("businessModel", e.target.value)}
                  placeholder="Enter business model"
                  className={inputClass}
                />
              </td>
            </tr>

            <tr className="border-b border-[#E2E8F0] bg-white dark:border-slate-700 dark:bg-[#141517]">
              <td className="border-r border-[#E2E8F0] px-3 py-2 align-middle text-sm font-medium text-[#143c2e] dark:border-slate-700 dark:text-slate-200">
                Online Presence
              </td>
              <td className="px-3 py-2 align-middle">
                <input
                  type="text"
                  value={data.onlinePresence}
                  disabled={readOnly}
                  onChange={(e) => updateField("onlinePresence", e.target.value)}
                  placeholder="Website or social media URL"
                  className={inputClass}
                />
              </td>
            </tr>

            <tr className="border-b border-[#E2E8F0] bg-white dark:border-slate-700 dark:bg-[#141517]">
              <td className="border-r border-[#E2E8F0] px-3 py-2 align-top text-sm font-medium text-[#143c2e] dark:border-slate-700 dark:text-slate-200">
                Pros
              </td>
              <td className="px-3 py-2 align-middle">
                <textarea
                  value={data.pros}
                  disabled={readOnly}
                  onChange={(e) => updateField("pros", e.target.value)}
                  placeholder="Enter pros"
                  rows={2}
                  className={`${inputClass} resize-y`}
                  style={{ whiteSpace: "pre-wrap" }}
                />
              </td>
            </tr>

            <tr className="bg-white dark:bg-[#141517]">
              <td className="border-r border-[#E2E8F0] px-3 py-2 align-top text-sm font-medium text-[#143c2e] dark:border-slate-700 dark:text-slate-200">
                Cons
              </td>
              <td className="px-3 py-2 align-middle">
                <textarea
                  value={data.cons}
                  disabled={readOnly}
                  onChange={(e) => updateField("cons", e.target.value)}
                  placeholder="Enter cons"
                  rows={2}
                  className={`${inputClass} resize-y`}
                  style={{ whiteSpace: "pre-wrap" }}
                />
              </td>
            </tr>

            {/* Critical Wire Transactions - one heading across the full width,
                with Debit and Credit side by side beneath it. */}
            <tr>
              <td
                colSpan={2}
                className="border-t px-3 py-2 text-center text-sm text-[#143c2e]"
                style={WIRE_HEADING_CELL_STYLE}
              >
                <strong style={{ fontWeight: 700 }}>Critical Wire Transactions</strong>
              </td>
            </tr>
            <tr className="bg-white dark:bg-[#141517]">
              <td colSpan={2} className="p-0 align-top" style={{ padding: 0 }}>
                {/* A table, not flex or grid, so the two-column layout survives
                    a copy into email. */}
                <table className="w-full table-fixed border-collapse">
                  <tbody>
                    <tr>
                      {WIRE_SIDE_ORDER.map((side) => (
                        <td
                          key={side}
                          className="align-top"
                          valign="top"
                          style={{ width: "50%", padding: "4px", verticalAlign: "top" }}
                        >
                          <div
                            className="overflow-hidden rounded-lg border"
                            style={{ borderColor: WIRE_BORDER }}
                          >
                            {/* Full-width band above the column headers; add sits at its right edge. */}
                            <div className="relative px-3 py-2" style={wireSideTabStyle(side)}>
                              <div className="text-center text-xs font-semibold tracking-wide text-white">
                                {WIRE_SIDE_LABEL[side]}
                              </div>
                              {!readOnly && (
                                <div className="absolute inset-y-0 right-2 flex items-center">
                                  <button
                                    type="button"
                                    onClick={() => addWireRow(side)}
                                    title={`Add ${side}`}
                                    aria-label={`Add ${side}`}
                                    className="flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[3px] border text-sm font-semibold leading-none text-white hover:bg-white/20 focus:outline-none"
                                    style={{ borderColor: "rgba(255, 255, 255, 0.9)" }}
                                  >
                                    +
                                  </button>
                                </div>
                              )}
                            </div>
                            <table className="w-full border-collapse text-xs">
                              <thead>
                                <tr
                                  className="border-b text-xs font-semibold uppercase tracking-wide text-slate-700"
                                  style={{ background: WIRE_HEADER_FILL, borderColor: WIRE_BORDER }}
                                >
                                  <th
                                    className="border px-2 py-2 text-left"
                                    style={{ borderColor: WIRE_BORDER, width: "32%", minWidth: "116px" }}
                                  >
                                    Date
                                  </th>
                                  <th
                                    className="border px-2 py-2 text-left"
                                    style={{ borderColor: WIRE_BORDER, width: "24%" }}
                                  >
                                    Amount
                                  </th>
                                  <th className="border px-2 py-2 text-left" style={{ borderColor: WIRE_BORDER }}>
                                    Description
                                  </th>
                                  {!readOnly && <th className="w-8 border" style={{ borderColor: WIRE_BORDER }} />}
                                </tr>
                              </thead>
                              <tbody>
                                {wire[side].length === 0 ? (
                                  <tr>
                                    <td
                                      colSpan={readOnly ? 3 : 4}
                                      className="border px-2 py-1 text-slate-400"
                                      style={{ borderColor: WIRE_BORDER }}
                                    >
                                      {readOnly ? EM_DASH : NO_WIRES_HINT[side]}
                                    </td>
                                  </tr>
                                ) : (
                                  wireMonthGroups(side).map(([monthKey, entries]) => {
                                    const collapsed = !!collapsedWireMonths[side + ":" + monthKey];
                                    const subtotal = entries.reduce(
                                      (sum, e) => sum + parseWireAmount(e.amount),
                                      0,
                                    );
                                    return (
                                      <Fragment key={monthKey}>
                                        <tr
                                          className="cursor-pointer select-none"
                                          style={{ background: "var(--color-sky-50, #f0f9ff)" }}
                                          onClick={() => toggleWireMonth(side, monthKey)}
                                        >
                                          <td
                                            className="border px-2 py-1 font-semibold text-slate-600"
                                            style={{ borderColor: WIRE_BORDER }}
                                          >
                                            <span className="inline-block w-3 text-slate-400">
                                              {collapsed ? CARET_CLOSED : CARET_OPEN}
                                            </span>
                                            {wireMonthLabel(monthKey)}
                                            <span className="ml-1 font-normal text-slate-400">
                                              ({entries.length})
                                            </span>
                                          </td>
                                          <td
                                            className="border px-2 py-1 text-left font-semibold text-slate-700"
                                            style={{ borderColor: WIRE_BORDER }}
                                          >
                                            {formatWireTotal(subtotal)}
                                          </td>
                                          <td className="border px-2 py-1" style={{ borderColor: WIRE_BORDER }} />
                                          {!readOnly && <td className="border" style={{ borderColor: WIRE_BORDER }} />}
                                        </tr>
                                        {!collapsed &&
                                          entries.map((entry) => (
                                            <tr key={entry.idx}>
                                              {/* Padding lives on the input so it fills the cell edge to edge. */}
                                              <td className="border p-0" style={{ borderColor: WIRE_BORDER }}>
                                                {/* A plain native date field - the browser owns the picker.
                                                    Focus freezes this side's grouping so the element survives
                                                    the onChange the picker fires while it is open. The calendar
                                                    indicator is stretched over the whole field and made
                                                    transparent, so a click anywhere in the cell opens it. */}
                                                <input
                                                  type="date"
                                                  readOnly={readOnly}
                                                  value={entry.date || ""}
                                                  onChange={(e) =>
                                                    changeWireRow(side, entry.idx, "date", e.target.value)
                                                  }
                                                  onFocus={() => freezeWireGroups(side)}
                                                  onBlur={unfreezeWireGroups}
                                                  aria-label="Pick date"
                                                  className="relative block w-full cursor-pointer bg-transparent px-2 py-1 text-left text-xs focus:outline-none [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
                                                  style={{ border: "none", fontSize: "inherit" }}
                                                />
                                              </td>
                                              <td className="border px-1 py-0.5" style={{ borderColor: WIRE_BORDER }}>
                                                <div className="flex items-center gap-0.5">
                                                  <span className="text-xs text-slate-400">$</span>
                                                  <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    readOnly={readOnly}
                                                    value={entry.amount || ""}
                                                    onChange={(e) =>
                                                      changeWireRow(side, entry.idx, "amount", e.target.value)
                                                    }
                                                    onBlur={(e) =>
                                                      changeWireRow(
                                                        side,
                                                        entry.idx,
                                                        "amount",
                                                        formatWireAmount(e.target.value),
                                                      )
                                                    }
                                                    placeholder="0.00"
                                                    className="w-full bg-transparent px-1 py-0.5 text-left text-xs focus:outline-none"
                                                  />
                                                </div>
                                              </td>
                                              <td className="border px-1 py-0.5" style={{ borderColor: WIRE_BORDER }}>
                                                <input
                                                  type="text"
                                                  readOnly={readOnly}
                                                  value={entry.description || ""}
                                                  onChange={(e) =>
                                                    changeWireRow(side, entry.idx, "description", e.target.value)
                                                  }
                                                  placeholder="Description"
                                                  className="w-full bg-transparent px-1 py-0.5 text-xs focus:outline-none"
                                                />
                                              </td>
                                              {!readOnly && (
                                                <td className="border text-center" style={{ borderColor: WIRE_BORDER }}>
                                                  <button
                                                    type="button"
                                                    onClick={() => removeWireRow(side, entry.idx)}
                                                    title="Remove row"
                                                    aria-label="Remove row"
                                                    className="mx-auto flex h-[18px] w-[18px] cursor-pointer items-center justify-center rounded-[3px] border text-sm leading-none text-slate-500 hover:border-red-400 hover:text-red-600 focus:outline-none"
                                                    style={{ borderColor: WIRE_BORDER }}
                                                  >
                                                    {MINUS_GLYPH}
                                                  </button>
                                                </td>
                                              )}
                                            </tr>
                                          ))}
                                      </Fragment>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

type NoteRow = { _id?: string; id?: string; content?: string };

function notesListFromResponse(payload: unknown): NoteRow[] {
  if (Array.isArray(payload)) return payload as NoteRow[];
  if (payload && typeof payload === "object") {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) return data as NoteRow[];
  }
  return [];
}

function readLocalAdditionalInfo(applicationId: string): AdditionalInfo | null {
  try {
    const raw = localStorage.getItem(additionalInfoStorageKey(applicationId));
    if (!raw) return null;
    return normalizeAdditionalInfo(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalAdditionalInfo(applicationId: string, data: AdditionalInfo) {
  try {
    localStorage.setItem(
      additionalInfoStorageKey(applicationId),
      JSON.stringify(normalizeAdditionalInfo(data)),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function ApplicationAdditionalInfo({
  applicationId,
  readOnly = false,
  isPreviewMode = false,
  onRegisterSave,
  positions,
}: {
  applicationId?: string | null;
  readOnly?: boolean;
  isPreviewMode?: boolean;
  onRegisterSave?: (save: () => Promise<boolean>) => void;
  /**
   * The Positions table's live rows. Passing them keeps the credit wires in
   * step as the user types; without them the sync falls back to the saved
   * store, which only changes after a save and a refetch.
   */
  positions?: unknown[];
}) {
  const [value, setValue] = useState<AdditionalInfo>({
    ...EMPTY_ADDITIONAL_INFO,
    sourceOfRevenue: [],
  });
  const valueRef = useRef(value);
  const savedSigRef = useRef(additionalInfoSignature(EMPTY_ADDITIONAL_INFO));
  const positionsState = useSelector((state: RootState) => state.positions);

  /**
   * Every funded position is a wire in, so the credit side mirrors Positions.
   * Each position owns one row, matched by its id, so editing a funder updates
   * that row rather than adding another, and deleting the position removes it.
   * Rows typed by hand are untouched, and a generated row the user deletes is
   * remembered and not recreated.
   */
  const livePositions = Array.isArray(positions) ? positions : null;
  useEffect(() => {
    if (!hydratedRef.current) return;
    // Prefer the table's live rows so an edit shows up immediately; fall back
    // to the store for screens that do not hand them over.
    const source =
      livePositions ??
      (Array.isArray(positionsState.data) ? positionsState.data : []);
    setValue((prev) => {
      const next = syncWireCreditFromPositions(prev, source);
      return additionalInfoSignature(next) === additionalInfoSignature(prev)
        ? prev
        : next;
    });
  }, [livePositions, positionsState.data]);
  const noteIdRef = useRef<string | null>(null);
  const persistInFlightRef = useRef(false);
  const hydratedRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const persist = useCallback(async (): Promise<boolean> => {
    const appId = applicationId != null ? String(applicationId).trim() : "";
    if (!appId) return true;
    if (!hydratedRef.current) return true;
    const next = normalizeAdditionalInfo(valueRef.current);
    const sig = additionalInfoSignature(next);
    writeLocalAdditionalInfo(appId, next);
    if (sig === savedSigRef.current) return true;
    if (persistInFlightRef.current) return true;
    persistInFlightRef.current = true;
    try {
      const encoded = encodeAdditionalInfoNote(next);
      if (noteIdRef.current) {
        try {
          await axiosDelete(`/notes/${noteIdRef.current}`);
        } catch {
          /* recreate below */
        }
        noteIdRef.current = null;
      }
      if (additionalInfoHasData(next)) {
        const resp = await axiosPost("/notes", {
          content: encoded,
          application: appId,
        });
        const created =
          (resp.data?.data as NoteRow | undefined) ?? (resp.data as NoteRow);
        const id = created?._id ?? created?.id;
        if (id) noteIdRef.current = String(id);
      }
      savedSigRef.current = sig;
      return true;
    } catch (err) {
      console.error("Failed to save additional info:", err);
      return false;
    } finally {
      persistInFlightRef.current = false;
    }
  }, [applicationId]);

  useEffect(() => {
    onRegisterSave?.(persist);
  }, [onRegisterSave, persist]);

  useEffect(() => {
    const appId = applicationId != null ? String(applicationId).trim() : "";
    if (!appId) {
      setValue({ ...EMPTY_ADDITIONAL_INFO, sourceOfRevenue: [] });
      noteIdRef.current = null;
      savedSigRef.current = additionalInfoSignature(EMPTY_ADDITIONAL_INFO);
      hydratedRef.current = false;
      return;
    }

    let cancelled = false;
    hydratedRef.current = false;
    const local = readLocalAdditionalInfo(appId);
    if (local) {
      setValue(local);
      savedSigRef.current = additionalInfoSignature(local);
    }

    void (async () => {
      try {
        const resp = await axiosGet(
          `/notes?${new URLSearchParams({ application: appId }).toString()}`,
        );
        if (cancelled) return;
        const list = notesListFromResponse(resp.data);
        const found = [...list]
          .reverse()
          .find((n) => isAdditionalInfoNoteContent(n?.content));
        if (found) {
          const parsed = decodeAdditionalInfoNote(found.content);
          noteIdRef.current = String(found._id ?? found.id ?? "") || null;
          if (parsed) {
            setValue(parsed);
            writeLocalAdditionalInfo(appId, parsed);
            savedSigRef.current = additionalInfoSignature(parsed);
          }
        }
      } catch {
        /* local cache already applied */
      } finally {
        if (!cancelled) hydratedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  useEffect(() => {
    if (readOnly || isPreviewMode) return;
    const appId = applicationId != null ? String(applicationId).trim() : "";
    if (!appId || !hydratedRef.current) return;
    writeLocalAdditionalInfo(appId, value);
    const timer = setTimeout(() => {
      void persist();
    }, 1500);
    return () => clearTimeout(timer);
  }, [applicationId, isPreviewMode, persist, readOnly, value]);

  if (isPreviewMode) {
    return <AdditionalInfoPreview value={value} />;
  }

  return (
    <AdditionalInfoSection
      value={value}
      onChange={setValue}
      readOnly={readOnly}
    />
  );
}
