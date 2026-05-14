import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerDocsModalProps {
    isOpen: boolean;
    onClose: () => void;
    fileUrl: string | null | undefined; // Explicitly allow undefined
    fileName?: string | null | undefined; // Explicitly allow undefined
    layout?: "contract";
    onSendToBoldSign?: (ccEmails: string[]) => void;
    prefillFieldsPreview?: Array<{ id: string; label?: string; value: string }>;
    onSendToDocusign?: (ccEmails: string[]) => void;
}

function DirectPdfViewer({ fileUrl }: { fileUrl: string }) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pageWidth, setPageWidth] = useState(640);

    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => {
            const w = el.clientWidth;
            if (w > 0) setPageWidth(Math.max(280, w - 24));
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return (
        <div ref={wrapRef} className="absolute inset-0 overflow-y-auto overflow-x-hidden bg-slate-100">
            <Document
                file={fileUrl}
                onLoadSuccess={({ numPages: n }) => setNumPages(n)}
                loading={
                    <div className="flex min-h-[300px] items-center justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-slate-400" aria-hidden />
                    </div>
                }
                error={
                    <div className="flex min-h-[300px] items-center justify-center px-4 text-center text-xs text-slate-500">
                        Could not render this PDF. Please check that the PDF URL is reachable and allows browser access.
                    </div>
                }
                className="flex w-full flex-col items-center gap-3 py-3"
            >
                {numPages
                    ? Array.from({ length: numPages }, (_, i) => (
                        <Page
                            key={i + 1}
                            pageNumber={i + 1}
                            width={pageWidth}
                            className="bg-white shadow-md"
                            renderTextLayer
                            renderAnnotationLayer
                        />
                    ))
                    : null}
            </Document>
        </div>
    );
}

const PDFViewerDocsModal = ({
    isOpen,
    onClose,
    fileUrl,
    fileName = "Document",
    layout = "contract",
    onSendToBoldSign,
    prefillFieldsPreview = [],
    onSendToDocusign,
}: PDFViewerDocsModalProps) => {
    // Prevent linting errors for unused props
    void layout;
    void onSendToBoldSign;
    void prefillFieldsPreview;
    void onSendToDocusign;

    // --- PRODUCTION SAFETY CHECKS ---
    // 1. Strictly check that fileUrl is actually a string before doing anything
    const safeUrl = typeof fileUrl === "string" ? fileUrl.trim() : "";
    const isValidUrl = safeUrl !== "";

    // 2. Strictly check fileName to prevent React render crashes
    const safeFileName = typeof fileName === "string" && fileName.trim() !== "" 
        ? fileName.trim() 
        : "Document Viewer";

    // If the modal is closed or the URL is invalid/malformed, render NOTHING.
    // This prevents the encodeURI error entirely.
    if (!isOpen || !isValidUrl) return null;

    return (
        <Dialog
            open={isOpen}
            onOpenChange={(open: boolean) => {
                if (!open) onClose();
            }}
        >
            <DialogContent className="max-w-5xl h-[95vh] p-0 flex flex-col">
                <DialogHeader className="p-3 pb-0 flex items-center justify-between">
                    <DialogTitle className="text-black">
                        {safeFileName}
                    </DialogTitle>
                </DialogHeader>

                {/* PDF Viewer */}
                <div className="relative m-3 min-h-0 flex-1 overflow-hidden rounded-lg border bg-gray-50">
                    <DirectPdfViewer fileUrl={safeUrl} />
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default PDFViewerDocsModal;