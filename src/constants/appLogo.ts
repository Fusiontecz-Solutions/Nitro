import appLogoSrc from "@/assets/black_logo.svg";
import appLogoDarkSrc from "@/assets/white_logo.svg";

/** Resolved URL for the primary app logo (light backgrounds). */
export const APP_LOGO_SRC = appLogoSrc;

/** Resolved URL for the app logo on dark backgrounds / dark theme. */
export const APP_LOGO_DARK_SRC = appLogoDarkSrc;

/** Pick logo URL for the current theme (sidebar, auth, etc.). */
export function resolveAppLogoSrc(isDark: boolean): string {
  return isDark ? appLogoDarkSrc : appLogoSrc;
}
