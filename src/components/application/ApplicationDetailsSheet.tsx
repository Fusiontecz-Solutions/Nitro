import { useEffect, useState } from "react"
import { useDispatch, useSelector } from "react-redux"
import type { AppDispatch, RootState } from "@/redux/store"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import type { Application } from "@/types/applicationTypes"
import type { Client } from "@/types/clientTypes"
import ApplicationSheetComments from "./ApplicationSheetComments"
import ApplicationSheetDudep from "./ApplicationSheetDudep"
import ApplicationSheetFiles from "./ApplicationSheetFiles"
import ApplicationSheetNotes from "./ApplicationSheetNotes"
import ApplicationSheetActivityLog from "./ApplicationSheetActivityLog"
import ApplicationSheetBankDetail from "./ApplicationSheetBankDetail"
import ApplicationSheetBankAnalysis from "./ApplicationSheetBankAnalysis"


import { formatCurrency, formatDate as formatDateUtil } from "@/lib/utils"
import { getWorkflowCurrentStateLabel } from "@/lib/applicationWorkflowState"
import { formatActionRequired } from "@/lib/formatActionRequired"
import { useTheme } from "@/context/ThemeContext"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Briefcase,
  Building2,
  FileText,
  AlertCircle
} from "lucide-react"
import { getClientByClientId } from "@/redux/actions/clientActions"

type ApplicationDetailsSheetProps = {
  application: Application | null
  open: boolean
  onOpenChange: (open: boolean) => void
}



function getClientNameFromApplication(client: Application["client"]): string {
  if (!client) return "-"
  if (typeof client === "string") return client
  if (client.business?.name) return client.business.name
  if (client.owner?.firstName || client.owner?.lastName) {
    return `${client.owner.firstName || ""} ${client.owner.lastName || ""}`.trim()
  }
  return client.owner?.email || client.business?.email || "-"
}

function formatMaybeDate(value: unknown): string {
  if (!value || typeof value !== "string") return "-"
  return formatDateUtil(value, "-")
}

/**
 * Derive a user-facing status label for the drawer summary.
 * This mirrors the "Current State" badge logic used in the applications list
 * so that both places stay consistent.
 */
function deriveStatus(app: any | null | undefined): string {
  if (!app) return "Pending"

  const currentStateRaw = app.currentState ?? app.state
  const currentStateStr = String(currentStateRaw ?? "").trim()

  // Match the "Final Underwriter-Approved" special case from the list view.
  const hasApprovedInCurrentState = /\bapproved\b/i.test(currentStateStr)
  if (hasApprovedInCurrentState) {
    return "Final Underwriter-Approved"
  }

  const queue = app.currentQueue || app.queue
  if (queue == null || String(queue).trim() === "") {
    // Fallback to workflow-based label when queue is missing,
    // to keep behavior reasonable for legacy data.
    return getWorkflowCurrentStateLabel(app)
  }

  const rawQueue = String(queue).trim()
  if (rawQueue.toLowerCase() !== "new") {
    return rawQueue
  }

  // For "New" queue, reuse the same Agent/New distinction as the list view.
  const creator = app.createdBy as
    | { id?: string; _id?: string; role?: string }
    | string
    | undefined
  const referring = app.referringAgent as
    | { id?: string; _id?: string }
    | string
    | undefined

  const creatorRole =
    typeof creator === "object" && creator?.role != null
      ? String(creator.role).toUpperCase().replace(/-/g, "_")
      : ""
  if (creatorRole === "AGENT") return "Agent"

  const creatorId =
    typeof creator === "object" && creator
      ? String(creator.id ?? creator._id ?? "")
      : ""
  const referringId =
    typeof referring === "object" && referring
      ? String(referring.id ?? referring._id ?? "")
      : ""
  if (creatorId && referringId && creatorId === referringId) return "Agent"

  return rawQueue
}
const TABS = [
  { id: "details", label: "Application Details", icon: <FileText className="w-4 h-4" /> },
  { id: "files", label: "Files", icon: <Briefcase className="w-4 h-4" /> },

  { id: "dedupe", label: "Dedupe", icon: <AlertCircle className="w-4 h-4" /> },
  { id: "bankDetails", label: "Bank Details", icon: <AlertCircle className="w-4 h-4" /> },
  { id: "Bank Analysis", label: "Bank Analysis", icon: <AlertCircle className="w-4 h-4" /> },
  { id: "comments", label: "Comments", icon: <AlertCircle className="w-4 h-4" /> },
  { id: "activityLog", label: "Activity Log", icon: <Building2 className="w-4 h-4" /> },
  { id: "remarks", label: "Note", icon: <FileText className="w-4 h-4" /> },

]

export default function ApplicationDetailsSheet({
  application,
  open,
  onOpenChange,
}: ApplicationDetailsSheetProps) {


  const [activeTab, setActiveTab] = useState("details")
  const dispatch = useDispatch<AppDispatch>()
  const { resolvedTheme } = useTheme()
  const { data: clientData, loading: clientLoading, currentClientId } = useSelector(
    (state: RootState) => state.clientDetail
  )

  const userRole = useSelector(
    (state: RootState) =>
      state.login?.data?.user?.role ||
      (typeof window !== "undefined" ? localStorage.getItem("role") : "") ||
      ""
  )
  const roleUpper = String(userRole || "").replace(/-/g, "_").toUpperCase()
  const canSeeDedupe = ["UNDERWRITER", "FINAL_UNDERWRITER", "ADMIN", "SUPER_ADMIN"].includes(
    roleUpper
  )
  const isOperationsRole = roleUpper === "OPERATIONS"
  const visibleTabs = (canSeeDedupe ? TABS : TABS.filter((t) => t.id !== "dedupe")).filter(
    (t) => !(isOperationsRole && t.id === "Bank Analysis")
  )

  // Derive clientId from application
  const clientIdFromApplication = (() => {
    const client = application?.client
    if (!client) return null
    if (typeof client === "string") return client
    if (client.clientId != null) return String(client.clientId)
    if (client._id) return client._id
    return null
  })()

  // Fetch full client details when sheet opens
  useEffect(() => {
    if (!open || !clientIdFromApplication) return
    if (currentClientId === clientIdFromApplication && clientData) return

    dispatch(getClientByClientId(clientIdFromApplication))
  }, [open, clientIdFromApplication, currentClientId, clientData, dispatch])

  useEffect(() => {
    if (!open) return
    if (activeTab === "dedupe" && !canSeeDedupe) {
      setActiveTab("details")
    }
    if (activeTab === "Bank Analysis" && isOperationsRole) {
      setActiveTab("details")
    }
  }, [open, activeTab, canSeeDedupe, isOperationsRole])

  if (!application) return null

  const clientName = getClientNameFromApplication(application.client)
  const appId = String(application.applicationId ?? application._id ?? (application as { id?: string }).id ?? "")
  const applicationId = String(
    application._id ?? (application as { id?: string }).id ?? application.applicationId ?? "",
  ).trim()


  const business: Client["business"] | null = clientData?.business ?? null
  const owner: Client["owner"] | null = clientData?.owner ?? null
  const isDark = resolvedTheme === "dark"
  const isSummaryLoading = clientLoading && !owner && !business
  const isCoreDetailsLoading =
    Boolean(clientIdFromApplication) &&
    (clientLoading || currentClientId !== clientIdFromApplication) &&
    !owner &&
    !business
  const loanAmount =
    application?.loanAmount != null && !Number.isNaN(Number(application.loanAmount))
      ? Number(application.loanAmount)
      : null
  const status = deriveStatus(application as any)
  const actionRequired = formatActionRequired((application as any)?.note)
  const summaryGradient = isDark
    ? "linear-gradient(90deg, #6F7887 0%, #6F7887 40%, #AAAEB5 100%)"
    : "linear-gradient(135deg, #3B8BD1 0%, #2566A9 50%, #0E416E 100%)"


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="fixed inset-y-0 right-0 z-[9999] flex h-full w-full max-w-full flex-col border-l bg-background p-0 transition-all duration-300 sm:w-[50vw] sm:max-w-[50vw]"
      >
        {/* --- TOP HEADER (Title & Deal ID) --- */}
        <div className="p-6 pb-4 flex justify-between items-start bg-muted/5">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-foreground tracking-tight">
              {clientName} Deal
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium">Deal ID:</span>
              <code className="bg-muted px-2 py-0.5 rounded text-[12px]">{appId}</code>
            </div>
          </div>

        </div>

        {/* --- TABS NAVIGATION --- */}
        <div className="flex min-h-0 flex-1 flex-col px-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 w-full flex-1 flex-col">
            <div className="overflow-x-auto overflow-y-hidden border-b [scrollbar-width:thin] [scrollbar-color:rgba(100,116,139,0.55)_transparent] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-400/70 dark:[&::-webkit-scrollbar-thumb]:bg-slate-500/70 [&::-webkit-scrollbar-thumb:hover]:bg-slate-500/90 dark:[&::-webkit-scrollbar-thumb:hover]:bg-slate-400/90">
              <TabsList className="bg-transparent rounded-none min-w-max w-max justify-start h-auto p-0 gap-6">
                {visibleTabs.map((tab) => (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="shrink-0 rounded-none border-b-2 border-b-transparent border-x-0 border-t-0 data-[state=active]:border-b-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 pb-3 text-md font-medium transition-all"
                  >
                    <div className="flex items-center gap-2">
                      {/* {tab.icon} */}
                      {tab.label}
                    </div>
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto py-6">
              {isCoreDetailsLoading ? (
                <div className="space-y-6 px-2">
                  <Card className={`border-0 rounded-lg shadow-xl overflow-hidden py-0 ${isDark ? "" : "dark:border dark:border-border"}`}>
                    <CardContent className="px-8 py-6" style={{ background: summaryGradient }}>
                      <div className="space-y-4">
                        <Skeleton className="h-8 w-[260px] bg-white/30" />
                        <div className={`grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 rounded-lg p-4 shadow-md dark:shadow-lg ${isDark ? "bg-white/20" : "bg-white/30"}`}>
                          {Array.from({ length: 5 }).map((_, index) => (
                            <div key={index} className="space-y-2">
                              <Skeleton className="h-4 w-[140px] bg-white/30" />
                              <Skeleton className="h-5 w-[100px] bg-white/30" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                  <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-md border border-border/60 bg-background p-4 space-y-3 shadow-md">
                      <Skeleton className="h-5 w-[200px]" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-[85%]" />
                    </div>
                    <div className="rounded-md border border-border/60 bg-background p-4 space-y-3 shadow-md">
                      <Skeleton className="h-5 w-[200px]" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-4 w-[85%]" />
                    </div>
                  </section>
                </div>
              ) : (
                <TabsContent value="details" className="m-0 space-y-8">
                  {/* Application Summary Section */}
                  <section className="space-y-4">
                    <Card className={`border-0 rounded-lg shadow-xl overflow-hidden py-0 ${isDark ? "" : "dark:border dark:border-border"}`}>
                      <CardContent className="px-8 py-6" style={{ background: summaryGradient }}>
                        <div className="flex flex-wrap items-center gap-3 mb-5">
                          <h3 className="text-white text-2xl font-[700] font-roboto">APPLICATION SUMMARY</h3>
                        </div>
                        <div className={`grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 rounded-lg p-4 justify-center items-center shadow-md dark:shadow-lg ${isDark ? "bg-white/20" : "bg-white/30"}`}>
                          <div className="text-white">
                            {isSummaryLoading ? (
                              <div className="space-y-2 pr-12">
                                <Skeleton className="h-4 w-[150px] bg-white/30" />
                                <Skeleton className="h-4 w-[100px] bg-white/30" />
                              </div>
                            ) : (
                              <>
                                <p className="text-sm font-medium opacity-90 mb-1">Borrower Name</p>
                                <p className="text-base font-semibold capitalize">
                                  {owner
                                    ? `${owner.firstName || ""} ${owner.lastName || ""}`.trim() || clientName
                                    : clientName || "-"}
                                </p>
                              </>
                            )}
                          </div>
                          <div className="text-white">
                            {isSummaryLoading ? (
                              <div className="space-y-2 pr-12">
                                <Skeleton className="h-4 w-[150px] bg-white/30" />
                                <Skeleton className="h-4 w-[100px] bg-white/30" />
                              </div>
                            ) : (
                              <>
                                <p className="text-sm font-medium opacity-90 mb-1">Business Name</p>
                                <p className="text-base font-semibold capitalize">{business?.name || clientName || "-"}</p>
                              </>
                            )}
                          </div>
                          <div className="text-white">
                            {isSummaryLoading ? (
                              <div className="space-y-2 pr-12">
                                <Skeleton className="h-4 w-[150px] bg-white/30" />
                                <Skeleton className="h-4 w-[100px] bg-white/30" />
                              </div>
                            ) : (
                              <>
                                <p className="text-sm font-medium opacity-90 mb-1">Loan Amount</p>
                                <p className="text-base font-semibold">{loanAmount != null ? formatCurrency(loanAmount) : "-"}</p>
                              </>
                            )}
                          </div>
                          <div className="text-white">
                            {isSummaryLoading ? (
                              <div className="space-y-2 pr-12">
                                <Skeleton className="h-4 w-[150px] bg-white/30" />
                                <Skeleton className="h-4 w-[100px] bg-white/30" />
                              </div>
                            ) : (
                              <>
                                <p className="text-sm font-medium opacity-90 mb-1">Status</p>
                                <p className="text-base font-semibold capitalize">{status}</p>
                              </>
                            )}
                          </div>
                          <div className="text-white text-center">
                            {isSummaryLoading ? (
                              <div className="space-y-2">
                                <Skeleton className="h-4 w-[150px] bg-white/30" />
                                <Skeleton className="h-4 w-[100px] bg-white/30" />
                              </div>
                            ) : (
                              <>
                                <p className="text-sm font-medium opacity-90 mb-1">Action Required</p>
                                <p className="text-base text-white/70 font-[300] font-roboto whitespace-pre-wrap break-words">
                                  {actionRequired}
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </section>

                  <Separator />

                  <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <DetailPanel
                      title="Business Profile"
                      loading={clientLoading && !business}
                      empty={!clientLoading && !business}
                      loadingText="Loading business profile..."
                      emptyText="Business profile not available for this client."
                      rows={
                        business
                          ? [
                            { label: "Business Name", value: business.name || "-" },
                            { label: "Business Email", value: business.email || "-" },
                            { label: "Business Number", value: business.number || "-" },
                            {
                              label: "Incorporation date",
                              value: business.incorporationDate
                                ? formatDateUtil(business.incorporationDate, "-")
                                : "-",
                            },
                            { label: "Type of business entity", value: business.businessEntityType || "-" },
                            { label: "website", value: business.website || "-" },
                            { label: "Incorporation State", value: business.incorporationState || "-" },
                            {
                              label: "Monthly Revenue",
                              value:
                                business.monthlyRevenue !== undefined &&
                                  business.monthlyRevenue !== null &&
                                  business.monthlyRevenue !== ""
                                  ? formatCurrency(Number(business.monthlyRevenue))
                                  : "-",
                            },
                            { label: "EIN Number", value: business.einNumber || "-" },
                            { label: "Address 1", value: business.address?.address1 || "-" },
                            { label: "City", value: business.address?.city || "-" },
                            { label: "State", value: business.address?.state || "-" },
                            { label: "Zip Code", value: business.address?.zipCode || "-" },
                          ]
                          : []
                      }
                    />
                    <DetailPanel
                      title="Business Owner Details"
                      loading={clientLoading && !owner}
                      empty={!clientLoading && !owner}
                      loadingText="Loading owner details..."
                      emptyText="Owner details not available for this client."
                      rows={
                        owner
                          ? [
                            {
                              label: "Name",
                              value: `${owner.firstName || ""} ${owner.lastName || ""}`.trim() || "-",
                            },
                            { label: "Email", value: owner.email || "-" },
                            { label: "Mobile Number", value: owner.mobileNumber || "-" },
                            { label: "Date of Birth", value: formatMaybeDate(owner.dateOfBirth) },
                            { label: "Social Security Number (SSN)", value: owner.ssn || "-" },
                            {
                              label: "FiCO Score",
                              value:
                                owner.ficoScore !== undefined && owner.ficoScore !== null && owner.ficoScore !== ""
                                  ? String(owner.ficoScore)
                                  : "-",
                            },
                            {
                              label: "Ownership Percentage",
                              value:
                                owner.ownershipPercentage !== undefined &&
                                  owner.ownershipPercentage !== null &&
                                  owner.ownershipPercentage !== ""
                                  ? `${owner.ownershipPercentage}%`
                                  : "-",
                            },
                            { label: "Address 1", value: owner.address?.address1 || "-" },
                            { label: "City", value: owner.address?.city || "-" },
                            { label: "State", value: owner.address?.state || "-" },
                            { label: "Zip Code", value: owner.address?.zipCode || "-" },
                          ]
                          : []
                      }
                    />
                  </section>

                </TabsContent>
              )}

              {/* Files Tab */}
              {activeTab === "files" && (
                <TabsContent value="files" className="m-0">
                  {/* For files we want to fetch by business applicationId (Deal ID) */}
                  <ApplicationSheetFiles
                    applicationId={String(application.applicationId ?? "")}
                    readOnly={isOperationsRole}
                  />
                </TabsContent>
              )}

              {/* Notes / Remarks Tab */}
              {activeTab === "remarks" && (
                <TabsContent value="remarks" className="m-0">
                  <ApplicationSheetNotes applicationId={applicationId} />
                </TabsContent>
              )}

              {/* Dedupe Tab */}
              {canSeeDedupe && activeTab === "dedupe" && (
                <TabsContent value="dedupe" className="m-0">
                  <ApplicationSheetDudep
                    applicationId={applicationId}
                    onNavigateAway={() => onOpenChange(false)}
                  />
                </TabsContent>
              )}

              {/* Comments Tab */}
              {activeTab === "comments" && (
                <TabsContent value="comments" className="m-0">
                  <ApplicationSheetComments applicationId={applicationId} />
                </TabsContent>
              )}
              {/* Activity Log Tab */}
              {activeTab === "activityLog" && (
                <TabsContent
                  value="activityLog"
                  className="m-0 flex min-h-0 flex-1 flex-col overflow-hidden"
                >
                  <ApplicationSheetActivityLog
                    applicationId={applicationId}
                    className="min-h-0 flex-1"
                  />
                </TabsContent>
              )}

              {/* Bank Details Tab */}
              {activeTab === "bankDetails" && (
                <TabsContent value="bankDetails" className="m-0">
                  <ApplicationSheetBankDetail applicationId={applicationId} />
                </TabsContent>
              )}
              {/* Bank Analysis Tab */}
              {activeTab === "Bank Analysis" && (
                <TabsContent value="Bank Analysis" className="m-0">
                  <ApplicationSheetBankAnalysis applicationId={appId} />
                </TabsContent>
              )}

            </div>
          </Tabs>
        </div>

        {/* --- FOOTER --- */}
        <div className="mt-auto p-4 border-t bg-muted/10 flex justify-between items-center px-6">
          <span className="text-[11px] text-muted-foreground uppercase tracking-widest font-semibold">
            Confidential Data
          </span>
          <span className="text-[11px] text-muted-foreground">
            Created At: {formatDateUtil(application.createdAt || "", "N/A")}
          </span>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailPanel({
  title,
  rows,
  loading,
  empty,
  loadingText,
  emptyText,
}: {
  title: string
  rows: Array<{ label: string; value: string }>
  loading: boolean
  empty: boolean
  loadingText: string
  emptyText: string
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background overflow-hidden shadow-md dark:shadow-lg">
      <div className="px-4 py-2 bg-muted/50 border-b border-border/60">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="p-4">
        {loading && <p className="text-sm text-muted-foreground">{loadingText}</p>}
        {empty && <p className="text-sm text-muted-foreground">{emptyText}</p>}
        {!loading && !empty && (
          <div className="space-y-3">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[minmax(150px,220px)_minmax(0,1fr)] gap-3">
                <p className="text-[13px] font-semibold text-[#2f5e7d]">{row.label}</p>
                <p className="min-w-0 whitespace-normal break-all text-[13px] text-foreground">{row.value || "-"}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}