/* global window, localStorage, chrome */

(function initCrmBridgeReceiver() {
  const PENDING_STORAGE_PREFIX = "crm_bridge_pending_";
  const INBOX_PREFIX = "crm_bridge_inbox_";
  const MAX_AGE_MS = 5 * 60 * 1000;

  function readApplicationIdFromPath() {
    const match = window.location.pathname.match(/\/application-details\/([^/]+)/i);
    return match?.[1] ? String(match[1]) : "";
  }

  function hashHasBridgePending() {
    return window.location.hash.includes("crm_bridge_pending");
  }

  function stripBridgePendingFromHash() {
    if (!window.location.hash.includes("crm_bridge_pending")) return;
    let hash = window.location.hash.replace(/^#/, "");
    hash = hash
      .replace(/&?crm_bridge_pending=1/g, "")
      .replace(/^&+/, "")
      .replace(/&+$/, "");
    const nextUrl = hash
      ? `${window.location.pathname}${window.location.search}#${hash}`
      : `${window.location.pathname}${window.location.search}`;
    try {
      window.history.replaceState(null, "", nextUrl);
    } catch {
      // Ignore history errors.
    }
  }

  function deliverInbox(applicationId, pending) {
    if (!applicationId || !pending?.importPayload || !pending?.returnMessage) return;
    if (Date.now() - (pending.savedAt || 0) > MAX_AGE_MS) return;

    try {
      localStorage.setItem(
        `${INBOX_PREFIX}${applicationId}`,
        JSON.stringify({
          source: pending.source,
          importPayload: pending.importPayload,
          returnMessage: pending.returnMessage,
          savedAt: pending.savedAt || Date.now(),
        }),
      );
    } catch {
      return;
    }

    stripBridgePendingFromHash();
    window.dispatchEvent(
      new CustomEvent("crm-bridge-inbox", { detail: { applicationId } }),
    );
    window.focus();
  }

  function consumePendingFromStorage(applicationId) {
    if (!applicationId || !chrome?.storage?.local) return;

    const storageKey = `${PENDING_STORAGE_PREFIX}${applicationId}`;
    chrome.storage.local.get([storageKey], (result) => {
      const pending = result?.[storageKey];
      if (!pending) return;
      deliverInbox(applicationId, pending);
      chrome.storage.local.remove([storageKey]);
    });
  }

  function consumePendingBridge() {
    const applicationId = readApplicationIdFromPath();
    if (!applicationId) return;
    consumePendingFromStorage(applicationId);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", consumePendingBridge, { once: true });
  } else {
    consumePendingBridge();
  }

  window.addEventListener("hashchange", consumePendingBridge);
  window.addEventListener("popstate", consumePendingBridge);

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const applicationId = readApplicationIdFromPath();
      if (!applicationId) return;
      const key = `${PENDING_STORAGE_PREFIX}${applicationId}`;
      if (changes[key]?.newValue) {
        deliverInbox(applicationId, changes[key].newValue);
        chrome.storage.local.remove([key]);
      }
    });
  }

  if (hashHasBridgePending()) {
    consumePendingBridge();
  }
})();
