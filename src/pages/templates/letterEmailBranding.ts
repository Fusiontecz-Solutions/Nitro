import { APP_COMPANY_NAME } from "@/constants/appBranding";
import { findFunderProfileById } from "@/hooks/useFunderProfiles";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import {
  APPLICATION_APPROVAL_EMAIL_LOGO_SRC,
  APPLICATION_APPROVAL_EMAIL_WATERMARK_SRC,
} from "./applicationApprovalEmailShared";

export type LetterEmailBranding = {
  companyName: string;
  logoSrc: string;
  watermarkSrc: string;
  /** Lighter two-tone accent strip (Woodmere default: gray). */
  accentStripLight: string;
  /** Darker two-tone accent strip (Woodmere default: near-black). */
  accentStripDark: string;
  /** Background for branded info-table icon column. */
  infoTableIconBg: string;
};

/** Woodmere Financial — default letter email branding. */
export const DEFAULT_LETTER_EMAIL_BRANDING: LetterEmailBranding = {
  companyName: APP_COMPANY_NAME,
  logoSrc: APPLICATION_APPROVAL_EMAIL_LOGO_SRC,
  watermarkSrc: APPLICATION_APPROVAL_EMAIL_WATERMARK_SRC,
  accentStripLight: "#71717a",
  accentStripDark: "#18181b",
  infoTableIconBg: "#18181b",
};

/**
 * Paste Cloudinary / hosted logo URLs + colors for each funder below.
 * Matching uses funder name / displayName (not organization).
 */
const FB_FUNDING_LETTER_EMAIL_BRANDING: LetterEmailBranding = {
  companyName: "FB FUNDING LLC",
  logoSrc: "https://res.cloudinary.com/dehrku8og/image/upload/v1784056760/ChatGPT_Image_Jul_15_2026_12_49_02_AM_ldveap.png",
  watermarkSrc: "",
  accentStripLight: "#64748b",
  accentStripDark: "#0f172a",
  infoTableIconBg: "#0f172a",
};

const HEWLETT_ADVANCE_LETTER_EMAIL_BRANDING: LetterEmailBranding = {
  companyName: "HEWLETT ADVANCE LLC",
  logoSrc:
    "https://res.cloudinary.com/dehrku8og/image/upload/v1784054493/ChatGPT_Image_Jul_15_2026_12_09_17_AM_wnjjkm.png",
  watermarkSrc: "",
  accentStripLight: "#031707",
  accentStripDark: "#A9CD86",
  infoTableIconBg: "#9BBF85",
};

const TILDE_ADVANCE_LETTER_EMAIL_BRANDING: LetterEmailBranding = {
  companyName: "TILDE ADVANCE",
  logoSrc: "https://res.cloudinary.com/dehrku8og/image/upload/v1784054593/ChatGPT_Image_Jul_15_2026_12_12_46_AM_bkrtfo.png",
  watermarkSrc:"",
  accentStripLight: "#a1a1aa",
  accentStripDark: "#27272a",
  infoTableIconBg: "#27272a",
};

type FunderNameFields = Pick<FunderProfile, "name" | "displayName">;

function normalizeFunderToken(value?: string | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Prefer name / displayName only so organization≠Woodmere does not steal branding. */
function funderNameTokens(funder: FunderNameFields): string[] {
  return [funder.name, funder.displayName].map(normalizeFunderToken).filter(Boolean);
}

function nameMatches(funder: FunderNameFields, needles: string[]): boolean {
  const tokens = funderNameTokens(funder);
  return needles.some((needle) =>
    tokens.some((token) => token === needle || token.includes(needle)),
  );
}

function isWoodmereLetterFunder(funder: FunderNameFields): boolean {
  return nameMatches(funder, ["woodmere financial", "woodmere"]);
}

function isFbFundingFunder(funder: FunderNameFields): boolean {
  return nameMatches(funder, ["fb funding llc", "fb funding"]);
}

function isHewlettAdvanceFunder(funder: FunderNameFields): boolean {
  return nameMatches(funder, ["hewlett advance llc", "hewlett advance"]);
}

function isTildeAdvanceFunder(funder: FunderNameFields): boolean {
  return nameMatches(funder, ["tilde advance"]);
}

/** Resolve logo, watermark, and accent colors for payoff / zero-balance letter emails. */
export function resolveLetterEmailBranding(
  funder?: Pick<
    FunderProfile,
    | "name"
    | "displayName"
    | "organization"
    | "legalName"
    | "mainContractLayoutKey"
  > | null,
): LetterEmailBranding {
  if (!funder) return DEFAULT_LETTER_EMAIL_BRANDING;

  // Named funders first — never let a shared "Woodmere" organization override these.
  if (isFbFundingFunder(funder)) return FB_FUNDING_LETTER_EMAIL_BRANDING;
  if (isHewlettAdvanceFunder(funder)) return HEWLETT_ADVANCE_LETTER_EMAIL_BRANDING;
  if (isTildeAdvanceFunder(funder)) return TILDE_ADVANCE_LETTER_EMAIL_BRANDING;
  if (isWoodmereLetterFunder(funder)) return DEFAULT_LETTER_EMAIL_BRANDING;

  const companyName =
    String(funder.displayName || funder.name || APP_COMPANY_NAME).trim() ||
    APP_COMPANY_NAME;
  return {
    ...DEFAULT_LETTER_EMAIL_BRANDING,
    companyName,
  };
}

export function resolveLetterEmailBrandingByFunderId(
  funders: FunderProfile[],
  funderProfileId?: string | null,
): LetterEmailBranding {
  return resolveLetterEmailBranding(
    findFunderProfileById(funders, funderProfileId),
  );
}
