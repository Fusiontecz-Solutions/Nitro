import { useEffect, useMemo, useState } from "react";
import { Loader2, Share2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type {
  FunderProfile,
  SignNowTemplateLinkItem,
} from "@/types/integrationSettingsTypes";
import {
  FUNDER_TEMPLATE_KIND_LABELS,
  funderTemplatesForKind,
  funderTemplateIdentity,
  type FunderTemplateKind,
} from "./funderTemplateSharing";

type Props = {
  open: boolean;
  kind: FunderTemplateKind;
  /** Templates the user ticked on the source funder. */
  items: SignNowTemplateLinkItem[];
  sourceFunderId?: string | null;
  sourceFunderName?: string;
  funders: FunderProfile[];
  onClose: () => void;
  /** Sends the share to the server and resolves with its summary message. */
  onShare: (targetFunderIds: string[]) => Promise<string>;
  onShared?: (message: string) => void;
};

export default function ShareFunderTemplatesDialog({
  open,
  kind,
  items,
  sourceFunderId,
  sourceFunderName,
  funders,
  onClose,
  onShare,
  onShared,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels = FUNDER_TEMPLATE_KIND_LABELS[kind];

  useEffect(() => {
    if (!open) return;
    setSelectedIds([]);
    setSearch("");
    setSharing(false);
    setError(null);
  }, [open, kind]);

  const candidates = useMemo(
    () => funders.filter((funder) => funder?.id && funder.id !== sourceFunderId),
    [funders, sourceFunderId],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return candidates;
    return candidates.filter((funder) =>
      `${funder.name} ${funder.displayName ?? ""}`.toLowerCase().includes(term),
    );
  }, [candidates, search]);

  const selectedIdentities = useMemo(
    () => new Set(items.map((item) => funderTemplateIdentity(item))),
    [items],
  );

  /** How many of the selected templates the target funder is still missing. */
  const missingCountFor = (funder: FunderProfile): number => {
    const existing = new Set(
      funderTemplatesForKind(funder, kind).map((item) => funderTemplateIdentity(item)),
    );
    let missing = 0;
    for (const identity of selectedIdentities) {
      if (!existing.has(identity)) missing += 1;
    }
    return missing;
  };

  const toggle = (funderId: string) => {
    setSelectedIds((prev) =>
      prev.includes(funderId)
        ? prev.filter((id) => id !== funderId)
        : [...prev, funderId],
    );
  };

  const handleShare = async () => {
    const targetFunderIds = candidates
      .filter((funder) => selectedIds.includes(funder.id))
      .map((funder) => funder.id);
    if (!targetFunderIds.length) {
      setError("Pick at least one funder to share with.");
      return;
    }

    setSharing(true);
    setError(null);
    try {
      // The server merges against each target's live row and reports what it did.
      const message = await onShare(targetFunderIds);
      onShared?.(message);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : `Failed to share ${labels.plural}`);
    } finally {
      setSharing(false);
    }
  };

  const shareLabel = selectedIds.length
    ? `Share with ${selectedIds.length} ${selectedIds.length === 1 ? "funder" : "funders"}`
    : "Share";

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-4 w-4" />
            Share {labels.plural} with another funder
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {items.length === 1
              ? `"${items[0].name || items[0].link}" will be copied`
              : `${items.length} selected ${labels.plural} will be copied`}
            {sourceFunderName ? ` from ${sourceFunderName}` : ""} to every funder you
            pick. Each funder keeps its own copy, so editing one later does not change
            the others.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          {candidates.length > 6 ? (
            <Input
              value={search}
              placeholder="Search funders…"
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : null}

          {candidates.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              There is no other funder to share with yet.
            </p>
          ) : visible.length === 0 ? (
            <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              No funder matches that search.
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-1">
              {visible.map((funder) => {
                const missing = missingCountFor(funder);
                const checked = selectedIds.includes(funder.id);
                return (
                  <label
                    key={funder.id}
                    className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(funder.id)}
                      aria-label={`Share with ${funder.name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {funder.name}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {missing === 0
                          ? `Already has ${items.length === 1 ? "this one" : "all of these"}`
                          : `${missing} new ${
                              missing === 1 ? labels.singular : labels.plural
                            } will be added`}
                        {funder.isActive ? "" : " · inactive"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={sharing}>
            Cancel
          </Button>
          <Button
            type="button"
            className="gap-2 bg-[image:var(--brand-gradient)] hover:opacity-90"
            onClick={() => void handleShare()}
            disabled={sharing || selectedIds.length === 0}
          >
            {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {sharing ? "Sharing…" : shareLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
