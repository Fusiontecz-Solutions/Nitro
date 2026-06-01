import { IsoApplicationPayoutStatus } from '@prisma/client';
import prisma from '../config/prismaClient';
import {
  aggregateStatsFromRows,
  buildCommissionLookupByApplication,
  getCommissionForApplication,
  mapApplicationToHistoryRow,
} from './commissionPortalHistoryLogic';

/** Matches Commission Portal dashboard list cap in the reference Super Admin implementation. */
export const COMMISSION_PORTAL_APP_LIMIT = 500;

export type CommissionPortalStats = {
  totalCommission: number;
  commissionPortalDealCount: number;
  commissionDealsFunded: number;
  commission: {
    paid: number;
    pending: number;
    processing: number;
    approved: number;
    clawback: number;
    totalFundedVolume: number;
    portalDealCount: number;
    dealsFunded: number;
  };
};

function mapIsoCommissionPayout(
  appIsoId: string | null | undefined,
  payouts: Array<{ isoId: string; payoutStatus: IsoApplicationPayoutStatus }>,
): { payoutStatus: 'paid' | 'pending' | 'clawbacks' } | null {
  if (!appIsoId || payouts.length === 0) return null;
  const row =
    payouts.find((p) => String(p.isoId) === String(appIsoId)) ?? payouts[0];
  if (!row?.payoutStatus) return null;
  const u = String(row.payoutStatus).toUpperCase();
  if (u === 'PAID') return { payoutStatus: 'paid' };
  if (u === 'CLAWBACKS') return { payoutStatus: 'clawbacks' };
  return { payoutStatus: 'pending' };
}

/** Funded-deals rows for commission lookup (global / SUPER_ADMIN scope). */
async function fetchFundedDealsForPortalLookup(): Promise<
  Array<{ application: Record<string, unknown>; commission: Record<string, unknown> | null }>
> {
  const offers = await prisma.termsOffer.findMany({
    select: { applicationId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  const seenOffer = new Set<string>();
  const offerAppIds: string[] = [];
  for (const o of offers) {
    if (!seenOffer.has(o.applicationId)) {
      seenOffer.add(o.applicationId);
      offerAppIds.push(o.applicationId);
    }
  }

  const crDistinct = await prisma.commissionRequest.groupBy({
    by: ['applicationId'],
  });
  const crAppIds = crDistinct.map((r) => r.applicationId);

  const idSet = new Set<string>();
  offerAppIds.forEach((id) => idSet.add(id));
  crAppIds.forEach((id) => idSet.add(id));
  const scopedAppIds = Array.from(idSet);
  if (!scopedAppIds.length) return [];

  const applications = await prisma.application.findMany({
    where: { id: { in: scopedAppIds } },
    select: {
      id: true,
      applicationId: true,
      createdAt: true,
      loanAmount: true,
      commissionPercentage: true,
      currentQueue: true,
      currentState: true,
    },
  });

  const commissionRequests = await prisma.commissionRequest.findMany({
    where: { applicationId: { in: scopedAppIds } },
    orderBy: { createdAt: 'desc' },
  });

  const latestByApplication = new Map<string, (typeof commissionRequests)[number]>();
  for (const cr of commissionRequests) {
    if (!latestByApplication.has(cr.applicationId)) {
      latestByApplication.set(cr.applicationId, cr);
    }
  }

  return applications.map((app) => {
    const latest = latestByApplication.get(app.id);
    const applicationDto: Record<string, unknown> = {
      id: app.id,
      applicationId: app.applicationId,
      createdAt: app.createdAt,
      loanAmount: app.loanAmount,
      commissionPercentage: app.commissionPercentage ?? 0,
      currentQueue: app.currentQueue ?? null,
      currentState: app.currentState ?? null,
    };
    const commissionDto = latest
      ? {
          id: latest.id,
          status: latest.status,
          createdAt: latest.createdAt,
          fundingAmount: (latest as { fundingAmount?: unknown }).fundingAmount,
          commissionPercentage: (latest as { commissionPercentage?: unknown }).commissionPercentage,
        }
      : null;
    return { application: applicationDto, commission: commissionDto };
  });
}

function applicationToPortalDto(
  app: Awaited<ReturnType<typeof loadCommissionPortalApplications>>[number],
): Record<string, unknown> {
  const iso = app.iso;
  const client = app.client;
  const payouts = app.isoApplicationPayouts ?? [];
  return {
    id: app.id,
    applicationId: app.applicationId,
    dealId: app.dealId,
    createdAt: app.createdAt,
    loanAmount: app.loanAmount,
    commissionAmount: app.commissionAmount,
    commissionPercentage: app.commissionPercentage,
    currentQueue: app.currentQueue,
    currentState: app.currentState,
    isoId: app.isoId,
    iso: iso ? { id: iso.id, name: iso.name } : null,
    isoCommissionPayout: mapIsoCommissionPayout(app.isoId, payouts),
    OfferDecision: app.OfferDecision,
    termsOffers: app.termsOffers,
    client: client
      ? {
          businessName: client.businessName,
        }
      : null,
  };
}

async function loadCommissionPortalApplications() {
  return prisma.application.findMany({
    orderBy: { createdAt: 'desc' },
    take: COMMISSION_PORTAL_APP_LIMIT,
    select: {
      id: true,
      applicationId: true,
      dealId: true,
      createdAt: true,
      loanAmount: true,
      commissionAmount: true,
      commissionPercentage: true,
      currentQueue: true,
      currentState: true,
      isoId: true,
      iso: { select: { id: true, name: true } },
      isoApplicationPayouts: { select: { isoId: true, payoutStatus: true } },
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
      termsOffers: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          approvedAmount: true,
          commissionAmount: true,
        },
      },
      client: {
        select: {
          businessName: true,
        },
      },
    },
  });
}

/**
 * Commission KPIs using the same rules as the Commission Portal UI
 * (latest apps + funded-deals commission lookup).
 */
export async function computeCommissionPortalStats(): Promise<CommissionPortalStats> {
  const [applications, fundedDeals] = await Promise.all([
    loadCommissionPortalApplications(),
    fetchFundedDealsForPortalLookup(),
  ]);

  const lookup = buildCommissionLookupByApplication(fundedDeals);
  const dealRows = applications.map((app, idx) => {
    const dto = applicationToPortalDto(app);
    return mapApplicationToHistoryRow(dto, idx, getCommissionForApplication(dto, lookup));
  });

  const stats = aggregateStatsFromRows(dealRows);
  const portalDealCount = dealRows.length;

  return {
    totalCommission: stats.commissionTotal,
    commissionPortalDealCount: portalDealCount,
    commissionDealsFunded: stats.dealsFunded,
    commission: {
      paid: stats.paid,
      pending: stats.pendingCommission,
      processing: stats.processing,
      approved: stats.approved,
      clawback: stats.clawback,
      totalFundedVolume: stats.totalFunded,
      portalDealCount,
      dealsFunded: stats.dealsFunded,
    },
  };
}
