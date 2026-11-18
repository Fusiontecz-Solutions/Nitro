import {
  APP_BRAND_LOGO_URL,
  APP_BRAND_LOGO_WATERMARK_URL,
  APP_COMPANY_NAME,
  APP_EMAIL_BRAND,
} from "@/constants/appBranding";
import type { LetterEmailBranding } from "./letterEmailBranding";

export type LetterHtmlTheme = {
  companyName: string;
  logoSrc: string;
  watermarkSrc: string;
  brandPrimary: string;
  brandAccent: string;
  brandMid: string;
};

/** Map funder Letter Info branding onto the Gmail-safe letter HTML theme. */
export function letterHtmlTheme(branding?: LetterEmailBranding | null): LetterHtmlTheme {
  return {
    companyName: branding?.companyName?.trim() || APP_COMPANY_NAME,
    logoSrc: branding?.logoSrc?.trim() || APP_BRAND_LOGO_URL,
    watermarkSrc: branding?.watermarkSrc?.trim() || APP_BRAND_LOGO_WATERMARK_URL,
    brandPrimary: branding?.accentStripDark?.trim() || APP_EMAIL_BRAND.primary,
    brandAccent: branding?.accentStripLight?.trim() || APP_EMAIL_BRAND.accent,
    brandMid: branding?.infoTableIconBg?.trim() || APP_EMAIL_BRAND.mid,
  };
}
