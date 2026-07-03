/* global chrome */

function pathIncludesApplicationId(url, applicationId) {
  if (!url || !applicationId) return false;
  try {
    return new URL(url).pathname.includes(`/application-details/${applicationId}/`);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "crm:bridge-deliver") return;

  const { applicationId, returnUrl } = message;
  const senderTabId = sender?.tab?.id;
  if (!applicationId) {
    sendResponse({ ok: false });
    return;
  }

  chrome.tabs.query({}, (tabs) => {
    const matches = tabs.filter(
      (tab) =>
        tab.id &&
        tab.id !== senderTabId &&
        pathIncludesApplicationId(tab.url, applicationId),
    );

    const target = matches[0] || null;

    if (target?.id) {
      const updates = { active: true, highlighted: true };
      if (returnUrl && !String(target.url || "").includes("/background-check")) {
        updates.url = returnUrl;
      }
      chrome.tabs.update(target.id, updates, () => {
        sendResponse({ ok: true, tabId: target.id });
      });
      return;
    }

    if (returnUrl) {
      chrome.tabs.create({ url: returnUrl, active: true }, (tab) => {
        sendResponse({ ok: true, tabId: tab?.id ?? null });
      });
      return;
    }

    sendResponse({ ok: false });
  });

  return true;
});
