import type { Request, Response } from 'express';
import { IsoApplicationPayoutStatus } from '@prisma/client';
import prisma from '../config/prismaClient';

type PayoutStatusApi = 'paid' | 'pending' | 'clawbacks';

const mapPayoutToApi = (st: IsoApplicationPayoutStatus): PayoutStatusApi => {
  if (st === IsoApplicationPayoutStatus.PAID) return 'paid';
  if (st === IsoApplicationPayoutStatus.CLAWBACKS) return 'clawbacks';
  return 'pending';
};

const parsePayoutStatus = (raw: unknown): IsoApplicationPayoutStatus | null => {
  const lower = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (lower === 'paid') return IsoApplicationPayoutStatus.PAID;
  if (lower === 'pending') return IsoApplicationPayoutStatus.PENDING;
  if (lower === 'clawbacks' || lower === 'clawback') return IsoApplicationPayoutStatus.CLAWBACKS;
  return null;
};

const parseOptionalDate = (raw: unknown): Date | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
};

async function assertIso(isoId: string) {
  const iso = await prisma.iso.findUnique({ where: { id: isoId }, select: { id: true } });
  return iso;
}

async function assertApplicationUnderIso(isoId: string, applicationId: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, isoId: true },
  });
  if (!app) return { ok: false as const, message: 'Application not found' };
  if (app.isoId !== isoId) {
    return { ok: false as const, message: 'Application is not linked to this ISO' };
  }
  return { ok: true as const, app };
}

function toYmd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

function toIsoString(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

const DEFAULT_DEALS_LIMIT = 10;
const MAX_DEALS_LIMIT = 100;

function parseDealsPage(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function parseDealsLimit(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DEALS_LIMIT;
  return Math.min(n, MAX_DEALS_LIMIT);
}

type DealRowOut = {
  applicationId: string;
  dealId: string | null;
  applicationNumber: number;
  merchant: string;
  offerApprovedAmount: number | null;
  commissionAmount: number;
  commissionRequestStatus: string | null;
  payoutStatus: PayoutStatusApi;
  scheduledPayDate: string | null;
  paidAt: string | null;
};

function dealMatchesSearch(deal: DealRowOut, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const haystack = [
    deal.merchant,
    deal.dealId ?? '',
    String(deal.applicationNumber),
    deal.payoutStatus,
    deal.commissionRequestStatus ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(s);
}

class IsoCommissionController {
  /** All applications for an ISO with offer-approved amount, commission, and payout fields. */
  async getMyDeals(req: Request, res: Response) {
    try {
      const isoId = String(req.params.id ?? '').trim();
      if (!isoId) {
        return res.status(400).json({ success: false, message: 'ISO id is required' });
      }
      const iso = await assertIso(isoId);
      if (!iso) {
        return res.status(404).json({ success: false, message: 'ISO not found' });
      }

      const apps = await prisma.application.findMany({
        where: { isoId },
        orderBy: { applicationId: 'desc' },
        select: {
          id: true,
          applicationId: true,
          dealId: true,
          commissionPercentage: true,
          client: { select: { businessName: true } },
        },
      });

      const searchRaw = String(req.query.search ?? '').trim();
      const page = parseDealsPage(req.query.page);
      const limit = parseDealsLimit(req.query.limit);

      if (apps.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            deals: [],
            total: 0,
            page: 1,
            limit,
            totalPages: 0,
            linkedApplicationCount: 0,
            summary: { totalEarned: 0, totalPaid: 0, pendingPayout: 0 },
          },
        });
      }

      const appIds = apps.map((a) => a.id);

      const [termsOffers, commissionRequests, payouts, offerDecisions] = await Promise.all([
        prisma.termsOffer.findMany({
          where: { applicationId: { in: appIds } },
          orderBy: { createdAt: 'desc' },
          select: {
            applicationId: true,
            approvedAmount: true,
            createdAt: true,
          },
        }),
        prisma.commissionRequest.findMany({
          where: { applicationId: { in: appIds } },
          orderBy: { createdAt: 'desc' },
          select: {
            applicationId: true,
            fundingAmount: true,
            commissionPercentage: true,
            status: true,
            createdAt: true,
          },
        }),
        prisma.isoApplicationPayout.findMany({
          where: { isoId, applicationId: { in: appIds } },
        }),
        prisma.offerDecision.findMany({
          where: { applicationId: { in: appIds } },
          select: { applicationId: true, offer: true },
        }),
      ]);

      const latestTermsByApp = new Map<string, number>();
      for (const t of termsOffers) {
        if (!latestTermsByApp.has(t.applicationId)) {
          latestTermsByApp.set(t.applicationId, t.approvedAmount);
        }
      }

      const latestCrByApp = new Map<
        string,
        { fundingAmount: number; commissionPercentage: number; status: string }
      >();
      for (const cr of commissionRequests) {
        if (!latestCrByApp.has(cr.applicationId)) {
          latestCrByApp.set(cr.applicationId, {
            fundingAmount: cr.fundingAmount,
            commissionPercentage: cr.commissionPercentage,
            status: cr.status,
          });
        }
      }

      const offerByApp = new Map<string, number>();
      for (const o of offerDecisions) {
        if (o.offer != null && !offerByApp.has(o.applicationId)) {
          offerByApp.set(o.applicationId, Number(o.offer));
        }
      }

      const payoutByApp = new Map<string, (typeof payouts)[0]>();
      for (const p of payouts) {
        payoutByApp.set(p.applicationId, p);
      }

      const deals: DealRowOut[] = apps.map((app) => {
        const merchant = app.client?.businessName?.trim() || '—';
        const offerApproved =
          latestTermsByApp.get(app.id) ?? offerByApp.get(app.id) ?? null;

        const cr = latestCrByApp.get(app.id);
        const payout = payoutByApp.get(app.id);
        let commissionAmount = 0;
        if (cr) {
          commissionAmount = (cr.fundingAmount * cr.commissionPercentage) / 100;
        } else if (offerApproved != null) {
          commissionAmount = (offerApproved * (app.commissionPercentage ?? 0)) / 100;
        }

        const commissionRequestStatus = cr?.status ?? null;

        const payoutStatus = payout ? mapPayoutToApi(payout.payoutStatus) : 'pending';
        const scheduledPayDate = toYmd(payout?.scheduledPayDate ?? null);
        const paidAt = toIsoString(payout?.paidAt ?? null);

        return {
          applicationId: app.id,
          dealId: app.dealId ?? null,
          applicationNumber: app.applicationId,
          merchant,
          offerApprovedAmount: offerApproved,
          commissionAmount,
          commissionRequestStatus,
          payoutStatus,
          scheduledPayDate,
          paidAt,
        };
      });

      const linkedApplicationCount = deals.length;
      const filtered = searchRaw
        ? deals.filter((d) => dealMatchesSearch(d, searchRaw))
        : deals;

      let totalEarned = 0;
      let totalPaid = 0;
      let pendingPayout = 0;
      for (const d of filtered) {
        totalEarned += d.commissionAmount;
        if (d.payoutStatus === 'paid') totalPaid += d.commissionAmount;
        else if (d.payoutStatus === 'pending') pendingPayout += d.commissionAmount;
      }

      const total = filtered.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
      const start = (safePage - 1) * limit;
      const pageDeals = filtered.slice(start, start + limit);

      return res.status(200).json({
        success: true,
        data: {
          deals: pageDeals,
          total,
          page: safePage,
          limit,
          totalPages,
          linkedApplicationCount,
          summary: { totalEarned, totalPaid, pendingPayout },
        },
      });
    } catch (error) {
      console.error('ISO my-deals error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  async upsertApplicationPayout(req: Request, res: Response) {
    try {
      const isoId = String(req.params.id ?? '').trim();
      const { applicationId, payoutStatus, scheduledPayDate, paidAt } = req.body ?? {};

      if (!isoId || !String(applicationId ?? '').trim()) {
        return res.status(400).json({ success: false, message: 'applicationId is required' });
      }

      const appId = String(applicationId).trim();
      const st = parsePayoutStatus(payoutStatus);
      if (!st) {
        return res.status(400).json({
          success: false,
          message: 'payoutStatus must be paid, pending, or clawbacks',
        });
      }

      const iso = await assertIso(isoId);
      if (!iso) {
        return res.status(404).json({ success: false, message: 'ISO not found' });
      }

      const check = await assertApplicationUnderIso(isoId, appId);
      if (!check.ok) {
        return res.status(400).json({ success: false, message: check.message });
      }

      const schedParsed =
        scheduledPayDate === undefined
          ? undefined
          : scheduledPayDate === null || scheduledPayDate === ''
            ? null
            : parseOptionalDate(scheduledPayDate);

      let paidParsed =
        paidAt === undefined
          ? undefined
          : paidAt === null || paidAt === ''
            ? null
            : parseOptionalDate(paidAt);

      if (st === IsoApplicationPayoutStatus.PAID && paidParsed === undefined) {
        paidParsed = new Date();
      }

      const row = await prisma.isoApplicationPayout.upsert({
        where: {
          isoId_applicationId: { isoId, applicationId: appId },
        },
        create: {
          isoId,
          applicationId: appId,
          payoutStatus: st,
          scheduledPayDate: schedParsed === undefined ? null : schedParsed,
          paidAt: st === IsoApplicationPayoutStatus.PAID ? paidParsed ?? new Date() : null,
        },
        update: {
          payoutStatus: st,
          ...(schedParsed !== undefined ? { scheduledPayDate: schedParsed } : {}),
          ...(st === IsoApplicationPayoutStatus.PAID
            ? { paidAt: paidParsed ?? new Date() }
            : { paidAt: null }),
        },
      });

      const out = row;

      return res.status(200).json({
        success: true,
        data: {
          applicationId: out.applicationId,
          payoutStatus: mapPayoutToApi(out.payoutStatus),
          scheduledPayDate: toYmd(out.scheduledPayDate),
          paidAt: toIsoString(out.paidAt),
        },
      });
    } catch (error) {
      console.error('ISO application payout upsert error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

const isoCommissionController = new IsoCommissionController();
export default isoCommissionController;
