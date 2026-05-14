import { createAsyncThunk } from '@reduxjs/toolkit';
import { isAxiosError } from 'axios';
import { axiosGet } from '../axios';
import type { MoneyFlowPoint, PaymentDashboardData } from '@/types/paymentDashboardTypes';

/** Aggregates all funded deals + payments in one request — allow longer than default 25s. */
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
            return 'Cannot reach the server — check that the API is running and VITE_API_BASE_URL is correct.';
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
        },
        moneyFlow: {
            monthly: normalizeMoneyFlowPoints(mfRaw.monthly),
            weekly: normalizeMoneyFlowPoints(mfRaw.weekly),
            yearly: normalizeMoneyFlowPoints(mfRaw.yearly),
        },
    };
}

type PaymentDashForCondition = { paymentDashboard: { loading: boolean } };

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
