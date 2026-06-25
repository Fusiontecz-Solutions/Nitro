import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { APP_LOGO_SRC } from "@/constants/appLogo";
import { BACKGROUND_CHECK_RESOURCES } from "@/config/externalLinks";
import type { DataMerchLookupData, DataMerchMerchant, DataMerchRecord } from "@/redux/actions/datamerch-actions";
import type { AttachmentPreview } from "./backgroundCheckAttachmentPreview";
import { resolveCheckAttachmentPreviews } from "./backgroundCheckAttachmentPreview";
import type { BackgroundCheckFormState, BackgroundCheckStatus } from "./backgroundCheckTypes";

const BRAND = "#6366F1";
const PROGRESS_RADIUS = 42;
const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * PROGRESS_RADIUS;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatTimestamp(iso?: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatEinDisplay(ein: string): string {
  const digits = ein.replace(/\D/g, "");
  if (digits.length !== 9) return ein || "—";
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

export function formatBackgroundCheckEin(ein: string): string {
  return formatEinDisplay(ein);
}

function merchantRecords(merchant: DataMerchMerchant): DataMerchRecord[] {
  if (Array.isArray(merchant.records)) return merchant.records;
  if (Array.isArray(merchant.notes)) return merchant.notes;
  return [];
}

function recordText(record: DataMerchRecord): string {
  return String(record.note ?? record.notes ?? "").trim() || "—";
}

function countByStatus(
  checks: BackgroundCheckFormState,
  checkIds: string[],
  status: BackgroundCheckStatus,
): number {
  return checkIds.filter((id) => checks[id]?.status === status).length;
}

function statusBadgeClass(status?: BackgroundCheckStatus): string {
  if (status === "pass") return "check-badge pass";
  if (status === "fail") return "check-badge fail";
  if (status === "flag") return "check-badge flag";
  if (status === "na") return "check-badge na";
  return "check-badge pending";
}

function statusBadgeLabel(status?: BackgroundCheckStatus): string {
  if (status === "pass") return "PASS";
  if (status === "fail") return "FAIL";
  if (status === "flag") return "FLAG";
  if (status === "na") return "N/A";
  return "PENDING";
}

function overallStatusLabel(
  checks: BackgroundCheckFormState,
  checkIds: string[],
): { label: string; className: string } {
  const completed = checkIds.filter((id) => checks[id]?.status != null).length;
  if (completed < checkIds.length) {
    return { label: "IN PROGRESS", className: "overall-badge pending" };
  }
  if (checkIds.some((id) => checks[id]?.status === "fail")) {
    return { label: "FAIL", className: "overall-badge fail" };
  }
  if (checkIds.some((id) => checks[id]?.status === "flag")) {
    return { label: "FLAG", className: "overall-badge flag" };
  }
  return { label: "PASS", className: "overall-badge pass" };
}

function buildProgressRingSvg(percent: number): string {
  const offset = PROGRESS_CIRCUMFERENCE - (percent / 100) * PROGRESS_CIRCUMFERENCE;
  return `
    <svg class="progress-svg" viewBox="0 0 108 108" aria-hidden="true">
      <g transform="rotate(-90 54 54)">
        <circle cx="54" cy="54" r="${PROGRESS_RADIUS}" fill="none" stroke="#E5E7EB" stroke-width="10" />
        <circle
          cx="54"
          cy="54"
          r="${PROGRESS_RADIUS}"
          fill="none"
          stroke="${BRAND}"
          stroke-width="10"
          stroke-linecap="round"
          stroke-dasharray="${PROGRESS_CIRCUMFERENCE}"
          stroke-dashoffset="${offset}"
        />
      </g>
      <text
        x="54"
        y="58"
        text-anchor="middle"
        fill="#111827"
        font-size="20"
        font-weight="700"
        font-family="Inter, Arial, Helvetica, sans-serif"
      >${percent}%</text>
    </svg>`;
}

function buildSummaryGraphHtml(
  checks: BackgroundCheckFormState,
  checkIds: string[],
  merchantName: string,
): string {
  const total = checkIds.length;
  const completed = checkIds.filter((id) => checks[id]?.status != null).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const rows = [
    { label: "Pass", count: countByStatus(checks, checkIds, "pass"), color: "#16A34A" },
    { label: "Fail", count: countByStatus(checks, checkIds, "fail"), color: "#DC2626" },
    { label: "Flag", count: countByStatus(checks, checkIds, "flag"), color: "#EA580C" },
    { label: "N/A", count: countByStatus(checks, checkIds, "na"), color: "#9CA3AF" },
  ];

  const bars = rows
    .map((row) => {
      const width =
        total > 0 ? Math.max((row.count / total) * 100, row.count > 0 ? 12 : 0) : 0;
      return `
        <div class="result-row">
          <span class="result-label">${row.label}</span>
          <div class="result-track">
            <div class="result-fill" style="width:${width}%;background:${row.color}"></div>
          </div>
          <span class="result-count">${row.count}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="summary-bottom">
      <div class="panel">
        <div class="panel-title">Completion Progress</div>
        <div class="progress-ring-wrap">
          ${buildProgressRingSvg(percent)}
        </div>
        <div class="progress-merchant">${escapeHtml((merchantName || "Merchant").toUpperCase())}</div>
        <div class="progress-caption">${completed} of ${total} complete</div>
      </div>
      <div class="panel">
        <div class="panel-kicker">RESULTS</div>
        ${bars}
      </div>
    </div>`;
}

const PDF_LAYOUT = {
  marginX: 14,
  marginTop: 20,
  marginBottom: 20,
};

const PILL_OUTER_STYLE =
  "display:inline-table;height:28px;min-width:56px;border-radius:999px;box-sizing:border-box;vertical-align:middle;border-collapse:separate;border-spacing:0;";

const PILL_INNER_STYLE =
  "display:table-cell;vertical-align:middle;text-align:center;padding:0 14px;font-size:10px;font-weight:700;line-height:1;white-space:nowrap;font-family:Arial,Helvetica,sans-serif;";

const PILL_COLOR_STYLES: Record<string, string> = {
  "check-badge pass": "background:#22C55E;color:#ffffff;",
  "check-badge fail": "background:#EF4444;color:#ffffff;",
  "check-badge flag": "background:#F97316;color:#ffffff;",
  "check-badge na": "background:#F3F4F6;color:#374151;border:1px solid #D1D5DB;",
  "check-badge pending": "background:#E5E7EB;color:#6B7280;",
  "overall-badge pass": "background:#22C55E;color:#ffffff;",
  "overall-badge fail": "background:#EF4444;color:#ffffff;",
  "overall-badge flag": "background:#F97316;color:#ffffff;",
  "overall-badge pending": "background:#E5E7EB;color:#374151;",
  "attachment-badge": "background:#22C55E;color:#ffffff;",
};

function pillHtml(classNames: string, label: string): string {
  const colors = PILL_COLOR_STYLES[classNames] ?? "background:#E5E7EB;color:#374151;";
  return `<span class="${classNames}" style="${PILL_OUTER_STYLE}${colors}"><span style="${PILL_INNER_STYLE}">${escapeHtml(label)}</span></span>`;
}

function buildAttachmentsHtml(
  state: BackgroundCheckFormState[string],
  preview?: AttachmentPreview | null,
): string {
  const hasAttachment = Boolean(state.attachmentName && state.attachmentUrl);
  const previewHtml =
    preview?.dataUrl
      ? `<div class="attachment-preview-wrap">
          <img
            class="attachment-preview"
            src="${preview.dataUrl}"
            alt="${escapeHtml(state.attachmentName ?? "Uploaded attachment")}"
          />
        </div>`
      : "";

  return `
    <div class="attachments-section">
      <div class="attachments-kicker">Attachments</div>
      ${
        hasAttachment
          ? `<div class="attachment-uploaded">
              <div class="attachment-meta-row">
                ${pillHtml("attachment-badge", "Uploaded")}
                <span class="attachment-name">${escapeHtml(state.attachmentName!)}</span>
                ${
                  preview?.kind === "pdf"
                    ? '<span class="attachment-kind">PDF · first page preview</span>'
                    : preview?.kind === "image"
                      ? '<span class="attachment-kind">Image preview</span>'
                      : ""
                }
              </div>
              ${previewHtml}
            </div>`
          : '<div class="attachments-empty">No attachments</div>'
      }
    </div>`;
}

function buildCheckCardHtml(
  title: string,
  description: string,
  state: BackgroundCheckFormState[string],
  savedByName: string,
  preview?: AttachmentPreview | null,
): string {
  const displayTitle = state.optional ? `${title} (optional)` : title;
  const notes = state.notes?.trim()
    ? escapeHtml(state.notes.trim())
    : "—";
  const saved = formatTimestamp(state.savedAt);
  const savedLine = saved ? `By ${escapeHtml(savedByName)} · ${escapeHtml(saved)}` : "";

  return `
    <div class="check-card">
      <div class="check-head">
        <div class="check-head-main">
          <div class="check-head-text">
            <div class="check-title">${escapeHtml(displayTitle)}</div>
            <div class="check-desc">${escapeHtml(description)}</div>
          </div>
        </div>
        ${pillHtml(statusBadgeClass(state.status), statusBadgeLabel(state.status))}
      </div>
      ${savedLine ? `<div class="check-meta">${savedLine}</div>` : ""}
      <div class="notes-section">
        <div class="notes-kicker">Notes / findings</div>
        <div class="notes-box">${notes}</div>
      </div>
      ${buildAttachmentsHtml(state, preview)}
    </div>`;
}

function buildDataMerchMerchantSections(merchant: DataMerchMerchant): string {
  const name = escapeHtml(
    String(merchant.legalName ?? merchant.legal_name ?? merchant.name ?? "Unknown merchant").trim(),
  );
  const fein = String(merchant.fein ?? merchant.ein ?? "").trim();
  const location = [merchant.city, merchant.state].filter(Boolean).join(", ");
  const meta = [
    fein ? `EIN ${escapeHtml(formatEinDisplay(fein))}` : null,
    location ? escapeHtml(location) : null,
    merchant.dba ? `DBA ${escapeHtml(String(merchant.dba))}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const header = `
    <div class="dm-merchant-header">
      <div class="dm-merchant-name">${name}</div>
      ${meta ? `<div class="dm-merchant-meta">${meta}</div>` : ""}
    </div>`;

  const records = merchantRecords(merchant);
  if (records.length === 0) {
    return `<div class="dm-merchant">${header}<div class="dm-merchant-meta">No funder reports on file.</div></div>`;
  }

  const recordBlocks = records
    .map((record) => {
      const category = escapeHtml(String(record.category ?? "Record"));
      const date = formatTimestamp(record.createdAt ?? record.created_at ?? undefined);
      const funder = record.addedBy ?? record.funder ?? record.added_by;
      return `
        <div class="dm-record">
          <div class="dm-record-head">
            <span class="dm-record-category">${category}</span>
            ${date ? `<span class="dm-record-date">Reported: ${escapeHtml(date)}</span>` : ""}
          </div>
          <div class="dm-record-note">${escapeHtml(recordText(record))}</div>
          ${funder ? `<div class="dm-record-funder">Funder: ${escapeHtml(String(funder))}</div>` : ""}
        </div>`;
    })
    .join("");

  return `<div class="dm-merchant">${header}${recordBlocks}</div>`;
}

function buildDataMerchSections(
  datamerch: Omit<DataMerchLookupData, "raw">,
  searchedAt: string | null | undefined,
): string {
  const totalRecords = (datamerch.merchants ?? []).reduce(
    (sum, merchant) => sum + merchantRecords(merchant).length,
    0,
  );
  const summaryClass = totalRecords > 0 ? "dm-summary warn" : "dm-summary ok";
  const summaryText =
    totalRecords > 0
      ? `<strong>${totalRecords} record${totalRecords !== 1 ? "s" : ""} found</strong> across ${datamerch.merchants.length} merchant${datamerch.merchants.length !== 1 ? "s" : ""} · Matched using ${datamerch.searchType === "ein" ? "EIN" : "keywords"}: ${escapeHtml(datamerch.searchQuery)}`
      : `<strong>No DataMerch records found</strong> · ${datamerch.searchType === "ein" ? `EIN ${escapeHtml(formatEinDisplay(datamerch.searchQuery))}` : escapeHtml(datamerch.businessName ?? datamerch.searchQuery)}`;

  const summarySection = `
    <div class="datamerch-block">
      ${searchedAt ? `<div class="client-line muted">Last searched ${escapeHtml(formatTimestamp(searchedAt) ?? searchedAt)}</div>` : ""}
      <div class="${summaryClass}">${summaryText}</div>
    </div>`;

  const merchantSections = (datamerch.merchants ?? [])
    .map((merchant) => `<div class="dm-merchant-block">${buildDataMerchMerchantSections(merchant)}</div>`)
    .join("");

  return `${summarySection}${merchantSections}`;
}

function buildBackgroundCheckPdfHtml(
  input: BackgroundCheckPdfInput,
  attachmentPreviews: Record<string, AttachmentPreview | null>,
): string {
  const checkIds = BACKGROUND_CHECK_RESOURCES.map((r) => r.id).filter(
    (id) => !input.checks[id]?.optional,
  );
  const overall = overallStatusLabel(input.checks, checkIds);
  const generatedAt = formatTimestamp(new Date().toISOString()) ?? "";
  const savedLine = input.savedAt
    ? `Last saved ${formatTimestamp(input.savedAt) ?? input.savedAt}`
    : "";

  let isFirstCheck = true;
  const cards = BACKGROUND_CHECK_RESOURCES.map((resource) => {
    const state = input.checks[resource.id] ?? { notes: "", optional: false };
    const card = buildCheckCardHtml(
      resource.title,
      resource.description,
      state,
      input.savedByName,
      attachmentPreviews[resource.id] ?? null,
    );

    const sectionTitle = isFirstCheck
      ? `<div class="section-title">Checks performed</div>`
      : "";
    isFirstCheck = false;

    if (resource.id === "datamerch") {
      const dmSections =
        input.datamerch != null
          ? buildDataMerchSections(input.datamerch, input.datamerchSearchedAt)
          : `<div class="datamerch-block muted">DataMerch not searched yet.</div>`;
      return `<div class="check-block">${sectionTitle}${card}${dmSections}</div>`;
    }

    return `<div class="check-block">${sectionTitle}${card}</div>`;
  }).join("");

  return `
    <style>
      * { box-sizing: border-box; }
      .pdf-root {
        font-family: Inter, Arial, Helvetica, sans-serif;
        color: #111827;
        background: #ffffff;
        font-size: 12px;
        line-height: 1.45;
        padding: 0;
      }
      .check-block { margin-bottom: 18px; }
      .logo-row { margin-bottom: 14px; }
      .logo-row img { height: 34px; width: auto; display: block; }
      .page-header { margin-bottom: 18px; padding: 8px 0 20px; border-bottom: 3px solid #1E293B; }
      .page-title { font-size: 24px; font-weight: 700; margin: 0 0 4px; color: #0F172A; letter-spacing: 0.02em; }
      .page-subtitle { font-size: 13px; color: #64748B; margin: 0; }
      .meta-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 24px;
        margin-top: 14px;
        font-size: 12px;
      }
      .meta-label { color: #64748B; margin-right: 6px; }
      .meta-value { font-weight: 600; color: #0F172A; }
      .meta-status-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .overall-badge,
      .check-badge,
      .attachment-badge {
        flex-shrink: 0;
      }
      .section-title { font-size: 14px; font-weight: 700; color: #0F172A; margin: 18px 0 10px; }
      .check-card {
        border: 1px solid #E2E8F0;
        border-radius: 8px;
        background: #fff;
        padding: 18px 16px 26px;
        margin-bottom: 18px;
      }
      .check-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
      .check-head-main {
        display: block;
        flex: 1;
        min-width: 0;
      }
      .check-head-text { min-width: 0; }
      .check-title { font-size: 14px; font-weight: 700; color: #0F172A; }
      .check-desc { font-size: 11px; color: #64748B; margin-top: 2px; }
      .check-badge {
        flex-shrink: 0;
      }
      .check-meta { margin-top: 6px; font-size: 10px; color: #64748B; }
      .notes-section { margin-top: 10px; }
      .notes-kicker, .attachments-kicker {
        font-size: 10px;
        font-weight: 700;
        color: #64748B;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .notes-box {
        padding: 8px 10px;
        border: 1px solid #E5E7EB;
        border-radius: 6px;
        background: #FAFBFC;
        white-space: pre-wrap;
        font-size: 12px;
        color: #111827;
        min-height: 28px;
      }
      .attachments-section { margin-top: 12px; margin-bottom: 6px; }
      .attachments-empty { font-size: 11px; color: #94A3B8; padding-bottom: 6px; }
      .attachment-uploaded {
        border: 1px solid #E2E8F0;
        border-radius: 6px;
        background: #F8FAFC;
        padding: 12px 12px 16px;
        margin-bottom: 6px;
      }
      .attachment-meta-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 10px;
      }
      .attachment-preview-wrap {
        width: 100%;
        border: 1px solid #E2E8F0;
        border-radius: 6px;
        background: #ffffff;
        padding: 10px;
        overflow: hidden;
      }
      .attachment-preview {
        display: block;
        width: 100%;
        height: auto;
        object-fit: contain;
        object-position: top center;
      }
      .attachment-kind { font-size: 10px; color: #64748B; }
      .attachment-badge {
        flex-shrink: 0;
      }
      .attachment-name { font-size: 11px; font-weight: 600; color: #1E293B; }
      .datamerch-block { margin-top: 10px; padding-bottom: 12px; margin-bottom: 8px; }
      .client-line { font-size: 11px; color: #6B7280; margin-bottom: 6px; }
      .dm-summary { border-radius: 8px; padding: 10px 12px; font-size: 11px; margin-bottom: 10px; }
      .dm-summary.warn { border: 1px solid #FDE68A; background: #FFFBEB; color: #92400E; }
      .dm-summary.ok { border: 1px solid #BBF7D0; background: #F0FDF4; color: #166534; }
      .dm-merchant {
        border: 1px solid #E5E7EB;
        border-radius: 8px;
        background: #fff;
        padding: 10px 12px 14px;
        margin-bottom: 12px;
      }
      .dm-merchant-header { margin-bottom: 8px; }
      .dm-merchant-block { margin-top: 12px; }
      .dm-merchant-name { font-size: 13px; font-weight: 600; color: #111827; }
      .dm-merchant-meta { font-size: 10px; color: #6B7280; margin-top: 2px; margin-bottom: 8px; }
      .dm-record {
        border: 1px solid #E5E7EB;
        border-radius: 6px;
        background: #F9FAFB;
        padding: 8px 10px 12px;
        margin-top: 6px;
        margin-bottom: 2px;
      }
      .dm-record-head { display: flex; justify-content: space-between; gap: 8px; }
      .dm-record-category { font-size: 10px; font-weight: 700; color: #374151; text-transform: uppercase; }
      .dm-record-date { font-size: 10px; color: #6B7280; }
      .dm-record-note { font-size: 11px; color: #111827; margin-top: 4px; white-space: pre-wrap; }
      .dm-record-funder { font-size: 10px; color: #6B7280; margin-top: 4px; }
      .summary-bottom {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
        margin-top: 24px;
        margin-bottom: 24px;
      }
      .panel {
        border: 1px solid #E5E7EB;
        border-radius: 8px;
        background: #fff;
        padding: 14px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.05);
      }
      .panel-title { font-size: 13px; font-weight: 600; margin-bottom: 10px; color: #111827; }
      .panel-kicker { font-size: 11px; font-weight: 700; color: #6B7280; letter-spacing: 0.04em; margin-bottom: 10px; }
      .progress-ring-wrap {
        width: 108px;
        height: 108px;
        margin: 0 auto 8px;
      }
      .progress-svg {
        width: 108px;
        height: 108px;
        display: block;
      }
      .progress-merchant {
        text-align: center;
        font-size: 12px;
        font-weight: 700;
        color: #111827;
        margin-top: 4px;
      }
      .progress-caption { text-align: center; font-size: 11px; color: #6B7280; margin-top: 2px; }
      .result-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
      .result-label { width: 34px; font-size: 11px; color: #374151; font-weight: 500; }
      .result-track { flex: 1; height: 8px; background: #E5E7EB; border-radius: 999px; overflow: hidden; }
      .result-fill { height: 100%; border-radius: 999px; }
      .result-count { width: 14px; text-align: right; font-size: 11px; font-weight: 600; }
      .pdf-footer {
        margin-top: 8px;
        padding: 12px 0 20px;
        border-top: 1px solid #E5E7EB;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        font-size: 10px;
        line-height: 1.5;
        color: #94A3B8;
      }
      .pdf-footer-wrap { margin-top: 24px; padding-top: 16px; border-top: 1px solid #E2E8F0; }
      .pdf-section-footer { margin-bottom: 0; }
      .muted { color: #6B7280; }
    </style>
    <div class="pdf-root">
      <div class="logo-row">
        <img src="${escapeHtml(input.logoUrl)}" alt="Platform logo" />
      </div>
      <div class="page-header">
        <h1 class="page-title">COMPLIANCE REPORT</h1>
        <p class="page-subtitle">Background Check — due-diligence summary</p>
        <div class="meta-grid">
          <div><span class="meta-label">Merchant:</span><span class="meta-value">${escapeHtml(input.merchantName || "—")}</span></div>
          <div><span class="meta-label">Deal:</span><span class="meta-value">${escapeHtml(input.dealId || "—")}</span></div>
          <div><span class="meta-label">EIN:</span><span class="meta-value">${escapeHtml(formatEinDisplay(input.ein))}</span></div>
          <div><span class="meta-label">Offer amount:</span><span class="meta-value">${escapeHtml(input.offerAmount || "—")}</span></div>
          <div><span class="meta-label">Owner:</span><span class="meta-value">${escapeHtml(input.ownerName || "—")}</span></div>
          <div><span class="meta-label">Report date:</span><span class="meta-value">${escapeHtml(generatedAt)}</span></div>
          <div class="meta-status-row">
            <span class="meta-label">Overall status:</span>
            ${pillHtml(overall.className, overall.label)}
          </div>
          ${savedLine ? `<div><span class="meta-label">Saved:</span><span class="meta-value">${escapeHtml(savedLine)}</span></div>` : ""}
        </div>
      </div>

      ${cards}

      <div class="summary-wrap">
        ${buildSummaryGraphHtml(input.checks, checkIds, input.merchantName)}
      </div>

      <div class="pdf-footer-wrap">
        <div class="pdf-footer">
          <span>Confidential — for internal underwriting use only.</span>
          <span>Generated ${escapeHtml(generatedAt)}</span>
        </div>
      </div>
    </div>`;
}

export type BackgroundCheckPdfInput = {
  logoUrl: string;
  merchantName: string;
  ownerName: string;
  offerAmount: string;
  savedByName: string;
  ein: string;
  dealId: string;
  checks: BackgroundCheckFormState;
  savedAt?: string | null;
  datamerch?: Omit<DataMerchLookupData, "raw"> | null;
  datamerchSearchedAt?: string | null;
};

async function waitForDomPaint(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function resolveAssetDataUrl(src: string): Promise<string> {
  if (!src || src.startsWith("data:")) return src;
  try {
    const response = await fetch(src);
    if (!response.ok) return src;
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? src));
      reader.onerror = () => resolve(src);
      reader.readAsDataURL(blob);
    });
  } catch {
    return src;
  }
}

async function waitForImages(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        }),
    ),
  );
}

async function renderPdfRootCanvas(root: HTMLElement, styleText: string): Promise<HTMLCanvasElement> {
  return html2canvas(root, {
    scale: 2,
    useCORS: true,
    allowTaint: true,
    backgroundColor: "#ffffff",
    logging: false,
    width: root.scrollWidth,
    height: root.scrollHeight,
    windowWidth: root.scrollWidth,
    onclone: (clonedDoc) => {
      const style = clonedDoc.createElement("style");
      style.textContent = styleText;
      clonedDoc.head.appendChild(style);
    },
  });
}

function paginateCanvasToPdf(doc: jsPDF, canvas: HTMLCanvasElement): void {
  const { marginX, marginTop, marginBottom } = PDF_LAYOUT;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - marginX * 2;
  const contentHeight = pageHeight - marginTop - marginBottom;
  const pxPerMm = canvas.width / contentWidth;
  const pageSliceHeightPx = contentHeight * pxPerMm;

  let sourceY = 0;
  let pageIndex = 0;

  while (sourceY < canvas.height) {
    if (pageIndex > 0) {
      doc.addPage();
    }

    const slicePx = Math.min(pageSliceHeightPx, canvas.height - sourceY);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = slicePx;
    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) break;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
    ctx.drawImage(canvas, 0, sourceY, canvas.width, slicePx, 0, 0, canvas.width, slicePx);

    const sliceHeightMm = slicePx / pxPerMm;
    doc.addImage(
      sliceCanvas.toDataURL("image/png"),
      "PNG",
      marginX,
      marginTop,
      contentWidth,
      sliceHeightMm,
    );

    sourceY += slicePx;
    pageIndex += 1;
  }
}

async function appendPdfRootToDoc(doc: jsPDF, container: HTMLElement): Promise<void> {
  const root = container.querySelector(".pdf-root");
  if (!root || !(root instanceof HTMLElement)) return;

  const styleText = container.querySelector("style")?.textContent ?? "";
  const canvas = await renderPdfRootCanvas(root, styleText);
  if (!canvas.width || !canvas.height) return;
  paginateCanvasToPdf(doc, canvas);
}

export async function downloadBackgroundCheckPdf(input: BackgroundCheckPdfInput): Promise<void> {
  const logoDataUrl = await resolveAssetDataUrl(input.logoUrl);
  const allCheckIds = BACKGROUND_CHECK_RESOURCES.map((resource) => resource.id);
  const attachmentPreviews = await resolveCheckAttachmentPreviews(input.checks, allCheckIds);
  const html = buildBackgroundCheckPdfHtml(
    { ...input, logoUrl: logoDataUrl },
    attachmentPreviews,
  );

  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.width = "794px";
  container.style.background = "#ffffff";
  container.style.zIndex = "-1";
  container.style.pointerEvents = "none";
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    await waitForDomPaint();
    await waitForImages(container);

    const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    await appendPdfRootToDoc(doc, container);

    const safeName = (input.merchantName || "background-check")
      .replace(/[^\w.-]+/g, "_")
      .slice(0, 48);
    doc.save(`${safeName}-background-check.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}

export function defaultBackgroundCheckLogoUrl(): string {
  return APP_LOGO_SRC;
}
