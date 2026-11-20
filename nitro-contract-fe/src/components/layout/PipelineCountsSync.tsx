import { useCallback, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { useSocket } from "@/context/SocketContext";
import { fetchOperationsDashboardSummary } from "@/redux/actions/operationsDashboardActions";
import { invalidateDashboardData } from "@/lib/invalidateDashboardData";
import { invalidateApplicationsListCache } from "@/lib/applicationsListCache";
import { appQueryClient } from "@/lib/queryClient";
import { CONTRACT_SIGNING_STATUS_SOCKET_EVENT } from "@/hooks/useContractSigningStatusRealtime";

/** Safety-net poll while the tab is visible and the socket is connected. */
const CONNECTED_POLL_MS = 120_000;
/** Faster safety-net poll while the socket is down and pushes cannot arrive. */
const DISCONNECTED_POLL_MS = 45_000;
/** Triggers landing within this window are merged into one refresh. */
const COALESCE_MS = 3_000;
/** Never refresh more often than this, however many events arrive. */
const MIN_REFRESH_GAP_MS = 10_000;
/** Returning to the tab only reloads list pages after being away this long. */
const LIST_REFRESH_AFTER_HIDDEN_MS = 60_000;

/**
 * Keeps the pipeline totals — state cards, queue counts and the sidebar badges —
 * in step with the backend.
 *
 * Those numbers move on events the browser never initiates: a signNow/DocuSign
 * webhook completing a contract, or another user advancing a deal.
 * `contract:signing-status` and `notification:new` are broadcast to every CRM
 * user, so they are treated as "recount".
 *
 * Every trigger is coalesced and rate-limited: a burst of notifications (or the
 * focus + visibilitychange pair the browser fires together) costs one refresh,
 * not one per event per open tab. Only events that actually move deals between
 * queues (signing status, reconnect, returning after a while) also reload the
 * cached list pages; a plain notification refreshes counts only.
 *
 * Mounted once at the app root, inside SocketProvider.
 */
const PipelineCountsSync = () => {
    const { socket, isConnected } = useSocket();
    const dispatch = useDispatch<AppDispatch>();
    const lastRefreshRef = useRef(0);
    const timerRef = useRef<number | null>(null);
    const pendingListsRef = useRef(false);
    const hiddenSinceRef = useRef<number | null>(null);

    const runRefresh = useCallback(() => {
        timerRef.current = null;
        lastRefreshRef.current = Date.now();
        const includeLists = pendingListsRef.current;
        pendingListsRef.current = false;

        if (includeLists) {
            // A stage move changes which queue a deal is listed under, so the
            // cached list pages are wrong too, not just the totals.
            invalidateApplicationsListCache();
            void appQueryClient.invalidateQueries({ queryKey: ["workflow-queue"] });
        }
        void appQueryClient.invalidateQueries({ queryKey: ["workflow-summary"] });
        void appQueryClient.invalidateQueries({ queryKey: ["sidebar-applications-total"] });
        void dispatch(fetchOperationsDashboardSummary());
        invalidateDashboardData(dispatch);
    }, [dispatch]);

    const scheduleRefresh = useCallback(
        (options?: { includeLists?: boolean }) => {
            if (options?.includeLists) pendingListsRef.current = true;
            if (timerRef.current !== null) return;
            const sinceLast = Date.now() - lastRefreshRef.current;
            const delay = Math.max(COALESCE_MS, MIN_REFRESH_GAP_MS - sinceLast);
            timerRef.current = window.setTimeout(runRefresh, delay);
        },
        [runRefresh],
    );

    useEffect(
        () => () => {
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        },
        [],
    );

    useEffect(() => {
        if (!socket) return;

        const onSigningStatus = () => scheduleRefresh({ includeLists: true });
        const onNotification = () => scheduleRefresh();
        const onConnect = () => scheduleRefresh({ includeLists: true });

        socket.on(CONTRACT_SIGNING_STATUS_SOCKET_EVENT, onSigningStatus);
        socket.on("notification:new", onNotification);
        socket.on("connect", onConnect);

        return () => {
            socket.off(CONTRACT_SIGNING_STATUS_SOCKET_EVENT, onSigningStatus);
            socket.off("notification:new", onNotification);
            socket.off("connect", onConnect);
        };
    }, [socket, scheduleRefresh]);

    useEffect(() => {
        const onVisible = () => {
            if (document.hidden) {
                if (hiddenSinceRef.current === null) hiddenSinceRef.current = Date.now();
                return;
            }
            const hiddenFor =
                hiddenSinceRef.current === null ? 0 : Date.now() - hiddenSinceRef.current;
            hiddenSinceRef.current = null;
            scheduleRefresh({ includeLists: hiddenFor >= LIST_REFRESH_AFTER_HIDDEN_MS });
        };

        const timer = window.setInterval(
            () => {
                if (document.hidden) return;
                scheduleRefresh();
            },
            isConnected ? CONNECTED_POLL_MS : DISCONNECTED_POLL_MS,
        );

        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);

        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
        };
    }, [scheduleRefresh, isConnected]);

    return null;
};

export default PipelineCountsSync;
