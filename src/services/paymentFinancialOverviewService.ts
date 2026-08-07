/**
 * Payment portfolio dashboard removed with contract-workflow cleanup.
 * Stub keeps import sites compiling.
 */
export type PaymentFinancialOverviewSummaryPayload = {
  creditDebitTrend: { labels: string[]; credit: number[]; debit: number[] };
  chartYearOptions: number[];
  [key: string]: unknown;
};

export async function buildPaymentFinancialOverviewSummary(
  chartYear?: number,
  _chartMonth?: number | 'all',
  _organization?: string,
): Promise<PaymentFinancialOverviewSummaryPayload> {
  const year = Number.isFinite(Number(chartYear))
    ? Math.floor(Number(chartYear))
    : new Date().getFullYear();
  return {
    creditDebitTrend: { labels: [], credit: [], debit: [] },
    chartYearOptions: [year],
  };
}
