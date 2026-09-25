import type { AppDispatch } from "@/redux/store";
import {
    getApplicationById,
    getApplicationByApplicationId,
} from "@/redux/actions/applicationActions";
import { invalidateApplicationDetailCache } from "@/lib/applicationDetailCache";
import { invalidateHttpGetCacheForResource } from "@/lib/httpGetCache";
import { isNumericApplicationRouteParam } from "@/lib/applicationRouteMatch";

/**
 * Re-read the application detail (stage, status, progress) from the server.
 *
 * The detail thunks answer from cache while it is "fresh", so a stage move made
 * by the backend (contract signed, CC notice sent) never reached the header
 * until a hard reload. Every cached copy — by route param, uuid and numeric id —
 * is dropped first so the fetch really goes to the server.
 */
export function refreshApplicationDetailFromServer(
    dispatch: AppDispatch,
    routeParam: string | null | undefined,
    otherCacheKeys: Array<string | number | null | undefined> = [],
): void {
    const route = String(routeParam ?? "").trim();
    for (const key of [route, ...otherCacheKeys]) {
        const value = String(key ?? "").trim();
        if (value) invalidateApplicationDetailCache(value);
    }
    invalidateHttpGetCacheForResource("applications");
    if (!route) return;
    if (isNumericApplicationRouteParam(route)) {
        void dispatch(getApplicationByApplicationId(route));
    } else {
        void dispatch(getApplicationById(route));
    }
}
