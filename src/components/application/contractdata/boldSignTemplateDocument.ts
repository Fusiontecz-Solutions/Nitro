/** BoldSign / DocuSign template row shape from `GET /contract/templates`. */
export type BoldSignTemplateRow = {
    id?: string;
    name?: string;
    type?: string;
    templateId?: string;
    template_id?: string;
    pdfUrl?: string;
    pdf_url?: string;
    layoutKey?: string;
};

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

export function boldSignTemplateIsPreviewable(
    template: BoldSignTemplateRow | null | undefined,
): boolean {
    return Boolean(
        getBoldSignTemplatePdfUrl(template) || getBoldSignTemplateDocuSignId(template),
    );
}

export async function loadBoldSignTemplatePdfBlob(options: {
    template?: BoldSignTemplateRow | null;
    axiosGet: (
        url: string,
        config?: { responseType?: "blob" },
    ) => Promise<{ data?: unknown }>;
}): Promise<Blob> {
    const pdfUrl = getBoldSignTemplatePdfUrl(options.template);
    if (pdfUrl) {
        try {
            const response = await fetch(pdfUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch PDF (${response.status})`);
            }
            return await response.blob();
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new Error(
                `Could not load PDF from Cloudinary: ${message}`,
            );
        }
    }

    const templateId = getBoldSignTemplateDocuSignId(options.template);
    if (!templateId) {
        throw new Error(
            "This template has no PDF URL or DocuSign template id.",
        );
    }

    const response = await options.axiosGet(
        `/docusign/template/${encodeURIComponent(templateId)}/download`,
        { responseType: "blob" },
    );
    return response?.data instanceof Blob
        ? response.data
        : new Blob([response?.data as BlobPart], { type: "application/pdf" });
}
