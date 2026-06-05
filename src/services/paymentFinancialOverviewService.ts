import { DashboardCacheKind, withDashboardCache } from './dashboardCache';
import { buildPaymentDashboardPortfolioPayload } from './paymentDashboardPortfolioService';
import { computeCreditDebitTrendPortfolio } from './paymentDashboardCreditDebitTrend';

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
