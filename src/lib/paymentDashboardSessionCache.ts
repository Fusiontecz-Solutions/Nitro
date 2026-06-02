import type { Application } from '@/types/applicationTypes';
import type { PaymentDashboardData } from '@/types/paymentDashboardTypes';
import type { FundedDealBalanceApiRow } from '@/lib/collectionPaymentDashboardApi';
import { CRM_CACHE_NS, crmCacheClearNamespace, crmCacheGet, crmCacheSet } from '@/lib/crmCache';

const NS = CRM_CACHE_NS.PAYMENT_DASHBOARD;

const CACHE_VERSION = 1 as const;

export type PaymentDashboardSessionBundle = {
    v: typeof CACHE_VERSION;
    savedAt: number;
    dashboard: PaymentDashboardData | null;
    cohort: {
        data: Application[];
        pagination: {
            total: number;
            page: number;
            limit: number;
            totalPages: number;
        } | null;
    } | null;
    money: {
        balancesByAppId: Record<string, FundedDealBalanceApiRow>;
        paymentsByApp: Record<string, unknown[]>;
    } | null;
};

function cacheKeyForSession(): string {
    try {
        const token = localStorage.getItem('token');
        if (!token) return 'ih.paymentDashboard.v1.__no_token__';
        const parts = token.split('.');
        if (parts.length < 2) return 'ih.paymentDashboard.v1.__bad_token__';
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
        const json = JSON.parse(atob(padded)) as { id?: string; sub?: string; _id?: string };
        const uid = String(json.id ?? json.sub ?? json._id ?? 'user');
        return `ih.paymentDashboard.v1.${uid}`;
    } catch {
        return 'ih.paymentDashboard.v1.__err__';
    }
}

export function readPaymentDashboardSessionCache(): PaymentDashboardSessionBundle | null {
    if (typeof window === 'undefined') return null;
    const bundle = crmCacheGet<PaymentDashboardSessionBundle>(NS, cacheKeyForSession());
    if (!bundle || bundle.v !== CACHE_VERSION) return null;
    return bundle;
}

/** Merge the latest successful API slice into sessionStorage so refresh can restore instantly. */
export function writePaymentDashboardSessionCache(partial: {
    dashboard?: PaymentDashboardData | null;
    cohort?: PaymentDashboardSessionBundle['cohort'];
    money?: PaymentDashboardSessionBundle['money'];
}): void {
    if (typeof window === 'undefined') return;
    const key = cacheKeyForSession();
    const prev = readPaymentDashboardSessionCache();

    const bundle: PaymentDashboardSessionBundle = {
        v: CACHE_VERSION,
        savedAt: Date.now(),
        dashboard: partial.dashboard !== undefined ? partial.dashboard : prev?.dashboard ?? null,
        cohort: partial.cohort !== undefined ? partial.cohort : prev?.cohort ?? null,
        money: partial.money !== undefined ? partial.money : prev?.money ?? null,
    };

    const hasAnything =
        bundle.dashboard != null ||
        bundle.cohort != null ||
        bundle.money != null;

    if (!hasAnything) return;

    const tryWrite = (b: PaymentDashboardSessionBundle) => {
        crmCacheSet(NS, key, b);
    };

    tryWrite(bundle);
    if (bundle.cohort && bundle.cohort.data.length > 400) {
        tryWrite({
            ...bundle,
            cohort: {
                data: bundle.cohort.data.slice(0, 400),
                pagination: bundle.cohort.pagination,
            },
        });
    }
}

export function clearPaymentDashboardSessionCache(): void {
    crmCacheClearNamespace(NS);
}
