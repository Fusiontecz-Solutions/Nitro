import { useCallback, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { useSocket } from "@/context/SocketContext";
import { fetchOperationsDashboardSummary } from "@/redux/actions/operationsDashboardActions";
import { invalidateDashboardData } from "@/lib/invalidateDashboardData";
import { invalidateApplicationsListCache } from "@/lib/applicationsListCache";
import { appQueryClient } from "@/lib/queryClient";
import { CONTRACT_SIGNING_STATUS_SOCKET_EVENT } from "@/hooks/useContractSigningStatusRealtime";

/** Safety-net poll while the tab is visible, in case a socket push is missed. */
const VISIBLE_POLL_MS = 45_000;
/** Ignore a refresh trigger that lands right behind another one. */
const MIN_REFRESH_GAP_MS = 2_000;

/**
 * Keeps the pipeline totals — state cards, queue counts and the sidebar badges —
 * in step with the backend.
 *
 * Those numbers move on events the browser never initiates: a signNow/DocuSign
 * webhook completing a contract, or another user advancing a deal. Before this
 * listener existed they only refreshed when the tab that owned them remounted,
 * so a deal could sit in "Contract Signed" while the sidebar still showed it
 * under Sent. `contract:signing-status` and `notification:new` are already
 * broadcast to every CRM user watching a deal, so both are treated here as
 * "the pipeline moved — recount".
 *
 * Mounted once at the app root, inside SocketProvider, so the counts stay live
 * on every page rather than only on the dashboard.
 */
const PipelineCountsSync = () => {
    const { socket } = useSocket();
    const dispatch = useDispatch<AppDispatch>();
    const lastRefreshRef = useRef(0);

    const refreshCounts = useCallback(
        (options?: { includeLists?: boolean }) => {
            const now = Date.now();
            if (now - lastRefreshRef.current < MIN_REFRESH_GAP_MS) return;
            lastRefreshRef.current = now;

            if (options?.includeLists) {
                // A stage move changes which queue a deal is listed under, so the
                // cached list pages are wrong too, not just the totals.
                invalidateApplicationsListCache();
                void appQueryClient.invalidateQueries({ queryKey: ["workflow-queue"] });
            }
            // Agent / Underwriter sidebar badges + workflow dashboard (e.g. ISO approval
            // moving a deal from Sent to ISO → Contract Pending).
            void appQueryClient.invalidateQueries({ queryKey: ["workflow-summary"] });
            void dispatch(fetchOperationsDashboardSummary());
            invalidateDashboardData(dispatch);
        },
        [dispatch],
    );

    useEffect(() => {
        if (!socket) return;

        const onSigningStatus = () => refreshCounts({ includeLists: true });
        const onNotification = () => refreshCounts({ includeLists: true });
        const onConnect = () => refreshCounts({ includeLists: true });

        socket.on(CONTRACT_SIGNING_STATUS_SOCKET_EVENT, onSigningStatus);
        socket.on("notification:new", onNotification);
        socket.on("connect", onConnect);

        return () => {
            socket.off(CONTRACT_SIGNING_STATUS_SOCKET_EVENT, onSigningStatus);
            socket.off("notification:new", onNotification);
            socket.off("connect", onConnect);
        };
    }, [socket, refreshCounts]);

    useEffect(() => {
        const onVisible = () => {
            if (document.hidden) return;
            refreshCounts({ includeLists: true });
        };

        const timer = window.setInterval(() => {
            if (document.hidden) return;
            refreshCounts();
        }, VISIBLE_POLL_MS);

        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);

        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("focus", onVisible);
        };
    }, [refreshCounts]);

    return null;
};

export default PipelineCountsSync;
