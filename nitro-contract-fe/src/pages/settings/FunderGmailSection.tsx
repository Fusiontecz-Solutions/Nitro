import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Mail, RefreshCw, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  disconnectFunderGmailAccount,
  fetchFunderGmailStatus,
  startFunderGmailConnect,
  verifyFunderGmailConnection,
} from "@/redux/actions/integrationSettingsActions";
import type { FunderGmailStatus, FunderMailProvider } from "@/types/integrationSettingsTypes";

type Props = {
  /** Saved funder id; Gmail can only be connected to a saved funder. */
  funderId?: string | null;
  mailProvider: FunderMailProvider;
  onMailProviderChange: (provider: FunderMailProvider) => void;
};

const errorMessage = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
  (err instanceof Error ? err.message : fallback);

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString() : "—");

/**
 * Funder Gmail connection + provider selector (Settings → Funders → Edit).
 * SendGrid stays the default; Gmail becomes selectable only once the funder's
 * mailbox is connected and verified by the server. Tokens never reach the browser.
 */
export default function FunderGmailSection({ funderId, mailProvider, onMailProviderChange }: Props) {
  const [status, setStatus] = useState<FunderGmailStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"connect" | "verify" | "disconnect" | null>(null);

  const load = useCallback(
    async (probe = false) => {
      if (!funderId) return;
      setLoading(true);
      try {
        setStatus(await fetchFunderGmailStatus(funderId, { probe }));
      } catch (err) {
        toast.error(errorMessage(err, "Could not load Gmail status"));
      } finally {
        setLoading(false);
      }
    },
    [funderId],
  );

  useEffect(() => {
    setStatus(null);
    void load(true);
  }, [load]);

  const canUseGmail = Boolean(status?.canUseGmail);

  // A funder left on Gmail whose mailbox stopped working is shown as such; the
  // server already falls back to SendGrid for its sends until it is reconnected.
  const gmailSelectedButUnavailable = mailProvider === "gmail" && status !== null && !canUseGmail;

  const handleConnect = async () => {
    if (!funderId) return;
    setBusy("connect");
    try {
      const url = await startFunderGmailConnect(funderId, "/user-setting?tab=funders");
      if (!url) throw new Error("Gmail connection is not available");
      // Google's consent screen cannot be framed — leave the app and come back.
      window.location.assign(url);
    } catch (err) {
      toast.error(errorMessage(err, "Could not start Gmail connection"));
      setBusy(null);
    }
  };

  const handleVerify = async () => {
    if (!funderId) return;
    setBusy("verify");
    try {
      const next = await verifyFunderGmailConnection(funderId);
      setStatus(next);
      if (next.verified) toast.success("Gmail connection verified");
      else toast.error(next.lastError || "Gmail connection could not be verified — reconnect it");
    } catch (err) {
      toast.error(errorMessage(err, "Could not verify Gmail connection"));
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    if (!funderId) return;
    if (
      !window.confirm(
        "Disconnect this funder's Gmail? Its emails will go out through SendGrid again until Gmail is reconnected.",
      )
    ) {
      return;
    }
    setBusy("disconnect");
    try {
      setStatus(await disconnectFunderGmailAccount(funderId));
      onMailProviderChange("sendgrid");
      toast.success("Gmail disconnected — this funder now sends through SendGrid");
    } catch (err) {
      toast.error(errorMessage(err, "Could not disconnect Gmail"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <Label className="text-sm font-semibold">Outbound email provider</Label>
      </div>

      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Outbound email provider">
        <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary">
          <input
            type="radio"
            name="funder-mail-provider"
            className="mt-0.5"
            checked={mailProvider === "sendgrid"}
            onChange={() => onMailProviderChange("sendgrid")}
          />
          <span>
            <span className="font-medium">SendGrid</span> (default)
            <span className="block text-xs text-muted-foreground">Uses the SendGrid sender above.</span>
          </span>
        </label>
        <label
          className={`flex items-start gap-2 rounded-md border p-3 text-sm has-[:checked]:border-primary ${
            canUseGmail ? "cursor-pointer" : "cursor-not-allowed opacity-60"
          }`}
          title={canUseGmail ? undefined : "Connect and verify this funder's Gmail first"}
        >
          <input
            type="radio"
            name="funder-mail-provider"
            className="mt-0.5"
            checked={mailProvider === "gmail"}
            disabled={!canUseGmail}
            onChange={() => onMailProviderChange("gmail")}
          />
          <span>
            <span className="font-medium">Gmail</span>
            <span className="block text-xs text-muted-foreground">
              {canUseGmail ? `Sends from ${status?.sendAsEmail || status?.gmailEmail}` : "Available after connecting Gmail"}
            </span>
          </span>
        </label>
      </div>

      {!funderId ? (
        <p className="text-xs text-muted-foreground">Save this funder first, then connect its Gmail account.</p>
      ) : loading && !status ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking Gmail connection…
        </p>
      ) : status && !status.configured ? (
        <p className="text-xs text-muted-foreground">
          Gmail connection is not configured on the server (Google OAuth client).
        </p>
      ) : status ? (
        <div className="grid gap-2 text-sm">
          {status.connected && canUseGmail ? (
            <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Connected: {status.gmailEmail}
            </p>
          ) : status.needsReconnect ? (
            <p className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> Reconnect needed{status.gmailEmail ? ` (${status.gmailEmail})` : ""}
            </p>
          ) : (
            <p className="text-muted-foreground">No Gmail account connected.</p>
          )}

          {status.connected && status.senderMatchesMailbox === false ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {status.senderEmail} is not a verified "Send mail as" address on {status.gmailEmail}; Gmail will send
              as {status.gmailEmail}.
            </p>
          ) : null}
          {gmailSelectedButUnavailable ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Gmail is selected but not usable right now — this funder's emails fall back to SendGrid until it is
              reconnected.
            </p>
          ) : null}
          {status.lastError && !canUseGmail ? (
            <p className="text-xs text-muted-foreground">Last error: {status.lastError}</p>
          ) : null}
          {status.connected ? (
            <p className="text-xs text-muted-foreground">
              Verified {formatDate(status.verifiedAt)}
              {status.connectedBy ? ` · connected by ${status.connectedBy}` : ""}
              {status.lastUsedAt ? ` · last used ${formatDate(status.lastUsedAt)}` : ""}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={status.connected ? "outline" : "default"} onClick={handleConnect} disabled={busy !== null}>
              {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              {status.connected || status.needsReconnect ? "Reconnect Gmail" : "Connect Gmail"}
            </Button>
            {status.connected || status.needsReconnect ? (
              <>
                <Button type="button" size="sm" variant="outline" onClick={handleVerify} disabled={busy !== null}>
                  {busy === "verify" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Check connection
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleDisconnect} disabled={busy !== null}>
                  {busy === "disconnect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                  Disconnect
                </Button>
              </>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Connecting leaves this page for Google — save other changes first. Sign in with the funder's mailbox,
            not your own account.
          </p>
        </div>
      ) : null}
    </div>
  );
}
