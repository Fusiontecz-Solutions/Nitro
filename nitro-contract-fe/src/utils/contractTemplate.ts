import { axiosGet } from "@/redux/axios";
import { isPreferredCapitalBranding } from "@/components/application/contractdata/contractTemplatePreview";

export type LatestContractTemplate = {
    url: string;
    originalName: string;
};

const STORAGE_KEY = "globalContractTemplate";

/** Load the latest uploaded contract template URL (API first, then localStorage fallback). */
export async function fetchLatestContractTemplate(): Promise<LatestContractTemplate | null> {
    try {
        const response = await axiosGet("/contract-templates/latest");
        const data = response.data?.data;
        if (
            data?.url &&
            !isPreferredCapitalBranding(data.originalName) &&
            !isPreferredCapitalBranding(data.url)
        ) {
            const template: LatestContractTemplate = {
                url: String(data.url),
                originalName: String(data.originalName || "Contract.pdf"),
            };
            if (typeof window !== "undefined") {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(template));
            }
            return template;
        }
    } catch {
        /* fall through to cached copy */
    }

    if (typeof window === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as { url?: unknown; originalName?: unknown };
        if (!parsed?.url) return null;
        if (
            isPreferredCapitalBranding(parsed.originalName) ||
            isPreferredCapitalBranding(parsed.url)
        ) {
            return null;
        }
        return {
            url: String(parsed.url),
            originalName: String(parsed.originalName || "Contract.pdf"),
        };
    } catch {
        return null;
    }
}
