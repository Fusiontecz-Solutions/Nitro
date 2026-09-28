import { useEffect } from "react";
import { toast } from "react-toastify";
import { useSocket } from "@/context/SocketContext";

/** Matches backend `PORTAL_SEND_RESULT_SOCKET_EVENT`. */
export const PORTAL_SEND_RESULT_SOCKET_EVENT = "contract:portal-send-result";

export type PortalSendResultPayload = {
    envelopeId?: string;
    applicationId?: string | null;
    ok?: boolean;
    recipientEmails?: string[];
    message?: string;
};

/**
 * "Send via SignNow" answers as soon as the send is validated; the SignNow
 * publish and the SendGrid emails finish on the server afterwards. This reports
 * how that ended to the user who clicked — on any page, since the contract
 * modal may already be closed by then.
 */
const PortalSendResultListener = () => {
    const { socket } = useSocket();

    useEffect(() => {
        if (!socket) return;
        const onResult = (payload: PortalSendResultPayload) => {
            if (payload?.ok) {
                const to = (payload.recipientEmails || []).join(", ");
                toast.success(
                    to ? `Signing link emailed to ${to}.` : "Signing link emailed to the merchant.",
                );
                return;
            }
            toast.error(
                `Contract was not sent: ${payload?.message || "Could not email the signing link."}`,
                { autoClose: false },
            );
        };
        socket.on(PORTAL_SEND_RESULT_SOCKET_EVENT, onResult);
        return () => {
            socket.off(PORTAL_SEND_RESULT_SOCKET_EVENT, onResult);
        };
    }, [socket]);

    return null;
};

export default PortalSendResultListener;
