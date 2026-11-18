import { useEffect, useMemo, useState } from "react";
import { toast } from "react-toastify";
import { Mail } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { axiosPost } from "@/redux/axios";
import { invalidateHttpGetCacheForResource } from "@/lib/httpGetCache";
import {
  APPLICATION_APPROVAL_CLIENT_NAME_PLACEHOLDER,
  APPLICATION_APPROVAL_COMPANY_NAME_PLACEHOLDER,
  APPLICATION_APPROVAL_EMAIL_SUBJECT,
  APPLICATION_APPROVAL_URL_PLACEHOLDER,
  renderApplicationApprovalEmailHtml,
} from "@/pages/templates";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parseEmails = (raw: string): string[] =>
  raw
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);

/** Agent → ISO approval request, emailed to the ISO through the system mailer (SendGrid). */
export default function SendToIsoDialog({
  open,
  onOpenChange,
  applicationUuid,
  isoName,
  isoEmail,
  businessName,
  resend,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationUuid: string;
  isoName?: string | null;
  isoEmail?: string | null;
  businessName?: string | null;
  /** True when the ISO was already emailed — UI wording only; the backend continues the same thread. */
  resend: boolean;
  onSent: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");

  useEffect(() => {
    if (!open) return;
    setTo(String(isoEmail ?? "").trim());
    setCc("");
  }, [open, isoEmail]);

  const ccList = useMemo(() => parseEmails(cc), [cc]);
  const toValid = EMAIL_PATTERN.test(to.trim());
  const ccValid = ccList.every((e) => EMAIL_PATTERN.test(e));
  const canSend = toValid && ccValid && !sending;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    const placeholders = {
      client_name: APPLICATION_APPROVAL_CLIENT_NAME_PLACEHOLDER,
      company_name: APPLICATION_APPROVAL_COMPANY_NAME_PLACEHOLDER,
      calculate_approval_url: APPLICATION_APPROVAL_URL_PLACEHOLDER,
      view_application_url: APPLICATION_APPROVAL_URL_PLACEHOLDER,
    };
    try {
      await axiosPost("/applications/send-approval-email", {
        applicationId: applicationUuid,
        // Always the approval template. (The backend "resend" flag switches to the Super Admin
        // "offer values updated" template, not wanted here.)
        resend: false,
        emailHtml: renderApplicationApprovalEmailHtml(placeholders),
        emailSubject: APPLICATION_APPROVAL_EMAIL_SUBJECT,
        isoEmail: to.trim(),
        ccEmails: ccList,
      });
      invalidateHttpGetCacheForResource("applications");
      toast.success("ISO approval email sent. The application is now awaiting ISO approval.");
      onSent();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || "Failed to send the ISO approval email");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => !sending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{resend ? "Resend to ISO for approval" : "Send to ISO for approval"}</DialogTitle>
          <DialogDescription>
            {isoName ? `${isoName} ` : "The ISO "}receives a secure approval link for{" "}
            {businessName || "this application"}. Once they approve, the application moves to Contract
            Pending automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="iso-to">ISO email</Label>
              <Input
                id="iso-to"
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="iso@example.com"
              />
              {to && !toValid ? <p className="text-xs text-destructive">Enter a valid email address.</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iso-cc">CC (optional)</Label>
              <Input
                id="iso-cc"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="name@example.com, other@example.com"
              />
              {!ccValid ? <p className="text-xs text-destructive">One of the CC addresses is invalid.</p> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Subject: {APPLICATION_APPROVAL_EMAIL_SUBJECT}
            </p>
          </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            Cancel
          </Button>
          <Button onClick={() => void handleSend()} disabled={!canSend} loading={sending} className="gap-1.5">
            <Mail className="size-4" />
            {resend ? "Resend to ISO" : "Send to ISO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
