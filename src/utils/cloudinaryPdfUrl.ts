import { axiosGet } from "@/redux/axios";
import { isCloudinaryAssetUrl } from "@/lib/documentPreview";

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

export function uint8ArrayLooksLikePdf(bytes: Uint8Array): boolean {
    if (!bytes || bytes.length < 5) return false;
    return (
        bytes[0] === PDF_MAGIC[0] &&
        bytes[1] === PDF_MAGIC[1] &&
        bytes[2] === PDF_MAGIC[2] &&
        bytes[3] === PDF_MAGIC[3]
    );
}

export async function blobHasPdfMagic(blob: Blob): Promise<boolean> {
    if (!blob || blob.size < 5) return false;
    const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    return uint8ArrayLooksLikePdf(header);
}

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
    if (String(rawBlob.type || "").toLowerCase().includes("json")) {
        throw new Error("Could not load this PDF for preview.");
    }
    // Force application/pdf — Cloudinary often returns octet-stream for raw/image PDFs.
    const blob = new Blob([rawBlob], { type: "application/pdf" });
    if (!(await blobHasPdfMagic(blob))) {
        throw new Error("The file is not a valid PDF.");
    }
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
    if (
        isCloudinaryPdfUrl(trimmed, name) ||
        isCloudinaryRawPdfUrl(trimmed) ||
        isCloudinaryAssetUrl(trimmed)
    ) {
        return fetchCloudinaryPdfBlobUrl(trimmed, name);
    }
    return trimmed;
}

/**
 * Copy PDF bytes into a same-origin `blob:` URL with `application/pdf`.
 * react-pdf cannot fetch Cloudinary (CORS) and fails if a parent blob was revoked.
 */
export async function loadPdfBlobUrlForViewer(
    url: string,
    name = "document.pdf",
): Promise<string> {
    const trimmed = String(url || "").trim();
    if (!trimmed) throw new Error("No PDF URL provided.");

    const resolved = await resolvePdfViewUrl(trimmed, name);
    if (!resolved) throw new Error("No PDF URL provided.");

    let sourceBlob: Blob;
    if (resolved.startsWith("blob:") || resolved.startsWith("data:")) {
        const res = await fetch(resolved);
        if (!res.ok) throw new Error("Could not read the PDF preview.");
        sourceBlob = await res.blob();
    } else if (isCloudinaryAssetUrl(resolved) || /res\.cloudinary\.com/i.test(resolved)) {
        const blobUrl = await fetchCloudinaryPdfBlobUrl(resolved, name);
        try {
            const res = await fetch(blobUrl);
            if (!res.ok) throw new Error("Could not read the PDF preview.");
            sourceBlob = await res.blob();
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    } else {
        const res = await fetch(resolved, { mode: "cors" });
        if (!res.ok) throw new Error(`Could not fetch PDF (${res.status})`);
        sourceBlob = await res.blob();
    }

    const bytes = new Uint8Array(await sourceBlob.arrayBuffer());
    if (!uint8ArrayLooksLikePdf(bytes)) {
        throw new Error("The file is not a valid PDF.");
    }
    return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}
