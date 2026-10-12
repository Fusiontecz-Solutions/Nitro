import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "react-toastify";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Hand, Mail, Pencil, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { resolveSessionUser } from "@/lib/sessionRole";
import { toAppRole } from "@/lib/roleAccess";
import {
  WORKFLOW_QUEUE,
  WORKFLOW_STATE_NEEDS_RE_REVIEW,
  claimApplication,
  isWorkflowQueue,
  returnToUnderwriter,
  sendToAgentApproval,
  submitToUnderwriting,
  workflowToken,
} from "@/lib/workflowApi";
import WorkflowStatusBadge from "./WorkflowStatusBadge";
import WorkflowNoteDialog from "./WorkflowNoteDialog";
import SendToIsoDialog from "./SendToIsoDialog";
// import IsoEmailThreadCard from "./IsoEmailThreadCard";

const CONTRACT_STAGE_TOKENS = new Set(
  [
    "Contract Pending",
    "Contract Generated",
    "Contract Sent",
    "Contract Signed",
    "Contracted",
    "Contract Out",
    "Contracts Out",
    "Final",
    "Funding Call",
    "Disbursment",
    "Funded",
  ].map(workflowToken),
);

const personName = (p: any): string =>
  p ? `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() || p.email || "" : "";

type Tone = "info" | "action" | "success";

function Banner({
  tone,
  icon,
  title,
  children,
  actions,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
        tone === "action" && "border-[var(--brand)]/40 bg-[var(--brand)]/5",
        tone === "success" && "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30",
        tone === "info" && "border-border bg-card",
      )}
    >
      <div className="flex gap-3">
        <span className="mt-0.5 text-[var(--brand)]">{icon}</span>
        <div>
          <p className="font-semibold text-foreground">{title}</p>
          {children ? <div className="mt-0.5 text-sm text-muted-foreground">{children}</div> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div> : null}
    </div>
  );
}

/**
 * Stage banner + actions for the Agent → Underwriter → Agent → ISO workflow, shown at the
 * top of Application Details for Agents, Underwriters, Super Admin (acts as the Underwriter
 * during underwriting and as the Agent at every other stage) and read-only Contracts Log oversight.
 */
export default function WorkflowActionPanel({
  application,
  role,
  onChanged,
}: {
  application: any;
  role: string;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const appRole = toAppRole(role);
  const me = resolveSessionUser()?.id ?? "";
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<null | "sendToAgent" | "returnToUw" | "sendToIso">(null);

  if (!application || !appRole) return null;

  const uuid = String(application._id ?? application.id ?? "");
  const ref = uuid || String(application.applicationId ?? "");
  const queue = application.currentQueue as string;
  const iso = application.iso;
  const agentName = personName(application.referringAgent) || "the Agent";
  const underwriter = application.assignedUnderwriter;
  const underwriterId = String(application.assignedUnderwriterId ?? underwriter?._id ?? underwriter?.id ?? "");
  const underwriterName = personName(underwriter);
  const businessName = application.client?.business?.name ?? null;

  const isDraft = isWorkflowQueue(queue, WORKFLOW_QUEUE.AGENT_DRAFT) || isWorkflowQueue(queue, "New");
  const inUnderwriting = isWorkflowQueue(queue, WORKFLOW_QUEUE.UNDERWRITER);
  const needsReReview = inUnderwriting && isWorkflowQueue(application.currentState, WORKFLOW_STATE_NEEDS_RE_REVIEW);
  // "Agent Approval" is the legacy label of the Agent Review stage.
  const inAgentApproval = isWorkflowQueue(queue, WORKFLOW_QUEUE.AGENT_APPROVAL) || isWorkflowQueue(queue, "Agent Approval");
  const isoPending = isWorkflowQueue(queue, WORKFLOW_QUEUE.APPROVAL_SENT);
  const inContractStage = CONTRACT_STAGE_TOKENS.has(workflowToken(queue));
  const isSuperAdmin = appRole === "SUPER_ADMIN";
  /** Which workflow seat this viewer acts in for the current stage. */
  const actingRole = isSuperAdmin ? (inUnderwriting ? "UNDERWRITER" : "AGENT") : appRole;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["workflow-summary"] });
    void queryClient.invalidateQueries({ queryKey: ["workflow-queue"] });
    void queryClient.invalidateQueries({ queryKey: ["iso-email-thread", uuid] });
    void queryClient.invalidateQueries({ queryKey: ["workflow-notes"] });
    onChanged();
  };

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      refresh();
    } catch (err: any) {
      toast.error(err?.message || "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const status = <WorkflowStatusBadge queue={queue} className="ml-2 align-middle" />;
  let banner: ReactNode = null;

  if (actingRole === "UNDERWRITER") {
    if (inUnderwriting && !underwriterId) {
      banner = (
        <Banner
          tone="action"
          icon={<Hand className="size-5" />}
          title="Unclaimed application"
          actions={
            <Button loading={busy} onClick={() => void run(() => claimApplication(ref), "Application claimed — it is assigned to you.")}>
              Claim application
            </Button>
          }
        >
          Claim it to start underwriting. Until then the application is read-only.
        </Banner>
      );
    } else if (inUnderwriting && (underwriterId === me || isSuperAdmin)) {
      banner = (
        <Banner
          tone="action"
          icon={needsReReview ? <Undo2 className="size-5" /> : <Pencil className="size-5" />}
          title={
            needsReReview
              ? "Needs re-review — the Agent requested changes"
              : underwriterId === me
                ? "You are underwriting this application"
                : `Claimed by ${underwriterName || "another underwriter"}`
          }
          actions={
            <Button className="gap-1.5" onClick={() => setDialog("sendToAgent")}>
              <Send className="size-4" /> Send to Agent for approval
            </Button>
          }
        >
          {needsReReview
            ? "Check the Agent's note in the activity log, update the offer on the Create Offer tab, then send it back to the Agent."
            : "Review documents, background check and bank analysis, and create the offer on the Create Offer tab."}
        </Banner>
      );
    } else if (inUnderwriting) {
      banner = (
        <Banner tone="info" icon={<Clock className="size-5" />} title="Claimed by another underwriter">
          {underwriterName || "Another underwriter"} is working on this application.
        </Banner>
      );
    } else if (inAgentApproval) {
      banner = (
        <Banner tone="success" icon={<CheckCircle2 className="size-5" />} title="Sent to the Agent for approval">
          Waiting for {agentName} to review and send it to the ISO. The application is read-only.
        </Banner>
      );
    } else if (isoPending || inContractStage) {
      banner = (
        <Banner tone="success" icon={<CheckCircle2 className="size-5" />} title={isoPending ? "Awaiting ISO approval" : "ISO approved"}>
          {isoPending ? "The Agent sent the approval request to the ISO." : "The application moved to the contract stage."}
        </Banner>
      );
    }
  }

  if (actingRole === "AGENT") {
    if (isDraft) {
      banner = (
        <Banner
          tone="action"
          icon={<Pencil className="size-5" />}
          title="Draft application"
          actions={
            <>
              <Button variant="outline" className="gap-1.5" onClick={() => navigate(`/create-applications/${uuid}`)}>
                <Pencil className="size-4" /> Edit
              </Button>
              <Button
                className="gap-1.5"
                loading={busy}
                disabled={!iso}
                onClick={() => void run(() => submitToUnderwriting(ref), "Submitted to underwriting.")}
              >
                <Send className="size-4" /> Submit to underwriting
              </Button>
            </>
          }
        >
          {iso ? `Linked ISO: ${iso.name}.` : "Link an ISO (Edit) before submitting."} Submitting sends it to the
          Underwriter pool.
        </Banner>
      );
    } else if (inUnderwriting) {
      banner = (
        <Banner tone="info" icon={<Clock className="size-5" />} title="In underwriting">
          {underwriterName ? `${underwriterName} is underwriting this application.` : "Waiting for an underwriter to claim it."}
        </Banner>
      );
    } else if (inAgentApproval) {
      banner = (
        <Banner
          tone="action"
          icon={<CheckCircle2 className="size-5" />}
          title="Underwriting complete — your approval is needed"
          actions={
            <>
              <Button variant="outline" className="gap-1.5" onClick={() => setDialog("returnToUw")}>
                <Undo2 className="size-4" /> Request changes
              </Button>
              <Button className="gap-1.5" onClick={() => setDialog("sendToIso")} disabled={!iso}>
                <Mail className="size-4" /> Send to ISO for approval
              </Button>
            </>
          }
        >
          {underwriterName ? `Underwritten by ${underwriterName}. ` : ""}Review the offer on the Create Offer tab, then send it to{" "}
          {iso?.name || "the ISO"} for approval.
        </Banner>
      );
    } else if (isoPending) {
      banner = (
        <Banner
          tone="info"
          icon={<Clock className="size-5" />}
          title="Awaiting ISO approval"
          actions={
            <Button variant="outline" className="gap-1.5" onClick={() => setDialog("sendToIso")}>
              <Mail className="size-4" /> Resend to ISO
            </Button>
          }
        >
          {iso?.name || "The ISO"} has the approval link. It moves to Contract Pending as soon as they approve.
        </Banner>
      );
    } else if (inContractStage) {
      banner = (
        <Banner tone="success" icon={<CheckCircle2 className="size-5" />} title="ISO approved">
          The application is in the contract stage ({queue}).
        </Banner>
      );
    }
  }

  if (appRole === "CONTRACTS_LOG" && (inUnderwriting || inAgentApproval || isoPending)) {
    banner = (
      <Banner tone="info" icon={<Clock className="size-5" />} title="Agent / Underwriter workflow">
        Agent: {agentName}
        {underwriterName ? ` · Underwriter: ${underwriterName}` : inUnderwriting ? " · Unclaimed" : ""}
        {iso?.name ? ` · ISO: ${iso.name}` : ""}
      </Banner>
    );
  }

  const showEmailHistory = actingRole !== "UNDERWRITER" && (isoPending || inContractStage || inAgentApproval);

  if (!banner && !showEmailHistory) return null;

  return (
    <div className="mb-6 space-y-4">
      {banner ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workflow status {status}
          </p>
          {banner}
        </div>
      ) : null}
      {/* {showEmailHistory ? <IsoEmailThreadCard applicationUuid={uuid} /> : null} */}

      <WorkflowNoteDialog
        open={dialog === "sendToAgent"}
        onOpenChange={(open) => setDialog(open ? "sendToAgent" : null)}
        title="Send to Agent for approval"
        description={`Underwriting is complete. ${agentName} will review the offer and send it to the ISO.`}
        noteLabel="Note to the Agent (optional)"
        notePlaceholder="Summary of the offer, conditions, stips…"
        confirmLabel="Send to Agent"
        onConfirm={async (note) => {
          try {
            await sendToAgentApproval(ref, note);
            toast.success("Sent to the Agent for approval.");
            refresh();
          } catch (err: any) {
            toast.error(err?.message || "Failed to send to the Agent");
            throw err;
          }
        }}
      />
      <WorkflowNoteDialog
        open={dialog === "returnToUw"}
        onOpenChange={(open) => setDialog(open ? "returnToUw" : null)}
        title="Request changes from underwriting"
        description="The application goes back to the Underwriter with your note."
        noteLabel="What needs to change?"
        noteRequired
        confirmLabel="Return to Underwriter"
        onConfirm={async (note) => {
          try {
            await returnToUnderwriter(ref, note);
            toast.success("Returned to underwriting.");
            refresh();
          } catch (err: any) {
            toast.error(err?.message || "Failed to return to underwriting");
            throw err;
          }
        }}
      />
      {uuid ? (
        <SendToIsoDialog
          open={dialog === "sendToIso"}
          onOpenChange={(open) => setDialog(open ? "sendToIso" : null)}
          applicationUuid={uuid}
          isoName={iso?.name}
          isoEmail={iso?.email}
          businessName={businessName}
          resend={isoPending}
          onSent={refresh}
        />
      ) : null}
    </div>
  );
}
