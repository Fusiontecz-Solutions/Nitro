import { useEffect } from "react";
import { loadCrmBridgeInbox, type CrmBridgeInboxPayload } from "./crmBridgeTypes";

export function useCrmBridgeInbox(
  applicationId: string | undefined,
  onInbox: (payload: CrmBridgeInboxPayload) => void,
): void {
  useEffect(() => {
    if (!applicationId) return;

    const consume = () => {
      const inbox = loadCrmBridgeInbox(applicationId);
      if (inbox) {
        onInbox(inbox);
      }
    };

    consume();
    window.addEventListener("crm-bridge-inbox", consume);
    return () => window.removeEventListener("crm-bridge-inbox", consume);
  }, [applicationId, onInbox]);
}
