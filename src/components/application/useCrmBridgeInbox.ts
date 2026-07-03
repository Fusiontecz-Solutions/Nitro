import { useEffect, useRef } from "react";
import { loadCrmBridgeInbox, type CrmBridgeInboxPayload } from "./crmBridgeTypes";

export function useCrmBridgeInbox(
  applicationId: string | undefined,
  onInbox: (payload: CrmBridgeInboxPayload) => void,
): void {
  const onInboxRef = useRef(onInbox);
  onInboxRef.current = onInbox;

  useEffect(() => {
    if (!applicationId) return;

    const consume = () => {
      const inbox = loadCrmBridgeInbox(applicationId);
      if (inbox) {
        onInboxRef.current(inbox);
      }
    };

    consume();
    window.addEventListener("crm-bridge-inbox", consume);

    const pollInterval = window.setInterval(consume, 1000);
    const stopPoll = window.setTimeout(() => {
      window.clearInterval(pollInterval);
    }, 60_000);

    return () => {
      window.removeEventListener("crm-bridge-inbox", consume);
      window.clearInterval(pollInterval);
      window.clearTimeout(stopPoll);
    };
  }, [applicationId]);
}
