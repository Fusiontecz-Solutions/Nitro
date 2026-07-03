import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ExternalLink, Loader2, Search } from "lucide-react";
import { useSelector } from "react-redux";
import { toast } from "react-toastify";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RootState } from "@/redux/store";
import { importOpenCorporatesForApplication } from "@/redux/actions/opencorporates-actions";
import {
  buildOpenCorporatesQueryKey,
  buildOpenCorporatesSearchUrl,
  formatOpenCorporatesSearchedAt,
  isOpenCorporatesImportMessage,
  isAllowedOpenCorporatesMessageOrigin,
  loadOpenCorporatesCache,
  saveOpenCorporatesCache,
  type OpenCorporatesCompanyHit,
  type OpenCorporatesLookupData,
} from "./opencorporatesTypes";
import { buildOpenCorporatesNotesHtml } from "./backgroundCheckNotesHtml";
import {
  handleCrmBridgeReturn,
  isCrmBridgeReturnMessage,
  resolveCrmBridgeOrigin,
} from "./crmBridgeTypes";
import { useCrmBridgeInbox } from "./useCrmBridgeInbox";

type OpenCorporatesPanelProps = {
  embedded?: boolean;
  onApplyToNotes?: (notes: string) => void;
};

type DealClientDetails = {
  businessName: string;
  state: string;
  dealId: string;
};

function extractDealClientDetails(
  applicationData: Record<string, unknown> | null,
): DealClientDetails {
  const client = applicationData?.client as Record<string, unknown> | undefined;
  const business = client?.business as Record<string, unknown> | undefined;
  const address = business?.address as Record<string, unknown> | undefined;

  return {
    businessName: String(
      business?.name ?? client?.businessName ?? applicationData?.businessName ?? "",
    ).trim(),
    state: String(address?.state ?? client?.state ?? "").trim(),
    dealId: String(
      applicationData?.applicationId ??
        applicationData?.dealId ??
        applicationData?.id ??
        applicationData?._id ??
        "",
    ).trim(),
  };
}

function OpenCorporatesClientSummary({
  client,
  className,
}: {
  client: DealClientDetails;
  className?: string;
}) {
  if (!client.businessName) {
    return (
      <p className={cn("text-[11px] text-[#6B7280]", className)}>
        Add a business name on this deal to search OpenCorporates.
      </p>
    );
  }

  const detailParts = [
    client.state ? `State ${client.state}` : null,
    client.dealId ? `Deal ${client.dealId}` : null,
  ].filter(Boolean);

  return (
    <p className={cn("min-w-0 text-[11px] leading-snug text-[#6B7280]", className)}>
      <span className="font-semibold text-[#111827]">{client.businessName}</span>
      {detailParts.length > 0 ? (
        <>
          {" "}
          <span className="text-[#D1D5DB]" aria-hidden>
            ·
          </span>{" "}
          {detailParts.join(" · ")}
        </>
      ) : null}
    </p>
  );
}

function OpenCorporatesCompanyCard({ company }: { company: OpenCorporatesCompanyHit }) {
  const location = [company.jurisdictionCode, company.companyNumber].filter(Boolean).join(" / ");

  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white px-3 py-3 space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#111827]">{company.name}</p>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            {location}
            {company.currentStatus ? ` · ${company.currentStatus}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#6B7280]">
        {company.incorporationDate ? <span>Incorporated {company.incorporationDate}</span> : null}
        {company.companyType ? <span>Type: {company.companyType}</span> : null}
      </div>
      {company.agentName ? (
        <p className="text-xs text-[#374151]">
          <span className="font-medium">Agent:</span> {company.agentName}
          {company.agentAddress ? ` — ${company.agentAddress}` : ""}
        </p>
      ) : null}
      {company.addresses && company.addresses.length > 0 ? (
        <div className="space-y-1 text-xs text-[#374151]">
          {company.addresses.map((entry, index) => (
            <p key={`${entry.label}-${index}`} className="whitespace-pre-wrap">
              <span className="font-medium">{entry.label}:</span> {entry.address}
            </p>
          ))}
        </div>
      ) : company.registeredAddress ? (
        <p className="text-xs text-[#374151] whitespace-pre-wrap">{company.registeredAddress}</p>
      ) : null}
      {company.identifiers && company.identifiers.length > 0 ? (
        <div className="text-[11px] text-[#6B7280]">
          <p className="font-medium text-[#374151]">Identifiers</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {company.identifiers.map((identifier, index) => (
              <li key={`${identifier.system}-${index}`}>
                {identifier.system}: {identifier.value}
                {identifier.category ? ` (${identifier.category})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {company.directors && company.directors.length > 0 ? (
        <div className="text-[11px] text-[#6B7280]">
          <p className="font-medium text-[#374151]">Directors</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {company.directors.map((officer, index) => (
              <li key={`director-${officer.name}-${index}`}>
                {officer.name}
                {officer.position ? ` (${officer.position})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {company.officers && company.officers.length > 0 ? (
        <div className="text-[11px] text-[#6B7280]">
          <p className="font-medium text-[#374151]">Officers</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {company.officers.map((officer, index) => (
              <li key={`${officer.name}-${index}`}>
                {officer.name}
                {officer.position ? ` (${officer.position})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {company.inactiveOfficers && company.inactiveOfficers.length > 0 ? (
        <div className="text-[11px] text-[#6B7280]">
          <p className="font-medium text-[#374151]">Inactive officers</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {company.inactiveOfficers.map((officer, index) => (
              <li key={`inactive-${officer.name}-${index}`}>
                {officer.name}
                {officer.position ? ` (${officer.position})` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {[company.dataSource, company.lastUpdateFromSource, company.lastChangeRecorded]
        .filter(Boolean)
        .length > 0 ? (
        <div className="text-[11px] text-[#6B7280] space-y-0.5">
          {company.dataSource ? <p>Source: {company.dataSource}</p> : null}
          {company.lastUpdateFromSource ? (
            <p>Last update: {company.lastUpdateFromSource}</p>
          ) : null}
          {company.lastChangeRecorded ? <p>Last change: {company.lastChangeRecorded}</p> : null}
          {company.nextUpdateFromSource ? (
            <p>Next update: {company.nextUpdateFromSource}</p>
          ) : null}
        </div>
      ) : null}
      <a
        href={company.opencorporatesUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] text-[var(--brand)] hover:underline"
      >
        View on OpenCorporates
        <ExternalLink className="h-3 w-3" aria-hidden />
      </a>
    </div>
  );
}

export default function OpenCorporatesPanel({
  embedded = false,
  onApplyToNotes,
}: OpenCorporatesPanelProps) {
  const applicationData = useSelector(
    (state: RootState) => state.applicationDetail.data as Record<string, unknown> | null,
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

  const dealClient = useMemo(
    () => extractDealClientDetails(applicationData),
    [applicationData],
  );

  const queryKey = useMemo(
    () => buildOpenCorporatesQueryKey(dealClient.businessName, dealClient.state),
    [dealClient.businessName, dealClient.state],
  );

  const [result, setResult] = useState<OpenCorporatesLookupData | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchedAt, setSearchedAt] = useState<string | null>(null);
  const [resultsExpanded, setResultsExpanded] = useState(true);
  const [waitingForImport, setWaitingForImport] = useState(false);
  const [savingImport, setSavingImport] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const importTimeoutRef = useRef<number | null>(null);

  const canSearch = Boolean(applicationId) && Boolean(dealClient.businessName);

  const persistResult = useCallback(
    (lookup: OpenCorporatesLookupData, searchedAtIso: string, expanded = resultsExpanded) => {
      if (!applicationId) return;
      saveOpenCorporatesCache(applicationId, {
        queryKey,
        searchedAt: searchedAtIso,
        resultsExpanded: expanded,
        result: lookup,
      });
    },
    [applicationId, queryKey, resultsExpanded],
  );

  const applyLookup = useCallback(
    async (
      lookup: OpenCorporatesLookupData,
      meta: { searchedAt: string; sourceUrl?: string },
      options?: { announce?: boolean },
    ) => {
      setResult(lookup);
      setHasSearched(true);
      setSearchedAt(meta.searchedAt);
      setResultsExpanded(true);
      persistResult(lookup, meta.searchedAt, true);

      if (applicationId) {
        setSavingImport(true);
        const response = await importOpenCorporatesForApplication(applicationId, {
          searchQuery: lookup.searchQuery,
          jurisdictionCode: lookup.jurisdictionCode,
          sourceUrl: meta.sourceUrl ?? lookup.sourceUrl,
          companies: lookup.companies,
        });
        setSavingImport(false);
        if (!response.success && options?.announce) {
          toast.warn(response.message);
        }
      }

      if (options?.announce) {
        const count = lookup.companies.length;
        toast.success(
          count > 0
            ? `Imported ${count} OpenCorporates result${count !== 1 ? "s" : ""}.`
            : "OpenCorporates search returned no companies.",
        );
      }
    },
    [applicationId, persistResult],
  );

  useEffect(() => {
    if (!applicationId) {
      setResult(null);
      setHasSearched(false);
      setSearchedAt(null);
      return;
    }

    const cached = loadOpenCorporatesCache(applicationId, queryKey);
    if (cached) {
      setResult(cached.result);
      setHasSearched(true);
      setSearchedAt(cached.searchedAt);
      setResultsExpanded(cached.resultsExpanded ?? true);
      return;
    }

    setResult(null);
    setHasSearched(false);
    setSearchedAt(null);
    setResultsExpanded(true);
  }, [applicationId, queryKey]);

  const finishBridgeImport = useCallback(() => {
    setWaitingForImport(false);
    if (importTimeoutRef.current) {
      window.clearTimeout(importTimeoutRef.current);
      importTimeoutRef.current = null;
    }
    popupRef.current = null;
  }, []);

  const processOpenCorporatesImport = useCallback(
    (data: Parameters<typeof isOpenCorporatesImportMessage>[0]) => {
      if (!applicationId || !isOpenCorporatesImportMessage(data, applicationId)) return;

      const lookup: OpenCorporatesLookupData = {
        searchQuery: dealClient.businessName,
        jurisdictionCode: dealClient.state || undefined,
        companies: data.companies,
        sourceUrl: data.sourceUrl,
      };

      void applyLookup(
        lookup,
        {
          searchedAt: data.searchedAt || new Date().toISOString(),
          sourceUrl: data.sourceUrl,
        },
        { announce: true },
      );

      finishBridgeImport();
      handleCrmBridgeReturn({
        type: "crm:bridge-return",
        applicationId,
        source: "opencorporates",
        sectionId: "opencorporates",
      });
    },
    [applicationId, applyLookup, dealClient.businessName, dealClient.state, finishBridgeImport],
  );

  const handleBridgeMessage = useCallback(
    (event: MessageEvent) => {
      if (!applicationId) return;
      if (isCrmBridgeReturnMessage(event.data) && event.data.applicationId === applicationId) {
        handleCrmBridgeReturn(event.data);
        finishBridgeImport();
        return;
      }
      if (!isAllowedOpenCorporatesMessageOrigin(event.origin)) {
        return;
      }
      processOpenCorporatesImport(event.data);
    },
    [applicationId, finishBridgeImport, processOpenCorporatesImport],
  );

  useCrmBridgeInbox(
    applicationId,
    useCallback(
      (inbox) => {
        if (inbox.source !== "opencorporates") return;
        processOpenCorporatesImport(inbox.importPayload);
      },
      [processOpenCorporatesImport],
    ),
  );

  useEffect(() => {
    window.addEventListener("message", handleBridgeMessage);
    return () => window.removeEventListener("message", handleBridgeMessage);
  }, [handleBridgeMessage]);

  useEffect(() => {
    return () => {
      if (importTimeoutRef.current) {
        window.clearTimeout(importTimeoutRef.current);
      }
    };
  }, []);

  const openSearch = () => {
    if (!applicationId || !dealClient.businessName) {
      toast.error("Add a business name on this deal to search OpenCorporates.");
      return;
    }

    const url = buildOpenCorporatesSearchUrl({
      businessName: dealClient.businessName,
      state: dealClient.state,
      applicationId,
      origin: resolveCrmBridgeOrigin(),
    });

    popupRef.current = window.open(url, `crm_opencorporates_${applicationId}`);
    if (!popupRef.current) {
      toast.error(
        "Browser blocked the new tab. Allow popups for this site, then click Search OpenCorporates again.",
      );
      setWaitingForImport(false);
      return;
    }
    setHasSearched(true);
    setWaitingForImport(true);

    if (importTimeoutRef.current) {
      window.clearTimeout(importTimeoutRef.current);
    }
    importTimeoutRef.current = window.setTimeout(() => {
      setWaitingForImport(false);
    }, 30_000);
  };

  const handleApplyToNotes = () => {
    if (!result) return;
    const notes = buildOpenCorporatesNotesHtml(result, searchedAt ?? undefined);
    onApplyToNotes?.(notes);
    toast.success("OpenCorporates summary applied to notes.");
  };

  const toggleResultsExpanded = () => {
    setResultsExpanded((current) => {
      const next = !current;
      if (applicationId && result && searchedAt) {
        persistResult(result, searchedAt, next);
      }
      return next;
    });
  };

  const companyCount = result?.companies.length ?? 0;
  const canApplyToNotes = Boolean(onApplyToNotes && result && companyCount > 0);

  const applyToNotesButton = canApplyToNotes ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 text-xs"
      onClick={handleApplyToNotes}
    >
      Apply to notes
    </Button>
  ) : null;

  const searchButton = (
    <Button
      type="button"
      variant="default"
      size="sm"
      className="h-8 text-xs"
      disabled={!canSearch || savingImport}
      onClick={openSearch}
    >
      <Search className="mr-1.5 h-3 w-3" aria-hidden />
      {hasSearched ? "Search again" : "Search OpenCorporates"}
    </Button>
  );

  return (
    <div className={embedded ? "space-y-3" : "rounded-md border border-[#E5E7EB] bg-white p-4 space-y-3 shadow-[0px_4px_20px_0px_#00000005]"}>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <OpenCorporatesClientSummary client={dealClient} className="flex-1" />
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {searchedAt ? (
              <p className="text-[11px] text-[#6B7280]">
                Last searched {formatOpenCorporatesSearchedAt(searchedAt)}
              </p>
            ) : null}
            {applyToNotesButton}
            {searchButton}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[#111827]">OpenCorporates</h3>
              <p className="mt-0.5 text-xs text-[#6B7280]">Entity registration &amp; status</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {searchedAt ? (
                <p className="text-[11px] text-[#6B7280]">
                  Last searched {formatOpenCorporatesSearchedAt(searchedAt)}
                </p>
              ) : null}
              {applyToNotesButton}
              {searchButton}
            </div>
          </div>
          <OpenCorporatesClientSummary client={dealClient} />
        </>
      )}

      {waitingForImport ? (
        <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-900">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
          <div>
            <p className="font-medium">Waiting for import from OpenCorporates tab…</p>
            <p className="mt-1 text-blue-800/90">
              Solve the captcha if prompted, review results, then click{" "}
              <strong>Send to CRM</strong> on OpenCorporates.
            </p>
          </div>
        </div>
      ) : null}

      {!hasSearched && !waitingForImport ? (
        <p className="rounded-md border border-dashed border-[#D1D5DB] bg-[#F9FAFB] px-3 py-3 text-xs text-[#6B7280]">
          Click <strong>Search OpenCorporates</strong> to open the registry, then use{" "}
          <strong>Send to CRM</strong> on the company page.
        </p>
      ) : null}

      {savingImport ? (
        <div className="flex items-center gap-2 text-xs text-[#6B7280]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Saving import…
        </div>
      ) : null}

      {result && hasSearched ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={toggleResultsExpanded}
            className={cn(
              "flex w-full items-start gap-2 rounded-md border px-3 py-2.5 text-left text-xs transition-colors",
              companyCount > 0
                ? "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100/80"
                : "border-green-200 bg-green-50 text-green-800 hover:bg-green-100/80",
            )}
            aria-expanded={resultsExpanded}
          >
            <div className="min-w-0 flex-1">
              {companyCount > 0 ? (
                <>
                  <p className="font-semibold">
                    {companyCount} compan{companyCount !== 1 ? "ies" : "y"} found
                  </p>
                  {resultsExpanded ? (
                    <p className="mt-0.5">Matched &quot;{result.searchQuery}&quot;</p>
                  ) : (
                    <p className="mt-0.5 opacity-80">Click to expand results</p>
                  )}
                </>
              ) : (
                <>
                  <p className="font-semibold">No OpenCorporates matches found</p>
                  {resultsExpanded ? (
                    <p className="mt-0.5">Searched for &quot;{result.searchQuery}&quot;</p>
                  ) : (
                    <p className="mt-0.5 opacity-80">Click to expand details</p>
                  )}
                </>
              )}
            </div>
            <ChevronDown
              className={cn(
                "mt-0.5 h-4 w-4 shrink-0 transition-transform",
                resultsExpanded && "rotate-180",
              )}
              aria-hidden
            />
          </button>

          {resultsExpanded && companyCount > 0 ? (
            <div className="space-y-2">
              {result.companies.map((company, index) => (
                <OpenCorporatesCompanyCard
                  key={`${company.jurisdictionCode}-${company.companyNumber}-${index}`}
                  company={company}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
