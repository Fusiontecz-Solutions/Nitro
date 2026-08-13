import { axiosGet } from "@/redux/axios";
import { isCloudinaryPdfUrl, isCloudinaryRawPdfUrl } from "@/utils/cloudinaryPdfUrl";

/** BoldSign / DocuSign template row shape from `GET /contract/templates`. */
export type BoldSignTemplateRow = {
    id?: string | null;
    name?: string | null;
    type?: string | null;
    templateId?: string | null;
    template_id?: string | null;
    pdfUrl?: string | null;
    pdf_url?: string | null;
    layoutKey?: string | null;
};

/** Authenticated proxy — direct `res.cloudinary.com` fetches often 401 in the browser. */
async function fetchTemplatePdfViaInlinePreview(
    pdfUrl: string,
    name = "document.pdf",
): Promise<Blob> {
    const response = await axiosGet("/uploads/inline-preview", {
        params: { url: pdfUrl, name, mimeType: "application/pdf" },
        responseType: "blob",
    });
    const rawBlob =
        response.data instanceof Blob
            ? response.data
            : new Blob([response.data as BlobPart], { type: "application/pdf" });
    if (rawBlob.type && rawBlob.type.includes("json")) {
        const text = await rawBlob.text();
        let message = "Failed to load template PDF.";
        try {
            message = String(JSON.parse(text)?.message || message);
        } catch {
            /* keep default */
        }
        throw new Error(message);
    }
    return new Blob([rawBlob], { type: "application/pdf" });
}

export function getBoldSignTemplatePdfUrl(
    template: BoldSignTemplateRow | null | undefined,
): string {
    return String(template?.pdfUrl || template?.pdf_url || "").trim();
}

export function getBoldSignTemplateDocuSignId(
    template: BoldSignTemplateRow | null | undefined,
): string {
    return String(template?.templateId || template?.template_id || "").trim();
}

/** Stable ref for mappings / dropdown (`bs:<ref>`) — prefers row id, then DocuSign template id. */
export function getBoldSignTemplateMappingRef(
    template: BoldSignTemplateRow | null | undefined,
): string {
    return String(template?.id || getBoldSignTemplateDocuSignId(template) || "").trim();
}

/**
 * Dropdown / send ref for addenda — prefer layoutKey so platform Case Takeover
 * stays selected after mapping create (UUID row id ≠ synthetic layout-key option).
 */
export function getAddendumDropdownRef(
    template: BoldSignTemplateRow | null | undefined,
): string {
    let layoutKey = String(template?.layoutKey || "").trim();
    if (
        layoutKey === "case_takeover_balance_transfer" ||
        layoutKey.endsWith("_case_takeover_balance_transfer")
    ) {
        layoutKey = layoutKey.replace(
            /case_takeover_balance_transfer$/,
            "case_takeover_addendum",
        );
    }
    if (layoutKey) return layoutKey;
    return getBoldSignTemplateMappingRef(template);
}

export function boldSignTemplateIsPreviewable(
    template: BoldSignTemplateRow | null | undefined,
): boolean {
    const pdfUrl = getBoldSignTemplatePdfUrl(template);
    if (pdfUrl) return true;
    if (getBoldSignTemplateDocuSignId(template)) return true;
    const layoutKey = String(template?.layoutKey || "").trim();
    return Boolean(layoutKey);
}

export async function loadBoldSignTemplatePdfBlob(options: {
    template?: BoldSignTemplateRow | null;
    axiosGet: (
        url: string,
        config?: { responseType?: "blob"; params?: Record<string, string> },
    ) => Promise<{ data?: unknown }>;
    funderName?: string | null;
    funderProfileId?: string | null;
    state?: string | null;
}): Promise<Blob> {
    const pdfUrl = getBoldSignTemplatePdfUrl(options.template);
    const layoutKey = String(options.template?.layoutKey || "").trim();

    const templateName =
        String(options.template?.name || "").trim() || "document.pdf";

    // Prefer the uploaded Cloudinary PDF via authenticated proxy (direct fetch → 401).
    if (pdfUrl && !pdfUrl.startsWith("platform://")) {
        const useProxy =
            isCloudinaryPdfUrl(pdfUrl, templateName) ||
            isCloudinaryRawPdfUrl(pdfUrl) ||
            /res\.cloudinary\.com/i.test(pdfUrl);
        if (useProxy) {
            try {
                return await fetchTemplatePdfViaInlinePreview(pdfUrl, templateName);
            } catch (proxyErr) {
                // Fall through to DocuSign/layout download when proxy fails.
                const proxyMessage =
                    proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
                try {
                    return await downloadTemplatePdfByRef(options, layoutKey, proxyMessage);
                } catch {
                    throw new Error(
                        `Could not load PDF from Cloudinary: ${proxyMessage}`,
                    );
                }
            }
        }
        try {
            const response = await fetch(pdfUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch PDF (${response.status})`);
            }
            return await response.blob();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(`Could not load PDF from Cloudinary: ${message}`);
        }
    }

    return downloadTemplatePdfByRef(options, layoutKey);
}

async function downloadTemplatePdfByRef(
    options: {
        template?: BoldSignTemplateRow | null;
        axiosGet: (
            url: string,
            config?: { responseType?: "blob"; params?: Record<string, string> },
        ) => Promise<{ data?: unknown }>;
        funderName?: string | null;
        funderProfileId?: string | null;
        state?: string | null;
    },
    layoutKey: string,
    _priorError?: string,
): Promise<Blob> {
    const templateId = getBoldSignTemplateDocuSignId(options.template);
    const downloadRef =
        layoutKey ||
        templateId ||
        getAddendumDropdownRef(options.template) ||
        getBoldSignTemplateMappingRef(options.template);
    if (!downloadRef) {
        throw new Error(
            "This template has no PDF URL or DocuSign template id.",
        );
    }

    const params: Record<string, string> = {};
    const funderName = String(options.funderName || "").trim();
    const funderProfileId = String(options.funderProfileId || "").trim();
    const state = String(options.state || "").trim();
    if (funderName) params.funderName = funderName;
    if (funderProfileId) params.funderProfileId = funderProfileId;
    if (state) params.state = state;

    try {
        const response = await options.axiosGet(
            `/docusign/template/${encodeURIComponent(downloadRef)}/download`,
            { responseType: "blob", params },
        );
        const data = response?.data;
        if (data instanceof Blob) {
            // Axios often returns JSON error bodies as Blob when responseType is blob.
            if (data.type && data.type.includes("json")) {
                const text = await data.text();
                let message = "Failed to load template PDF.";
                try {
                    message = String(JSON.parse(text)?.message || message);
                } catch {
                    /* keep default */
                }
                throw new Error(message);
            }
            return data;
        }
        return new Blob([data as BlobPart], { type: "application/pdf" });
    } catch (err: unknown) {
        const ax = err as {
            response?: { data?: Blob | { message?: string }; status?: number };
            message?: string;
        };
        if (ax?.response?.data instanceof Blob) {
            try {
                const text = await ax.response.data.text();
                const parsed = JSON.parse(text) as { message?: string };
                if (parsed?.message) throw new Error(parsed.message);
            } catch (inner) {
                if (inner instanceof Error && inner.message !== "Failed to load template PDF.") {
                    throw inner;
                }
            }
        }
        const msg =
            (typeof ax?.response?.data === "object" &&
                ax.response.data &&
                !(ax.response.data instanceof Blob) &&
                String((ax.response.data as { message?: string }).message || "").trim()) ||
            String(ax?.message || "").trim() ||
            "Failed to load template PDF.";
        throw new Error(msg);
    }
}
