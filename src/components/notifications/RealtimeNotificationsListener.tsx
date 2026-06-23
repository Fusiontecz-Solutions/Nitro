import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";
import type { AppDispatch, RootState } from "@/redux/store";
import { useSocket } from "@/context/SocketContext";
import {
    prependNotification,
    type Notification,
} from "@/redux/slices/notificationSlice";

/**
 * Real-time notifications bridge.
 *
 * Subscribes to the shared Socket.IO connection (see {@link SocketContext}) and
 * reconciles inbound `notification:new` pushes into Redux so the bell, sidebar
 * badge and notifications page update with zero latency — no polling lag.
 *
 * The backend emits one event per recipient (room `user:<id>`) when an
 * application moves to Approved (see `applicationApprovalSideEffects.ts`),
 * carrying:
 *   - `notification`: the persisted Notification record in the same shape
 *     returned by GET /notifications, so the existing reducer can prepend it
 *     directly without an extra REST round-trip.
 *   - `meta.realtimeKind`: tag the UI uses to render context-specific in-app
 *     toasts (e.g. "ISO approved Application #X — you can now create the
 *     contract" for OPERATIONS users, click-through deep-link to the app).
 *
 * Mounted once at the app root (inside SocketProvider) so it runs for every
 * authenticated user and never duplicates listeners.
 */
type RealtimeKind =
    | "iso_approval_for_operations"
    | "application_approved"
    | "contract_signing_status";

interface IncomingNotificationEvent {
    notification: Notification;
    meta?: {
        realtimeKind?: RealtimeKind;
        actionUrl?: string;
    };
}

const RealtimeNotificationsListener = () => {
    const { socket } = useSocket();
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const { data: loginData } = useSelector((state: RootState) => state.login);

    /**
     * Keep the user role in a ref so the socket handler doesn't re-bind on
     * every render — react-redux selectors update frequently but the role
     * rarely changes, and re-subscribing would briefly miss events.
     */
    const userRoleRef = useRef<string>("");
    useEffect(() => {
        const fromState = String(loginData?.user?.role || "").toUpperCase();
        const fromStorage = String(localStorage.getItem("role") || "").toUpperCase();
        userRoleRef.current = fromState || fromStorage;
    }, [loginData]);

    useEffect(() => {
        if (!socket) return;

        const handleNotification = (event: IncomingNotificationEvent) => {
            const incoming = event?.notification;
            if (!incoming || !incoming._id) return;

            // Reconcile into the inbox immediately for badge / dropdown / page.
            dispatch(prependNotification(incoming));

            const role = userRoleRef.current;
            const kind = event?.meta?.realtimeKind;
            const isOpsRecipient = role === "OPERATIONS";
            const applicationLink = (() => {
                if (event?.meta?.actionUrl) return event.meta.actionUrl;
                const app = incoming.application;
                if (app && typeof app === "object") {
                    const id = app.applicationId ?? app._id;
                    return id ? `/application-details/${id}` : null;
                }
                return null;
            })();

            // Operations users get a high-priority CTA toast; everyone else
            // gets a quiet info toast so they're aware without distraction.
            if (kind === "iso_approval_for_operations" && isOpsRecipient) {
                toast.success(
                    () => (
                        <div className="flex flex-col gap-1">
                            <span className="font-semibold">{incoming.title}</span>
                            <span className="text-sm">{incoming.message}</span>
                            {applicationLink ? (
                                <span className="text-xs underline mt-1">
                                    Click to open the application
                                </span>
                            ) : null}
                        </div>
                    ),
                    {
                        autoClose: 6000,
                        onClick: () => {
                            if (applicationLink) navigate(applicationLink);
                        },
                    },
                );
                return;
            }

            if (kind === "contract_signing_status") {
                toast.info(
                    () => (
                        <div className="flex flex-col gap-1">
                            <span className="font-semibold">{incoming.title}</span>
                            <span className="text-sm">{incoming.message}</span>
                        </div>
                    ),
                    {
                        autoClose: 5000,
                        onClick: () => {
                            if (applicationLink) navigate(applicationLink);
                        },
                    },
                );
                return;
            }

            // Generic application_approved push (FUW / underwriter / agent).
            toast.info(`${incoming.title}`, {
                autoClose: 4000,
                onClick: () => {
                    if (applicationLink) navigate(applicationLink);
                },
            });
        };

        socket.on("notification:new", handleNotification);

        return () => {
            socket.off("notification:new", handleNotification);
        };
    }, [socket, dispatch, navigate]);

    return null;
};

export default RealtimeNotificationsListener;
