import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useApplicationDetailLoader } from "@/hooks/useApplicationDetailLoader";
import { Button } from "@/components/ui/button";

import Templates from "@/pages/payment/Templates";
import Letters from "@/pages/payment/Letters";
import { prefetchPaymentTemplates } from "@/pages/payment/paymentTemplateApi";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isApplicationUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

type TabId = "templates" | "letters";

const tabs: { id: TabId; label: string }[] = [
  { id: "templates", label: "Templates" },
  { id: "letters", label: "Letters" },
];

/**
 * Letter generator drill-in: same Templates / Letters experience as Payments,
 * without overview, collections, or logs.
 */
export default function LetterGeneratorDealById() {
  const { letterGeneratorDealId } = useParams<{ letterGeneratorDealId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("templates");

  const applicationId = useMemo(() => {
    const raw = letterGeneratorDealId?.trim();
    if (!raw) return "";
    try {
      const decoded = decodeURIComponent(raw);
      return isApplicationUuid(decoded) ? decoded : "";
    } catch {
      return isApplicationUuid(raw) ? raw : "";
    }
  }, [letterGeneratorDealId]);

  const { loading, data: applicationData, error } =
    useApplicationDetailLoader(applicationId || undefined);

  useEffect(() => {
    prefetchPaymentTemplates();
  }, []);

  const ready = !loading && !!applicationData && !error;

  if (!applicationId) {
    return (
      <div className="min-h-screen bg-background p-6 lg:p-10">
        <p className="text-center text-destructive" role="alert">
          Invalid application link. Use Letter generator and pick an application from the list.
        </p>
        <div className="mt-4 flex justify-center">
          <Button type="button" variant="outline" onClick={() => navigate("/letter-generator")}>
            Back to list
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 font-sans text-foreground lg:p-10">
      <div className="mx-auto w-full space-y-6">
        <div className="overflow-hidden rounded-2xl border border-white/20 bg-white shadow-lg ring-1 ring-inset ring-white/10 dark:border-border dark:bg-card">
          <div className="border-b border-border/60 px-5 pb-4 pt-5 sm:px-6">
            <div className="flex flex-wrap items-start gap-4">
              <button
                type="button"
                onClick={() => navigate("/letter-generator")}
                className="group flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-all hover:border-[#276D9C]/40 hover:text-[#276D9C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#276D9C]/30 focus-visible:ring-offset-2"
                aria-label="Back to disbursement list"
                title="Back to list"
              >
                <ArrowLeft className="h-5 w-5 transition-transform group-hover:-translate-x-0.5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Letter generator
                </p>
                <p className="mt-1 text-lg font-semibold text-foreground">
                  {applicationData?.applicationId != null
                    ? `APP-${applicationData.applicationId}`
                    : "Application"}
                </p>
              </div>
            </div>

            <div className="mt-5 inline-flex max-w-full flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
              {tabs.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors sm:px-4 ${
                    activeTab === id
                      ? "bg-[#276D9C] text-white shadow-sm"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6 p-5 sm:p-6">
            {loading && !applicationData && (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span>Loading application…</span>
              </div>
            )}

            {error && !loading && (
              <p className="py-8 text-center text-destructive" role="alert">
                {error}
              </p>
            )}

            {ready && activeTab === "templates" && <Templates />}
            {ready && activeTab === "letters" && <Letters />}
          </div>
        </div>
      </div>
    </div>
  );
}
