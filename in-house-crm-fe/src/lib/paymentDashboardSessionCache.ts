import type { Application } from '@/types/applicationTypes';
import type { PaymentDashboardData } from '@/types/paymentDashboardTypes';
import type { FundedDealBalanceApiRow } from '@/lib/collectionPaymentDashboardApi';

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

function safeParse(raw: string): PaymentDashboardSessionBundle | null {
    try {
        const parsed = JSON.parse(raw) as PaymentDashboardSessionBundle;
        if (parsed?.v !== CACHE_VERSION) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function readPaymentDashboardSessionCache(): PaymentDashboardSessionBundle | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(cacheKeyForSession());
        if (!raw) return null;
        return safeParse(raw);
    } catch {
        return null;
    }
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
        sessionStorage.setItem(key, JSON.stringify(b));
    };

    try {
        tryWrite(bundle);
    } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            try {
                const slim: PaymentDashboardSessionBundle = {
                    ...bundle,
                    cohort:
                        bundle.cohort && bundle.cohort.data.length > 400
                            ? {
                                  data: bundle.cohort.data.slice(0, 400),
                                  pagination: bundle.cohort.pagination,
                              }
                            : bundle.cohort,
                };
                tryWrite(slim);
            } catch {
                try {
                    tryWrite({
                        v: CACHE_VERSION,
                        savedAt: Date.now(),
                        dashboard: bundle.dashboard,
                        cohort: null,
                        money: bundle.money,
                    });
                } catch {
                    if (bundle.dashboard) {
                        try {
                            tryWrite({
                                v: CACHE_VERSION,
                                savedAt: Date.now(),
                                dashboard: bundle.dashboard,
                                cohort: null,
                                money: null,
                            });
                        } catch {
                            /* ignore */
                        }
                    }
                }
            }
        }
    }
}

export function clearPaymentDashboardSessionCache(): void {
    if (typeof window === 'undefined') return;
    try {
        sessionStorage.removeItem(cacheKeyForSession());
    } catch {
        /* ignore */
    }
}
