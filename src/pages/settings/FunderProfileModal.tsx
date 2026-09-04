import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  FunderProfile,
  FunderProfileInput,
  SignNowTemplateLinkItem,
} from "@/types/integrationSettingsTypes";

type Props = {
  open: boolean;
  saving?: boolean;
  initial?: FunderProfile | null;
  allFunders?: FunderProfile[];
  docusignOptions?: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (payload: FunderProfileInput) => Promise<void>;
};

type LinkRow = SignNowTemplateLinkItem & { key: string };

function newRow(partial?: Partial<SignNowTemplateLinkItem>): LinkRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: partial?.name ?? "",
    link: partial?.link ?? "",
  };
}

function toRows(items?: SignNowTemplateLinkItem[] | null): LinkRow[] {
  if (!items?.length) return [];
  return items.map((item) => newRow(item));
}

function cleanRows(rows: LinkRow[]): SignNowTemplateLinkItem[] {
  return rows
    .map((row) => ({
      name: row.name.trim(),
      link: row.link.trim(),
    }))
    .filter((row) => row.name || row.link);
}

function TemplateLinkList({
  title,
  description,
  rows,
  addLabel,
  onChange,
}: {
  title: string;
  description: string;
  rows: LinkRow[];
  addLabel: string;
  onChange: (next: LinkRow[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => onChange([...rows, newRow()])}
        >
          <Plus className="h-4 w-4" />
          {addLabel}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No items yet. Click “{addLabel}” to add one.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[1fr_1.4fr_auto]"
            >
              <div className="grid gap-1.5">
                <Label htmlFor={`${title}-name-${row.key}`}>Name</Label>
                <Input
                  id={`${title}-name-${row.key}`}
                  value={row.name}
                  placeholder={
                    title.toLowerCase().includes("disclosure")
                      ? "e.g. Texas Daily Disclosure"
                      : "e.g. ACH Weekly"
                  }
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = { ...row, name: e.target.value };
                    onChange(next);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`${title}-link-${row.key}`}>SignNow template link</Label>
                <Input
                  id={`${title}-link-${row.key}`}
                  value={row.link}
                  placeholder="Paste SignNow template link or id"
                  onChange={(e) => {
                    const next = [...rows];
                    next[index] = { ...row, link: e.target.value };
                    onChange(next);
                  }}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-destructive"
                  aria-label={`Remove ${title} row`}
                  onClick={() => onChange(rows.filter((item) => item.key !== row.key))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FunderProfileModal({
  open,
  saving,
  initial,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState("");
  const [defaultCcEmail, setDefaultCcEmail] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [contractLink, setContractLink] = useState("");
  const [addendums, setAddendums] = useState<LinkRow[]>([]);
  const [disclosures, setDisclosures] = useState<LinkRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDefaultCcEmail(initial?.defaultCcEmail ?? "");
    setIsActive(initial?.isActive !== false);
    setContractLink(initial?.signnowContractTemplateLink ?? "");
    setAddendums(toRows(initial?.signnowAddendumTemplates));
    setDisclosures(toRows(initial?.signnowDisclosureTemplates));
    setError(null);
  }, [open, initial]);

  const handleSubmit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Funder name is required.");
      return;
    }

    const incompleteAddendum = addendums.find(
      (row) => Boolean(row.name.trim()) !== Boolean(row.link.trim()),
    );
    if (incompleteAddendum) {
      setError("Each addendum needs both a name and a SignNow link.");
      return;
    }

    const incompleteDisclosure = disclosures.find(
      (row) => Boolean(row.name.trim()) !== Boolean(row.link.trim()),
    );
    if (incompleteDisclosure) {
      setError("Each disclosure needs both a name and a SignNow link.");
      return;
    }

    setError(null);
    const payload: FunderProfileInput = {
      name: trimmedName,
      defaultCcEmail: defaultCcEmail.trim() || "",
      isActive,
      signnowContractTemplateLink: contractLink.trim() || null,
      signnowAddendumTemplates: cleanRows(addendums),
      signnowDisclosureTemplates: cleanRows(disclosures),
      // SignNow funders manage their own document links.
      documentsSource: "own",
      addendumDocumentsSource: "own",
      disclosureDocumentsSource: "own",
    };

    await onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => (!next ? onClose() : undefined)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit funder" : "Add funder"}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Paste SignNow template links for the main contract, addendums, and disclosures.
          </p>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid gap-2">
            <Label htmlFor="funder-name">Funder name</Label>
            <Input
              id="funder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nitro Advance"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="funder-cc">Default CC email(s)</Label>
            <Input
              id="funder-cc"
              value={defaultCcEmail}
              onChange={(e) => setDefaultCcEmail(e.target.value)}
              placeholder="Optional — comma-separated emails"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border"
            />
            Active (show in Create Contract)
          </label>

          <div className="grid gap-2 rounded-lg border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
            <Label htmlFor="contract-link">Main contract SignNow link</Label>
            <Input
              id="contract-link"
              value={contractLink}
              onChange={(e) => setContractLink(e.target.value)}
              placeholder="Paste the main contract template link or id"
            />
            <p className="text-xs text-muted-foreground">
              This is the primary SignNow template used when sending contracts for this funder.
            </p>
          </div>

          <TemplateLinkList
            title="Addendums"
            description="Add any number of addendum templates (name + SignNow link)."
            rows={addendums}
            addLabel="Add addendum"
            onChange={setAddendums}
          />

          <TemplateLinkList
            title="Disclosures"
            description="Add any number of disclosure templates (name + SignNow link)."
            rows={disclosures}
            addLabel="Add disclosure"
            onChange={setDisclosures}
          />

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={Boolean(saving)}>
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-[image:var(--brand-gradient)] hover:opacity-90"
            onClick={() => void handleSubmit()}
            disabled={Boolean(saving)}
          >
            {saving ? "Saving…" : initial ? "Save funder" : "Add funder"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
