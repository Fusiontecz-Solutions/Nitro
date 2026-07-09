import { isTexasFundingGroupFunderProfile } from "@/hooks/useFunderProfiles";

export const FUNDER_DOCUMENTS_SOURCES = ["platform", "own", "shared"] as const;
export type FunderDocumentsSource = (typeof FUNDER_DOCUMENTS_SOURCES)[number];

export function normalizeFunderDocumentsSource(
  value?: string | null,
): FunderDocumentsSource {
  const token = String(value ?? "")
    .trim()
    .toLowerCase();
  if (token === "platform" || token === "shared") return token;
  return "own";
}

export function resolveDocumentsLayoutFunderId(profile: {
  id: string;
  name?: string | null;
  displayName?: string | null;
  mainContractLayoutKey?: string | null;
  organization?: string | null;
  legalName?: string | null;
  contactEmail?: string | null;
  documentsSource?: string | null;
  sharedDocumentsFunderId?: string | null;
}): string | null {
  const source = normalizeFunderDocumentsSource(profile.documentsSource);
  if (isTexasFundingGroupFunderProfile(profile)) {
    if (source === "shared") {
      const sharedId = String(profile.sharedDocumentsFunderId || "").trim();
      return sharedId || profile.id;
    }
    return profile.id;
  }
  if (source === "platform") return null;
  if (source === "shared") {
    const sharedId = String(profile.sharedDocumentsFunderId || "").trim();
    return sharedId || profile.id;
  }
  return profile.id;
}

export function canManageFunderDocuments(profile: {
  id: string;
  documentsSource?: string | null;
  sharedDocumentsFunderId?: string | null;
}): boolean {
  const source = normalizeFunderDocumentsSource(profile.documentsSource);
  if (source === "platform") return false;
  const layoutFunderId = resolveDocumentsLayoutFunderId(profile);
  return layoutFunderId === profile.id;
}

export const FUNDER_DOCUMENTS_SOURCE_OPTIONS = [
  {
    value: "platform" as const,
    label: "Platform defaults",
    description:
      "Use the addendums and disclosures already set up for Woodmere Financial (shared platform documents).",
  },
  {
    value: "own" as const,
    label: "This funder only",
    description: "Upload addendums and disclosures just for this funder.",
  },
  {
    value: "shared" as const,
    label: "Same as another funder",
    description:
      "Reuse another funder's addendums and disclosures (e.g. multiple funders share one document set).",
  },
] as const;
