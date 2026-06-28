import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { CheckCircle2, Loader2, UploadCloud } from "lucide-react";
import { axiosGet, axiosPostFormData } from "@/redux/axios";
import { Button } from "@/components/ui/button";
import { documentRequestDisplayLabel, type DocumentRequestRow } from "@/constants/documentRequestTypes";
import { formatDateTimeUS, cn } from "@/lib/utils";
import { useTheme } from "@/context/ThemeContext";
import { resolveAppLogoSrc } from "@/constants/appLogo";
import { toast } from "react-toastify";

type PortalResponse = {
  success: boolean;
  data?: {
    application: {
      id: string;
      applicationId: number;
      clientName: string;
    };
    documents: DocumentRequestRow[];
    expiresAt: string | Date | null;
  };
  code?: string;
  message?: string;
  expiresAt?: string | Date | null;
};

const PublicDocumentRequestPage = () => {
  const { token } = useParams<{ token: string }>();
  const { resolvedTheme } = useTheme();
  const brandLogo = (
    <img
      src={resolveAppLogoSrc(resolvedTheme === "dark")}
      alt="Company logo"
      className="mx-auto h-28 w-auto max-w-full object-contain sm:h-32 md:h-40"
    />
  );

  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | Date | null>(null);
  const [application, setApplication] = useState<{
    id: string;
    applicationId: number;
    clientName: string;
  } | null>(null);
  const [documents, setDocuments] = useState<DocumentRequestRow[]>([]);
  const [uploadingSlug, setUploadingSlug] = useState<string | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadPortal = useCallback(async () => {
    if (!token) {
      setErrorCode("TOKEN_MISSING");
      setLoading(false);
      return;
    }

    try {
      const res = await axiosGet(`/public/application/${token}/document-request`);
      const body = res.data as PortalResponse;

      if (!body?.success || !body?.data) {
        setErrorCode(body?.code || "INVALID_TOKEN");
        setLoading(false);
        return;
      }

      setApplication(body.data.application);
      setDocuments(body.data.documents || []);
      setExpiresAt(body.data.expiresAt);
      setErrorCode(null);
      setLoading(false);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number; data?: PortalResponse } };
      const status = axiosErr?.response?.status;
      if (status === 410) {
        setErrorCode("TOKEN_EXPIRED");
        setExpiresAt(axiosErr?.response?.data?.expiresAt ?? null);
      } else {
        setErrorCode("TOKEN_INVALID");
      }
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);

  const handleUpload = async (doc: DocumentRequestRow, file: File) => {
    if (!token) return;

    const slug = doc.name;
    const allowed = ["pdf", "jpg", "jpeg", "png"];
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!allowed.includes(ext)) {
      toast.error("Please upload a PDF, JPG, or PNG.");
      return;
    }

    setUploadingSlug(slug);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("requestedDocumentSlug", slug);

      const res = await axiosPostFormData(
        `/public/application/${token}/document-request/upload`,
        formData,
      );
      const body = res.data as {
        success: boolean;
        data?: { documents?: DocumentRequestRow[] };
        message?: string;
      };

      if (!body?.success) {
        throw new Error(body?.message || "Upload failed.");
      }

      if (body.data?.documents) {
        setDocuments(body.data.documents);
      } else {
        await loadPortal();
      }

      toast.success(`${documentRequestDisplayLabel(doc)} uploaded.`);
    } catch (error: unknown) {
      const message =
        typeof error === "string"
          ? error
          : (error as { response?: { data?: { message?: string } }; message?: string })
                ?.response?.data?.message ||
            (error as { message?: string })?.message ||
            "Upload failed.";
      toast.error(message);
    } finally {
      setUploadingSlug(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-screen-md">
          <div className="mb-2 text-center">{brandLogo}</div>
          <div className="text-sm text-[#687182]">Loading document request…</div>
        </div>
      </div>
    );
  }

  if (errorCode) {
    return (
      <div className="min-h-screen bg-background p-4 md:p-6">
        <div className="mx-auto max-w-screen-md">
          <div className="mb-2 text-center">{brandLogo}</div>
          <div className="mt-4 rounded-md border border-[#E5E7EB] bg-white p-4 text-sm text-[#687182]">
            <div className="font-semibold text-[var(--brand)]">
              {errorCode === "TOKEN_EXPIRED" ? "Link expired" : "Link not available"}
            </div>
            {errorCode === "TOKEN_EXPIRED" && expiresAt ? (
              <div className="mt-1">This link expired on {formatDateTimeUS(expiresAt)}</div>
            ) : (
              <div className="mt-1">Please ask the sender for a new link.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const pendingCount = documents.filter((d) => d.status !== "Complete").length;
  const uploadableDocs = documents.filter(
    (d) => d.status !== "Complete" && d.name !== "Sent Back for Documentation",
  );

  return (
    <div className="min-h-screen bg-background px-3 py-3 md:px-5 md:py-4">
      <div className="mx-auto w-full max-w-screen-md rounded-lg bg-background">
        <div className="mb-4 text-center">
          <div
            className={cn(
              "rounded-md py-1 md:py-1",
              resolvedTheme === "dark" ? "bg-transparent" : "px-4",
            )}
          >
            {brandLogo}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Document Request
          </h1>
          {application ? (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Please upload the requested documents for{" "}
              <strong>{application.clientName}</strong> (Application #
              {application.applicationId}).
            </p>
          ) : null}

          {documents.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No document requests found for this link.</p>
          ) : (
            <>
              <div className="mt-4 flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                  Requested documents
                </p>
                {pendingCount > 0 ? (
                  <span className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                    {pendingCount} pending
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                    All received
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-2">
                {documents.map((doc, index) => {
                  const isReceived = doc.status === "Complete";
                  const label = documentRequestDisplayLabel(doc);
                  const isUploading = uploadingSlug === doc.name;
                  const canUpload =
                    !isReceived && doc.name !== "Sent Back for Documentation";

                  return (
                    <div
                      key={`${doc.name}-${index}`}
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2",
                        isReceived
                          ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20"
                          : "border-amber-200 bg-amber-50/80 dark:border-amber-900/40 dark:bg-amber-950/20",
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                          {label}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {isReceived ? "Received" : "Pending — upload required"}
                        </p>
                        {doc.message ? (
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {doc.message}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        {canUpload ? (
                          <>
                            <input
                              ref={(el) => {
                                fileInputRefs.current[doc.name] = el;
                              }}
                              type="file"
                              accept=".pdf,.jpg,.jpeg,.png"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                e.target.value = "";
                                if (file) void handleUpload(doc, file);
                              }}
                            />
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 gap-1 border-[var(--brand)]/30 px-2.5 text-xs text-[var(--brand)] hover:bg-[var(--brand)]/5"
                              disabled={isUploading}
                              onClick={() => fileInputRefs.current[doc.name]?.click()}
                            >
                              {isUploading ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <UploadCloud className="h-3.5 w-3.5" />
                              )}
                              Upload
                            </Button>
                          </>
                        ) : null}
                        {isReceived ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {uploadableDocs.length === 0 && pendingCount > 0 ? (
                <p className="mt-4 text-sm text-slate-500">
                  Contact your scrubbing if you need guidance on what to upload.
                </p>
              ) : null}
            </>
          )}

          <p className="mt-5 text-xs text-slate-500 dark:text-slate-400">
            Accepted formats: PDF, JPG, PNG.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PublicDocumentRequestPage;
