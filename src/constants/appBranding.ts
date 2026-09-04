/** Display name for outbound emails, letters, and template previews. */
export const APP_COMPANY_NAME = "Nitro Advance";

/** CRM product name referenced in client-facing emails. */
export const APP_COMPANY_CRM_NAME = "Nitro Advance";

/** In-app / email-preview logo (served from `public/`). */
export const APP_BRAND_LOGO_URL =
  String(import.meta.env?.VITE_BRAND_LOGO_URL ?? "").trim() ||
  "/harbor_logo.png";

/** Faded watermark for letter/email backgrounds. Override with `VITE_BRAND_LOGO_WATERMARK_URL`. */
export const APP_BRAND_LOGO_WATERMARK_URL =
  String(import.meta.env?.VITE_BRAND_LOGO_WATERMARK_URL ?? "").trim() ||
  APP_BRAND_LOGO_URL;

/**
 * Inline email/letter colors aligned with Nitro Advance navy / flame branding.
 */
export const APP_EMAIL_BRAND = {
  /** Header / footer ribbon */
  primary: "#0D2478",
  /** Titles, borders, signature accent */
  accent: "#1E4FA3",
  /** Info-table icon column */
  mid: "#0D2478",
} as const;

/** Metallic navy from the NITRO ADVANCE wordmark. */
export const APP_BRAND_NAVY = "#0D2478";

/** Royal blue from the logo type. */
export const APP_BRAND_BLUE = "#1E4FA3";

/** Flame orange sampled from the logo. */
export const APP_BRAND_ORANGE = "#F26C11";

/** Gold highlight from the flame core. */
export const APP_BRAND_GOLD = "#F5A623";
