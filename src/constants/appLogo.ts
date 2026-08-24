import { APP_BRAND_LOGO_URL } from "@/constants/appBranding";
import appLogoLocalSrc from "@/assets/logoo.png";

/** Long logo on light backgrounds. Prefer public file; Vite asset as fallback. */
export const APP_LOGO_SRC = APP_BRAND_LOGO_URL || appLogoLocalSrc;

/** Long logo on dark backgrounds. */
export const APP_LOGO_DARK_SRC = APP_BRAND_LOGO_URL || appLogoLocalSrc;

/** Favicon / collapsed sidebar / any small square mark. */
export const APP_SHORT_ICON_SRC = APP_BRAND_LOGO_URL || appLogoLocalSrc;

/** Favicon / collapsed sidebar / any small square mark. */
export const APP_SHORT_ICON_DARK_SRC = APP_BRAND_LOGO_URL || appLogoLocalSrc;

/** Pick long logo URL for the current theme (sidebar expanded, auth headers, etc.). */
export function resolveAppLogoSrc(_isDark: boolean): string {
  return APP_LOGO_SRC;
}
