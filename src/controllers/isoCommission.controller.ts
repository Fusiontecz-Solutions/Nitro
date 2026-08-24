import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';

type PayoutStatusApi = 'paid' | 'pending' | 'clawbacks';

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
  /** ISO commission payout tables removed — returns deals with pending payout stubs. */
  async getMyDeals(req: Request, res: Response) {
    try {
      const isoId = String(req.params.isoId || '').trim();
      if (!isoId) {
        return res.status(400).json({ success: false, message: 'isoId is required' });
      }

      const iso = await prisma.iso.findUnique({ where: { id: isoId }, select: { id: true } });
      if (!iso) {
        return res.status(404).json({ success: false, message: 'ISO not found' });
      }

      const page = parseDealsPage(req.query.page);
      const limit = parseDealsLimit(req.query.limit);
      const q = String(req.query.q ?? req.query.search ?? '').trim();

      const apps = await prisma.application.findMany({
        where: { isoId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          dealId: true,
          applicationId: true,
          commissionAmount: true,
          commissionPercentage: true,
          client: { select: { businessName: true } },
        },
      });

      const appIds = apps.map((a) => a.id);
      const [termsOffers, offerDecisions] = await Promise.all([
        prisma.termsOffer.findMany({
          where: { applicationId: { in: appIds } },
          orderBy: { createdAt: 'desc' },
          select: { applicationId: true, approvedAmount: true },
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
      const offerByApp = new Map<string, number>();
      for (const od of offerDecisions) {
        if (od.offer != null) offerByApp.set(od.applicationId, Number(od.offer));
      }

      let deals: DealRowOut[] = apps.map((app) => {
        const approved =
          latestTermsByApp.get(app.id) ?? offerByApp.get(app.id) ?? null;
        const commissionAmount =
          app.commissionAmount != null
            ? Number(app.commissionAmount)
            : approved != null && app.commissionPercentage != null
              ? (approved * Number(app.commissionPercentage)) / 100
              : 0;
        return {
          applicationId: app.id,
          dealId: app.dealId,
          applicationNumber: app.applicationId,
          merchant: app.client?.businessName ?? '',
          offerApprovedAmount: approved,
          commissionAmount,
          commissionRequestStatus: null,
          payoutStatus: 'pending' as const,
          scheduledPayDate: null,
          paidAt: null,
        };
      });

      if (q) deals = deals.filter((d) => dealMatchesSearch(d, q));

      const total = deals.length;
      const start = (page - 1) * limit;
      const pageDeals = deals.slice(start, start + limit);

      return res.status(200).json({
        success: true,
        data: {
          deals: pageDeals,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.max(1, Math.ceil(total / limit)),
          },
        },
      });
    } catch (error) {
      console.error('ISO getMyDeals error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /** ISO application payout model removed — acknowledge without persisting. */
  async upsertApplicationPayout(req: Request, res: Response) {
    try {
      const isoId = String(req.params.isoId || '').trim();
      const appId = String(req.params.applicationId || req.body?.applicationId || '').trim();
      if (!isoId || !appId) {
        return res.status(400).json({ success: false, message: 'isoId and applicationId are required' });
      }

      const iso = await prisma.iso.findUnique({ where: { id: isoId }, select: { id: true } });
      if (!iso) {
        return res.status(404).json({ success: false, message: 'ISO not found' });
      }

      const app = await prisma.application.findUnique({
        where: { id: appId },
        select: { id: true, isoId: true },
      });
      if (!app) {
        return res.status(404).json({ success: false, message: 'Application not found' });
      }
      if (app.isoId !== isoId) {
        return res.status(400).json({ success: false, message: 'Application is not linked to this ISO' });
      }

      const rawStatus = String(req.body?.payoutStatus ?? req.body?.status ?? 'pending')
        .trim()
        .toLowerCase();
      const payoutStatus: PayoutStatusApi =
        rawStatus === 'paid' ? 'paid' : rawStatus === 'clawbacks' || rawStatus === 'clawback' ? 'clawbacks' : 'pending';

      return res.status(200).json({
        success: true,
        data: {
          applicationId: appId,
          payoutStatus,
          scheduledPayDate: null,
          paidAt: payoutStatus === 'paid' ? new Date().toISOString() : null,
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
