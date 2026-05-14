import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { CollectionPaymentSource, CollectionPaymentStatus, Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import prisma from '../config/prismaClient';
import {
  applyStrictTransactionFiltering,
  computeDealCollectionsView,
  filterCollectionPaymentsForTransactionsPage,
  alreadyNetDealEconomics,
  feesForOfferDecision,
  balanceDueLikeTransactionsPage,
  filterCollectionPaymentsForApplicationDeal,
  getApprovedOfferAmountForDealBalance,
  getBalancesForApplicationIds,
  sumTotalPaybackOfferTimesRateFromOfferDecisionRows,
  getDealFinancialsForApplication,
  grossRepaidDealEconomicsFromPayments,
  paymentBelongsToApplicationDeal,
  repaidTowardPaybackExcludingSurplus,
  signedAbovePrincipalGap,
} from '../services/collectionPaymentFinancials';
import { processCollectionPaymentUploadJob } from '../services/collectionPaymentUploadIngestService';
import { distributeSyndicatorCreditsForPayments } from '../services/syndicatorRepaymentService';
import { parseExcelDate } from '../services/applicationBulkExcelIngestService';
import {
  buildApplicationStatsBucketWhere,
  buildFundedApplicationWhereForPaybackTotals,
} from '../services/applicationStatsBucketWhere';

const STATUS_MAP_TO_DB: Record<string, CollectionPaymentStatus | undefined> = {
  paid: CollectionPaymentStatus.PAID,
  failed: CollectionPaymentStatus.FAILED,
  due_today: CollectionPaymentStatus.DUE_TODAY,
  upcoming: CollectionPaymentStatus.UPCOMING,
  scheduled: CollectionPaymentStatus.SCHEDULED,
  manual: CollectionPaymentStatus.MANUAL,
  waived: CollectionPaymentStatus.WAIVED,
  credit: CollectionPaymentStatus.CREDIT,
  debit: CollectionPaymentStatus.DEBIT,
};

const STATUS_MAP_TO_API: Record<string, string> = {
  [CollectionPaymentStatus.PAID]: 'paid',
  [CollectionPaymentStatus.FAILED]: 'failed',
  [CollectionPaymentStatus.DUE_TODAY]: 'due_today',
  [CollectionPaymentStatus.UPCOMING]: 'upcoming',
  [CollectionPaymentStatus.SCHEDULED]: 'scheduled',
  [CollectionPaymentStatus.MANUAL]: 'manual',
  [CollectionPaymentStatus.WAIVED]: 'waived',
  [CollectionPaymentStatus.CREDIT]: 'credit',
  [CollectionPaymentStatus.DEBIT]: 'debit',
};

// Backward/forward compatibility across environments where enum variants may differ.
const maybeCredit = (CollectionPaymentStatus as unknown as Record<string, string>).CREDIT;
if (maybeCredit) {
  STATUS_MAP_TO_DB.credit = maybeCredit as CollectionPaymentStatus;
  STATUS_MAP_TO_API[maybeCredit] = 'credit';
}
const maybeDebit = (CollectionPaymentStatus as unknown as Record<string, string>).DEBIT;
if (maybeDebit) {
  STATUS_MAP_TO_DB.debit = maybeDebit as CollectionPaymentStatus;
  STATUS_MAP_TO_API[maybeDebit] = 'debit';
}

const normalizeStatusToDb = (status: unknown): CollectionPaymentStatus | null => {
  if (!status) return null;
  const raw = String(status).trim().toLowerCase();
  return STATUS_MAP_TO_DB[raw] ?? null;
};

const mapPaymentToApi = (payment: any) => ({
  ...payment,
  status: STATUS_MAP_TO_API[payment.status as CollectionPaymentStatus] ?? 'scheduled',
  amount: Number(payment.amount ?? 0),
  scheduledDate: payment.scheduledDate ? new Date(payment.scheduledDate).toISOString().slice(0, 10) : null,
  processedDate: payment.processedDate ? new Date(payment.processedDate).toISOString().slice(0, 10) : null,
});

const startOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date: Date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const toNum = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value != null && typeof value === 'object' && 'toString' in value) {
    const parsed = Number((value as { toString(): string }).toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Collections / transactions table: newest first (after strict filtering). */
type CollectionPaymentSortable = {
  id: string;
  scheduledDate: Date;
  Date: Date | null;
  createdAt: Date;
  paymentNumber: number | null;
};

function sortPrismaCollectionPaymentsNewestFirst<T extends CollectionPaymentSortable>(rows: T[]): void {
  rows.sort((a, b) => {
    const at = Math.max(
      new Date(a.scheduledDate).getTime(),
      a.Date != null ? new Date(a.Date).getTime() : 0,
    );
    const bt = Math.max(
      new Date(b.scheduledDate).getTime(),
      b.Date != null ? new Date(b.Date).getTime() : 0,
    );
    if (bt !== at) return bt - at;
    const ac = new Date(a.createdAt).getTime();
    const bc = new Date(b.createdAt).getTime();
    if (bc !== ac) return bc - ac;
    return String(b.id).localeCompare(String(a.id));
  });
}

const parseMoney = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n = toNum(value);
  return Number.isFinite(n) ? n : null;
};

const RECOVERED_STATUSES = new Set<CollectionPaymentStatus>([
  CollectionPaymentStatus.PAID,
]);

const OPEN_DUE_STATUSES = new Set<CollectionPaymentStatus>([
  CollectionPaymentStatus.DUE_TODAY,
  CollectionPaymentStatus.UPCOMING,
  CollectionPaymentStatus.SCHEDULED,
]);

const EXCLUDED_FROM_TOTAL_DUES = new Set<CollectionPaymentStatus>([CollectionPaymentStatus.WAIVED]);

const normalizeDealIdToken = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const normalizeHeaderKey = (value: unknown): string =>
  String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Headers whose cells are formatted as calendar dates in preview (Excel serials → YYYY-MM-DD). */
const PREVIEW_DATE_HEADER_KEYS = new Set([
  'date',
  'paymentdate',
  'transactiondate',
  'valuedate',
  'postingdate',
  'effectivedate',
  'settlementdate',
  'cleareddate',
  'scheduleddate',
  'processeddate',
  'returndate',
]);

function formatLocalYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatPreviewCellAsString(header: string, cellValue: unknown): string {
  if (cellValue == null) return '';
  const nk = normalizeHeaderKey(header);
  if (PREVIEW_DATE_HEADER_KEYS.has(nk)) {
    const parsed = parseExcelDate(cellValue);
    if (parsed && !Number.isNaN(parsed.getTime())) return formatLocalYmd(parsed);
  }
  if (cellValue instanceof Date) {
    const parsed = parseExcelDate(cellValue);
    if (parsed && !Number.isNaN(parsed.getTime())) return formatLocalYmd(parsed);
  }
  return String(cellValue);
}

const DEAL_ID_FROM_DESCRIPTION_REGEX = /\b(BA\d+)\b/i;

/**
 * SheetJS: max rows read from the first worksheet (Excel allows >1M; unbounded parse can OOM the API).
 * Every row up to this cap is returned in `previewRows` with full column strings for the preview grid.
 */
const PREVIEW_XLSX_SHEET_ROWS_CAP = 25_000;

const getPreviewRowValue = (rowData: Record<string, unknown>, ...candidates: string[]): unknown => {
  const wanted = new Set(candidates.map((candidate) => normalizeHeaderKey(candidate)));
  for (const [key, value] of Object.entries(rowData ?? {})) {
    if (wanted.has(normalizeHeaderKey(key))) return value;
  }
  return undefined;
};

const hasPreviewCellValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

const parsePreviewAmount = (value: unknown): number | null => {
  if (!hasPreviewCellValue(value)) return null;
  const normalized = typeof value === 'string' ? value.replace(/[$,\s]/g, '') : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

class CollectionPaymentController {
  private async resolveDealIdFromQuery(params: {
    applicationIdRaw: string;
    dealIdRaw: string;
  }): Promise<string | null> {
    const { applicationIdRaw, dealIdRaw } = params;
    if (dealIdRaw) return dealIdRaw;
    if (!applicationIdRaw) return null;

    const byUuid = await prisma.application.findUnique({
      where: { id: applicationIdRaw },
      select: { dealId: true, note: true },
    });
    if (byUuid?.dealId?.trim()) return byUuid.dealId.trim();

    const markerMatch = String(byUuid?.note ?? '').match(/\[DEAL_ID:([^\]]+)\]/i);
    if (markerMatch?.[1]?.trim()) return markerMatch[1].trim();

    const byDisplayId =
      Number.isFinite(Number(applicationIdRaw)) && Number(applicationIdRaw) > 0
        ? await prisma.application.findFirst({
            where: { applicationId: Number(applicationIdRaw) },
            select: { dealId: true, note: true },
            orderBy: { createdAt: 'desc' },
          })
        : null;
    if (byDisplayId?.dealId?.trim()) return byDisplayId.dealId.trim();
    const markerFromDisplay = String(byDisplayId?.note ?? '').match(/\[DEAL_ID:([^\]]+)\]/i);
    if (markerFromDisplay?.[1]?.trim()) return markerFromDisplay[1].trim();

    const byDealId = await prisma.application.findFirst({
      where: {
        OR: [
          { dealId: { equals: applicationIdRaw, mode: 'insensitive' } },
          { note: { contains: `[DEAL_ID:${applicationIdRaw}]`, mode: 'insensitive' } },
          { note: { contains: applicationIdRaw, mode: 'insensitive' } },
        ],
      },
      select: { dealId: true, note: true },
      orderBy: { createdAt: 'desc' },
    });
    if (byDealId?.dealId?.trim()) return byDealId.dealId.trim();
    const markerFromDeal = String(byDealId?.note ?? '').match(/\[DEAL_ID:([^\]]+)\]/i);
    if (markerFromDeal?.[1]?.trim()) return markerFromDeal[1].trim();

    // Final fallback for formatting variants (e.g. BA2010 vs BA-2010 vs BA 2010).
    const targetToken = normalizeDealIdToken(applicationIdRaw);
    if (targetToken) {
      const appsForToken = await this.findApplicationsByNormalizedDealIdToken(targetToken);
      const tokenMatch = appsForToken[0];
      if (tokenMatch?.dealId?.trim()) return tokenMatch.dealId.trim();
    }

    return null;
  }

  private async findApplicationsForDealId(
    dealId: string,
  ): Promise<Array<{ id: string; applicationId: number; createdAt: Date }>> {
    const trimmed = String(dealId || '').trim();
    if (!trimmed) return [];
    const marker = `[DEAL_ID:${trimmed}]`;
    return prisma.application.findMany({
      where: {
        OR: [
          { dealId: { equals: trimmed, mode: 'insensitive' } },
          { note: { contains: marker, mode: 'insensitive' } },
          { note: { contains: trimmed, mode: 'insensitive' } },
        ],
      },
      select: { id: true, applicationId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Applications whose `dealId` normalizes to `targetToken` (same rules as {@link normalizeDealIdToken}).
   * Avoids `findMany({ dealId: { not: null } })` + in-memory filter, which loaded the entire table at scale.
   */
  private async findApplicationsByNormalizedDealIdToken(
    targetToken: string,
  ): Promise<Array<{ id: string; applicationId: number; createdAt: Date; dealId: string | null }>> {
    const t = String(targetToken ?? '').trim();
    if (!t) return [];
    return prisma.$queryRaw<
      Array<{ id: string; applicationId: number; createdAt: Date; dealId: string | null }>
    >`
      SELECT
        a.id::text AS id,
        a."applicationId" AS "applicationId",
        a."createdAt" AS "createdAt",
        a."dealId" AS "dealId"
      FROM "Application" a
      WHERE a."dealId" IS NOT NULL
      AND regexp_replace(upper(a."dealId"), '[^A-Z0-9]', '', 'g') = ${t}
      ORDER BY a."createdAt" DESC
    `;
  }

  /** Latest application per normalized deal token (for batch upload mapping). */
  private async mapLatestApplicationsByNormalizedDealTokens(
    tokens: string[],
  ): Promise<Map<string, { id: string; dealId: string | null }>> {
    const uniq = Array.from(
      new Set(tokens.map((x) => String(x ?? '').trim()).filter((x) => x.length > 0)),
    );
    const out = new Map<string, { id: string; dealId: string | null }>();
    if (!uniq.length) return out;

    /** Index-friendly path when the stored dealId matches the token (avoids regexp scan on large tables). */
    if (uniq.length === 1) {
      const t = uniq[0]!;
      const direct = await prisma.application.findFirst({
        where: { dealId: { not: null, equals: t, mode: 'insensitive' } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, dealId: true },
      });
      if (direct?.dealId) {
        const nt = normalizeDealIdToken(direct.dealId);
        if (nt === t) {
          out.set(t, { id: direct.id, dealId: direct.dealId });
          return out;
        }
      }
    }

    const rows = await prisma.$queryRaw<
      Array<{ id: string; dealId: string | null; tok: string }>
    >`
      SELECT
        a.id::text AS id,
        a."dealId" AS "dealId",
        regexp_replace(upper(a."dealId"), '[^A-Z0-9]', '', 'g') AS tok
      FROM "Application" a
      WHERE a."dealId" IS NOT NULL
      AND regexp_replace(upper(a."dealId"), '[^A-Z0-9]', '', 'g') IN (${Prisma.join(uniq)})
      ORDER BY a."createdAt" DESC
    `;

    for (const row of rows) {
      if (!row.tok || out.has(row.tok)) continue;
      out.set(row.tok, { id: row.id, dealId: row.dealId });
    }
    return out;
  }

  /** Pick the application row the CRM detail view refers to (UUID, display id, or latest on deal). */
  private resolveViewApplicationUuid(params: {
    applicationIdQuery: string;
    matchedApps: Array<{ id: string; applicationId: number }>;
  }): string | null {
    const { applicationIdQuery, matchedApps } = params;
    const q = String(applicationIdQuery ?? '').trim();
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (q && uuidRe.test(q)) {
      const hit = matchedApps.find((a) => a.id === q);
      if (hit) return hit.id;
      return q;
    }
    if (q) {
      const num = Number(q);
      if (Number.isFinite(num) && num > 0) {
        const byDisplay = matchedApps.find((a) => a.applicationId === num);
        if (byDisplay) return byDisplay.id;
      }
    }
    return matchedApps[0]?.id ?? null;
  }

  /** Batch Balance Due / repaid totals from DB — used by Payment History funded-deals grid (always fresh). */
  async balancesForApplications(req: Request, res: Response) {
    try {
      const rawList = (req.body as { applicationIds?: unknown })?.applicationIds;
      const ids = Array.isArray(rawList)
        ? rawList.map((id) => String(id ?? '').trim()).filter((id) => id.length > 0)
        : [];
      if (!ids.length) {
        return res.status(400).json({
          success: false,
          message: 'applicationIds must be a non-empty array',
        });
      }
      const max = 400;
      const sliced = ids.slice(0, max);
      const data = await getBalancesForApplicationIds(prisma, sliced);
      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error('balancesForApplications error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /** Sum of repaid and balance using strict CREDIT/DEBIT linking rules. Query: `applicationId` (UUID). */
  async financials(req: Request, res: Response) {
    try {
      const applicationId = typeof req.query.applicationId === 'string' ? req.query.applicationId.trim() : '';
      const dealId = typeof req.query.dealId === 'string' ? req.query.dealId.trim() : '';
      if (!applicationId && !dealId) {
        return res
          .status(400)
          .json({ success: false, message: 'applicationId or dealId query parameter is required' });
      }

      const resolvedDealId = await this.resolveDealIdFromQuery({
        applicationIdRaw: applicationId,
        dealIdRaw: dealId,
      });
      if (!resolvedDealId) {
        return res.status(404).json({ success: false, message: 'Application/deal not found' });
      }

      const matchedApps = await this.findApplicationsForDealId(resolvedDealId);
      const latestApp = matchedApps[0];
      if (!latestApp?.id) {
        return res.status(404).json({ success: false, message: 'Application not found for dealId' });
      }

      const data = await getDealFinancialsForApplication(prisma, latestApp.id);
      if (!data) {
        return res.status(404).json({ success: false, message: 'Application not found' });
      }

      return res.status(200).json({
        success: true,
        data: {
          dealId: data.dealId,
          sumOfRepaid: Number(data.sumOfRepaid.toFixed(2)),
          balance: Number(data.balance.toFixed(2)),
        },
      });
    } catch (error) {
      console.error('Collection payment financials error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async list(req: Request, res: Response) {
    try {
      const applicationId = typeof req.query.applicationId === 'string' ? req.query.applicationId.trim() : '';
      const dealId = typeof req.query.dealId === 'string' ? req.query.dealId.trim() : '';
      if (!applicationId && !dealId) {
        return res
          .status(400)
          .json({ success: false, message: 'applicationId or dealId query parameter is required' });
      }

      const resolvedDealId = await this.resolveDealIdFromQuery({
        applicationIdRaw: applicationId,
        dealIdRaw: dealId,
      });
      if (!resolvedDealId) {
        return res.status(404).json({ success: false, message: 'Application/deal not found' });
      }

      const matchedApps = await this.findApplicationsForDealId(resolvedDealId);
      let matchedIds = matchedApps.map((app) => app.id);
        if (!matchedIds.length) {
          const targetToken = normalizeDealIdToken(resolvedDealId);
          if (targetToken) {
            const tokenMatchedApps =
              await this.findApplicationsByNormalizedDealIdToken(targetToken);
            matchedIds = tokenMatchedApps.map((app) => app.id);
          }
        }
      const payments = await prisma.collectionPayment.findMany({
        where: {
          applicationId: matchedIds.length
            ? { in: matchedIds }
            : applicationId
              ? applicationId
              : undefined,
        },
        orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }, { paymentNumber: 'desc' }],
      });
      const filteredPayments = applyStrictTransactionFiltering(payments);
      sortPrismaCollectionPaymentsNewestFirst(filteredPayments);

      const includeDealView =
        req.query.includeDealView === '1' ||
        String(req.query.includeDealView ?? '').toLowerCase() === 'true';

      let dealView: import('../services/collectionPaymentFinancials').DealCollectionsViewApi | null = null;
      if (includeDealView && matchedApps.length > 0) {
        const viewUuid = this.resolveViewApplicationUuid({
          applicationIdQuery: applicationId,
          matchedApps,
        });
        if (viewUuid) {
          const viewApp = await prisma.application.findUnique({
            where: { id: viewUuid },
            select: {
              id: true,
              applicationId: true,
              dealId: true,
              loanAmount: true,
              commissionAmount: true,
              OfferDecision: true,
              termsOffers: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                  approvedAmount: true,
                  factorRate: true,
                  paybackAmount: true,
                  paymentAmount: true,
                  frequency: true,
                  commissionAmount: true,
                },
              },
            },
          });
          if (viewApp) {
            const appDealId = viewApp.dealId ?? null;
            const viewRows = filterCollectionPaymentsForTransactionsPage(filteredPayments, {
              primaryApplicationId: viewApp.id,
              applicationIdDisplay: String(viewApp.applicationId),
              applicationDealId: appDealId,
            });
            const toTerms = viewApp.termsOffers[0];
            dealView = computeDealCollectionsView({
              viewPayments: viewRows,
              application: {
                id: viewApp.id,
                applicationId: viewApp.applicationId,
                dealId: appDealId,
                loanAmount: viewApp.loanAmount,
                commissionAmount: viewApp.commissionAmount,
                OfferDecision: (viewApp.OfferDecision ?? null) as unknown as Record<string, unknown> | null,
                termsOffers: toTerms
                  ? [
                      {
                        approvedAmount: toTerms.approvedAmount,
                        factorRate: toTerms.factorRate,
                        paybackAmount: toTerms.paybackAmount,
                        paymentAmount: toTerms.paymentAmount,
                        frequency: toTerms.frequency,
                        commissionAmount: toTerms.commissionAmount,
                      },
                    ]
                  : [],
              },
            });
          }
        }
      }

      return res.status(200).json({
        success: true,
        data: filteredPayments.map(mapPaymentToApi),
        ...(includeDealView ? { dealView } : {}),
      });
    } catch (error) {
      console.error('List collection payments error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Bulk load for payment dashboard: one DB round-trip instead of N × GET /collection-payments.
   * Applies the same per-application strict transaction filtering as GET list (pairing is per appId).
   */
  async listByApplicationIds(req: Request, res: Response) {
    try {
      const body = (req.body ?? {}) as { applicationIds?: unknown };
      const rawIds = Array.isArray(body.applicationIds) ? body.applicationIds : [];
      const MAX_IDS = 2_000;
      const ids = [
        ...new Set(
          rawIds
            .map((id) => String(id ?? '').trim())
            .filter((id) => id.length > 0),
        ),
      ];
      if (ids.length > MAX_IDS) {
        return res.status(400).json({
          success: false,
          message: `applicationIds must contain at most ${MAX_IDS} ids`,
        });
      }
      if (ids.length === 0) {
        return res.status(200).json({ success: true, data: {} });
      }

      const payments = await prisma.collectionPayment.findMany({
        where: { applicationId: { in: ids } },
        orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }, { paymentNumber: 'desc' }],
      });

      const byApp = new Map<string, typeof payments>();
      for (const p of payments) {
        const list = byApp.get(p.applicationId) ?? [];
        list.push(p);
        byApp.set(p.applicationId, list);
      }

      const data: Record<string, ReturnType<typeof mapPaymentToApi>[]> = {};
      for (const id of ids) {
        const group = byApp.get(id) ?? [];
        const filtered = applyStrictTransactionFiltering(group);
        sortPrismaCollectionPaymentsNewestFirst(filtered);
        data[id] = filtered.map(mapPaymentToApi);
      }

      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error('Bulk list collection payments error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async create(req: Request, res: Response) {
    try {
      const { applicationId, amount, date, status, note, referenceNumber } = req.body ?? {};
      if (!String(applicationId ?? '').trim() || amount === undefined || !String(date ?? '').trim()) {
        return res.status(400).json({ success: false, message: 'applicationId, amount and date are required' });
      }

      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ success: false, message: 'amount must be a valid positive number' });
      }

      const parsedDate = new Date(String(date));
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ success: false, message: 'date must be a valid date' });
      }

      const normalizedStatus = normalizeStatusToDb(status) ?? CollectionPaymentStatus.MANUAL;

      const existingApplication = await prisma.application.findUnique({
        where: { id: String(applicationId).trim() },
        select: { id: true },
      });
      if (!existingApplication) {
        return res.status(404).json({ success: false, message: 'Application not found' });
      }

      const resolvedDealId = await this.resolveDealIdFromQuery({
        applicationIdRaw: String(applicationId).trim(),
        dealIdRaw: '',
      });

      const lastPayment = await prisma.collectionPayment.findFirst({
        where: { applicationId: String(applicationId).trim() },
        orderBy: { paymentNumber: 'desc' },
        select: { paymentNumber: true },
      });

      const created = await prisma.collectionPayment.create({
        data: {
          applicationId: String(applicationId).trim(),
          dealId: resolvedDealId,
          amount: new Prisma.Decimal(parsedAmount),
          scheduledDate: parsedDate,
          status: normalizedStatus,
          notes: note ? String(note).trim() : '',
          referenceNumber: referenceNumber ? String(referenceNumber).trim() : null,
          source:
            normalizedStatus === CollectionPaymentStatus.MANUAL
              ? CollectionPaymentSource.MANUAL
              : CollectionPaymentSource.SYSTEM,
          paymentNumber: (lastPayment?.paymentNumber ?? 0) + 1,
          createdById: (req as any)?.user?.id ?? null,
        },
      });

      try {
        await distributeSyndicatorCreditsForPayments(prisma, [
          {
            id: created.id,
            applicationId: created.applicationId,
            amount: created.amount,
            status: created.status,
            scheduledDate: created.scheduledDate,
            Date: created.Date,
            notes: created.notes,
          },
        ]);
      } catch (syndicatorErr) {
        console.error('Syndicator distribution after collection payment create:', syndicatorErr);
      }

      return res.status(201).json({
        success: true,
        message: 'Payment created successfully',
        data: mapPaymentToApi(created),
      });
    } catch (error) {
      console.error('Create collection payment error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { amount, date, status, note, referenceNumber } = req.body ?? {};
      const existing = await prisma.collectionPayment.findUnique({ where: { id } });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }

      const payload: Prisma.CollectionPaymentUpdateInput = {};

      if (amount !== undefined) {
        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          return res.status(400).json({ success: false, message: 'amount must be a valid positive number' });
        }
        payload.amount = new Prisma.Decimal(parsedAmount);
      }

      if (date !== undefined) {
        const parsedDate = new Date(String(date));
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({ success: false, message: 'date must be a valid date' });
        }
        payload.scheduledDate = parsedDate;
      }

      if (status !== undefined) {
        const normalizedStatus = normalizeStatusToDb(status);
        if (!normalizedStatus) {
          return res.status(400).json({ success: false, message: 'Invalid payment status' });
        }
        payload.status = normalizedStatus;
      }

      if (note !== undefined) payload.notes = String(note ?? '').trim();
      if (referenceNumber !== undefined) payload.referenceNumber = referenceNumber ? String(referenceNumber).trim() : null;

      const updated = await prisma.collectionPayment.update({
        where: { id },
        data: payload,
      });

      return res.status(200).json({
        success: true,
        message: 'Payment updated successfully',
        data: mapPaymentToApi(updated),
      });
    } catch (error) {
      console.error('Update collection payment error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      if (!String(id ?? '').trim()) {
        return res.status(400).json({ success: false, message: 'Payment id is required' });
      }

      const existing = await prisma.collectionPayment.findUnique({ where: { id } });

      if (!existing) {
        return res.status(404).json({ success: false, message: 'Payment not found' });
      }

      await prisma.collectionPayment.delete({ where: { id } });

      return res.status(200).json({
        success: true,
        message: 'Payment deleted successfully',
        data: { id },
      });
    } catch (error) {
      console.error('Delete collection payment error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Update Fees (`OfferDecision.fees`) and / or Commission (`Application.commissionAmount`)
   * for the deal shown in the Transactions tab. Accepts either the application UUID / display id
   * or the dealId — resolves to one Application row and writes both fields.
   */
  async updateDealEconomics(req: Request, res: Response) {
    try {
      const body = (req.body ?? {}) as {
        applicationId?: unknown;
        dealId?: unknown;
        feesAmount?: unknown;
        commissionOnDeal?: unknown;
      };

      const applicationIdRaw = String(body.applicationId ?? '').trim();
      const dealIdRaw = String(body.dealId ?? '').trim();
      if (!applicationIdRaw && !dealIdRaw) {
        return res
          .status(400)
          .json({ success: false, message: 'applicationId or dealId is required' });
      }

      const hasFees = body.feesAmount !== undefined && body.feesAmount !== null && body.feesAmount !== '';
      const hasCommission =
        body.commissionOnDeal !== undefined && body.commissionOnDeal !== null && body.commissionOnDeal !== '';
      if (!hasFees && !hasCommission) {
        return res
          .status(400)
          .json({ success: false, message: 'Provide feesAmount and/or commissionOnDeal to update' });
      }

      const feesAmount = hasFees ? parseMoney(body.feesAmount) : null;
      const commissionOnDeal = hasCommission ? parseMoney(body.commissionOnDeal) : null;
      if (hasFees && (feesAmount == null || feesAmount < 0)) {
        return res.status(400).json({ success: false, message: 'feesAmount must be a non-negative number' });
      }
      if (hasCommission && (commissionOnDeal == null || commissionOnDeal < 0)) {
        return res
          .status(400)
          .json({ success: false, message: 'commissionOnDeal must be a non-negative number' });
      }

      // Resolve to a concrete Application UUID. Match the same resolution rules used by GET /collection-payments.
      let appUuid: string | null = null;
      const uuidRe =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;
      if (applicationIdRaw && uuidRe.test(applicationIdRaw)) {
        const direct = await prisma.application.findUnique({
          where: { id: applicationIdRaw },
          select: { id: true },
        });
        if (direct) appUuid = direct.id;
      }
      if (!appUuid && applicationIdRaw && /^\d+$/.test(applicationIdRaw)) {
        const byDisplay = await prisma.application.findUnique({
          where: { applicationId: Number(applicationIdRaw) },
          select: { id: true },
        });
        if (byDisplay) appUuid = byDisplay.id;
      }
      if (!appUuid) {
        const resolvedDealId = await this.resolveDealIdFromQuery({
          applicationIdRaw,
          dealIdRaw,
        });
        if (resolvedDealId) {
          const matchedApps = await this.findApplicationsForDealId(resolvedDealId);
          appUuid = this.resolveViewApplicationUuid({
            applicationIdQuery: applicationIdRaw,
            matchedApps,
          });
          if (!appUuid) {
            const targetToken = normalizeDealIdToken(resolvedDealId);
            if (targetToken) {
              const tokenApps = await this.findApplicationsByNormalizedDealIdToken(targetToken);
              appUuid = tokenApps[0]?.id ?? null;
            }
          }
        }
      }

      if (!appUuid) {
        return res.status(404).json({ success: false, message: 'Application not found' });
      }

      const updates: Promise<unknown>[] = [];

      if (hasFees) {
        updates.push(
          prisma.offerDecision.upsert({
            where: { applicationId: appUuid },
            update: { fees: new Prisma.Decimal(feesAmount as number) },
            // Persisting fees alone for a brand-new deal: use neutral defaults so required scalars stay non-null.
            create: {
              applicationId: appUuid,
              decision: 'approved',
              fees: new Prisma.Decimal(feesAmount as number),
            },
          }),
        );
      }

      if (hasCommission) {
        updates.push(
          prisma.application.update({
            where: { id: appUuid },
            data: { commissionAmount: commissionOnDeal as number },
          }),
        );
      }

      await Promise.all(updates);

      const updatedApp = await prisma.application.findUnique({
        where: { id: appUuid },
        select: {
          id: true,
          applicationId: true,
          dealId: true,
          commissionAmount: true,
          OfferDecision: { select: { fees: true } },
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Deal economics updated successfully',
        data: {
          applicationId: updatedApp?.id ?? appUuid,
          applicationDisplayId: updatedApp?.applicationId ?? null,
          dealId: updatedApp?.dealId ?? null,
          feesAmount: toNum(updatedApp?.OfferDecision?.fees ?? 0),
          commissionOnDeal: toNum(updatedApp?.commissionAmount ?? 0),
        },
      });
    } catch (error) {
      console.error('Update deal economics error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async uploadTransactions(req: Request, res: Response) {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        return res.status(400).json({ message: 'File is required' });
      }

      const previewOnlyRaw = (req.body as { previewOnly?: unknown } | undefined)?.previewOnly;
      const previewOnly =
        previewOnlyRaw === true ||
        String(previewOnlyRaw ?? '')
          .trim()
          .toLowerCase() === 'true';
      const queueJobId = randomUUID();
      const safeOriginal = (file.originalname || 'transactions.xlsx').replace(/[^a-zA-Z0-9._-]/g, '_');
      await prisma.collectionPaymentUploadJob.create({
        data: {
          queueJobId,
          fileName: file.originalname || safeOriginal,
          filePath: `BUFFER_ONLY:${queueJobId}-${safeOriginal}`,
          createdById: (req as any)?.user?.id ?? null,
          status: 'PROCESSING',
        },
      });

      // Process in background from in-memory buffer to avoid temp-file ENOENT race conditions.
      setImmediate(() => {
        void (async () => {
          try {
            await prisma.collectionPaymentUploadJob.update({
              where: { queueJobId },
              data: {
                status: 'PROCESSING',
                startedAt: new Date(),
                errorMessage: null,
              },
            });

            await processCollectionPaymentUploadJob(
              {
                queueJobId,
                filePath: `BUFFER_ONLY:${queueJobId}-${safeOriginal}`,
                workbookBuffer: file.buffer,
                previewOnly,
              },
              async (progress) => {
                await prisma.collectionPaymentUploadJob.update({
                  where: { queueJobId },
                  data: {
                    totalRows: progress.totalRows,
                    processedRows: progress.processedRows,
                    successCount: progress.successCount,
                    failedCount: progress.failedCount,
                  },
                });
              },
            );

            const latest = await prisma.collectionPaymentUploadJob.findUnique({
              where: { queueJobId },
              select: { failedCount: true },
            });

            await prisma.collectionPaymentUploadJob.update({
              where: { queueJobId },
              data: {
                status: (latest?.failedCount ?? 0) > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED',
                completedAt: new Date(),
              },
            });
          } catch (bgErr) {
            console.error('Collection payment upload background processing failed:', {
              queueJobId,
              error: bgErr instanceof Error ? bgErr.message : bgErr,
            });
            await prisma.collectionPaymentUploadJob.update({
              where: { queueJobId },
              data: {
                status: 'FAILED',
                completedAt: new Date(),
                errorMessage: bgErr instanceof Error ? bgErr.message : 'Upload processing failed',
              },
            });
          }
        })();
      });

      return res.status(202).json({
        success: true,
        message: previewOnly
          ? 'Preview accepted. Processing started in background without DB inserts.'
          : 'Upload accepted. Processing started in background.',
        data: {
          jobId: queueJobId,
          status: 'processing',
          previewOnly,
        },
      });
    } catch (error) {
      console.error('Upload transaction excel error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  }

  async previewTransactions(req: Request, res: Response) {
    try {
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file?.buffer || !file.originalname) {
        return res.status(400).json({ success: false, message: 'File is required' });
      }

      const fileName = file.originalname.toLowerCase();
      const isSupported =
        fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv');
      if (!isSupported) {
        return res.status(400).json({
          success: false,
          message: 'Invalid file format. Please upload .xlsx, .xls, or .csv file.',
        });
      }

      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(file.buffer, {
          type: 'buffer',
          raw: true,
          cellDates: false,
          bookVBA: false,
          /** Critical perf: avoid materializing 100k+ rows. */
          sheetRows: PREVIEW_XLSX_SHEET_ROWS_CAP,
        });
      } catch (parseErr) {
        return res.status(400).json({
          success: false,
          message: 'Unable to parse the uploaded file. Please verify the file format.',
          error: parseErr instanceof Error ? parseErr.message : 'Parse failed',
        });
      }

      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return res.status(400).json({ success: false, message: 'Excel file has no sheet.' });
      }

      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], {
        defval: null,
        blankrows: false,
      });
      if (!rows.length) {
        return res.status(400).json({ success: false, message: 'Uploaded file is empty.' });
      }

      const firstRow = rows[0] ?? {};
      const descriptionKey = Object.keys(firstRow).find((key) => {
        const normalized = normalizeHeaderKey(key);
        return normalized === 'description' || normalized === 'desc' || normalized === 'narration';
      });

      if (!descriptionKey) {
        return res.status(400).json({
          success: false,
          message: 'Missing required Description column in uploaded file.',
        });
      }

      const excelHeaders = Object.keys(firstRow);

      type LightPreviewRow = {
        rowNumber: number;
        description: string;
        dealId: string | null;
      };

      const duplicateCounts = new Map<string, number>();
      const lightRows: LightPreviewRow[] = [];
      for (let idx = 0; idx < rows.length; idx += 1) {
        const row = rows[idx] ?? {};
        const rowNumber = idx + 2;
        const description = String(row[descriptionKey] ?? '').trim();
        const match = description.match(DEAL_ID_FROM_DESCRIPTION_REGEX);
        const dealToken = match?.[1] ? String(match[1]).toUpperCase() : '';
        const dealId = dealToken || null;
        if (dealToken) {
          duplicateCounts.set(dealToken, (duplicateCounts.get(dealToken) ?? 0) + 1);
        }
        lightRows.push({ rowNumber, description, dealId });
      }

      const duplicateDealIds = Array.from(duplicateCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([dealId]) => dealId);
      const duplicateDealIdSet = new Set(duplicateDealIds);

      const totalRows = lightRows.length;
      const validRows = lightRows.filter((r) => r.dealId).length;
      const invalidRows = totalRows - validRows;

      /** Full `rowData` for every scanned row so the preview grid can list the whole sheet (within the row cap). */
      const previewRows = lightRows.map((meta) => {
        const row = rows[meta.rowNumber - 2] ?? {};
        const rowData = excelHeaders.reduce<Record<string, string>>((acc, header) => {
          const cellValue = row[header];
          if (cellValue == null) {
            acc[header] = '';
            return acc;
          }
          acc[header] = formatPreviewCellAsString(header, cellValue);
          return acc;
        }, {});
        return {
          rowNumber: meta.rowNumber,
          description: meta.description,
          dealId: meta.dealId,
          isValid: Boolean(meta.dealId),
          validationStatus: meta.dealId ? ('valid' as const) : ('invalid' as const),
          isDuplicate: Boolean(meta.dealId && duplicateDealIdSet.has(meta.dealId)),
          rowData,
        };
      });

      const sheetRowCapHit = rows.length >= PREVIEW_XLSX_SHEET_ROWS_CAP;

      return res.status(200).json({
        success: true,
        data: {
          regex: DEAL_ID_FROM_DESCRIPTION_REGEX.source,
          excelHeaders,
          totalRows,
          validRows,
          invalidRows,
          duplicateDealIds,
          sheetRowCapHit,
          previewRows,
        },
      });
    } catch (error) {
      console.error('Preview transaction excel error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async commitPreviewTransactions(req: Request, res: Response) {
    try {
      const body = (req.body ?? {}) as {
        transactions?: Array<{
          rowNumber?: unknown;
          dealId?: unknown;
          description?: unknown;
          rowData?: Record<string, unknown>;
        }>;
      };
      const transactions = Array.isArray(body.transactions) ? body.transactions : [];
      if (!transactions.length) {
        return res.status(400).json({ success: false, message: 'No transactions provided for commit.' });
      }

      const dealTokens = Array.from(
        new Set(
          transactions
            .map((row) => normalizeDealIdToken(row.dealId))
            .filter((token) => token.length > 0),
        ),
      );
      if (!dealTokens.length) {
        return res.status(400).json({ success: false, message: 'Mapped Deal ID is required for save.' });
      }

      const appByDealToken = await this.mapLatestApplicationsByNormalizedDealTokens(dealTokens);

      const preparedRows: Prisma.CollectionPaymentCreateManyInput[] = [];
      const failedRows: Array<{ rowNumber: number; dealId: string; reason: string }> = [];

      transactions.forEach((tx, idx) => {
        const rowNumber =
          typeof tx.rowNumber === 'number' && Number.isFinite(tx.rowNumber) ? tx.rowNumber : idx + 1;
        const mappedDealId = normalizeDealIdToken(tx.dealId);
        if (!mappedDealId) {
          failedRows.push({ rowNumber, dealId: '', reason: 'Deal ID is missing.' });
          return;
        }

        const app = appByDealToken.get(mappedDealId);
        if (!app?.id) {
          failedRows.push({ rowNumber, dealId: mappedDealId, reason: 'No application found for selected Deal ID.' });
          return;
        }

        const rowData = tx.rowData && typeof tx.rowData === 'object' ? tx.rowData : {};
        const amountFromAmount = parsePreviewAmount(getPreviewRowValue(rowData, 'Amount'));
        const creditAmount = parsePreviewAmount(getPreviewRowValue(rowData, 'Credit'));
        const debitAmount = parsePreviewAmount(getPreviewRowValue(rowData, 'Debit'));
        const amount = amountFromAmount ?? creditAmount ?? debitAmount ?? 0;
        const statusRaw = String(getPreviewRowValue(rowData, 'Status', 'Payment Status') ?? '')
          .trim()
          .toLowerCase();
        const hasCredit = hasPreviewCellValue(getPreviewRowValue(rowData, 'Credit'));
        const hasDebit = hasPreviewCellValue(getPreviewRowValue(rowData, 'Debit'));
        const status = hasCredit
          ? CollectionPaymentStatus.CREDIT
          : hasDebit
            ? CollectionPaymentStatus.DEBIT
            : statusRaw === 'debit' || statusRaw === 'failed'
              ? CollectionPaymentStatus.DEBIT
              : statusRaw === 'paid'
                ? CollectionPaymentStatus.PAID
                : statusRaw === 'manual'
                  ? CollectionPaymentStatus.MANUAL
                  : CollectionPaymentStatus.CREDIT;
        const dateRaw = getPreviewRowValue(
          rowData,
          'Date',
          'Payment Date',
          'Transaction Date',
          'Value Date',
          'Posting Date',
        );
        const date = (() => {
          if (!hasPreviewCellValue(dateRaw)) return new Date();
          const parsed = parseExcelDate(dateRaw);
          return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
        })();
        const description = String(
          getPreviewRowValue(rowData, 'Description', 'Notes', 'Note', 'Remarks') ??
            tx.description ??
            '',
        ).trim();

        preparedRows.push({
          applicationId: app.id,
          dealId: app.dealId?.trim() || mappedDealId,
          amount: new Prisma.Decimal(amount),
          Date: date,
          scheduledDate: date,
          status,
          source: CollectionPaymentSource.MANUAL,
          notes: description,
        });
      });

      if (!preparedRows.length) {
        return res.status(400).json({
          success: false,
          message: 'No valid transactions to save.',
          data: {
            savedCount: 0,
            failedCount: failedRows.length,
            failedRows,
          },
        });
      }

      let savedCount = 0;
      const savedRowsForSyndicator: Prisma.CollectionPaymentCreateManyInput[] = [];
      try {
        await prisma.collectionPayment.createMany({ data: preparedRows });
        savedCount = preparedRows.length;
        savedRowsForSyndicator.push(...preparedRows);
      } catch (bulkErr) {
        for (let i = 0; i < preparedRows.length; i += 1) {
          try {
            await prisma.collectionPayment.create({ data: preparedRows[i]! });
            savedCount += 1;
            savedRowsForSyndicator.push(preparedRows[i]!);
          } catch (rowErr) {
            const original = transactions[i];
            failedRows.push({
              rowNumber:
                typeof original?.rowNumber === 'number' && Number.isFinite(original.rowNumber)
                  ? original.rowNumber
                  : i + 1,
              dealId: normalizeDealIdToken(original?.dealId),
              reason: rowErr instanceof Error ? rowErr.message : 'Insert failed',
            });
          }
        }
      }

      if (savedRowsForSyndicator.length) {
        try {
          await distributeSyndicatorCreditsForPayments(prisma, savedRowsForSyndicator);
        } catch (syndicatorErr) {
          console.error('Syndicator distribution after preview commit:', syndicatorErr);
        }
      }

      return res.status(200).json({
        success: true,
        message: savedCount > 0 ? 'Verified transactions saved successfully.' : 'No transactions were saved.',
        data: {
          savedCount,
          failedCount: failedRows.length,
          failedRows,
        },
      });
    } catch (error) {
      console.error('Commit preview transactions error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async uploadTransactionsStatus(req: Request, res: Response) {
    try {
      const jobId = String(req.params.jobId || '').trim();
      if (!jobId) {
        return res.status(400).json({ success: false, message: 'jobId is required' });
      }

      const job = await prisma.collectionPaymentUploadJob.findUnique({
        where: { queueJobId: jobId },
        select: {
          queueJobId: true,
          totalRows: true,
          processedRows: true,
          successCount: true,
          failedCount: true,
          status: true,
          failedRows: true,
          errorMessage: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
          fileName: true,
        },
      });

      if (!job) {
        return res.status(404).json({ success: false, message: 'Upload job not found' });
      }

      return res.status(200).json({
        success: true,
        data: {
          jobId: job.queueJobId,
          fileName: job.fileName,
          totalRows: job.totalRows,
          processedRows: job.processedRows,
          successCount: job.successCount,
          failedCount: job.failedCount,
          status: String(job.status).toLowerCase(),
          failedRows: job.failedRows ?? [],
          errorMessage: job.errorMessage,
          createdAt: job.createdAt,
          startedAt: job.startedAt,
          completedAt: job.completedAt,
        },
      });
    } catch (error) {
      console.error('Collection payment upload status error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async dashboard(req: Request, res: Response) {
    try {
      const now = new Date();
      const todayStart = startOfDay(now);
      const todayEnd = endOfDay(now);
      const next7End = endOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
      const yearStart = new Date(now.getFullYear(), 0, 1);

      /** Same cohort as Payment History `/applications?statsBucket=funded` (queue-led only — see `applicationStatsBucketWhere`). */
      const fundedDashboardWhere = buildApplicationStatsBucketWhere('funded');
      if (!fundedDashboardWhere) {
        return res.status(500).json({ success: false, message: 'Dashboard funded scope unavailable' });
      }
      const disbursementApps = await prisma.application.findMany({
        where: fundedDashboardWhere,
        select: {
          id: true,
          applicationId: true,
          updatedAt: true,
          loanAmount: true,
          dealId: true,
          commissionAmount: true,
          termsOffers: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              approvedAmount: true,
              factorRate: true,
              paybackAmount: true,
              commissionAmount: true,
            },
          },
          OfferDecision: {
            select: {
              offer: true,
              decision: true,
              rate: true,
              fees: true,
              totalRemit: true,
              refinanceAmount: true,
            },
          },
        },
      });

      /** Σ(`OfferDecision.offer` × `OfferDecision.rate`) for funded queue or Funded state — Total Payback card. */
      const appsForPaybackPortfolioTotal = await prisma.application.findMany({
        where: buildFundedApplicationWhereForPaybackTotals(),
        select: {
          id: true,
          dealId: true,
          OfferDecision: {
            select: {
              offer: true,
              decision: true,
              rate: true,
            },
          },
        },
      });
      const totalPayback = sumTotalPaybackOfferTimesRateFromOfferDecisionRows(appsForPaybackPortfolioTotal);

      const appIds = disbursementApps.map((app) => app.id);
      const debitDefaultsAggregate = await prisma.collectionPayment.aggregate({
        where: { status: CollectionPaymentStatus.DEBIT },
        _sum: { amount: true },
      });
      const payments = appIds.length
        ? await prisma.collectionPayment.findMany({
            where: { applicationId: { in: appIds } },
            select: {
              id: true,
              applicationId: true,
              dealId: true,
              amount: true,
              status: true,
              Date: true,
              scheduledDate: true,
              processedDate: true,
              notes: true,
            },
          })
        : [];

      const dealIdByApplicationIdDashboard = new Map(
        disbursementApps.map((a) => [a.id, a.dealId]),
      );
      const paymentsForDashboardCharts = payments.filter((p) =>
        paymentBelongsToApplicationDeal(p, dealIdByApplicationIdDashboard.get(p.applicationId)),
      );

      const appAmountById = new Map<string, number>();
      for (const app of disbursementApps) {
        const loanAmount = toNum(app.loanAmount);
        const offerDecision =
          app.OfferDecision?.decision?.toLowerCase() === 'declined' ? 0 : toNum(app.OfferDecision?.offer);
        const chosen = loanAmount > 0 ? loanAmount : offerDecision || loanAmount || 0;
        appAmountById.set(app.id, chosen);
      }

      let dueToday = 0;
      let dueNext7Days = 0;
      let totalDues = 0;
      let recovered = 0;
      let defaults = 0;

      const paymentsByApplicationId = new Map<string, typeof payments>();
      for (const payment of paymentsForDashboardCharts) {
        const list = paymentsByApplicationId.get(payment.applicationId);
        if (list) list.push(payment);
        else paymentsByApplicationId.set(payment.applicationId, [payment]);
      }

      for (const payment of paymentsForDashboardCharts) {
        const amount = toNum(payment.amount);
        const date = payment.scheduledDate ? new Date(payment.scheduledDate) : null;
        const status = payment.status;

        // Due today follows schedule semantics first (status-based),
        // and falls back to date only for still-open statuses.
        if (status === CollectionPaymentStatus.DUE_TODAY) {
          dueToday += amount;
        } else if (
          OPEN_DUE_STATUSES.has(status) &&
          date &&
          date >= todayStart &&
          date <= todayEnd
        ) {
          dueToday += amount;
        }

        // Next 7 days includes only open scheduled items and excludes today's dues.
        if (OPEN_DUE_STATUSES.has(status) && date && date > todayEnd && date <= next7End) {
          dueNext7Days += amount;
        }

        if (!EXCLUDED_FROM_TOTAL_DUES.has(status)) {
          // Keep for legacy cards if needed; overridden below with financials-based total.
          totalDues += amount;
        }

        if (RECOVERED_STATUSES.has(status)) {
          // Keep for legacy cards if needed; overridden below with financials-based total.
          recovered += amount;
        }
      }

      // Recovered Amount + Total Dues: single source of truth as funded list/embed — sum per-deal from DB (`getBalancesForApplicationIds`).
      const dealFinancialRows =
        appIds.length > 0 ? await getBalancesForApplicationIds(prisma, appIds) : [];
      const dealFinancialByAppId = new Map(
        dealFinancialRows.map((r) => [r.applicationId, r]),
      );
      recovered = dealFinancialRows.reduce(
        (sum, row) =>
          sum +
          repaidTowardPaybackExcludingSurplus(
            row.grossRepaidDealEconomics,
            row.paybackAmount,
          ),
        0,
      );
      /** Same “payback remaining” as `Transactions.tsx` (gross repaid economics, not strict pairing balance). */
      totalDues = dealFinancialRows.reduce(
        (sum, row) =>
          sum +
          Math.max(
            balanceDueLikeTransactionsPage(row.paybackAmount, row.grossRepaidDealEconomics),
            0,
          ),
        0,
      );
      defaults = Math.abs(toNum(debitDefaultsAggregate._sum.amount));

      // Portfolio: funded + net funding; Above Principal = Σ signed gaps = Σ(positive) − Σ(|negative|) (same as Payment History StatCard).
      let fundedPortfolioTotal = 0;
      let netFundingPortfolioTotal = 0;
      let abovePrincipalPositiveSum = 0;
      let abovePrincipalNegativeMagSum = 0;
      let dealsWithPositiveGap = 0;
      let dealsWithNegativeGap = 0;
      let dealsWithZeroGap = 0;
      const zeroGapDealsPayload: Array<{ dealId: string; gapAmount: number }> = [];
      const GAP_CLASSIFY_EPS = 1e-6;
      for (const app of disbursementApps) {
        const rawPayments = paymentsByApplicationId.get(app.id) ?? [];
        const scopedPayments = filterCollectionPaymentsForApplicationDeal(
          rawPayments,
          app.dealId ?? null,
        );
        const advanceNum = Math.max(getApprovedOfferAmountForDealBalance(app), 0);
        const od = app.OfferDecision ?? null;
        const feesAmount = feesForOfferDecision(od);
        const refinanceAmount = toNum(od?.refinanceAmount);
        const latestTermsOffer = app.termsOffers?.[0];
        const commissionOnDeal =
          parseMoney(app.commissionAmount) ?? parseMoney(latestTermsOffer?.commissionAmount) ?? 0;

        const netFundingNum = Math.max(
          0,
          advanceNum - feesAmount - refinanceAmount,
        );
        const alreadyNetNum = alreadyNetDealEconomics(
          advanceNum,
          feesAmount,
          commissionOnDeal,
        );

        const bal = dealFinancialByAppId.get(app.id);
        const grossRepaid = bal
          ? bal.grossRepaidDealEconomics
          : grossRepaidDealEconomicsFromPayments(scopedPayments);
        const paybackAmt = bal?.paybackAmount ?? 0;
        const repaidCapped = repaidTowardPaybackExcludingSurplus(grossRepaid, paybackAmt);
        const gap = signedAbovePrincipalGap(repaidCapped, alreadyNetNum);
        if (gap > GAP_CLASSIFY_EPS) {
          abovePrincipalPositiveSum += gap;
          dealsWithPositiveGap += 1;
        } else if (gap < -GAP_CLASSIFY_EPS) {
          abovePrincipalNegativeMagSum += -gap;
          dealsWithNegativeGap += 1;
        } else {
          dealsWithZeroGap += 1;
          const dealLabel = String(app.dealId ?? '').trim();
          zeroGapDealsPayload.push({
            dealId: dealLabel.length > 0 ? dealLabel : String(app.applicationId),
            gapAmount: Number(gap.toFixed(2)),
          });
        }

        fundedPortfolioTotal += advanceNum;
        netFundingPortfolioTotal += netFundingNum;
      }
      const abovePrincipalNet =
        abovePrincipalPositiveSum - abovePrincipalNegativeMagSum;

      const collectionEfficiency = totalDues > 0 ? Number(((recovered / totalDues) * 100).toFixed(1)) : 0;

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const yearlyMap = new Map<string, { inflow: number; outflow: number }>();
      for (const month of monthNames) yearlyMap.set(month, { inflow: 0, outflow: 0 });

      for (const payment of paymentsForDashboardCharts) {
        const baseDate = payment.processedDate || payment.scheduledDate;
        if (!baseDate) continue;
        const d = new Date(baseDate);
        if (d.getFullYear() !== now.getFullYear()) continue;
        const month = monthNames[d.getMonth()];
        const bucket = yearlyMap.get(month)!;
        if (RECOVERED_STATUSES.has(payment.status)) bucket.inflow += toNum(payment.amount);
      }

      for (const app of disbursementApps) {
        const d = new Date(app.updatedAt);
        if (d < yearStart || d > now) continue;
        const month = monthNames[d.getMonth()];
        const bucket = yearlyMap.get(month)!;
        bucket.outflow += appAmountById.get(app.id) || 0;
      }

      const yearly = monthNames.map((label) => ({
        label,
        inflow: Number((yearlyMap.get(label)?.inflow || 0).toFixed(2)),
        outflow: Number((yearlyMap.get(label)?.outflow || 0).toFixed(2)),
      }));

      const currentMonth = now.getMonth();
      const daysInMonth = new Date(now.getFullYear(), currentMonth + 1, 0).getDate();
      const monthlyByDay = Array.from({ length: daysInMonth }, (_, i) => ({
        label: String(i + 1),
        inflow: 0,
        outflow: 0,
      }));

      for (const payment of paymentsForDashboardCharts) {
        const baseDate = payment.processedDate || payment.scheduledDate;
        if (!baseDate || !RECOVERED_STATUSES.has(payment.status)) continue;
        const d = new Date(baseDate);
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === currentMonth) {
          const idx = d.getDate() - 1;
          if (monthlyByDay[idx]) monthlyByDay[idx].inflow += toNum(payment.amount);
        }
      }

      for (const app of disbursementApps) {
        const d = new Date(app.updatedAt);
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === currentMonth) {
          const idx = d.getDate() - 1;
          if (monthlyByDay[idx]) monthlyByDay[idx].outflow += appAmountById.get(app.id) || 0;
        }
      }

      /** Five rolling calendar weeks (Sun–Sat), oldest first — labels match payment dashboard chart (e.g. "Mar 29 - Apr 4"). */
      const NUM_WEEKLY_BUCKETS = 5;
      const startOfWeekSunday = (d: Date) => {
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        s.setDate(s.getDate() - s.getDay());
        return s;
      };
      const formatWeekRangeLabel = (weekStart: Date, weekEnd: Date) => {
        const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
        return `${weekStart.toLocaleDateString('en-US', opts)} - ${weekEnd.toLocaleDateString('en-US', opts)}`;
      };
      const thisWeekStart = startOfWeekSunday(now);
      const weekly: { label: string; inflow: number; outflow: number }[] = [];
      const weekStarts: Date[] = [];
      for (let w = NUM_WEEKLY_BUCKETS - 1; w >= 0; w--) {
        const ws = new Date(thisWeekStart);
        ws.setDate(ws.getDate() - w * 7);
        const we = new Date(ws);
        we.setDate(we.getDate() + 6);
        weekStarts.push(ws);
        weekly.push({
          label: formatWeekRangeLabel(ws, we),
          inflow: 0,
          outflow: 0,
        });
      }
      const weekIndexForCalendarDate = (d: Date) => {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        for (let i = 0; i < NUM_WEEKLY_BUCKETS; i++) {
          const ws = weekStarts[i]!;
          const we = new Date(ws);
          we.setDate(we.getDate() + 6);
          if (t >= ws && t <= we) return i;
        }
        return -1;
      };
      for (const payment of paymentsForDashboardCharts) {
        const baseDate = payment.processedDate || payment.scheduledDate;
        if (!baseDate || !RECOVERED_STATUSES.has(payment.status)) continue;
        const d = new Date(baseDate);
        const idx = weekIndexForCalendarDate(d);
        if (idx >= 0) weekly[idx]!.inflow += toNum(payment.amount);
      }
      for (const app of disbursementApps) {
        const d = new Date(app.updatedAt);
        const idx = weekIndexForCalendarDate(d);
        if (idx >= 0) weekly[idx]!.outflow += appAmountById.get(app.id) || 0;
      }

      // When there are no scoped collection rows for charts, money-flow inflow stays zero; card totals still use deal balance aggregation above.
      const hasCollectionPaymentRecords = paymentsForDashboardCharts.length > 0;
      if (!hasCollectionPaymentRecords) {
        yearly.forEach((row) => {
          row.inflow = 0;
        });
        monthlyByDay.forEach((row) => {
          row.inflow = 0;
        });
        weekly.forEach((row) => {
          row.inflow = 0;
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          cards: {
            dueToday: Number(dueToday.toFixed(2)),
            dueNext7Days: Number(dueNext7Days.toFixed(2)),
            totalDues: Number(totalDues.toFixed(2)),
            totalPayback: Number(totalPayback.toFixed(2)),
            recovered: Number(recovered.toFixed(2)),
            defaults: Number(defaults.toFixed(2)),
            totalDeals: disbursementApps.length,
            activeDeals: disbursementApps.length,
            collectionEfficiency,
            fundedTotal: Number(fundedPortfolioTotal.toFixed(2)),
            netFundingTotal: Number(netFundingPortfolioTotal.toFixed(2)),
            abovePrincipalTotal: Number(abovePrincipalNet.toFixed(2)),
            abovePrincipalPositiveSum: Number(abovePrincipalPositiveSum.toFixed(2)),
            abovePrincipalNegativeSum: Number(abovePrincipalNegativeMagSum.toFixed(2)),
            dealsWithPositiveGap,
            dealsWithNegativeGap,
            dealsWithZeroGap,
            zeroGapDeals: zeroGapDealsPayload,
          },
          moneyFlow: {
            monthly: monthlyByDay.map((row) => ({
              ...row,
              inflow: Number(row.inflow.toFixed(2)),
              outflow: Number(row.outflow.toFixed(2)),
            })),
            weekly: weekly.map((row) => ({
              ...row,
              inflow: Number(row.inflow.toFixed(2)),
              outflow: Number(row.outflow.toFixed(2)),
            })),
            yearly,
          },
        },
      });
    } catch (error) {
      console.error('Collection payment dashboard error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

const collectionPaymentController = new CollectionPaymentController();
export default collectionPaymentController;
