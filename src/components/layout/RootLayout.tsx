import { Outlet, useNavigate, useLocation } from "react-router";
import Sidebar from "../sidebar/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { jwtDecode } from "jwt-decode";
import RootLayoutWrapper from "./RootLayoutWrapper";
import { useEffect, useMemo } from "react";
import { normalizeRoleKey, resolveEffectiveRole } from "@/lib/sessionRole";
import { isAppAllowedRole, isPathAllowedForRole } from "@/lib/roleAccess";
import { useSelector } from "react-redux";
import type { RootState } from "@/redux/store";
import { axiosGet } from "@/redux/axios";
import { toast } from "react-toastify";
import NotificationsSync from "@/components/notifications/NotificationsSync";
import RealtimeNotificationsListener from "@/components/notifications/RealtimeNotificationsListener";
import PipelineCountsSync from "./PipelineCountsSync";
import PortalSendResultListener from "./PortalSendResultListener";

interface DecodedToken {
    role: string;
    name: string;
    email: string;
    id: string;
    exp?: number;
}

const RootLayout = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const isPublicRoute = location.pathname.startsWith("/public/");
    const { data } = useSelector((state: RootState) => state.login);

    const userRole = useMemo(
        () => resolveEffectiveRole(data?.user),
        [data?.user?.role, location.pathname],
    );
    const normalizedRole = normalizeRoleKey(userRole);

    useEffect(() => {
        if (isPublicRoute) return;

        const token = localStorage.getItem("token");
        const returnTo = `${location.pathname}${location.search || ""}`;
        const loginWithReturn = () =>
            navigate(`/login?returnUrl=${encodeURIComponent(returnTo)}`, { replace: true });

        if (!token) {
            loginWithReturn();
            return;
        }

        try {
            const decoded: DecodedToken = jwtDecode(token);
            if (decoded?.exp && decoded.exp * 1000 < Date.now()) {
                loginWithReturn();
                return;
            }
            const tokenRole = normalizeRoleKey(decoded?.role ?? "");
            if (tokenRole && !isAppAllowedRole(tokenRole)) {
                localStorage.removeItem("token");
                localStorage.removeItem("user");
                localStorage.removeItem("role");
                toast.error("Your role does not have access to this application.");
                navigate("/login", { replace: true });
                return;
            }
            // Workflow roles (Agent / Underwriter) only reach their own pages.
            if (tokenRole && !isPathAllowedForRole(tokenRole, location.pathname)) {
                navigate("/", { replace: true });
            }
        } catch {
            loginWithReturn();
        }
    }, [navigate, isPublicRoute, location.pathname, location.search]);

    // Session user role gate (after Redux hydrate)
    useEffect(() => {
        if (isPublicRoute) return;
        if (!data?.user) return;
        if (normalizedRole && !isAppAllowedRole(normalizedRole)) {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            localStorage.removeItem("role");
            toast.error("Your role does not have access to this application.");
            navigate("/login", { replace: true });
        }
    }, [data?.user, normalizedRole, isPublicRoute, navigate]);

    // Gmail OAuth return (`?gmail=connected|error`) — surface the result once, then clean the URL.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const gmailResult = params.get("gmail");
        if (!gmailResult) return;
        if (gmailResult === "connected") {
            toast.success("Gmail connected. ISO approval emails will be sent from your mailbox.");
        } else {
            const reason = params.get("reason") || "unknown_error";
            const hint =
                reason === "no_refresh_token"
                    ? "Google did not return offline access. Remove the app from your Google account permissions and connect again."
                    : `Gmail connection failed (${reason}).`;
            toast.error(hint);
        }
        params.delete("gmail");
        params.delete("reason");
        const qs = params.toString();
        navigate(`${location.pathname}${qs ? `?${qs}` : ""}`, { replace: true });
    }, [location.search, location.pathname, navigate]);

    // DocuSign OAuth callback (required for contract / ACH envelopes)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");
        const state = params.get("state");

        if (code) {
            axiosGet("/docusign/callback", {
                params: { code, state },
            })
                .then(() => {
                    toast.success("DocuSign connected successfully!");
                    window.history.replaceState({}, document.title, window.location.pathname);
                })
                .catch((err) => {
                    console.error("DocuSign callback error:", err);
                    toast.error(err?.response?.data?.message || "DocuSign connection failed");
                    window.history.replaceState({}, document.title, window.location.pathname);
                });
        }
    }, [location.search]);

    if (isPublicRoute) {
        return (
            <div className="min-h-screen bg-background">
                <Outlet />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-background">
            <SidebarProvider>
                <Sidebar />
                <RootLayoutWrapper />
                <NotificationsSync />
                <RealtimeNotificationsListener />
                <PipelineCountsSync />
                <PortalSendResultListener />
            </SidebarProvider>
        </div>
    );
};

export default RootLayout;
