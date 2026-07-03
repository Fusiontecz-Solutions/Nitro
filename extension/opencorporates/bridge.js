/* global window, sessionStorage */

(function initCrmBridge() {
  if (window.CrmBackgroundCheckBridge) return;

  const BRIDGE_STORAGE_KEY = "crm_background_check_bridge";
const RETURN_MESSAGE_TYPE = "crm:bridge-return";

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function persistBridgeContext(context) {
  if (!context.applicationId && !context.targetOrigin) return;
  try {
    sessionStorage.setItem(BRIDGE_STORAGE_KEY, JSON.stringify(context));
  } catch {
    // Ignore quota / private-mode errors.
  }
}

function loadBridgeContext() {
  try {
    const raw = sessionStorage.getItem(BRIDGE_STORAGE_KEY);
    if (!raw) return emptyBridgeContext();
    const parsed = JSON.parse(raw);
    return normalizeBridgeContext(parsed);
  } catch {
    return emptyBridgeContext();
  }
}

function emptyBridgeContext() {
  return {
    applicationId: "",
    targetOrigin: "",
    returnUrl: "",
    sectionId: "",
    searchMode: "",
    businessName: "",
    ownerFirstName: "",
    ownerMiddleName: "",
    ownerLastName: "",
  };
}

function normalizeBridgeContext(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    applicationId: cleanText(data.applicationId),
    targetOrigin: cleanText(data.targetOrigin),
    returnUrl: cleanText(data.returnUrl),
    sectionId: cleanText(data.sectionId),
    searchMode: cleanText(data.searchMode),
    businessName: cleanText(data.businessName),
    ownerFirstName: cleanText(data.ownerFirstName),
    ownerMiddleName: cleanText(data.ownerMiddleName),
    ownerLastName: cleanText(data.ownerLastName),
  };
}

function readParamsFromLocation() {
  const hash = window.location.hash.replace(/^#/, "");
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    if (
      hashParams.get("crm_app_id") ||
      hashParams.get("hardrock_app_id") ||
      hashParams.get("crm_origin") ||
      hashParams.get("hardrock_origin")
    ) {
      return { params: hashParams, fromHash: true };
    }
  }

  return { params: new URLSearchParams(window.location.search), fromHash: false };
}

function clearBridgeHashFromUrl() {
  if (!window.location.hash) return;
  try {
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", cleanUrl);
  } catch {
    // Ignore history API errors.
  }
}

function readBridgeContext() {
  const { params, fromHash } = readParamsFromLocation();
  const fromUrl = normalizeBridgeContext({
    applicationId: params.get("crm_app_id") || params.get("hardrock_app_id"),
    targetOrigin: params.get("crm_origin") || params.get("hardrock_origin"),
    returnUrl: params.get("crm_return_url"),
    sectionId: params.get("crm_section"),
    searchMode: params.get("crm_search_mode"),
    businessName: params.get("crm_business_name"),
    ownerFirstName: params.get("crm_owner_first"),
    ownerMiddleName: params.get("crm_owner_middle"),
    ownerLastName: params.get("crm_owner_last"),
  });

  if (fromUrl.applicationId || fromUrl.targetOrigin || fromUrl.returnUrl) {
    persistBridgeContext(fromUrl);
    if (fromHash) {
      clearBridgeHashFromUrl();
    }
    return fromUrl;
  }

  return loadBridgeContext();
}

function sendPayloadToCrm(importPayload, source) {
  const context = readBridgeContext();
  const targetOrigin = context.targetOrigin;

  if (window.opener && !window.opener.closed && targetOrigin) {
    window.opener.postMessage(importPayload, targetOrigin);
    window.opener.postMessage(
      {
        type: RETURN_MESSAGE_TYPE,
        applicationId: context.applicationId,
        source,
        returnUrl: context.returnUrl,
        sectionId: context.sectionId,
      },
      targetOrigin,
    );
    window.opener.focus();
    window.setTimeout(() => {
      try {
        window.close();
      } catch {
        // Popup may be blocked from closing; CRM tab is already focused.
      }
    }, 700);
    return { mode: "opener", applicationId: context.applicationId, targetOrigin };
  }

  return { mode: "clipboard", applicationId: context.applicationId, targetOrigin };
}

window.CrmBackgroundCheckBridge = {
  BRIDGE_STORAGE_KEY,
  RETURN_MESSAGE_TYPE,
  readBridgeContext,
  persistBridgeContext,
  sendPayloadToCrm,
  cleanText,
};
})();
