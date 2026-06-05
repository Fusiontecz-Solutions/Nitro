import { createAsyncThunk } from '@reduxjs/toolkit';
import { isAxiosError } from 'axios';
import { axiosGet } from '../axios';
import type { FundedDealBalanceApiRow } from '@/lib/collectionPaymentDashboardApi';
import type { Application } from '@/types/applicationTypes';
import type {
    CreditDebitTrendByView,
    MoneyFlowPoint,
    PaymentDashboardData,
    PaymentFailedPaymentSummary,
} from '@/types/paymentDashboardTypes';

/** Financial overview / legacy dashboard — allow longer than default 25s. */
const PAYMENT_DASHBOARD_REQUEST_TIMEOUT_MS = 180_000;

function resolvePaymentDashboardFetchError(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const resp = (error as { response?: { data?: unknown; status?: number } }).response;
        const data = resp?.data;
        if (data && typeof data === 'object') {
            const msg = (data as { message?: unknown }).message;
            if (typeof msg === 'string' && msg.trim()) return msg.trim();
        }
        if (resp?.status === 401) return 'Session expired — please sign in again.';
        if (resp?.status === 503) return 'Payment dashboard temporarily unavailable — try again.';
    }
    if (isAxiosError(error)) {
        if (error.code === 'ECONNABORTED' || String(error.message ?? '').toLowerCase().includes('timeout')) {
            return 'Payment dashboard timed out — many deals can make this slow; try again in a moment.';
        }
        if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
            return 'Cannot reach the server. Please try again in a moment.';
        }
        if (error.message?.trim()) return error.message.trim();
    }
    return 'Failed to fetch payment dashboard';
}

function normalizeMoneyFlowPoints(value: unknown): MoneyFlowPoint[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
        if (!item || typeof item !== 'object') {
            return { label: '', inflow: 0, outflow: 0 };
        }
        const o = item as Record<string, unknown>;
        return {
            label: String(o.label ?? o.name ?? ''),
            inflow: Number(o.inflow) || 0,
            outflow: Number(o.outflow) || 0,
        };
    });
}

function cardOptionalNumber(raw: Record<string, unknown>, key: string): number | undefined {
    if (!(key in raw)) return undefined;
    const n = Number(raw[key]);
    return Number.isFinite(n) ? n : undefined;
}

/** Normalize backend `cards.failedPayment` (DEBIT-based) — returns undefined when payload omits it. */
function normalizeFailedPaymentDebit(raw: unknown): PaymentFailedPaymentSummary | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    const totalAmountRaw = Number(o.totalAmount);
    const countRaw = Number(o.count);
    const totalAmount = Number.isFinite(totalAmountRaw) ? totalAmountRaw : 0;
    const failedTxnCount = Number.isFinite(countRaw) ? Math.max(0, Math.round(countRaw)) : 0;
    return { totalAmount, failedTxnCount };
}

function normalizeCreditDebitTrend(raw: unknown): CreditDebitTrendByView | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    return {
        monthly: normalizeMoneyFlowPoints(o.monthly),
        weekly: normalizeMoneyFlowPoints(o.weekly),
        monthlyInYear: normalizeMoneyFlowPoints(o.monthlyInYear),
        yearly: normalizeMoneyFlowPoints(o.yearly),
    };
}

function normalizeFailedPaymentSummary(raw: unknown): PaymentFailedPaymentSummary | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const o = raw as Record<string, unknown>;
    return {
        totalAmount: Number(o.totalAmount) || 0,
        failedTxnCount: Number(o.failedTxnCount) || 0,
    };
}

/** Merge API payload with safe defaults so cards/charts never flicker with undefined. */
export function normalizePaymentDashboardData(raw: unknown): PaymentDashboardData {
    const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const cardsRaw =
        root.cards && typeof root.cards === 'object' ? (root.cards as Record<string, unknown>) : {};
    const mfRaw =
        root.moneyFlow && typeof root.moneyFlow === 'object'
            ? (root.moneyFlow as Record<string, unknown>)
            : {};

    const fundedTotal = cardOptionalNumber(cardsRaw, 'fundedTotal');
    const netFundingTotal = cardOptionalNumber(cardsRaw, 'netFundingTotal');
    const abovePrincipalTotal = cardOptionalNumber(cardsRaw, 'abovePrincipalTotal');
    const abovePrincipalPositiveSum = cardOptionalNumber(cardsRaw, 'abovePrincipalPositiveSum');
    const abovePrincipalNegativeSum = cardOptionalNumber(cardsRaw, 'abovePrincipalNegativeSum');
    const dealsWithPositiveGap = cardOptionalNumber(cardsRaw, 'dealsWithPositiveGap');
    const dealsWithNegativeGap = cardOptionalNumber(cardsRaw, 'dealsWithNegativeGap');
    const dealsWithZeroGap = cardOptionalNumber(cardsRaw, 'dealsWithZeroGap');
    const failedPaymentFromCards = normalizeFailedPaymentDebit(cardsRaw.failedPayment);

    return {
cards: {
            dueToday: Number(cardsRaw.dueToday) || 0,
            dueNext7Days: Number(cardsRaw.dueNext7Days) || 0,
            totalPayback: Number(cardsRaw.totalPayback) || 0,
            totalDues: Number(cardsRaw.totalDues) || 0,
            recovered: Number(cardsRaw.recovered) || 0,
            defaults: Number(cardsRaw.defaults) || 0,
            totalDeals: Number(cardsRaw.totalDeals) || 0,
            activeDeals: Number(cardsRaw.activeDeals) || 0,
            collectionEfficiency: Number(cardsRaw.collectionEfficiency) || 0,
            ...(fundedTotal !== undefined ? { fundedTotal } : {}),
            ...(netFundingTotal !== undefined ? { netFundingTotal } : {}),
            ...(abovePrincipalTotal !== undefined ? { abovePrincipalTotal } : {}),
            ...(abovePrincipalPositiveSum !== undefined ? { abovePrincipalPositiveSum } : {}),
            ...(abovePrincipalNegativeSum !== undefined ? { abovePrincipalNegativeSum } : {}),
            ...(dealsWithPositiveGap !== undefined
                ? { dealsWithPositiveGap: Math.round(dealsWithPositiveGap) }
                : {}),
            ...(dealsWithNegativeGap !== undefined
                ? { dealsWithNegativeGap: Math.round(dealsWithNegativeGap) }
                : {}),
            ...(dealsWithZeroGap !== undefined ? { dealsWithZeroGap: Math.round(dealsWithZeroGap) } : {}),
            ...(failedPaymentFromCards
                ? {
                      failedPayment: {
                          totalAmount: failedPaymentFromCards.totalAmount,
                          count: failedPaymentFromCards.failedTxnCount,
                      },
                  }
                : {}),
        },
        moneyFlow: {
            monthly: normalizeMoneyFlowPoints(mfRaw.monthly),
            weekly: normalizeMoneyFlowPoints(mfRaw.weekly),
            yearly: normalizeMoneyFlowPoints(mfRaw.yearly),
        },
        ...(normalizeCreditDebitTrend(root.creditDebitTrend)
            ? { creditDebitTrend: normalizeCreditDebitTrend(root.creditDebitTrend) }
            : {}),
        ...(Array.isArray(root.chartYearOptions)
            ? {
                  chartYearOptions: (root.chartYearOptions as unknown[])
                      .map((y) => Number(y))
                      .filter((y) => Number.isFinite(y)),
              }
            : {}),
        ...(normalizeFailedPaymentSummary(root.failedPaymentSummary)
            ? { failedPaymentSummary: normalizeFailedPaymentSummary(root.failedPaymentSummary) }
            : failedPaymentFromCards
              ? { failedPaymentSummary: failedPaymentFromCards }
              : {}),
    };
}

export type FetchPaymentFinancialOverviewArg = {
    pageIndex?: number;
    pageSize?: number;
    search?: string;
    chartYear?: number;
    chartMonth?: number | 'all';
};

export type PaymentFinancialOverviewResult = {
    dashboard: PaymentDashboardData;
    cohort: {
        data: Application[];
        pagination: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
        };
    };
    balancesByAppId: Record<string, FundedDealBalanceApiRow>;
};

function balancesFromFundedDeals(deals: Application[]): Record<string, FundedDealBalanceApiRow> {
    const out: Record<string, FundedDealBalanceApiRow> = {};
    for (const app of deals) {
        const appId = String(app._id ?? (app as { id?: string }).id ?? '').trim();
        if (!appId) continue;
        if (app.collectionPaybackAmount == null || app.collectionBalanceDue == null) continue;
        out[appId] = {
            applicationId: appId,
            dealId: String(app.dealId ?? '').trim(),
            paybackAmount: Number(app.collectionPaybackAmount) || 0,
            sumOfRepaid: Number(app.collectionSumOfRepaid) || 0,
            balanceDue: Number(app.collectionBalanceDue) || 0,
            grossRepaidDealEconomics: Number(app.collectionGrossRepaidDealEconomics) || 0,
        };
    }
    return out;
}

export const fetchPaymentFinancialOverview = createAsyncThunk<
    PaymentFinancialOverviewResult,
    FetchPaymentFinancialOverviewArg | undefined,
    { rejectValue: string }
>(
    'paymentDashboard/financialOverview',
    async (arg, { rejectWithValue }) => {
        try {
            const pageIndex = arg?.pageIndex ?? 0;
            const pageSize = arg?.pageSize ?? 10;
            const params = new URLSearchParams();
            params.set('page', String(pageIndex + 1));
            params.set('limit', String(pageSize));
            params.set('sortBy', 'createdAt');
            params.set('sortOrder', 'desc');
            const search = arg?.search?.trim();
            if (search) params.set('search', search);
            if (arg?.chartYear != null && Number.isFinite(arg.chartYear)) {
                params.set('chartYear', String(Math.floor(arg.chartYear)));
            }
            if (arg?.chartMonth === 'all') {
                params.set('chartMonth', 'all');
            } else if (arg?.chartMonth != null && Number.isFinite(arg.chartMonth)) {
                params.set('chartMonth', String(Math.floor(arg.chartMonth)));
            }

            const response = await axiosGet(
                `/collection-payments/financial-overview?${params.toString()}`,
                { timeout: PAYMENT_DASHBOARD_REQUEST_TIMEOUT_MS },
            );
            const body = response?.data ?? {};
            const raw = (body as { data?: unknown }).data ?? body;
            const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
            const dealsRaw =
                root.deals && typeof root.deals === 'object'
                    ? (root.deals as Record<string, unknown>)
                    : {};
            const dealsData = Array.isArray(dealsRaw.data) ? (dealsRaw.data as Application[]) : [];
            const paginationRaw = dealsRaw.pagination as Record<string, unknown> | undefined;

            const dashboard = normalizePaymentDashboardData(root);
            return {
                dashboard,
                cohort: {
                    data: dealsData,
                    pagination: {
                        total: Number(paginationRaw?.totalItems ?? paginationRaw?.total ?? 0),
                        page: Number(paginationRaw?.currentPage ?? paginationRaw?.page ?? 1),
                        limit: Number(paginationRaw?.itemsPerPage ?? paginationRaw?.limit ?? pageSize),
                        totalPages: Number(paginationRaw?.totalPages ?? 1),
                    },
                },
                balancesByAppId: balancesFromFundedDeals(dealsData),
            };
        } catch (error: unknown) {
            return rejectWithValue(resolvePaymentDashboardFetchError(error));
        }
    },
    {
        condition: (arg, { getState }) => {
            const s = (
                getState() as PaymentDashForCondition
            ).paymentDashboard;
            if (arg?.pageIndex !== undefined || arg?.search || arg?.chartYear !== undefined) {
                return !s?.loading;
            }
            return !s?.loading;
        },
    },
);

export type FetchPaymentFinancialOverviewSummaryArg = {
    chartYear?: number;
    chartMonth?: number | 'all';
};

/** KPI cards + portfolio chart (cached). Does not load deals table or failed-transactions scan. */
export const fetchPaymentFinancialOverviewSummary = createAsyncThunk<
    PaymentDashboardData,
    FetchPaymentFinancialOverviewSummaryArg | undefined,
    { rejectValue: string }
>(
    'paymentDashboard/financialOverviewSummary',
    async (arg, { rejectWithValue }) => {
        try {
            const params = new URLSearchParams();
            if (arg?.chartYear != null && Number.isFinite(arg.chartYear)) {
                params.set('chartYear', String(Math.floor(arg.chartYear)));
            }
            if (arg?.chartMonth === 'all') {
                params.set('chartMonth', 'all');
            } else if (arg?.chartMonth != null && Number.isFinite(arg.chartMonth)) {
                params.set('chartMonth', String(Math.floor(arg.chartMonth)));
            }
            const qs = params.toString();
            const response = await axiosGet(
                `/collection-payments/financial-overview/summary${qs ? `?${qs}` : ''}`,
                { timeout: PAYMENT_DASHBOARD_REQUEST_TIMEOUT_MS },
            );
            const body = response?.data ?? {};
            const raw = (body as { data?: unknown }).data ?? body;
            return normalizePaymentDashboardData(raw);
        } catch (error: unknown) {
            return rejectWithValue(resolvePaymentDashboardFetchError(error));
        }
    },
    {
        condition: (_, { getState }) => {
            const s = (getState() as PaymentDashForCondition).paymentDashboard;
            // Allow chart filter refetches while a background refresh is in flight.
            return !s?.loading || Boolean(s?.isRefreshing);
        },
    },
);

/** Portfolio failed-payment card (cached on server). */
export const fetchPaymentFailedSummary = createAsyncThunk<
    PaymentFailedPaymentSummary,
    void,
    { rejectValue: string }
>(
    'paymentDashboard/failedSummary',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosGet('/collection-payments/failed-transactions/summary', {
                timeout: PAYMENT_DASHBOARD_REQUEST_TIMEOUT_MS,
            });
            const body = response?.data ?? {};
            const summary = (body as { summary?: Record<string, unknown> }).summary ?? {};
            return {
                totalAmount: Number(summary.totalAmount) || 0,
                failedTxnCount: Number(summary.totalCount) || 0,
            };
        } catch (error: unknown) {
            return rejectWithValue(resolvePaymentDashboardFetchError(error));
        }
    },
);

type PaymentDashForCondition = { paymentDashboard: { loading: boolean; isRefreshing: boolean } };

export const getPaymentDashboard = createAsyncThunk<
    PaymentDashboardData,
    void,
    { rejectValue: string }
>(
    'paymentDashboard/get',
    async (_, { rejectWithValue }) => {
        try {
            const response = await axiosGet('/collection-payments/dashboard', {
                timeout: PAYMENT_DASHBOARD_REQUEST_TIMEOUT_MS,
            });
            const body = response?.data ?? {};
            const raw = (body as { data?: unknown }).data ?? body;
            return normalizePaymentDashboardData(raw);
        } catch (error: unknown) {
            return rejectWithValue(resolvePaymentDashboardFetchError(error));
        }
    },
    {
        condition: (_, { getState }) => {
            const s = (getState() as PaymentDashForCondition).paymentDashboard;
            return !s?.loading;
        },
    },
);
