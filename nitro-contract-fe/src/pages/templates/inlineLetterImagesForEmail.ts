/**
 * Replaces `<img src>` that point at this app's `/letter-assets/` with `data:` URLs
 * so Gmail and other clients show them (remote recipients cannot load your CRM host).
 */
export async function inlineLetterImagesForEmail(html: string): Promise<string> {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }
  if (!html.includes("<img") || !html.toLowerCase().includes("letter-assets")) {
    return html;
  }

  const wrapped = `<div id="__letter_img_root">${html}</div>`;
  const doc = new DOMParser().parseFromString(wrapped, "text/html");
  const root = doc.getElementById("__letter_img_root");
  if (!root) return html;

  const imgs = Array.from(root.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const raw = img.getAttribute("src");
      if (!raw || raw.startsWith("data:") || raw.startsWith("cid:")) return;
      let abs: string;
      try {
        abs = new URL(raw, window.location.origin).href;
      } catch {
        return;
      }
      if (new URL(abs).origin !== window.location.origin) return;
      if (!abs.includes("/letter-assets/")) return;
      try {
        const dataUrl = await fetchImageAsEmbeddedDataUrl(abs);
        img.setAttribute("src", dataUrl);
      } catch {
        /* keep remote src; user may fix hosting */
      }
    }),
  );

  return root.innerHTML;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(blob);
  });
}

async function fetchImageAsEmbeddedDataUrl(absUrl: string): Promise<string> {
  const res = await fetch(absUrl, { credentials: "same-origin" });
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  const path = new URL(absUrl).pathname.toLowerCase();
  const keepPng =
    path.includes("zero-balance-bird") || path.includes("bird") || blob.size < 65_000;
  if (keepPng) {
    return blobToDataUrl(blob);
  }
  const img = await loadImageFromBlob(blob);
  const maxW = 320;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.86);
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image decode"));
    };
    img.src = url;
  });
}
