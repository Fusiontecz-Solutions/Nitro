import { axiosGet } from "@/redux/axios";
import {
    isTexasFundingGroupFunderProfile,
    persistedFunderProfileIdForApi,
} from "@/hooks/useFunderProfiles";
import type { FunderProfile } from "@/types/integrationSettingsTypes";
import { blobHasPdfMagic, resolvePdfViewUrl } from "@/utils/cloudinaryPdfUrl";
import { PLATFORM_LAYOUT_KEYS } from "./platformDocumentConfig";

export function isSignNowContractUiEnabled(): boolean {
    return String(import.meta.env.VITE_SIGNNOW_ENABLED || "").toLowerCase() === "true";
}

/** PCM / Preferred Capital Management leftovers — never show as the Nitro Advance contract. */
export function isPreferredCapitalBranding(value: unknown): boolean {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return false;
    const spaced = raw.replace(/[_-]+/g, " ");
    return (
        spaced.includes("preferred capital") ||
        spaced.includes("pcm contract") ||
        raw.includes("pcm_contract") ||
        raw.includes("preferredcapital")
    );
}

export const NITRO_ADVANCE_CONTRACT_PREVIEW_NAME = "Agreement - Nitro Advance.pdf";

export function sanitizeContractPreviewName(name?: string | null): string {
    const trimmed = String(name ?? "").trim();
    if (!trimmed || isPreferredCapitalBranding(trimmed)) {
        return NITRO_ADVANCE_CONTRACT_PREVIEW_NAME;
    }
    return trimmed;
}

export function isSignNowEnvelopeId(value: string | null | undefined): boolean {
    return /^[a-f0-9]{40}$/i.test(String(value || "").trim());
}

export const SIGNNOW_EMBEDDED_MESSAGE_SOURCE = "nitro-signnow-embedded";

export function signNowEmbeddedReturnUrl(): string {
    if (typeof window === "undefined") return "/embedded-complete";
    return `${window.location.origin}/embedded-complete`;
}

export function isSignNowEmbeddedCompleteMessage(data: unknown): boolean {
    if (!data || typeof data !== "object") return false;
    // Only a Finish counts: a Close or Decline of the review must not unlock Send.
    return (
        String((data as { source?: unknown }).source || "") === SIGNNOW_EMBEDDED_MESSAGE_SOURCE &&
        String((data as { event?: unknown }).event || "") === "complete"
    );
}

/** Bare SignNow editor URLs (need a SignNow login). Minted embedded-invite links are allowed. */
export function isSignNowLoginWebappUrl(value: string | null | undefined): boolean {
    const raw = String(value || "").trim();
    if (!raw) return false;
    try {
        const parsed = new URL(raw);
        if (!parsed.hostname.toLowerCase().includes("signnow.com")) return false;
        const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
        const isBareGroupEditor = /^\/webapp\/documentgroup\/[a-f0-9]{40}$/i.test(path);
        const isBareDocumentEditor = /^\/webapp\/document\/[a-f0-9]{40}$/i.test(path);
        return (isBareGroupEditor || isBareDocumentEditor) && !parsed.search && !parsed.hash;
    } catch {
        return false;
    }
}

function blobLooksLikePdf(blob: Blob): boolean {
    if (!blob || blob.size < 100) return false;
    const type = String(blob.type || "").toLowerCase();
    if (type.includes("json") || type.includes("html") || type.includes("text/")) return false;
    return true;
}

const SIGNNOW_AGREEMENT_CACHE_TTL_MS = 30 * 60 * 1000;
const cachedSignNowAgreementByKey = new Map<string, { blob: Blob; at: number }>();
const inflightSignNowAgreementByKey = new Map<
    string,
    Promise<{ url: string; name: string } | null>
>();
let lastSignNowAgreementError = "";

export function getLastSignNowAgreementError(): string {
    return lastSignNowAgreementError;
}

async function readBlobErrorMessage(blob: Blob): Promise<string> {
    try {
        const text = (await blob.text()).trim();
        if (!text) return "";
        try {
            const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
            return String(parsed?.message || parsed?.error || text).trim();
        } catch {
            return text.slice(0, 400);
        }
    } catch {
        return "";
    }
}

async function readAxiosErrorMessage(error: unknown): Promise<string> {
    const data = (error as { response?: { data?: unknown } })?.response?.data;
    if (typeof Blob !== "undefined" && data instanceof Blob) {
        return readBlobErrorMessage(data);
    }
    if (data && typeof data === "object") {
        const message = String(
            (data as { message?: unknown }).message ||
                (data as { error?: unknown }).error ||
                "",
        ).trim();
        if (message) return message;
    }
    return String((error as { message?: unknown })?.message || "").trim();
}

function signNowAgreementPreviewFromBlob(
    blob: Blob,
    previewName?: string | null,
): { url: string; name: string } {
    return {
        url: URL.createObjectURL(new Blob([blob], { type: "application/pdf" })),
        name:
            String(previewName || "").trim() ||
            NITRO_ADVANCE_CONTRACT_PREVIEW_NAME,
    };
}

/** Blank Agreement PDF from SignNow for a specific funder/template. */
export async function fetchSignNowAgreementPdf(options?: {
    funderProfileId?: string | null;
    signnowTemplateId?: string | null;
    previewName?: string | null;
}): Promise<{
    url: string;
    name: string;
} | null> {
    const funderProfileId = String(options?.funderProfileId ?? "").trim();
    const signnowTemplateId = String(options?.signnowTemplateId ?? "").trim();
    const previewName = String(options?.previewName ?? "").trim();
    if (!funderProfileId && !signnowTemplateId) {
        lastSignNowAgreementError = "";
    }
    const cacheKey = `${funderProfileId || "_"}:${signnowTemplateId || "_"}`;
    const now = Date.now();
    const cached = cachedSignNowAgreementByKey.get(cacheKey);
    if (cached && now - cached.at < SIGNNOW_AGREEMENT_CACHE_TTL_MS) {
        return signNowAgreementPreviewFromBlob(cached.blob, previewName);
    }
    const inflight = inflightSignNowAgreementByKey.get(cacheKey);
    if (inflight) return inflight;

    const pending = (async () => {
        try {
            const response = await axiosGet("/docusign/template/signnow-contract/download", {
                responseType: "blob",
                params: {
                    ...(funderProfileId ? { funderProfileId } : {}),
                    ...(signnowTemplateId ? { signnowTemplateId } : {}),
                },
            });
            const blob =
                response?.data instanceof Blob
                    ? response.data
                    : new Blob([response?.data], { type: "application/pdf" });
            if (!blobLooksLikePdf(blob) || !(await blobHasPdfMagic(blob))) {
                lastSignNowAgreementError =
                    (await readBlobErrorMessage(blob)) ||
                    "SignNow did not return the agreement PDF for this funder.";
                return null;
            }
            lastSignNowAgreementError = "";
            const pdfBlob = new Blob([blob], { type: "application/pdf" });
            cachedSignNowAgreementByKey.set(cacheKey, { blob: pdfBlob, at: Date.now() });
            return signNowAgreementPreviewFromBlob(
                pdfBlob,
                previewName ||
                    (funderProfileId
                        ? `Agreement.pdf`
                        : NITRO_ADVANCE_CONTRACT_PREVIEW_NAME),
            );
        } catch (error) {
            lastSignNowAgreementError =
                (await readAxiosErrorMessage(error)) ||
                "Could not load the agreement from SignNow for this funder.";
            console.error("Failed to fetch SignNow Agreement PDF:", lastSignNowAgreementError);
            return null;
        } finally {
            inflightSignNowAgreementByKey.delete(cacheKey);
        }
    })();

    inflightSignNowAgreementByKey.set(cacheKey, pending);
    return pending;
}

export type MainContractTemplatePreview = {
    url: string;
    name: string;
    layoutKey: string;
    source: "signnow" | "contract-templates" | "crm-pdf-url" | "docusign-download" | "fallback";
};

function isFunderOwnedContractLayout(layoutKey: string, profile?: FunderProfile): boolean {
    const key = String(layoutKey || "").trim();
    if (key.startsWith("funder_")) return true;
    if (key === "texas_funding_group_contract") return true;
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
                (String(row.layoutKey || "").trim() === key ||
                    String(row.templateId || "").trim() === key) &&
                !isPreferredCapitalBranding(row.name) &&
                !isPreferredCapitalBranding(row.originalFileName) &&
                !isPreferredCapitalBranding(row.pdfUrl),
        );
        const pdfUrl = String(match?.pdfUrl || "").trim();
        if (!pdfUrl || !/^https?:\/\//i.test(pdfUrl)) return null;
        const name = sanitizeContractPreviewName(
            String(match?.originalFileName || match?.name || "").trim() || previewName,
        );
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
    const usePlatformContract =
        layoutKey === PLATFORM_LAYOUT_KEYS.contract && !funderOwnedLayout;
    const useSignNowAgreement =
        isSignNowContractUiEnabled() &&
        !isTexasFundingGroupFunderProfile(profile ?? { name: funderName });

    // Live SignNow agreement: use the selected funder's link when present,
    // otherwise the platform document-group template (Create Contract pick is enough).
    if (useSignNowAgreement) {
        const funderContractTemplateId = String(
            profile?.signnowContractTemplateLink ?? "",
        ).trim();
        const previewName = funderName
            ? `Agreement - ${funderName}.pdf`
            : options.previewName || NITRO_ADVANCE_CONTRACT_PREVIEW_NAME;
        const signNow = await fetchSignNowAgreementPdf({
            funderProfileId: persistedProfileId || undefined,
            signnowTemplateId: funderContractTemplateId || undefined,
            previewName,
        });
        if (signNow?.url) {
            return {
                url: signNow.url,
                name: sanitizeContractPreviewName(signNow.name || previewName),
                layoutKey,
                source: "signnow",
            };
        }
        if (!lastSignNowAgreementError) {
            lastSignNowAgreementError = funderName
                ? `Could not load the agreement PDF for ${funderName}.`
                : "Could not load the agreement PDF.";
        }
        // SignNow is the live contract source — do not fall through to DocuSign REST.
        return null;
    }

    const usePlatformContractTemplateLatest = usePlatformContract;

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
            if (
                data?.url &&
                !isPreferredCapitalBranding(data.originalName) &&
                !isPreferredCapitalBranding(data.url)
            ) {
                const viewUrl = await resolvePdfViewUrl(
                    data.url,
                    data.originalName || options.previewName,
                );
                return {
                    url: viewUrl,
                    name: sanitizeContractPreviewName(
                        data.originalName || options.previewName,
                    ),
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

    if (!isSignNowContractUiEnabled()) {
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
            if (blob.size > 0 && blob.type !== "application/json" && (await blobHasPdfMagic(blob))) {
                return {
                    url: URL.createObjectURL(new Blob([blob], { type: "application/pdf" })),
                    name: sanitizeContractPreviewName(options.previewName),
                    layoutKey,
                    source: "docusign-download",
                };
            }
        } catch {
            /* fall through */
        }
    }

    const fallbackUrl = String(options.fallbackUrl ?? "").trim();
    const fallbackName = options.fallbackName || options.previewName;
    const fallbackIsPlaceholderBlob = fallbackUrl.startsWith("blob:");
    if (
        fallbackUrl &&
        !funderOwnedLayout &&
        !fallbackIsPlaceholderBlob &&
        !isPreferredCapitalBranding(fallbackName) &&
        !isPreferredCapitalBranding(fallbackUrl)
    ) {
        const viewUrl = await resolvePdfViewUrl(fallbackUrl, fallbackName);
        return {
            url: viewUrl,
            name: sanitizeContractPreviewName(fallbackName),
            layoutKey,
            source: "fallback",
        };
    }

    return null;
}
