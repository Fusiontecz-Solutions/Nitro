import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "react-toastify";
import type { AppDispatch, RootState } from "@/redux/store";
import {
  BACKGROUND_CHECK_RESOURCES,
  resolveBackgroundCheckHref,
} from "@/config/externalLinks";
import BackgroundCheckItemCard from "@/components/application/BackgroundCheckItemCard";
import BackgroundCheckSidebar from "@/components/application/BackgroundCheckSidebar";
import DataMerchPanel from "@/components/application/DataMerchPanel";
import {
  backgroundCheckPdfFilename,
  defaultBackgroundCheckLogoUrl,
  downloadBackgroundCheckPdf,
  fetchBackgroundCheckPdfBlob,
  formatBackgroundCheckEin,
} from "@/components/application/backgroundCheckPdf";
import PDFViewerDocsModal from "@/components/application/PDFViewerDocsModal";
import type { BackgroundCheckFormState } from "@/components/application/backgroundCheckTypes";
import { normalizeBackgroundCheckStatus } from "@/components/application/backgroundCheckTypes";
import type { DataMerchLookupData } from "@/redux/actions/datamerch-actions";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import { resolveApplicationOfferAmount } from "@/lib/applicationLoanAmount";
import { formatCurrency } from "@/lib/utils";

const CHECK_IDS = BACKGROUND_CHECK_RESOURCES.map((r) => r.id);

function emptyChecks(): BackgroundCheckFormState {
  return Object.fromEntries(
    CHECK_IDS.map((id) => [id, { notes: "", status: undefined, optional: false }]),
  );
}

function normalizeCheckItem(
  item: BackgroundCheckFormState[string] | undefined,
): BackgroundCheckFormState[string] {
  if (!item) return { notes: "", optional: false };
  const legacy = item as BackgroundCheckFormState[string] & { notesSavedAt?: string };
  return {
    ...item,
    status: normalizeBackgroundCheckStatus(item.status),
    savedAt: item.savedAt ?? legacy.notesSavedAt,
  };
}

function buildDataMerchQueryKey(businessName: string, ein: string): string {
  const einDigits = ein.replace(/\D/g, "");
  return `${einDigits}|${businessName.trim().toLowerCase()}`;
}

function loadPersistedState(applicationId: string): {
  checks: BackgroundCheckFormState;
  savedAt: string | null;
} | null {
  try {
    const raw = localStorage.getItem(`background-check:${applicationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      checks?: BackgroundCheckFormState;
      savedAt?: string;
      decision?: unknown;
    };
    const mergedChecks = { ...emptyChecks() };
    for (const id of CHECK_IDS) {
      mergedChecks[id] = normalizeCheckItem(parsed.checks?.[id]);
    }
    return {
      checks: mergedChecks,
      savedAt: parsed.savedAt ? String(parsed.savedAt) : null,
    };
  } catch {
    return null;
  }
}

function loadDataMerchForExport(
  applicationId: string,
  queryKey: string,
): { result: Omit<DataMerchLookupData, "raw">; searchedAt: string } | null {
  try {
    const raw = localStorage.getItem(`datamerch:${applicationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      queryKey?: string;
      searchedAt?: string;
      result?: Omit<DataMerchLookupData, "raw">;
    };
    if (parsed.queryKey !== queryKey || !parsed.result || !parsed.searchedAt) {
      return null;
    }
    return { result: parsed.result, searchedAt: parsed.searchedAt };
  } catch {
    return null;
  }
}

export default function BackgroundCheckTab() {
  const dispatch = useDispatch<AppDispatch>();
  const applicationData = useSelector(
    (state: RootState) => state.applicationDetail.data as Record<string, unknown> | null,
  );
  const { data: offerDecisionData } = useSelector(
    (state: RootState) => state.offerDecision,
  );
  const { data: termsOffers } = useSelector(
    (state: RootState) => state.termsOffers,
  );
  const loginUser = useSelector(
    (state: RootState) => state.login.data?.user as
      | { firstName?: string; lastName?: string }
      | undefined,
  );

  const applicationId = useMemo(
    () =>
      String(
        applicationData?._id ??
          applicationData?.id ??
          applicationData?.applicationId ??
          "",
      ).trim(),
    [applicationData],
  );

  const apiApplicationKey = useMemo(
    () =>
      String(
        applicationData?.applicationId ??
          applicationData?._id ??
          applicationId ??
          "",
      ).trim(),
    [applicationData, applicationId],
  );

  useEffect(() => {
    if (!apiApplicationKey) return;
    void dispatch(getOfferDecisionByApplication(apiApplicationKey));
    void dispatch(getTermsOffers({ application: apiApplicationKey }));
  }, [apiApplicationKey, dispatch]);

  const linkContext = useMemo(() => {
    const client = applicationData?.client as Record<string, unknown> | undefined;
    const business = client?.business as Record<string, unknown> | undefined;
    const businessName = String(
      business?.name ?? client?.businessName ?? applicationData?.businessName ?? "",
    ).trim();
    const ein = String(
      business?.einNumber ??
        business?.ein ??
        client?.businessEinNumber ??
        "",
    ).trim();
    const dealId = String(
      applicationData?.applicationId ??
        applicationData?.dealId ??
        applicationData?.id ??
        "",
    ).trim();
    const owner = client?.owner as Record<string, unknown> | undefined;
    const ownerName = `${owner?.firstName ?? ""} ${owner?.lastName ?? ""}`.trim();
    const ownerSsn = String(owner?.ssn ?? client?.ownerSsn ?? "").trim();
    const offerDecisionSource =
      offerDecisionData ??
      (applicationData?.OfferDecision as Record<string, unknown> | null | undefined) ??
      (applicationData?.offerDecision as Record<string, unknown> | null | undefined) ??
      null;
    const offerAmount = resolveApplicationOfferAmount(
      offerDecisionSource,
      termsOffers?.[0],
    );
    const offerAmountLabel =
      offerAmount != null && offerAmount > 0 ? formatCurrency(offerAmount) : "";
    return { businessName, ein, dealId, ownerName, ownerSsn, offerAmountLabel };
  }, [applicationData, offerDecisionData, termsOffers]);

  const savedByName = useMemo(() => {
    const name = `${loginUser?.firstName ?? ""} ${loginUser?.lastName ?? ""}`.trim();
    return name || "User";
  }, [loginUser]);

  const [checks, setChecks] = useState<BackgroundCheckFormState>(emptyChecks);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [viewingPdf, setViewingPdf] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewName, setPdfPreviewName] = useState("Compliance-Report.pdf");
  const [isPdfPreviewOpen, setIsPdfPreviewOpen] = useState(false);

  useEffect(() => {
    if (!applicationId) {
      setChecks(emptyChecks());
      setSavedAt(null);
      return;
    }
    const persisted = loadPersistedState(applicationId);
    if (persisted) {
      setChecks(persisted.checks);
      setSavedAt(persisted.savedAt);
      return;
    }
    setChecks(emptyChecks());
    setSavedAt(null);
  }, [applicationId]);

  useEffect(() => {
    if (!applicationId) return;
    localStorage.setItem(
      `background-check:${applicationId}`,
      JSON.stringify({ checks, savedAt: savedAt ?? undefined }),
    );
  }, [applicationId, checks, savedAt]);

  const requiredCheckIds = useMemo(
    () => CHECK_IDS.filter((id) => !checks[id]?.optional),
    [checks],
  );

  const updateCheck = useCallback(
    (id: string, patch: Partial<BackgroundCheckFormState[string]>) => {
      setChecks((prev) => ({
        ...prev,
        [id]: { ...prev[id], ...patch },
      }));
    },
    [],
  );

  const markCheckDirty = useCallback(
    (id: string, patch: Partial<BackgroundCheckFormState[string]>) => {
      updateCheck(id, { ...patch, savedAt: undefined });
      setSavedAt(null);
    },
    [updateCheck],
  );

  const saveCheck = useCallback(
    (id: string, extra?: Partial<BackgroundCheckFormState[string]>) => {
      updateCheck(id, {
        ...extra,
        savedAt: new Date().toISOString(),
      });
      setSavedAt(null);
    },
    [updateCheck],
  );

  const handleSaveAll = useCallback(() => {
    const now = new Date().toISOString();
    setSaving(true);
    setChecks((prev) => {
      const next = { ...prev };
      for (const id of CHECK_IDS) {
        next[id] = { ...next[id], savedAt: now };
      }
      return next;
    });
    setSavedAt(now);
    window.setTimeout(() => {
      setSaving(false);
      toast.success("Background check saved.");
    }, 150);
  }, []);

  const buildPdfInput = useCallback(() => {
    const datamerchQueryKey = buildDataMerchQueryKey(
      linkContext.businessName,
      linkContext.ein,
    );
    const datamerchExport = applicationId
      ? loadDataMerchForExport(applicationId, datamerchQueryKey)
      : null;

    return {
      logoUrl: defaultBackgroundCheckLogoUrl(),
      merchantName: linkContext.businessName,
      ownerName: linkContext.ownerName,
      ownerSsn: linkContext.ownerSsn,
      offerAmount: linkContext.offerAmountLabel,
      savedByName,
      ein: linkContext.ein,
      dealId: linkContext.dealId,
      checks,
      savedAt,
      datamerch: datamerchExport?.result ?? null,
      datamerchSearchedAt: datamerchExport?.searchedAt ?? null,
    };
  }, [applicationId, checks, linkContext, savedAt, savedByName]);

  const handleDownloadPdf = useCallback(async () => {
    setDownloadingPdf(true);
    try {
      await downloadBackgroundCheckPdf(buildPdfInput());
      toast.success("Background check PDF downloaded.");
    } catch {
      toast.error("Could not generate the background check PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  }, [buildPdfInput]);

  const handleViewPdf = useCallback(async () => {
    setViewingPdf(true);
    try {
      const blob = await fetchBackgroundCheckPdfBlob(buildPdfInput());
      const filename = backgroundCheckPdfFilename(linkContext.businessName);
      const url = URL.createObjectURL(blob);
      setPdfPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setPdfPreviewName(filename);
      setIsPdfPreviewOpen(true);
    } catch {
      toast.error("Could not generate the background check PDF.");
    } finally {
      setViewingPdf(false);
    }
  }, [buildPdfInput, linkContext.businessName]);

  const handleClosePdfPreview = useCallback(() => {
    setIsPdfPreviewOpen(false);
    setPdfPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPdfPreviewName("Compliance-Report.pdf");
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[#111827]">Background Check</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Due-diligence review required before contract.
          </p>
          <p className="mt-2 text-xs text-[#64748B]">
            {[
              linkContext.businessName || "Merchant",
              linkContext.ein
                ? `EIN ${formatBackgroundCheckEin(linkContext.ein)}`
                : null,
              linkContext.offerAmountLabel
                ? `Offer ${linkContext.offerAmountLabel}`
                : null,
              linkContext.ownerName ? `Owner ${linkContext.ownerName}` : null,
              linkContext.dealId ? `Deal ${linkContext.dealId}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {savedAt ? (
          <span className="rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
            Saved
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {BACKGROUND_CHECK_RESOURCES.map((resource) => {
            const state = checks[resource.id] ?? { notes: "", optional: false };
            const isDataMerch = resource.isApi === true;

            return (
              <BackgroundCheckItemCard
                key={resource.id}
                title={resource.title}
                description={resource.description}
                href={resolveBackgroundCheckHref(resource, linkContext)}
                notes={state.notes}
                noteImages={state.noteImages ?? []}
                status={state.status}
                risk={state.risk}
                optional={state.optional}
                attachmentName={state.attachmentName}
                attachmentUrl={state.attachmentUrl}
                attachmentPublicId={state.attachmentPublicId}
                savedAt={state.savedAt}
                onNotesChange={(notes) => markCheckDirty(resource.id, { notes })}
                onNoteImageAdd={(image) =>
                  markCheckDirty(resource.id, {
                    noteImages: [...(state.noteImages ?? []), image],
                  })
                }
                onNoteImageRemove={(imageId) =>
                  markCheckDirty(resource.id, {
                    noteImages: (state.noteImages ?? []).filter((image) => image.id !== imageId),
                  })
                }
                onSaveCheck={() => saveCheck(resource.id)}
                onLinkOpen={() =>
                  saveCheck(resource.id, { linkOpenedAt: new Date().toISOString() })
                }
                onStatusChange={(status) => markCheckDirty(resource.id, { status })}
                onRiskChange={(risk) => markCheckDirty(resource.id, { risk })}
                onOptionalToggle={() =>
                  markCheckDirty(resource.id, { optional: !state.optional })
                }
                onAttachmentSelect={(attachment) =>
                  markCheckDirty(resource.id, {
                    attachmentName: attachment.name,
                    attachmentUrl: attachment.url,
                    attachmentPublicId: attachment.publicId,
                  })
                }
                onAttachmentRemove={() =>
                  markCheckDirty(resource.id, {
                    attachmentName: undefined,
                    attachmentUrl: undefined,
                    attachmentPublicId: undefined,
                  })
                }
              >
                {isDataMerch ? <DataMerchPanel manualSearch embedded /> : null}
              </BackgroundCheckItemCard>
            );
          })}
        </div>

        <div className="w-full shrink-0 xl:w-[300px]">
          <BackgroundCheckSidebar
            merchantName={linkContext.businessName}
            checkIds={requiredCheckIds}
            checks={checks}
            savedAt={savedAt}
            saving={saving}
            downloadingPdf={downloadingPdf}
            viewingPdf={viewingPdf}
            onSaveAll={handleSaveAll}
            onDownloadPdf={handleDownloadPdf}
            onViewPdf={handleViewPdf}
          />
        </div>
      </div>

      <PDFViewerDocsModal
        isOpen={isPdfPreviewOpen}
        onClose={handleClosePdfPreview}
        fileUrl={pdfPreviewUrl}
        fileName={pdfPreviewName}
      />
    </div>
  );
}
