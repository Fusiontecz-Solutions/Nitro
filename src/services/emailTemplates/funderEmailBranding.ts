import { BRAND_DISPLAY_NAME, BRAND_EMAIL_LOGO_SRC } from '../../constants/brand';

/**
 * Funder (book) branding for outbound emails: logo and accent colors.
 *
 * Same rules as the payoff / zero-balance letters on the frontend
 * (`nitro-contract-fe/src/pages/templates/letterEmailBranding.ts`): Letter Info
 * saved on the funder profile wins, then the per-funder logos below, then
 * Nitro Advance. Keep the table in step with that file.
 */
export interface FunderEmailBranding {
  companyName: string;
  /** Hosted logo URL, or the Nitro Advance `cid:` logo (attach `buildBrandLogoAttachments()`). */
  logoSrc: string;
  /** Lighter accent (letter "accent strip light"). */
  accentLight: string;
  /** Darker accent / header band (letter "accent strip dark"). */
  accentDark: string;
}

export type FunderEmailBrandingSource = {
  name?: string | null;
  displayName?: string | null;
  letterCompanyName?: string | null;
  letterLogoUrl?: string | null;
  letterAccentStripLight?: string | null;
  letterAccentStripDark?: string | null;
};

export const DEFAULT_FUNDER_EMAIL_BRANDING: FunderEmailBranding = {
  companyName: BRAND_DISPLAY_NAME,
  logoSrc: BRAND_EMAIL_LOGO_SRC,
  accentLight: '#F26C11',
  accentDark: '#1E4FA3',
};

const LEGACY_FUNDER_BRANDING: Array<{ needles: string[]; branding: FunderEmailBranding }> = [
  {
    needles: ['fb funding'],
    branding: {
      companyName: 'FB FUNDING LLC',
      logoSrc:
        'https://res.cloudinary.com/dehrku8og/image/upload/v1784056760/ChatGPT_Image_Jul_15_2026_12_49_02_AM_ldveap.png',
      accentLight: '#64748b',
      accentDark: '#0f172a',
    },
  },
  {
    needles: ['hewlett advance'],
    branding: {
      companyName: 'HEWLETT ADVANCE LLC',
      logoSrc:
        'https://res.cloudinary.com/dehrku8og/image/upload/v1784054493/ChatGPT_Image_Jul_15_2026_12_09_17_AM_wnjjkm.png',
      accentLight: '#031707',
      accentDark: '#A9CD86',
    },
  },
  {
    needles: ['tilde advance'],
    branding: {
      companyName: 'TILDE ADVANCE',
      logoSrc:
        'https://res.cloudinary.com/dehrku8og/image/upload/v1784054593/ChatGPT_Image_Jul_15_2026_12_12_46_AM_bkrtfo.png',
      accentLight: '#a1a1aa',
      accentDark: '#27272a',
    },
  },
  {
    needles: ['atlas advance'],
    branding: {
      companyName: 'ATLAS ADVANCE LLC',
      logoSrc:
        'https://res.cloudinary.com/dehrku8og/image/upload/v1784141929/ChatGPT_Image_Jul_15_2026_07_03_58_PM_lvvg6y.png',
      accentLight: '#15599F',
      accentDark: '#6FB8F5',
    },
  },
  {
    needles: ['ejm ventures'],
    branding: {
      companyName: 'EJM VENTURES LLC',
      logoSrc:
        'https://res.cloudinary.com/dehrku8og/image/upload/v1784122585/ChatGPT_Image_Jul_15_2026_07_06_14_PM_oe4oo8.png',
      accentLight: '#3CAEE0',
      accentDark: '#FCAB12',
    },
  },
  {
    needles: ['nitro advance', 'harbor view', 'woodmere'],
    branding: DEFAULT_FUNDER_EMAIL_BRANDING,
  },
];

function normalize(value?: string | null): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function legacyBranding(funder: FunderEmailBrandingSource): FunderEmailBranding {
  const tokens = [funder.name, funder.displayName].map(normalize).filter(Boolean);
  const match = LEGACY_FUNDER_BRANDING.find(({ needles }) =>
    needles.some((needle) => tokens.some((token) => token.includes(needle))),
  );
  if (match) return match.branding;
  return {
    ...DEFAULT_FUNDER_EMAIL_BRANDING,
    companyName:
      String(funder.displayName || funder.name || '').trim() || DEFAULT_FUNDER_EMAIL_BRANDING.companyName,
  };
}

export function resolveFunderEmailBranding(
  funder?: FunderEmailBrandingSource | null,
): FunderEmailBranding {
  if (!funder) return DEFAULT_FUNDER_EMAIL_BRANDING;
  const fallback = legacyBranding(funder);
  const saved = (value?: string | null) => String(value ?? '').trim();
  return {
    companyName: saved(funder.letterCompanyName) || fallback.companyName,
    logoSrc: saved(funder.letterLogoUrl) || fallback.logoSrc,
    accentLight: saved(funder.letterAccentStripLight) || fallback.accentLight,
    accentDark: saved(funder.letterAccentStripDark) || fallback.accentDark,
  };
}
