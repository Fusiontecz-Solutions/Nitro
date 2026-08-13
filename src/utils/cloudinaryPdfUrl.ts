import { axiosGet } from "@/redux/axios";
import { isCloudinaryAssetUrl } from "@/lib/documentPreview";

/** Cloudinary raw uploads are served as octet-stream; PDF viewers need application/pdf. */
export function isCloudinaryRawPdfUrl(url: string): boolean {
    const u = String(url || "").trim();
    if (!u) return false;
    return (
        /res\.cloudinary\.com\/[^/]+\/raw\/upload\//i.test(u) &&
        /\.pdf($|[?#])/i.test(u)
    );
}

/**
 * Contract PDFs are stored as Cloudinary `image` (preferred) or legacy `raw`.
 * Both need the authenticated `/uploads/inline-preview` proxy for react-pdf.
 */
export function isCloudinaryPdfUrl(url: string, name = ""): boolean {
    const u = String(url || "").trim();
    if (!u || !isCloudinaryAssetUrl(u)) return false;
    if (/\.pdf($|[?#])/i.test(u)) return true;
    if (/\.pdf$/i.test(String(name || "").trim())) return true;
    // Funder contract uploads use image/upload + format=pdf; path may omit .pdf.
    return /\/(image|raw)\/upload\//i.test(u) && !/\.(png|jpe?g|gif|webp|bmp|svg)($|[?#])/i.test(u);
}

export async function fetchCloudinaryPdfBlobUrl(
    url: string,
    name = "document.pdf",
): Promise<string> {
    const response = await axiosGet("/uploads/inline-preview", {
        params: { url, name, mimeType: "application/pdf" },
        responseType: "blob",
    });
    const rawBlob =
        response.data instanceof Blob
            ? response.data
            : new Blob([response.data], { type: "application/pdf" });
    // Force application/pdf — Cloudinary often returns octet-stream for raw/image PDFs.
    const blob = new Blob([rawBlob], { type: "application/pdf" });
    return URL.createObjectURL(blob);
}

/** Resolve a stored Cloudinary URL for in-browser PDF viewing (react-pdf / iframe). */
export async function resolvePdfViewUrl(
    url: string,
    name = "document.pdf",
): Promise<string> {
    const trimmed = String(url || "").trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) return trimmed;
    // Proxy all Cloudinary PDF deliveries (image + raw). Direct res.cloudinary.com
    // fetches fail in react-pdf (CORS / content-type), which shows the "Could not render" error.
    if (isCloudinaryPdfUrl(trimmed, name) || isCloudinaryRawPdfUrl(trimmed)) {
        return fetchCloudinaryPdfBlobUrl(trimmed, name);
    }
    return trimmed;
}
