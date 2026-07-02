# CRM OpenCorporates Bridge (Chrome Extension)

Loads on `opencorporates.com` and adds a **Send to CRM** button when opened from the Hardrock/Katan background check tab.

## Install (unpacked)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `hardrock-fe/extension/opencorporates` (or `katan-fe/extension/opencorporates`)
5. After loading, click the extension icon — a small panel explains the workflow (the icon does not open OpenCorporates by itself)

## Usage

1. In CRM → Application → **Background Check** → OpenCorporates card, click **Search OpenCorporates** (this opens OpenCorporates in a new tab)
2. Solve the hCaptcha challenge if shown
3. Review search results or open a company detail page
4. Click **Send to CRM** (purple floating button, bottom-right of the OpenCorporates tab)
5. Results appear in the OpenCorporates panel; use **Apply to notes** if needed

## Bookmarklet fallback

If the extension is not installed, run this in the browser console on an OpenCorporates results page:

```js
CrmOpenCorporatesBookmarklet()
```

Then use **Paste JSON** in the CRM panel.

## Files

- `manifest.json` — MV3 extension manifest
- `extract.js` — DOM extraction + postMessage/clipboard helpers
- `content.js` — floating Send to CRM button
- `popup.html` / `popup.js` — instructions when you click the extension toolbar icon
