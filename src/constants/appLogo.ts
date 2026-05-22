import appLogoLightSrc from "@/assets/black_logo.svg";
import appLogoDarkSrc from "@/assets/white_logo.svg";
import appShortIconSrc from "@/assets/black_logo.svg";
import appShortIconDarkSrc from "@/assets/white_logo.svg";


/** Long logo on light backgrounds. */
export const APP_LOGO_SRC = appLogoLightSrc;

/** Long logo on dark backgrounds. */
export const APP_LOGO_DARK_SRC = appLogoDarkSrc;

/** Favicon / collapsed sidebar / any small square mark. */
export const APP_SHORT_ICON_SRC = appShortIconSrc;

/** Favicon / collapsed sidebar / any small square mark. */
export const APP_SHORT_ICON_DARK_SRC = appShortIconDarkSrc;

/** Pick long logo URL for the current theme (sidebar expanded, auth headers, etc.). */
export function resolveAppLogoSrc(isDark: boolean): string {
  return isDark ? appLogoDarkSrc : appLogoLightSrc;
}
