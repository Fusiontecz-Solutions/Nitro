import { axiosGet } from "@/redux/axios";
import { isAllianceFunderProfile, persistedFunderProfileIdForApi } from "@/hooks/useFunderProfiles";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
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
}): Promise<MainContractTemplatePreview | null> {
    const layoutKey = String(options.layoutKey || "").trim() || PLATFORM_LAYOUT_KEYS.contract;
    const funderName = String(options.funderName ?? "").trim();
    const state = String(options.state ?? "").trim() || undefined;
    const funderProfileId = String(options.funderProfileId ?? "").trim();
    const profile = options.findFunder?.(funderName);
    const persistedProfileId =
        funderProfileId && !funderProfileId.startsWith("fallback-")
            ? funderProfileId
            : persistedFunderProfileIdForApi(profile);
    const allianceFunder =
        Boolean(profile && isAllianceFunderProfile(profile)) ||
        layoutKey === PLATFORM_LAYOUT_KEYS.allianceBridgeContract;

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
            return {
                url: data.url,
                name: data.originalName || options.previewName,
                layoutKey,
                source: "contract-templates",
            };
        }
    } catch {
        /* try DocuSign template download */
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
    if (fallbackUrl && (!allianceFunder || layoutKey === PLATFORM_LAYOUT_KEYS.contract)) {
        return {
            url: fallbackUrl,
            name: options.fallbackName || options.previewName,
            layoutKey,
            source: "fallback",
        };
    }

    return null;
}
