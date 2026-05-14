import { useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { store } from "@/redux/store";
import { getApplicationById } from "@/redux/actions/applicationActions";
import { getCollectionPayments } from "@/redux/actions/collectionPaymentActions";
import {
  applicationPrimaryKey,
  resolvePaymentDealApplicationId,
} from "@/lib/paymentDealApplicationId";

import ApplicationSummary from "@/components/application/ApplicationSummary";
import ApplicationBasicDetails from "@/components/application/ApplicationBasicDetails";
import MyNotes from "@/components/application/MyNotes";
import UploadedDocuments from "@/components/application/UploadedDocuments";
import RequiredDocument from "@/components/application/RequiredDocument";
import ChecksAndDecision from "@/components/application/ChecksAndDecision";
import DecisionMakeFinalValues from "@/components/application/DecisionMakeFinalValues";

import { prefetchPaymentTemplates } from "./paymentTemplateApi";
import Transactions from "./Transactions";
import Templates from "./Templates";
import Letters from "./Letters";
import MailLogs from "./MailLogs";
import ActionLogs from "./ActionLogs";
import PaymentCommunicationTab from "./PaymentCommunicationTab";
import ApplicationSyndicationTab, {
  buildSyndicationDealHints,
} from "@/components/application/ApplicationSyndicationTab";

type TabId =
  | "overview"
  | "collections"
  | "templates"
  | "letters"
  | "mailLogs"
  | "actionLogs"
  | "communication"
  | "syndication";

const tabs: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "collections", label: "Collections" },
  { id: "templates", label: "Templates" },
  { id: "letters", label: "Letters" },
  { id: "mailLogs", label: "Mail logs" },
  { id: "actionLogs", label: "Action logs" },
  { id: "communication", label: "Communication" },
  { id: "syndication", label: "Syndication" },
];

export default function PaymentDealById() {
  const { paymentDealId } = useParams<{ paymentDealId: string }>();
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  const [activeTab, setActiveTab] = useState<TabId>("overview");

  /** Backend GET application expects Prisma `id` (UUID). Params may be numeric deal ids — only use param when it is a UUID. */
  const applicationId = useMemo(
    () => resolvePaymentDealApplicationId(paymentDealId),
    [paymentDealId],
  );

  const { loading, isRefreshing, data: applicationData, error } = useSelector(
    (state: RootState) => state.applicationDetail,
  );

  /** Warm collections + deal view before the user opens the Collections tab (same args as `Transactions`). */
  const prefetchCollectionParams = useMemo(() => {
    const app = applicationData as {
      id?: string;
      _id?: string;
      dealId?: string;
      dealID?: string;
      deal_id?: string;
    } | null;
    if (!app) return null;
    const primaryApplicationId = String(app.id ?? app._id ?? "").trim();
    const applicationDealId = String(
      app.dealId ?? app.dealID ?? app.deal_id ?? "",
    ).trim();
    if (!primaryApplicationId && !applicationDealId) return null;
    return {
      applicationId: primaryApplicationId || applicationDealId,
      dealId: applicationDealId || undefined,
      includeDealView: true,
    } as const;
  }, [applicationData]);

  const collectionsAlreadyFetched = useSelector((state: RootState) => {
    const mongo = prefetchCollectionParams?.applicationId;
    if (!mongo) return false;
    return Boolean(state.collectionPayments.fetched[mongo]);
  });

  useEffect(() => {
    if (!prefetchCollectionParams || collectionsAlreadyFetched) return;
    dispatch(getCollectionPayments(prefetchCollectionParams));
  }, [dispatch, prefetchCollectionParams, collectionsAlreadyFetched]);

  useEffect(() => {
    const { data, error: detailError } = store.getState().applicationDetail;
    const pk = applicationPrimaryKey(data);
    if (pk === applicationId && data != null && !detailError) {
      return;
    }
    dispatch(getApplicationById(applicationId));
  }, [dispatch, applicationId]);

  useEffect(() => {
    prefetchPaymentTemplates();
  }, []);

  const syndicationDealHints = useMemo(
    () => buildSyndicationDealHints(applicationData),
    [applicationData],
  );

  // const dealLabel = useMemo(() => {
  //   if (!paymentDealId?.trim()) return "—";
  //   try {
  //     return decodeURIComponent(paymentDealId);
  //   } catch {
  //     return paymentDealId;
  //   }
  // }, [paymentDealId]);

  const showOverview = Boolean(applicationData);
  const showInitialSpinner = loading && !applicationData;
  const showFatalError = Boolean(error && !applicationData && !loading);

  return (
    <div className="min-h-screen bg-background p-6 font-sans text-foreground lg:p-10">
      <div className="mx-auto w-full space-y-6">
        <div className="rounded-2xl border border-border/70 bg-card/95 shadow-lg ring-1 ring-inset ring-border/40 dark:border-white/10 dark:bg-white/[0.03] dark:ring-white/10">
          <div className="border-b border-border/60 px-5 pb-4 pt-5 sm:px-6">
            <div className="flex items-start gap-4">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="group flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-all hover:border-[#276D9C]/40 hover:text-[#276D9C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#276D9C]/30 focus-visible:ring-offset-2 dark:border-white/10 dark:bg-white/[0.04]"
                aria-label="Go back"
                title="Go back"
              >
                <ArrowLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
              </button>
              <div className="min-w-0 flex-1">
                {/* <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Payment deal
                </p>
                <p
                  className="mt-1 truncate text-lg font-semibold text-foreground"
                  title={dealLabel}
                >
                  {dealLabel}
                </p> */}
                {isRefreshing && applicationData && (
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Updating…
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1 dark:border-white/10 dark:bg-white/[0.04]">
              {tabs.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`cursor-pointer rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors sm:px-4 ${
                    activeTab === id
                      ? "bg-[#276D9C] text-white shadow-sm"
                      : "text-muted-foreground hover:bg-background hover:text-foreground dark:hover:bg-white/[0.06]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6 p-5 sm:p-6">
            {activeTab === "overview" && (
              <>
                {showInitialSpinner && (
                  <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span>Loading application…</span>
                  </div>
                )}

                {showFatalError && (
                  <p className="py-8 text-center text-destructive" role="alert">
                    {error}
                  </p>
                )}

                {showOverview && (
                  <div className="decision-making-deal-pipeline">
                    <ApplicationSummary />
                    <ApplicationBasicDetails
                      applicationId={applicationId}
                    />
                    <div className="mt-6">
                      <UploadedDocuments />
                    </div>
                    <div className="mt-6 flex w-full flex-row gap-4">
                      <RequiredDocument
                        isDecisionMaking={false}
                        isBankAnalysis={false}
                      />
                    </div>
                    <div className="mt-6">
                      <DecisionMakeFinalValues />
                    </div>
                    <div className="mt-6 flex w-full flex-row gap-4">
                      <ChecksAndDecision hideUnderwritingDecision />
                      <div className="w-[50%]">
                        <MyNotes applicationId={applicationId} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {activeTab === "collections" && <Transactions />}
            {activeTab === "templates" && <Templates />}
            {activeTab === "letters" && <Letters />}
            {activeTab === "mailLogs" && <MailLogs />}
            {activeTab === "actionLogs" && <ActionLogs />}
            {activeTab === "communication" && <PaymentCommunicationTab />}
            {activeTab === "syndication" && (
              <>
                {showInitialSpinner && (
                  <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span>Loading application…</span>
                  </div>
                )}
                {showFatalError && (
                  <p className="py-8 text-center text-destructive" role="alert">
                    {error}
                  </p>
                )}
                {showOverview && (
                  <ApplicationSyndicationTab
                    applicationId={applicationId}
                    dealHints={syndicationDealHints}
                  />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
