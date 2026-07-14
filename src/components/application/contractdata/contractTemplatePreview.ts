import { axiosGet } from "@/redux/axios";
import {
    isTexasFundingGroupFunderProfile,
    persistedFunderProfileIdForApi,
} from "@/hooks/useFunderProfiles";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import { resolvePdfViewUrl } from "@/utils/cloudinaryPdfUrl";
import { PLATFORM_LAYOUT_KEYS } from "./platformDocumentConfig";

export type MainContractTemplatePreview = {
    url: string;
    name: string;
    layoutKey: string;
    source: "contract-templates" | "crm-pdf-url" | "docusign-download" | "fallback";
};

function isFunderOwnedContractLayout(layoutKey: string, profile?: FunderProfile): boolean {
    const key = String(layoutKey || "").trim();
    if (key.startsWith("funder_")) return true;
    if (key === PLATFORM_LAYOUT_KEYS.texasFundingGroupContract) return true;
    if (profile && isTexasFundingGroupFunderProfile(profile)) return true;
    const profileKey = String(profile?.mainContractLayoutKey ?? "").trim();
    if (profileKey.startsWith("funder_")) return true;
    if (profileKey && profileKey !== PLATFORM_LAYOUT_KEYS.contract) return true;
    return false;
}

async function fetchCrmTemplatePdfByLayoutKey(
    layoutKey: string,
    previewName: string,
): Promise<MainContractTemplatePreview | null> {
    const key = String(layoutKey || "").trim();
    if (!key) return null;
    try {
        const res = await axiosGet("/contract/templates", {
            params: { type: "contract" },
        });
        const rows = (
            (res as { data?: { data?: unknown } })?.data?.data ??
            (res as { data?: unknown })?.data ??
            []
        ) as Array<{
            layoutKey?: string;
            templateId?: string;
            pdfUrl?: string;
            name?: string;
            originalFileName?: string;
        }>;
        if (!Array.isArray(rows)) return null;
        const match = rows.find(
            (row) =>
                String(row.layoutKey || "").trim() === key ||
                String(row.templateId || "").trim() === key,
        );
        const pdfUrl = String(match?.pdfUrl || "").trim();
        if (!pdfUrl || !/^https?:\/\//i.test(pdfUrl)) return null;
        const name =
            String(match?.originalFileName || match?.name || "").trim() || previewName;
        const viewUrl = await resolvePdfViewUrl(pdfUrl, name);
        return {
            url: viewUrl,
            name,
            layoutKey: key,
            source: "crm-pdf-url",
        };
    } catch {
        return null;
    }
}

export async function fetchMainContractTemplatePreview(options: {
    funderName?: string | null;
    funderProfileId?: string | null;
    state?: string | null;
    layoutKey: string;
    previewName: string;
    fallbackUrl?: string | null;
    fallbackName?: string | null;
    funders?: FunderProfile[];
    findFunder?: (name?: string | null) => FunderProfile | undefined;
    findFunderById?: (id?: string | null) => FunderProfile | undefined;
}): Promise<MainContractTemplatePreview | null> {
    const layoutKey = String(options.layoutKey || "").trim() || PLATFORM_LAYOUT_KEYS.contract;
    const funderName = String(options.funderName ?? "").trim();
    const state = String(options.state ?? "").trim() || undefined;
    const funderProfileId = String(options.funderProfileId ?? "").trim();
    const profile =
        options.findFunderById?.(funderProfileId) ?? options.findFunder?.(funderName);
    const persistedProfileId =
        funderProfileId && !funderProfileId.startsWith("fallback-")
            ? funderProfileId
            : persistedFunderProfileIdForApi(profile);
    const funderOwnedLayout = isFunderOwnedContractLayout(layoutKey, profile);
    const usePlatformContractTemplateLatest =
        layoutKey === PLATFORM_LAYOUT_KEYS.contract && !funderOwnedLayout;

    if (usePlatformContractTemplateLatest) {
        try {
            const res = await axiosGet("/contract-templates/latest", {
                params: {
                    layoutKey,
                    ...(funderName ? { funderName } : {}),
                    ...(state ? { state } : {}),
                },
            });
            const data = (res as { data?: { data?: { url?: string; originalName?: string } } })
                ?.data?.data;
            if (data?.url) {
                const viewUrl = await resolvePdfViewUrl(
                    data.url,
                    data.originalName || options.previewName,
                );
                return {
                    url: viewUrl,
                    name: data.originalName || options.previewName,
                    layoutKey,
                    source: "contract-templates",
                };
            }
        } catch {
            /* try CRM layout download / fallback */
        }
    }

    // Prefer CRM BoldSignTemplate.pdfUrl (Cloudinary) — works for funder_* layout keys.
    const crmPreview = await fetchCrmTemplatePdfByLayoutKey(layoutKey, options.previewName);
    if (crmPreview?.url) return crmPreview;

    try {
        const response = await axiosGet(
            `/docusign/template/${encodeURIComponent(layoutKey)}/download`,
            {
                responseType: "blob",
                params: {
                    ...(funderName ? { funderName } : {}),
                    ...(persistedProfileId ? { funderProfileId: persistedProfileId } : {}),
                    ...(state ? { state } : {}),
                },
            },
        );
        const blob =
            response?.data instanceof Blob
                ? response.data
                : new Blob([response?.data], { type: "application/pdf" });
        if (blob.size > 0 && blob.type !== "application/json") {
            return {
                url: URL.createObjectURL(blob),
                name: options.previewName,
                layoutKey,
                source: "docusign-download",
            };
        }
    } catch {
        /* fall through */
    }

    const fallbackUrl = String(options.fallbackUrl ?? "").trim();
    // Never fall back to the global Woodmere template when this funder has its own contract PDF.
    if (fallbackUrl && !funderOwnedLayout) {
        const viewUrl = await resolvePdfViewUrl(
            fallbackUrl,
            options.fallbackName || options.previewName,
        );
        return {
            url: viewUrl,
            name: options.fallbackName || options.previewName,
            layoutKey,
            source: "fallback",
        };
    }

    return null;
}
