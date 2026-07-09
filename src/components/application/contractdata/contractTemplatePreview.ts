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
    source: "contract-templates" | "docusign-download" | "fallback";
};

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
    const profileLayoutKey = String(profile?.mainContractLayoutKey ?? "").trim();
    const funderSpecificLayout =
        Boolean(profile && isTexasFundingGroupFunderProfile(profile)) ||
        Boolean(profile?.contractPdfFileName) ||
        (profileLayoutKey && profileLayoutKey !== PLATFORM_LAYOUT_KEYS.contract) ||
        layoutKey === PLATFORM_LAYOUT_KEYS.texasFundingGroupContract ||
        layoutKey.startsWith("funder_");
    const useGlobalContractTemplateLatest =
        layoutKey === PLATFORM_LAYOUT_KEYS.contract &&
        !funderSpecificLayout &&
        !funderName;

    if (useGlobalContractTemplateLatest) {
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
            /* try platform layout / CRM template download */
        }
    }

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
        if (blob.size > 0) {
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
    if (fallbackUrl && !funderSpecificLayout) {
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
