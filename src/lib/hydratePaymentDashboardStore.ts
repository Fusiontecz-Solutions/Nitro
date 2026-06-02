import type { Store } from '@reduxjs/toolkit';
import { readPaymentDashboardSessionCache } from '@/lib/paymentDashboardSessionCache';
import { hydratePaymentDashboardFromCache } from '@/redux/slices/paymentDashboardSlice';
import { hydratePaymentDashboardCohortFromCache } from '@/redux/slices/paymentDashboardCohortSlice';
import { hydratePaymentDashboardMoneyFromCache } from '@/redux/slices/paymentDashboardMoneySlice';

/**
 * Synchronously restore the last session snapshot before React renders (F5 / hard refresh).
 * Eliminates multi-minute “all $0.00” empty states while slow APIs refetch in the background.
 */
export function hydratePaymentDashboardFromSession(store: Store): void {
    if (typeof window === 'undefined') return;
    const snap = readPaymentDashboardSessionCache();
    if (!snap) return;

    if (snap.dashboard) {
        store.dispatch(hydratePaymentDashboardFromCache(snap.dashboard));
    }
    if (snap.cohort != null) {
        store.dispatch(
            hydratePaymentDashboardCohortFromCache({
                data: snap.cohort.data,
                pagination: snap.cohort.pagination,
            }),
        );
    }
    if (snap.money != null) {
        store.dispatch(
            hydratePaymentDashboardMoneyFromCache({
                balancesByAppId: snap.money.balancesByAppId,
                paymentsByApp: snap.money.paymentsByApp,
            }),
        );
    }
}
