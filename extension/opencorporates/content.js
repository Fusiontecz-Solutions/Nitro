/* global window, document */

(function initOpenCorporatesBridge() {
  const api = window.CrmOpenCorporatesExtract;
  if (!api) return;

  const { applicationId, targetOrigin } = (function readContext() {
    const params = new URLSearchParams(window.location.search);
    return {
      applicationId: params.get("hardrock_app_id") || "",
      targetOrigin: params.get("hardrock_origin") || "",
    };
  })();

  const isCaptchaPage =
    document.title.includes("HAProxy Challenge") || Boolean(document.querySelector(".h-captcha"));

  const isCompaniesPage = /\/companies(\/|$)/i.test(window.location.pathname);

  function createCaptchaHint() {
    if (document.getElementById("crm-opencorporates-captcha-hint")) return;

    const hint = document.createElement("div");
    hint.id = "crm-opencorporates-captcha-hint";
    hint.textContent =
      "CRM extension: solve the captcha above. After the page reloads, use Send to CRM (bottom-right).";
    hint.style.cssText = [
      "position:fixed",
      "left:20px",
      "right:20px",
      "bottom:20px",
      "z-index:2147483645",
      "padding:12px 14px",
      "border-radius:10px",
      "background:#1e3a8a",
      "color:#fff",
      "font:600 12px/1.4 system-ui,-apple-system,sans-serif",
      "box-shadow:0 10px 24px rgba(30,58,138,0.35)",
    ].join(";");
    document.body.appendChild(hint);
  }

  function createButton() {
    if (document.getElementById("crm-opencorporates-send-btn")) return;

    const button = document.createElement("button");
    button.id = "crm-opencorporates-send-btn";
    button.type = "button";
    button.textContent = "Send to CRM";
    button.title = "Send extracted company data back to the CRM background check tab";
    button.style.cssText = [
      "position:fixed",
      "right:20px",
      "bottom:20px",
      "z-index:2147483646",
      "padding:12px 16px",
      "border:none",
      "border-radius:999px",
      "background:#4f46e5",
      "color:#fff",
      "font:600 13px/1.2 system-ui,-apple-system,sans-serif",
      "box-shadow:0 10px 24px rgba(79,70,229,0.35)",
      "cursor:pointer",
    ].join(";");

    button.addEventListener("click", () => {
      const companies = api.extractPageCompanies();
      if (!companies.length) {
        window.alert("No OpenCorporates companies found on this page.");
        return;
      }

      const result = api.sendToOpener(companies);
      if (result.mode === "opener") {
        button.textContent = `Sent ${result.count} to CRM`;
        button.style.background = "#15803d";
        window.setTimeout(() => window.close(), 800);
        return;
      }

      button.textContent = "Copied JSON — paste in CRM";
      button.style.background = "#a16207";
      window.alert(
        `Copied ${result.count} companies as JSON to your clipboard.\n\nIn Hardrock: OpenCorporates → Paste JSON.`,
      );
    });

    document.body.appendChild(button);
  }

  if (isCaptchaPage) {
    createCaptchaHint();
    return;
  }

  if (isCompaniesPage || window.opener || applicationId) {
    createButton();
  }

  window.CrmOpenCorporatesBookmarklet = function bookmarklet() {
    const companies = api.extractPageCompanies();
    if (!companies.length) {
      window.alert("No companies found on this page.");
      return;
    }
    const payload = api.buildImportPayload(companies);
    void api.copyPayloadToClipboard({ companies: payload.payload.companies });
    window.alert(
      `Copied ${companies.length} compan${companies.length === 1 ? "y" : "ies"} as JSON. Paste into CRM OpenCorporates panel.`,
    );
  };
})();
