import { Outlet, useNavigate, useLocation } from "react-router";
import Sidebar from "../sidebar/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { jwtDecode } from "jwt-decode";
import RootLayoutWrapper from "./RootLayoutWrapper";
import { useEffect, useMemo } from "react";
import {
    normalizeRoleKey,
    resolveEffectiveRole,
} from "@/lib/sessionRole";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import {
    getApplicationStats,
    prefetchApplicationsList,
} from "@/redux/actions/applicationActions";
import {
    fetchOperationsDashboardSummary,
    fetchOperationsDashboardRecentCases,
} from "@/redux/actions/operationsDashboardActions";
import { getPaymentDashboard } from "@/redux/actions/paymentDashboardActions";
import { fetchPaymentDashboardFundedDeals } from "@/redux/actions/paymentDashboardCohortActions";
import { fetchPaymentDashboardMoney } from "@/redux/actions/paymentDashboardMoneyActions";
import { OnlineStatusSync } from "@/components/chat/OnlineStatusSync";
import RealtimeNotificationsListener from "@/components/notifications/RealtimeNotificationsListener";
import { axiosGet } from "@/redux/axios";
import { toast } from "react-toastify";
import { APPLICATIONS_LIST_DEFAULT_SORT } from "@/lib/applicationsListParams";

interface DecodedToken {
    role: string;
    name: string;
    email: string;
    id: string;
    exp?: number;
}

const FINAL_UNDERWRITER_ROLE = 'FINAL_UNDERWRITER';

/** Super Admin sidebar deal-pipeline stages — warm list cache after login. */
const SUPER_ADMIN_PIPELINE_OPERATIONS_STATUSES = [
    "Agent",
    "Underwriter",
    "Final Underwriter",
    "Contracted",
    "Final",
    "Funding Call",
    "Disbursment",
    "Funded",
] as const;

const allowedPathsForUnderwriter = (pathname: string): boolean => {
    if (pathname === '/') return true;
    if (pathname === '/applications') return true;
    if (pathname.startsWith('/application-details')) return true;
    // Allow the tab-driven ApplicationDetails route.
    if (pathname.startsWith('/applications/')) return true;
    if (pathname.startsWith('/create-applications')) return true;
    if (pathname === '/team-chat') return true;
    if (pathname === '/notifications') return true;
    if (pathname === '/user-setting') return true;
    return false;
};

const RootLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const dispatch = useDispatch<AppDispatch>();
    const isPublicRoute = location.pathname.startsWith('/public/');
    const { data } = useSelector((state: RootState) => state.login);
    const paymentCohort = useSelector((state: RootState) => state.paymentDashboardCohort);
    const statsData = useSelector((state: RootState) => state.applicationStats.data);
    const statsLoading = useSelector((state: RootState) => state.applicationStats.loading);
    const statsRefreshing = useSelector((state: RootState) => state.applicationStats.isRefreshing);

    const userRole = useMemo(
        () => resolveEffectiveRole(data?.user),
        [data?.user?.role, location.pathname],
    );

    const normalizedRole = normalizeRoleKey(userRole);
    const isFinalUnderwriter = normalizedRole === FINAL_UNDERWRITER_ROLE;

    // Get current user ID from token
    const currentUserId = useMemo(() => {
        try {
            const token = localStorage.getItem('token');
            if (token && typeof token === 'string') {
                const decoded: DecodedToken = jwtDecode(token);
                return decoded?.id ?? '';
            }
        } catch {
            // ignore
        }
        return '';
    }, [location.pathname]);

    useEffect(() => {
        // Public share pages must be accessible without auth.
        if (isPublicRoute) return;

        const token = localStorage.getItem('token');
        const returnTo = `${location.pathname}${location.search || ''}`;
        const loginWithReturn = () =>
            navigate(`/login?returnUrl=${encodeURIComponent(returnTo)}`, { replace: true });

        if (!token) {
            loginWithReturn();
            return;
        }

        if (token && typeof token === 'string') {
            try {
                const decoded: DecodedToken = jwtDecode(token);
                if (decoded?.exp && decoded.exp * 1000 < Date.now()) {
                    loginWithReturn();
                }
            } catch {
                loginWithReturn();
            }
        } else {
            loginWithReturn();
        }
    }, [navigate, isPublicRoute, location.pathname, location.search]);

    // Prefetch dashboard application stats once per authenticated shell; skip if login already triggered a fetch.
    useEffect(() => {
        if (isPublicRoute) return;
        const token = localStorage.getItem("token");
        if (!token) return;
        if (statsData != null || statsLoading || statsRefreshing) return;
        dispatch(getApplicationStats());
    }, [dispatch, isPublicRoute, statsData, statsLoading, statsRefreshing]);

    // Prefetch Operations dashboards for roles that use them.
    useEffect(() => {
        if (isPublicRoute) return;
        if (!localStorage.getItem("token")) return;
        const opsOrSuper =
            normalizedRole === "OPERATIONS" ||
            normalizedRole === "SUPER_ADMIN";
        if (!opsOrSuper) return;
        void dispatch(fetchOperationsDashboardSummary());
        void dispatch(fetchOperationsDashboardRecentCases());
    }, [dispatch, isPublicRoute, normalizedRole]);

    // Warm payment dashboard APIs after login so `/payments` can render from Redux immediately.
    useEffect(() => {
        if (isPublicRoute) return;
        if (!localStorage.getItem("token")) return;
        void dispatch(getPaymentDashboard());
        void dispatch(fetchPaymentDashboardFundedDeals());
    }, [dispatch, isPublicRoute]);

    // After funded cohort is ready, load per-deal balances + collection rows into Redux.
    useEffect(() => {
        if (isPublicRoute) return;
        if (!localStorage.getItem("token")) return;
        if (!paymentCohort.fetched) return;
        void dispatch(fetchPaymentDashboardMoney());
    }, [dispatch, isPublicRoute, paymentCohort.fetched, paymentCohort.data]);

    // Warm `/applications?operationsStatus=…` responses so first pipeline click is often instant.
    useEffect(() => {
        if (isPublicRoute) return;
        if (!localStorage.getItem("token")) return;
        if (normalizedRole !== "SUPER_ADMIN") return;
        for (const operationsStatus of SUPER_ADMIN_PIPELINE_OPERATIONS_STATUSES) {
            prefetchApplicationsList({
                page: 1,
                limit: 10,
                operationsStatus,
                ...APPLICATIONS_LIST_DEFAULT_SORT,
            });
        }
    }, [isPublicRoute, normalizedRole]);

    useEffect(() => {
        if (isPublicRoute) return;
        if (isFinalUnderwriter && !allowedPathsForUnderwriter(location.pathname)) {
            navigate('/', { replace: true });
        }
    }, [isFinalUnderwriter, location.pathname, navigate]);

    // ✅ DOCUSIGN CALLBACK HANDLER - Runs on every page load
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");

        if (code) {
            console.log("DocuSign callback detected - code:", code);
            console.log("DocuSign callback state:", state);

            // Call the callback API to exchange code for access token
            axiosGet("/docusign/callback", {
                params: {
                    code,
                    state,
                },
            })
                .then((res) => {
                    console.log("DocuSign callback response:", res);
                    console.log("DocuSign callback data:", res.data);

                    toast.success("DocuSign connected successfully!");

                    // Remove query parameters from URL without reloading
                    window.history.replaceState({}, document.title, window.location.pathname);

                    // If we have a PDF URL stored, we can optionally redirect to create the envelope
                    // This will be handled by the ContractTab when user navigates back
                })
                .catch((err) => {
                    console.error("DocuSign callback error:", err);
                    toast.error(err?.response?.data?.message || "DocuSign connection failed");

                    // Still clean up the URL even on error
                    window.history.replaceState({}, document.title, window.location.pathname);
                });
        }
    }, [location.search]);

    if (isPublicRoute) {
        return <div className="min-h-screen bg-background"><Outlet /></div>;
    }

    return (
        <div className="min-h-screen bg-background">
            <SidebarProvider>
                <Sidebar />
                <RootLayoutWrapper />
            </SidebarProvider>
            {currentUserId && (
                <>
                    <OnlineStatusSync />
                    <RealtimeNotificationsListener />
                    {/* <FloatingChatWidget currentUserId={currentUserId} /> */}
                </>
            )}
        </div>
    );
};

export default RootLayout;