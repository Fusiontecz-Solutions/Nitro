import { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { DashboardCacheKind, withDashboardCache } from './dashboardCache';
import { buildPaymentDashboardPortfolioPayload } from './paymentDashboardPortfolioService';
import { computeCreditDebitTrendPortfolio } from './paymentDashboardCreditDebitTrend';
import { buildApplicationStatsBucketWhere } from './applicationStatsBucketWhere';
import { getBalancesForApplicationIds } from './collectionPaymentFinancials';
import { mapApplicationToApi } from '../controllers/applicationController';

export type PaymentFinancialOverviewSummaryPayload = Awaited<
  ReturnType<typeof buildPaymentFinancialOverviewSummary>
>;

function parseChartMonth(chartMonth?: number | 'all'): number | 'all' {
  if (chartMonth === 'all') return 'all';
  if (chartMonth === undefined) return new Date().getMonth();
  const m = Math.floor(Number(chartMonth));
  if (!Number.isFinite(m) || m < 0 || m > 11) return new Date().getMonth();
  return m;
}

function portfolioCacheKey(year: number, month: number | 'all'): string {
  return `summary:${year}:${month === 'all' ? 'all' : month}`;
}

/** KPI cards + money-flow + credit/debit chart series (cached ~25s). */
export async function buildPaymentFinancialOverviewSummary(
  chartYear?: number,
  chartMonth?: number | 'all',
) {
  const year = Number.isFinite(Number(chartYear))
    ? Math.floor(Number(chartYear))
    : new Date().getFullYear();
  const month = parseChartMonth(chartMonth);

  return withDashboardCache(
    DashboardCacheKind.PAYMENT_OVERVIEW,
    portfolioCacheKey(year, month),
    async () => {
      const portfolio = await buildPaymentDashboardPortfolioPayload();
      const { creditDebitTrend, chartYearOptions } = await computeCreditDebitTrendPortfolio(
        year,
        month,
      );
      return {
        ...portfolio,
        creditDebitTrend,
        chartYearOptions,
      };
    },
  );
}

export type PaymentFinancialOverviewParams = {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  chartYear?: number;
  chartMonth?: number | 'all';
};

/** Funded "deals" listing (paginated) for the Payment History overview, with embedded collection balances. */
async function buildFundedDealsPage(params: {
  page: number;
  limit: number;
  search: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}) {
  const { page, limit, search, sortBy, sortOrder } = params;

  const fundedWhere = buildApplicationStatsBucketWhere('funded');
  if (!fundedWhere) {
    throw new Error('Funded scope unavailable');
  }

  let where: Prisma.ApplicationWhereInput = fundedWhere;
  if (search.trim()) {
    const searchStr = search.trim();
    where = {
      AND: [
        fundedWhere,
        {
          OR: [
            { type: { contains: searchStr, mode: 'insensitive' } },
            { note: { contains: searchStr, mode: 'insensitive' } },
            {
              client: {
                OR: [
                  { businessName: { contains: searchStr, mode: 'insensitive' } },
                  { businessEmail: { contains: searchStr, mode: 'insensitive' } },
                  { ownerFirstName: { contains: searchStr, mode: 'insensitive' } },
                  { ownerLastName: { contains: searchStr, mode: 'insensitive' } },
                  { ownerEmail: { contains: searchStr, mode: 'insensitive' } },
                ],
              },
            },
          ],
        },
      ],
    };
  }

  const orderByField =
    sortBy === 'createdAt' || sortBy === 'updatedAt' || sortBy === 'applicationId'
      ? sortBy
      : 'createdAt';
  const orderBy: Prisma.ApplicationOrderByWithRelationInput = {
    [orderByField]: sortOrder === 'asc' ? 'asc' : 'desc',
  };

  const skip = Math.max(0, (page - 1) * limit);
  const [apps, total] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
        client: true,
        iso: { select: { id: true, name: true, email: true, phone: true } },
        isoApplicationPayouts: true,
        claimedByUnderwriter: { select: { id: true, firstName: true, lastName: true, email: true } },
        termsOffers: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: {
            approvedAmount: true,
            factorRate: true,
            paybackAmount: true,
            commissionAmount: true,
          },
        },
        OfferDecision: true,
      },
    }),
    prisma.application.count({ where }),
  ]);

  const balanceByApplicationId = new Map<
    string,
    { balanceDue: number; sumOfRepaid: number; paybackAmount: number; grossRepaidDealEconomics: number }
  >();
  if (apps.length > 0) {
    try {
      const balRows = await getBalancesForApplicationIds(
        prisma,
        apps.map((a) => a.id),
      );
      for (const row of balRows) {
        balanceByApplicationId.set(row.applicationId, {
          balanceDue: row.balanceDue,
          sumOfRepaid: row.sumOfRepaid,
          paybackAmount: row.paybackAmount,
          grossRepaidDealEconomics: row.grossRepaidDealEconomics,
        });
      }
    } catch (embedErr) {
      console.error('Embed collection balances (financial overview deals):', embedErr);
    }
  }

  const data = apps.map((app) => {
    const dto = mapApplicationToApi(app) as Record<string, unknown>;
    const bal = balanceByApplicationId.get(app.id);
    if (bal) {
      dto.collectionBalanceDue = bal.balanceDue;
      dto.collectionSumOfRepaid = bal.sumOfRepaid;
      dto.collectionPaybackAmount = bal.paybackAmount;
      dto.collectionGrossRepaidDealEconomics = bal.grossRepaidDealEconomics;
    }
    return dto;
  });

  return {
    data,
    pagination: {
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: limit,
    },
  };
}

/** KPI cards + chart series (cached) combined with the paginated funded deals listing. */
export async function buildPaymentFinancialOverview(params: PaymentFinancialOverviewParams) {
  const page = Number.isFinite(Number(params.page)) && Number(params.page) > 0
    ? Math.floor(Number(params.page))
    : 1;
  const limit = Number.isFinite(Number(params.limit)) && Number(params.limit) > 0
    ? Math.min(Math.floor(Number(params.limit)), 100)
    : 10;
  const search = typeof params.search === 'string' ? params.search : '';
  const sortBy = typeof params.sortBy === 'string' ? params.sortBy : 'createdAt';
  const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc';

  const [summary, deals] = await Promise.all([
    buildPaymentFinancialOverviewSummary(params.chartYear, params.chartMonth),
    buildFundedDealsPage({ page, limit, search, sortBy, sortOrder }),
  ]);

  return { ...summary, deals };
}
