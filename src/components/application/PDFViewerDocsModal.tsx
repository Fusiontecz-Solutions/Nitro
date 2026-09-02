import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "react-toastify";
import { DocumentViewerPanel } from "@/components/documents/DocumentViewerPanel";
import { isPdfMimeOrName, resolveClientPreviewMime } from "@/lib/documentPreview";
import { cn } from "@/lib/utils";

interface PDFViewerDocsModalProps {
    isOpen: boolean;
    onClose: () => void;
    fileUrl: string | null | undefined;
    fileName?: string | null | undefined;
    showPrintButton?: boolean;
    onSendToBoldSign?: (ccEmails: string[]) => void;
    prefillFieldsPreview?: Array<{ id: string; label?: string; value: string }>;
    onSendToDocusign?: (ccEmails: string[]) => void;
    /** Use direct Cloudinary URLs (e.g. public portal without auth). */
    preferDirectUrl?: boolean;
    /** Public document portal token — fetches inline preview without CRM login. */
    publicPortalToken?: string;
    mimeTypeHint?: string;
    overlayClassName?: string;
    contentClassName?: string;
}

/** Print a same-origin / blob PDF without opening a popup window. */
function printPdfViaHiddenIframe(fileUrl: string): () => void {
    const existing = document.getElementById("nitro-pdf-print-frame");
    existing?.remove();

    const iframe = document.createElement("iframe");
    iframe.id = "nitro-pdf-print-frame";
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "Print document");
    // Keep a full viewport (hidden) — zero-size frames often print blank in Chromium.
    iframe.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;border:0;opacity:0;pointer-events:none;z-index:-1;";
    iframe.src = fileUrl;

    let cleaned = false;
    let printed = false;
    let loadFallbackTimer = 0;
    let removeFallbackTimer = 0;

    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        window.clearTimeout(loadFallbackTimer);
        window.clearTimeout(removeFallbackTimer);
        iframe.removeEventListener("load", onLoad);
        iframe.contentWindow?.removeEventListener("afterprint", cleanup);
        iframe.remove();
    };

    const triggerPrint = () => {
        if (cleaned || printed) return;
        printed = true;
        window.clearTimeout(loadFallbackTimer);
        try {
            const win = iframe.contentWindow;
            if (!win) {
                toast.error("Could not open print dialog.");
                cleanup();
                return;
            }
            win.focus();
            win.addEventListener("afterprint", cleanup);
            win.print();
            // Fallback if afterprint never fires (some Chromium PDF viewers).
            removeFallbackTimer = window.setTimeout(cleanup, 60_000);
        } catch {
            toast.error("Could not open print dialog.");
            cleanup();
        }
    };

    const onLoad = () => {
        // Give the browser PDF plugin a beat to attach before printing.
        window.setTimeout(triggerPrint, 250);
    };

    iframe.addEventListener("load", onLoad);
    document.body.appendChild(iframe);

    // If load never fires (rare), still attempt print once.
    loadFallbackTimer = window.setTimeout(triggerPrint, 1500);

    return cleanup;
}

const PDFViewerDocsModal = ({
    isOpen,
    onClose,
    fileUrl,
    fileName = "Document",
    showPrintButton = false,
    onSendToBoldSign,
    prefillFieldsPreview = [],
    onSendToDocusign,
    preferDirectUrl = false,
    publicPortalToken,
    mimeTypeHint,
    overlayClassName,
    contentClassName,
}: PDFViewerDocsModalProps) => {
    void onSendToBoldSign;
    void prefillFieldsPreview;
    void onSendToDocusign;

    const printCleanupRef = useRef<(() => void) | null>(null);

    const safeUrl = typeof fileUrl === "string" ? fileUrl.trim() : "";
    const isValidUrl = safeUrl !== "";
    const safeFileName =
        typeof fileName === "string" && fileName.trim() !== ""
            ? fileName.trim()
            : "Document Viewer";
    const mimeType = resolveClientPreviewMime(safeFileName, safeUrl, "", undefined, mimeTypeHint ?? "");
    const canPrint = showPrintButton && isPdfMimeOrName(mimeType, safeFileName);

    useEffect(() => {
        if (isOpen) return;
        printCleanupRef.current?.();
        printCleanupRef.current = null;
    }, [isOpen]);

    useEffect(
        () => () => {
            printCleanupRef.current?.();
            printCleanupRef.current = null;
        },
        [],
    );

    const handlePrint = () => {
        if (!safeUrl) {
            toast.error("Document is not ready to print.");
            return;
        }
        printCleanupRef.current?.();
        printCleanupRef.current = printPdfViaHiddenIframe(safeUrl);
    };

    if (!isOpen || !isValidUrl) return null;

    return (
        <Dialog
            open={isOpen}
            onOpenChange={(open: boolean) => {
                if (!open) onClose();
            }}
        >
            <DialogContent
                className={cn("flex h-[95vh] max-w-5xl flex-col p-0", contentClassName)}
                overlayClassName={overlayClassName}
            >
                <DialogHeader className="flex-row items-center justify-between space-y-0 p-3 pb-0">
                    <DialogTitle className="truncate pr-2 text-black dark:text-white">
                        {safeFileName}
                    </DialogTitle>
                    {canPrint ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={handlePrint}
                            className="mr-8 h-8 w-8 shrink-0"
                            title="Print PDF"
                            aria-label="Print PDF"
                        >
                            <Printer className="h-4 w-4" aria-hidden />
                        </Button>
                    ) : null}
                </DialogHeader>

                <div className="relative m-3 min-h-0 flex-1 overflow-hidden">
                    <DocumentViewerPanel
                        fileUrl={safeUrl}
                        fileName={safeFileName}
                        className="h-full"
                        minHeightClassName="min-h-[calc(95vh-6rem)]"
                        preferDirectUrl={preferDirectUrl}
                        publicPortalToken={publicPortalToken}
                        mimeTypeHint={mimeTypeHint}
                    />
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PDFViewerDocsModal;
