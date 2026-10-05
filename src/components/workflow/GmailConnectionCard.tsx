import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Mail, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { disconnectGmail, fetchGmailStatus, startGmailConnect } from "@/lib/workflowApi";

/** Connect / disconnect the signed-in user's Gmail (Agents send ISO approval mail from it). */
export default function GmailConnectionCard() {
  const queryClient = useQueryClient();
  const [working, setWorking] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["gmail-status"],
    queryFn: () => fetchGmailStatus(true),
    staleTime: 60_000,
  });

  const handleConnect = async () => {
    setWorking(true);
    try {
      await startGmailConnect("/user-setting?tab=email");
    } catch (err: any) {
      toast.error(err?.message || "Could not start Gmail connection");
      setWorking(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Disconnect Gmail? You will not be able to send ISO approval emails until you reconnect.")) {
      return;
    }
    setWorking(true);
    try {
      await disconnectGmail();
      toast.success("Gmail disconnected");
      await queryClient.invalidateQueries({ queryKey: ["gmail-status"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to disconnect Gmail");
    } finally {
      setWorking(false);
    }
  };

  const connected = Boolean(data?.connected);
  const needsReconnect = Boolean(data?.needsReconnect);

  return (
    <Card className="border-border">
      <CardHeader className="border-b bg-muted/40 backdrop-blur-sm">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mail className="size-5" /> Email connection
        </CardTitle>
        <CardDescription>
          ISO approval requests are sent from your own Gmail mailbox, and follow-ups stay on the same email thread
          so the ISO&apos;s replies are linked to the application.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking connection…
          </p>
        ) : error ? (
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        ) : !data?.configured ? (
          <div className="flex gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
            Gmail connection is not configured on the server yet (Google OAuth client). Contact your administrator.
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              {connected && !needsReconnect ? (
                <CheckCircle2 className="mt-0.5 size-5 text-emerald-500" />
              ) : (
                <AlertTriangle className="mt-0.5 size-5 text-amber-500" />
              )}
              <div className="text-sm">
                <p className="font-medium text-foreground">
                  {connected
                    ? needsReconnect
                      ? "Connection expired — reconnect Gmail"
                      : `Connected as ${data.gmailEmail || "your Gmail account"}`
                    : "Gmail is not connected"}
                </p>
                <p className="text-muted-foreground">
                  {connected && data.connectedAt
                    ? `Connected ${new Date(data.connectedAt).toLocaleString()}`
                    : "Connect to send ISO approval emails."}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {connected ? (
                <Button variant="outline" className="gap-1.5" onClick={() => void handleDisconnect()} disabled={working}>
                  <Unlink className="size-4" /> Disconnect
                </Button>
              ) : null}
              {!connected || needsReconnect ? (
                <Button
                  className="gap-1.5 bg-[image:var(--brand-gradient)] hover:opacity-90"
                  onClick={() => void handleConnect()}
                  loading={working}
                >
                  <Link2 className="size-4" /> {connected ? "Reconnect Gmail" : "Connect Gmail"}
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
