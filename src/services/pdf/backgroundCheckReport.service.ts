import { renderLetterHtmlToPdfBuffer } from './letterHtmlToPdf.service';
import fs from 'fs';
import path from 'path';

const BRAND_LOGO_CANDIDATES = [
  path.resolve(__dirname, '..', '..', '..', 'public', 'harbor_logo.png'),
  path.resolve(__dirname, '..', '..', '..', 'public', 'nitro_advance_logo.png'),
  path.resolve(__dirname, '..', '..', '..', 'public', 'logoo.png'),
];

let cachedLogoDataUri: string | undefined;

function isAbsoluteOrDataLogoUrl(url: string): boolean {
  return /^(https?:\/\/|data:)/i.test(url);
}

function resolveBackgroundCheckLogoSrc(logoUrl?: string): string {
  const override =
    logoUrl?.trim() ||
    process.env.BACKGROUND_CHECK_REPORT_LOGO_URL?.trim() ||
    process.env.BACKGROUND_CHECK_REPORT_LOGO_MARK_URL?.trim();
  if (override && isAbsoluteOrDataLogoUrl(override)) return override;

  if (!cachedLogoDataUri) {
    const logoPath = BRAND_LOGO_CANDIDATES.find((candidate) => fs.existsSync(candidate));
    if (!logoPath) {
      throw new Error('Nitro Advance logo not found in public/');
    }
    const bytes = fs.readFileSync(logoPath);
    const mime = logoPath.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
    cachedLogoDataUri = `data:${mime};base64,${bytes.toString('base64')}`;
  }
  return cachedLogoDataUri;
}

function buildHeaderLogoHtml(logoUrl?: string): string {
  const logoSrc = resolveBackgroundCheckLogoSrc(logoUrl);
  return `
    <div style="display:flex;align-items:center;min-width:0;">
      <img src="${esc(logoSrc)}" alt="Nitro Advance" style="height:52px;width:auto;display:block;max-width:260px;" />
    </div>`;
}

/** Nitro Advance brand — navy / blue wordmark + flame orange / gold. */
const NAVY = '#0D2478';
const BRAND = '#1E4FA3';
const ORANGE = '#F26C11';
const GOLD = '#F5A623';
const INK = '#0a0a0a';

const CHECK_RESOURCES = [
  { id: 'opencorporates', title: 'OpenCorporates', description: 'Entity registration & status' },
  { id: 'sos', title: 'Secretary of State', description: 'State business registration' },
  { id: 'nyscef', title: 'NY Court', description: 'Civil court case search' },
  { id: 'google', title: 'Google Search', description: 'Open-web reputation' },
  { id: 'notes', title: 'Notes', description: 'Overall due-diligence notes and screenshots' },
] as const;

type CheckStatus = 'completed' | 'pending';
type CheckRisk = 'high' | 'medium' | 'low';

type AttachmentPreview = {
  dataUrl: string;
  kind: 'image' | 'pdf';
};

type OpenCorporatesCompanyHit = {
  name?: string;
  companyNumber?: string;
  jurisdictionCode?: string;
  currentStatus?: string;
  registeredAddress?: string;
  officers?: Array<{ name?: string; position?: string }>;
};

type OpenCorporatesLookupData = {
  searchQuery?: string;
  companies?: OpenCorporatesCompanyHit[];
};

type CheckItemState = {
  notes?: string;
  status?: CheckStatus | string;
  risk?: CheckRisk | string;
  optional?: boolean;
  attachmentName?: string;
  attachmentUrl?: string;
  noteImages?: Array<{ id: string; name: string; url: string; publicId?: string }>;
  savedAt?: string;
};

export type BackgroundCheckReportPayload = {
  merchantName: string;
  ownerName: string;
  ownerSsn?: string;
  offerAmount: string;
  ein: string;
  dealId: string;
  checks: Record<string, CheckItemState>;
  savedByName?: string;
  logoUrl?: string;
  opencorporates?: OpenCorporatesLookupData | null;
  opencorporatesSearchedAt?: string | null;
  attachmentPreviews?: Record<string, AttachmentPreview | null>;
};

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  completed: { bg: '#dcfce7', fg: '#15803d', label: 'COMPLETED' },
  pending: { bg: '#f1f5f9', fg: '#64748b', label: 'PENDING' },
};

const RISK_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  high: { bg: '#fee2e2', fg: '#b91c1c', label: 'HIGH' },
  medium: { bg: '#fef9c3', fg: '#a16207', label: 'MEDIUM' },
  low: { bg: '#dcfce7', fg: '#15803d', label: 'LOW' },
};

const BAR_COLOR: Record<string, string> = {
  completed: '#16a34a',
  pending: '#94a3b8',
  high: '#dc2626',
  medium: '#eab308',
  low: '#16a34a',
};

const LEGACY_COMPLETED_STATUSES = new Set(['pass', 'fail', 'flag', 'na']);

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTimestamp(iso?: string | null): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtEin(ein: string): string {
  const digits = String(ein || '').replace(/\D/g, '');
  if (digits.length !== 9) return ein || '—';
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function fmtSsn(ssn: string): string {
  const digits = String(ssn || '').replace(/\D/g, '');
  if (digits.length !== 9) return ssn.trim() || '—';
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
}

function normalizeCheckStatus(status?: string | null): CheckStatus {
  if (status === 'completed' || status === 'pending') return status;
  if (status && LEGACY_COMPLETED_STATUSES.has(status)) return 'completed';
  return 'pending';
}

function normalizeCheckRisk(risk?: string | null): CheckRisk | null {
  if (risk === 'high' || risk === 'medium' || risk === 'low') return risk;
  return null;
}

function statusBadgeHtml(status?: string | null): string {
  const key = normalizeCheckStatus(status);
  const s = STATUS_STYLE[key];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:9px;font-weight:700;line-height:1.15;letter-spacing:0.2px;background:${s.bg};color:${s.fg};white-space:nowrap;">${s.label}</span>`;
}

function riskBadgeHtml(risk?: string | null): string {
  const key = normalizeCheckRisk(risk);
  if (!key) {
    return '<span style="color:#cbd5e1;font-style:italic;font-size:11px;">—</span>';
  }
  const s = RISK_STYLE[key];
  return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:9px;font-weight:700;line-height:1.15;letter-spacing:0.2px;background:${s.bg};color:${s.fg};white-space:nowrap;">${s.label}</span>`;
}

function summaryChip(count: number, kind: 'completed' | 'pending'): string {
  if (count <= 0) return '';
  const s = STATUS_STYLE[kind];
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:9px;font-weight:700;line-height:1.15;background:${s.bg};color:${s.fg};white-space:nowrap;">${count} ${s.label}</span>`;
}

function countByStatus(
  checks: Record<string, CheckItemState>,
  checkIds: string[],
  status: CheckStatus,
): number {
  return checkIds.filter((id) => normalizeCheckStatus(checks[id]?.status) === status).length;
}

function countByRisk(
  checks: Record<string, CheckItemState>,
  checkIds: string[],
  risk: CheckRisk,
): number {
  return checkIds.filter((id) => normalizeCheckRisk(checks[id]?.risk) === risk).length;
}

const STRUCTURED_NOTES_MARKER = 'data-crm-bg-notes';

function isStructuredNotesHtml(notes: string): boolean {
  return notes.includes(STRUCTURED_NOTES_MARKER);
}

function decodeBasicHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/gi, "'");
}

/** Convert CRM structured notes HTML into clean plain text for the PDF. */
export function structuredNotesToPlainText(html: string): string {
  let text = String(html || '');

  // Preserve useful link targets before stripping tags.
  text = text.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, label: string) => {
      const cleanLabel = decodeBasicHtmlEntities(label.replace(/<[^>]+>/g, '').trim());
      const cleanHref = String(href || '').trim();
      if (!cleanHref) return cleanLabel;
      if (!cleanLabel || cleanLabel === cleanHref) return cleanHref;
      return `${cleanLabel}: ${cleanHref}`;
    },
  );

  text = text
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/dt>/gi, ': ')
    .replace(/<\/(p|div|h[1-6]|li|tr|dd|article|section|ul|ol|dl)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '');

  text = decodeBasicHtmlEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

function formatFindings(
  notes: string | undefined,
  noteImages?: CheckItemState['noteImages'],
): string {
  const trimmed = String(notes || '').trim();
  let textHtml = '';
  if (trimmed) {
    const plain = isStructuredNotesHtml(trimmed)
      ? structuredNotesToPlainText(trimmed)
      : trimmed;
    textHtml = plain ? `<div>${esc(plain).replace(/\n/g, '<br/>')}</div>` : '';
  }
  const images = (noteImages ?? [])
    .map(
      (image) => `
        <div style="margin-top:6px;">
          <a href="${esc(image.url)}" style="color:#2563eb;text-decoration:underline;font-size:10px;">${esc(image.name)}</a>
          <div style="margin-top:4px;border:1px solid #e2e8f0;border-radius:6px;padding:6px;background:#fff;">
            <img src="${esc(image.url)}" alt="${esc(image.name)}" style="display:block;width:100%;max-height:260px;object-fit:contain;object-position:top center;" />
          </div>
        </div>`,
    )
    .join('');

  if (textHtml || images) return `${textHtml}${images}`;
  return '—';
}

function isImageAttachment(name: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function buildAttachmentsCell(state: CheckItemState): string {
  if (!state.attachmentName) {
    return '<span style="color:#cbd5e1;font-style:italic;">None</span>';
  }
  const name = esc(state.attachmentName);
  if (state.attachmentUrl) {
    return `<a href="${esc(state.attachmentUrl)}" style="color:#2563eb;text-decoration:underline;">${name}</a>`;
  }
  return name;
}

function buildAttachmentPreviewHtml(
  state: CheckItemState,
  preview?: AttachmentPreview | null,
): string {
  const src =
    preview?.dataUrl ||
    (state.attachmentUrl && isImageAttachment(state.attachmentName ?? '')
      ? state.attachmentUrl
      : null);
  if (!src) return '';

  const kindLabel =
    preview?.kind === 'pdf'
      ? 'PDF · first page preview'
      : preview?.kind === 'image' || isImageAttachment(state.attachmentName ?? '')
        ? 'Image preview'
        : 'Attachment preview';

  return `
    <div style="margin-top:8px;border:1px solid #e2e8f0;border-radius:6px;padding:8px;background:#fff;">
      <img src="${esc(src)}" alt="${esc(state.attachmentName ?? 'Attachment')}" style="display:block;width:100%;max-height:300px;object-fit:contain;object-position:top center;" />
      <div style="font-size:9px;color:#64748b;margin-top:4px;">${kindLabel}</div>
    </div>`;
}

function buildOpenCorporatesFindingsHtml(
  lookup: OpenCorporatesLookupData | null | undefined,
  searchedAt?: string | null,
): string {
  if (!lookup) return '';
  const companies = lookup.companies ?? [];
  const searched = searchedAt ? `Searched ${fmtTimestamp(searchedAt)}` : '';
  if (companies.length === 0) {
    return `<div style="margin-top:8px;font-size:10px;color:#64748b;">No OpenCorporates companies found${lookup.searchQuery ? ` for "${esc(lookup.searchQuery)}"` : ''}.${searched ? ` ${esc(searched)}.` : ''}</div>`;
  }
  const rows = companies
    .slice(0, 8)
    .map((company) => {
      const officers = (company.officers ?? [])
        .slice(0, 4)
        .map((officer) => (officer.position ? `${officer.name} (${officer.position})` : officer.name))
        .filter(Boolean)
        .join(', ');
      const details = [
        company.companyNumber ? `No. ${company.companyNumber}` : '',
        company.jurisdictionCode || '',
        company.currentStatus || '',
      ]
        .filter(Boolean)
        .join(' · ');
      return `<li style="margin:0 0 6px;font-size:10px;">
        <div style="font-weight:600;color:#0f172a;">${esc(company.name || 'Company')}</div>
        ${details ? `<div style="color:#64748b;margin-top:2px;">${esc(details)}</div>` : ''}
        ${company.registeredAddress ? `<div style="color:#64748b;margin-top:2px;">${esc(company.registeredAddress)}</div>` : ''}
        ${officers ? `<div style="color:#64748b;margin-top:2px;">Officers: ${esc(officers)}</div>` : ''}
      </li>`;
    })
    .join('');
  return `<div style="margin-top:8px;">
    <div style="font-size:8px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#94a3b8;margin-bottom:4px;">OpenCorporates findings${searched ? ` · ${esc(searched)}` : ''}</div>
    <ul style="margin:0;padding-left:16px;">${rows}</ul>
  </div>`;
}

function buildCheckCardHtml(
  index: number,
  title: string,
  description: string,
  state: CheckItemState,
  preview?: AttachmentPreview | null,
  extraContent = '',
): string {
  const displayTitle = state.optional ? `${title} (optional)` : title;
  const findings = formatFindings(state.notes, state.noteImages);
  const reviewed = fmtDate(state.savedAt);
  const attachments = buildAttachmentsCell(state);
  const attachmentPreview = buildAttachmentPreviewHtml(state, preview);
  const statusBadges = `${statusBadgeHtml(state.status)}${state.risk ? ` <span style="display:inline-block;width:4px;"></span> ${riskBadgeHtml(state.risk)}` : ''}`;

  const coreSection = `
      <div style="background:linear-gradient(90deg,#fff7ed 0%,#eef2ff 100%);padding:10px 12px;border-radius:7px 7px 0 0;border-bottom:2px solid ${ORANGE};">
        <table style="width:100%;border-collapse:collapse;margin:0;" cellspacing="0" cellpadding="0">
          <tr>
            <td style="width:30px;padding:0 8px 0 0;vertical-align:middle;">
              <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:linear-gradient(135deg,${ORANGE} 0%,${GOLD} 100%);color:#fff;font-size:11px;font-weight:700;">${index}</span>
            </td>
            <td style="vertical-align:middle;padding:0;">
              <div style="font-size:13px;font-weight:700;color:${NAVY};line-height:1.2;">${esc(displayTitle)}</div>
              <div style="font-size:10px;color:#94a3b8;margin-top:1px;line-height:1.2;">${esc(description)}</div>
            </td>
            <td style="width:1%;white-space:nowrap;text-align:right;vertical-align:middle;padding:0 0 0 8px;">
              ${statusBadges}
            </td>
          </tr>
        </table>
      </div>
      <table style="width:100%;border-collapse:collapse;background:#fff;" cellspacing="0" cellpadding="0">
        <tr>
          <td style="width:92px;padding:5px 9px;font-size:8px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#94a3b8;vertical-align:top;background:#f8fafc;border-right:1px solid #f1f5f9;">FINDINGS</td>
          <td style="padding:5px 9px;font-size:11px;color:#334155;line-height:1.35;">${findings}</td>
        </tr>
        <tr>
          <td style="width:92px;padding:5px 9px;border-top:1px solid #f1f5f9;font-size:8px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#94a3b8;vertical-align:top;background:#f8fafc;border-right:1px solid #f1f5f9;">REVIEWED</td>
          <td style="padding:5px 9px;border-top:1px solid #f1f5f9;font-size:11px;color:#334155;">${esc(reviewed)}</td>
        </tr>
        <tr>
          <td style="width:92px;padding:5px 9px;border-top:1px solid #f1f5f9;font-size:8px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#94a3b8;vertical-align:top;background:#f8fafc;border-right:1px solid #f1f5f9;">ATTACHMENTS</td>
          <td style="padding:5px 9px;border-top:1px solid #f1f5f9;font-size:11px;color:#334155;">${attachments}</td>
        </tr>
      </table>`;

  const pageBreakGuard =
    'break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;';
  const attachmentBlock = attachmentPreview
    ? `<div style="padding:0 9px 9px;">${attachmentPreview}</div>`
    : '';
  const extraBlock = extraContent
    ? `<div style="padding:0 9px 9px;">${extraContent}</div>`
    : '';

  return `
    <div class="bc-check-card" style="border:1px solid #fed7aa;border-radius:8px;background:#fff;margin:0 0 7px;${pageBreakGuard}">
      ${coreSection}
      ${attachmentBlock}
      ${extraBlock}
    </div>`;
}

function buildGraphsHtml(
  checks: Record<string, CheckItemState>,
  checkIds: string[],
  merchantName: string,
): string {
  const total = checkIds.length;
  const completed = checkIds.filter(
    (id) => normalizeCheckStatus(checks[id]?.status) === 'completed',
  ).length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const offset = 264 - (percent / 100) * 264;

  const statusBars = (['completed', 'pending'] as const)
    .map((status) => {
      const count = countByStatus(checks, checkIds, status);
      const width = total > 0 ? Math.max((count / total) * 100, count > 0 ? 12 : 0) : 0;
      const label = status === 'completed' ? 'Completed' : 'Pending';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="width:56px;font-size:10px;color:#374151;">${label}</span>
        <div style="flex:1;height:7px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${width}%;background:${BAR_COLOR[status]};border-radius:999px;"></div>
        </div>
        <span style="width:12px;text-align:right;font-size:10px;font-weight:600;">${count}</span>
      </div>`;
    })
    .join('');

  const riskBars = (['high', 'medium', 'low'] as const)
    .map((risk) => {
      const count = countByRisk(checks, checkIds, risk);
      const width = total > 0 ? Math.max((count / total) * 100, count > 0 ? 12 : 0) : 0;
      const label = risk === 'high' ? 'High' : risk === 'medium' ? 'Medium' : 'Low';
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
        <span style="width:56px;font-size:10px;color:#374151;">${label}</span>
        <div style="flex:1;height:7px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
          <div style="height:100%;width:${width}%;background:${BAR_COLOR[risk]};border-radius:999px;"></div>
        </div>
        <span style="width:12px;text-align:right;font-size:10px;font-weight:600;">${count}</span>
      </div>`;
    })
    .join('');

  return `
    <div class="bc-graphs-section" style="margin:14px 0 0;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;" cellspacing="0" cellpadding="0">
        <tr>
          <td style="width:50%;vertical-align:top;padding-right:5px;">
            <div style="border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:11px;height:100%;box-sizing:border-box;">
              <div style="font-size:12px;font-weight:600;margin-bottom:8px;color:#111827;">Completion Progress</div>
              <div style="width:96px;height:96px;margin:0 auto 6px;">
                <svg viewBox="0 0 108 108" style="width:96px;height:96px;display:block;" aria-hidden="true">
                  <g transform="rotate(-90 54 54)">
                    <circle cx="54" cy="54" r="42" fill="none" stroke="#E5E7EB" stroke-width="10" />
                    <circle cx="54" cy="54" r="42" fill="none" stroke="${ORANGE}" stroke-width="10" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="${offset}" />
                  </g>
                  <text x="54" y="58" text-anchor="middle" fill="#111827" font-size="18" font-weight="700" font-family="Arial, Helvetica, sans-serif">${percent}%</text>
                </svg>
              </div>
              <div style="text-align:center;font-size:11px;font-weight:700;color:#111827;">${esc((merchantName || 'Merchant').toUpperCase())}</div>
              <div style="text-align:center;font-size:10px;color:#6b7280;margin-top:2px;">${completed} of ${total} complete</div>
            </div>
          </td>
          <td style="width:50%;vertical-align:top;padding-left:5px;">
            <div style="border:1px solid #e5e7eb;border-radius:8px;background:#fff;padding:11px;height:100%;box-sizing:border-box;">
              <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:0.04em;margin-bottom:8px;">STATUS</div>
              ${statusBars}
              <div style="font-size:10px;font-weight:700;color:#6b7280;letter-spacing:0.04em;margin:10px 0 8px;">RISK</div>
              ${riskBars}
            </div>
          </td>
        </tr>
      </table>
    </div>`;
}

function buildHtml(payload: BackgroundCheckReportPayload): string {
  const checkIds = CHECK_RESOURCES.map((r) => r.id).filter((id) => !payload.checks[id]?.optional);
  const generatedAt = fmtTimestamp(new Date().toISOString());
  const reportDate = fmtDate(new Date().toISOString());
  const dealLabel = [payload.merchantName, payload.dealId].filter(Boolean).join(' — ') || '—';

  const chips =
    summaryChip(countByStatus(payload.checks, checkIds, 'completed'), 'completed') +
    summaryChip(countByStatus(payload.checks, checkIds, 'pending'), 'pending');

  let index = 0;
  const cards = CHECK_RESOURCES.map((resource) => {
    index += 1;
    const state = payload.checks[resource.id] ?? { notes: '' };
    const preview = payload.attachmentPreviews?.[resource.id] ?? null;
    // Notes already store the structured OpenCorporates HTML — don't duplicate it.
    const extra =
      resource.id === 'opencorporates' && !isStructuredNotesHtml(String(state.notes || ''))
        ? buildOpenCorporatesFindingsHtml(payload.opencorporates, payload.opencorporatesSearchedAt)
        : '';
    return buildCheckCardHtml(index, resource.title, resource.description, state, preview, extra);
  }).join('');

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff;font-size:12px;line-height:1.35;">
      <div style="background:linear-gradient(90deg,${INK} 0%,${NAVY} 55%,${BRAND} 100%);color:#fff;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 22px;">
          ${buildHeaderLogoHtml(payload.logoUrl)}
          <div style="text-align:right;">
            <div style="font-size:22px;font-weight:800;letter-spacing:1.5px;line-height:1.1;">COMPLIANCE REPORT</div>
            <div style="font-size:10px;letter-spacing:0.4px;opacity:0.9;margin-top:3px;">BACKGROUND CHECK · DUE-DILIGENCE SUMMARY</div>
          </div>
        </div>
        <div style="height:4px;background:linear-gradient(90deg,${ORANGE} 0%,${GOLD} 50%,${ORANGE} 100%);"></div>
      </div>

      <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 22px;border-bottom:1px solid #e8edf3;font-size:11px;color:#64748b;">
        <span>${checkIds.length} checks reviewed</span>
        <span style="display:inline-flex;align-items:center;gap:5px;">${chips || '<span style="font-size:10px;color:#94a3b8;">No results recorded yet</span>'}</span>
      </div>

      <div style="margin:12px 22px 0;border:1px solid #fed7aa;border-radius:6px;overflow:hidden;">
        <div style="background:linear-gradient(90deg,#fff7ed 0%,#eef2ff 100%);color:${NAVY};text-align:center;font-size:10px;font-weight:700;letter-spacing:0.8px;padding:5px 10px;border-bottom:2px solid ${ORANGE};">DEAL OVERVIEW</div>
        <table style="width:100%;border-collapse:collapse;" cellspacing="0" cellpadding="0">
          <tr>
            <td style="width:50%;border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;">
              <div style="font-size:8px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:2px;">DEAL</div>
              <div style="font-size:12px;font-weight:700;color:#0f172a;">${esc(dealLabel)}</div>
            </td>
            <td style="width:50%;border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;">
              <div style="font-size:8px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:2px;">APPROVED AMOUNT</div>
              <div style="font-size:12px;font-weight:700;color:#0f172a;">${esc(payload.offerAmount || '—')}</div>
            </td>
          </tr>
          <tr>
            <td style="border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;">
              <div style="font-size:8px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:2px;">EIN</div>
              <div style="font-size:12px;font-weight:700;color:#0f172a;">${esc(fmtEin(payload.ein))}</div>
            </td>
            <td style="border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;">
              <div style="font-size:8px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:2px;">OWNER</div>
              <div style="font-size:12px;font-weight:700;color:#0f172a;">${esc(payload.ownerName || '—')}</div>
            </td>
          </tr>
          <tr>
            <td style="border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;">
              <div style="font-size:8px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:2px;">SSN</div>
              <div style="font-size:12px;font-weight:700;color:#0f172a;">${esc(fmtSsn(payload.ownerSsn ?? ''))}</div>
            </td>
            <td style="border:1px solid #e2e8f0;padding:6px 10px;vertical-align:top;">
              <div style="font-size:8px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#94a3b8;margin-bottom:2px;">REPORT DATE</div>
              <div style="font-size:12px;font-weight:700;color:#0f172a;">${esc(reportDate)}</div>
            </td>
          </tr>
        </table>
      </div>

      <div style="margin:14px 22px 0;">
        <div style="font-size:12px;font-weight:700;color:${NAVY};margin:0 0 5px;">BACKGROUND CHECKS</div>
        <div style="height:3px;background:linear-gradient(90deg,${ORANGE} 0%,${GOLD} 40%,${BRAND} 100%);margin-bottom:8px;border-radius:999px;"></div>
      </div>

      <div style="padding:0 22px;">
        ${cards}
        <div class="bc-summary-tail" style="break-inside:avoid;page-break-inside:avoid;">
          ${buildGraphsHtml(payload.checks, checkIds, payload.merchantName)}
          <div style="margin:12px 0 0;padding:8px 0 14px;border-top:1px solid #e8edf3;font-size:8px;color:#94a3b8;display:flex;justify-content:space-between;text-transform:uppercase;letter-spacing:0.2px;">
            <span>Confidential — for internal underwriting use only.</span>
            <span>Generated ${esc(generatedAt)}${payload.savedByName ? ` · ${esc(payload.savedByName)}` : ''}</span>
          </div>
        </div>
      </div>
    </div>`;
}

export function buildBackgroundCheckReportFilename(merchantName: string): string {
  const safeName = String(merchantName || 'Merchant')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${safeName || 'Merchant'}-Background-Check.pdf`;
}

export async function generateBackgroundCheckReportPdf(
  payload: BackgroundCheckReportPayload,
): Promise<{ buffer: Buffer; filename: string }> {
  const html = buildHtml(payload);
  const buffer = await renderLetterHtmlToPdfBuffer(html);
  return {
    buffer,
    filename: buildBackgroundCheckReportFilename(payload.merchantName),
  };
}
