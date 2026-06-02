import { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { computePlatformDealCounts } from './dealCountsService';
import { computeCommissionPortalStats } from './commissionPortalStatsService';
import { buildPaymentDashboardPortfolioPayload } from './paymentDashboardPortfolioService';

export const SUPER_ADMIN_PLATFORM_ROW_ID = 'platform';

export type SuperAdminPlatformSnapshot = {
  id: string;
  clientCount: number;
  isoCount: number;
  deals: { total: number; funded: number };
  totalDealsCount: number;
  fundedDealsCount: number;
  dealCount: number;
  commissionPortalDealCount: number;
  commissionDealsFunded: number;
  totalCommission: number;
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
  paymentCards: {
    fundedTotal: number;
    netFundingTotal: number;
    abovePrincipalTotal: number;
    recovered: number;
    failedPayment: { totalAmount: number; count: number };
    dueToday: number;
    dueNext7Days: number;
    totalDues: number;
    totalPayback: number;
    collectionEfficiency: number;
    totalDeals: number;
    activeDeals: number;
  };
  lastRefreshedAt: string;
  updatedAt: string;
};

function decimalToNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

function mapRowToSnapshot(row: {
  id: string;
  clientCount: number;
  isoCount: number;
  totalDealsCount: number;
  fundedDealsCount: number;
  commissionPortalDealCount: number;
  commissionDealsFunded: number;
  totalCommission: Prisma.Decimal;
  deals: unknown;
  commission: unknown;
  paymentCards: unknown;
  lastRefreshedAt: Date;
  updatedAt: Date;
}): SuperAdminPlatformSnapshot {
  const dealsJson = (row.deals ?? {}) as { total?: number; funded?: number };
  const commissionJson = (row.commission ?? {}) as SuperAdminPlatformSnapshot['commission'];
  const paymentJson = (row.paymentCards ?? {}) as Partial<SuperAdminPlatformSnapshot['paymentCards']>;
  const failedJson = (paymentJson.failedPayment ?? {}) as Partial<
    SuperAdminPlatformSnapshot['paymentCards']['failedPayment']
  >;

  const totalDealsCount = row.totalDealsCount;
  const fundedDealsCount = row.fundedDealsCount;

  // jsonb does not preserve key insertion order, so rebuild paymentCards
  // explicitly to keep a stable, predictable response shape.
  const paymentCards: SuperAdminPlatformSnapshot['paymentCards'] = {
    fundedTotal: Number(paymentJson.fundedTotal ?? 0),
    netFundingTotal: Number(paymentJson.netFundingTotal ?? 0),
    abovePrincipalTotal: Number(paymentJson.abovePrincipalTotal ?? 0),
    recovered: Number(paymentJson.recovered ?? 0),
    failedPayment: {
      totalAmount: Number(failedJson.totalAmount ?? 0),
      count: Number(failedJson.count ?? 0),
    },
    dueToday: Number(paymentJson.dueToday ?? 0),
    dueNext7Days: Number(paymentJson.dueNext7Days ?? 0),
    totalDues: Number(paymentJson.totalDues ?? 0),
    totalPayback: Number(paymentJson.totalPayback ?? 0),
    collectionEfficiency: Number(paymentJson.collectionEfficiency ?? 0),
    totalDeals: Number(paymentJson.totalDeals ?? 0),
    activeDeals: Number(paymentJson.activeDeals ?? 0),
  };

  return {
    id: row.id,
    clientCount: row.clientCount,
    isoCount: row.isoCount,
    deals: {
      total: dealsJson.total ?? totalDealsCount,
      funded: dealsJson.funded ?? fundedDealsCount,
    },
    totalDealsCount,
    fundedDealsCount,
    dealCount: fundedDealsCount,
    commissionPortalDealCount: row.commissionPortalDealCount,
    commissionDealsFunded: row.commissionDealsFunded,
    totalCommission: decimalToNumber(row.totalCommission),
    commission: commissionJson,
    paymentCards,
    lastRefreshedAt: row.lastRefreshedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getSuperAdminPlatformSnapshot(): Promise<SuperAdminPlatformSnapshot | null> {
  const row = await prisma.superAdminPlateform.findUnique({
    where: { id: SUPER_ADMIN_PLATFORM_ROW_ID },
  });
  if (!row) return null;
  return mapRowToSnapshot(row);
}

export async function refreshSuperAdminPlatformSnapshot(): Promise<SuperAdminPlatformSnapshot> {
  const now = new Date();

  const [clientCount, isoCount, portfolioPayload, commissionStats, dealCounts] =
    await Promise.all([
      prisma.client.count(),
      prisma.iso.count(),
      buildPaymentDashboardPortfolioPayload(),
      computeCommissionPortalStats(),
      computePlatformDealCounts(),
    ]);

  const cards = portfolioPayload.cards as Record<string, unknown>;
  const failedPayment = (cards.failedPayment ?? { totalAmount: 0, count: 0 }) as {
    totalAmount: number;
    count: number;
  };

  const paymentCards: SuperAdminPlatformSnapshot['paymentCards'] = {
    fundedTotal: Number(cards.fundedTotal ?? 0),
    netFundingTotal: Number(cards.netFundingTotal ?? 0),
    abovePrincipalTotal: Number(cards.abovePrincipalTotal ?? 0),
    recovered: Number(cards.recovered ?? 0),
    failedPayment: {
      totalAmount: Number(failedPayment.totalAmount ?? 0),
      count: Number(failedPayment.count ?? 0),
    },
    dueToday: Number(cards.dueToday ?? 0),
    dueNext7Days: Number(cards.dueNext7Days ?? 0),
    totalDues: Number(cards.totalDues ?? 0),
    totalPayback: Number(cards.totalPayback ?? 0),
    collectionEfficiency: Number(cards.collectionEfficiency ?? 0),
    totalDeals: Number(cards.totalDeals ?? dealCounts.fundedDealsCount),
    activeDeals: Number(cards.activeDeals ?? dealCounts.fundedDealsCount),
  };

  const deals = {
    total: dealCounts.totalDealsCount,
    funded: dealCounts.fundedDealsCount,
  };

  const row = await prisma.superAdminPlateform.upsert({
    where: { id: SUPER_ADMIN_PLATFORM_ROW_ID },
    create: {
      id: SUPER_ADMIN_PLATFORM_ROW_ID,
      clientCount,
      isoCount,
      totalDealsCount: dealCounts.totalDealsCount,
      fundedDealsCount: dealCounts.fundedDealsCount,
      commissionPortalDealCount: commissionStats.commissionPortalDealCount,
      commissionDealsFunded: commissionStats.commissionDealsFunded,
      totalCommission: commissionStats.totalCommission,
      deals: deals as Prisma.InputJsonValue,
      commission: commissionStats.commission as Prisma.InputJsonValue,
      paymentCards: paymentCards as Prisma.InputJsonValue,
      lastRefreshedAt: now,
    },
    update: {
      clientCount,
      isoCount,
      totalDealsCount: dealCounts.totalDealsCount,
      fundedDealsCount: dealCounts.fundedDealsCount,
      commissionPortalDealCount: commissionStats.commissionPortalDealCount,
      commissionDealsFunded: commissionStats.commissionDealsFunded,
      totalCommission: commissionStats.totalCommission,
      deals: deals as Prisma.InputJsonValue,
      commission: commissionStats.commission as Prisma.InputJsonValue,
      paymentCards: paymentCards as Prisma.InputJsonValue,
      lastRefreshedAt: now,
    },
  });

  return mapRowToSnapshot(row);
}
