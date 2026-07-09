import { axiosGet } from "@/redux/axios";

/** Cloudinary raw uploads are served as octet-stream; PDF viewers need application/pdf. */
export function isCloudinaryRawPdfUrl(url: string): boolean {
    const u = String(url || "").trim();
    if (!u) return false;
    return (
        /res\.cloudinary\.com\/[^/]+\/raw\/upload\//i.test(u) &&
        /\.pdf($|[?#])/i.test(u)
    );
}

export async function fetchCloudinaryPdfBlobUrl(
    url: string,
    name = "document.pdf",
): Promise<string> {
    const response = await axiosGet("/uploads/inline-preview", {
        params: { url, name },
        responseType: "blob",
    });
    const blob =
        response.data instanceof Blob
            ? response.data
            : new Blob([response.data], { type: "application/pdf" });
    return URL.createObjectURL(blob);
}

/** Resolve a stored Cloudinary URL for in-browser PDF viewing (react-pdf / iframe). */
export async function resolvePdfViewUrl(
    url: string,
    name = "document.pdf",
): Promise<string> {
    const trimmed = String(url || "").trim();
    if (!trimmed) return "";
    if (!isCloudinaryRawPdfUrl(trimmed)) return trimmed;
    return fetchCloudinaryPdfBlobUrl(trimmed, name);
}
