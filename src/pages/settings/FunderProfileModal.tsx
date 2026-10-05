import { useEffect, useRef, useState } from "react";
import { ChevronDown, Info, Plus, Share2, Trash2, Upload } from "lucide-react";

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
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  FunderProfile,
  FunderProfileInput,
  SignNowTemplateLinkItem,
} from "@/types/integrationSettingsTypes";
import type { FunderProfileFiles } from "@/redux/actions/integrationSettingsActions";
import { DEFAULT_LETTER_EMAIL_BRANDING } from "@/pages/templates/letterEmailBranding";
import ShareFunderTemplatesDialog from "./ShareFunderTemplatesDialog";
import {
  funderTemplateIdentity,
  type FunderTemplateKind,
} from "./funderTemplateSharing";

type Props = {
  open: boolean;
  saving?: boolean;
  initial?: FunderProfile | null;
  allFunders?: FunderProfile[];
  docusignOptions?: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (
    payload: FunderProfileInput,
    files?: FunderProfileFiles | null,
  ) => Promise<void>;
  /** Sends a share to the server; resolves with the summary to toast. */
  onShareTemplates?: (input: {
    sourceFunderId: string;
    kind: FunderTemplateKind;
    templates: SignNowTemplateLinkItem[];
    targetFunderIds: string[];
  }) => Promise<string>;
  /** Called once a share finished, with a summary suitable for a toast. */
  onShareComplete?: (message: string) => void;
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

function normalizeHex(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) return `#${trimmed}`;
  return fallback;
}

function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function TemplateLinkList({
  title,
  description,
  rows,
  addLabel,
  onChange,
  selectedKeys,
  onSelectionChange,
  onShareSelected,
  shareDisabledReason,
  isRowShareable,
}: {
  title: string;
  description: string;
  rows: LinkRow[];
  addLabel: string;
  onChange: (next: LinkRow[]) => void;
  selectedKeys: string[];
  onSelectionChange: (next: string[]) => void;
  onShareSelected: () => void;
  /** When set, sharing is unavailable and this explains why. */
  shareDisabledReason?: string | null;
  /** A row can only be shared once it exists on the saved funder. */
  isRowShareable: (row: LinkRow) => boolean;
}) {
  const shareableKeys = rows.filter(isRowShareable).map((row) => row.key);
  const selectedShareable = selectedKeys.filter((key) => shareableKeys.includes(key));
  const allSelected =
    shareableKeys.length > 0 && selectedShareable.length === shareableKeys.length;

  const toggleRow = (key: string) => {
    onSelectionChange(
      selectedKeys.includes(key)
        ? selectedKeys.filter((item) => item !== key)
        : [...selectedKeys, key],
    );
  };

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

      {shareableKeys.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={allSelected}
              onCheckedChange={() =>
                onSelectionChange(allSelected ? [] : shareableKeys)
              }
              aria-label={`Select all ${title.toLowerCase()}`}
            />
            {selectedShareable.length
              ? `${selectedShareable.length} selected`
              : "Select to share"}
          </label>
          <div className="flex items-center gap-2">
            {shareDisabledReason && selectedShareable.length ? (
              <span className="text-xs text-muted-foreground">
                {shareDisabledReason}
              </span>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={selectedShareable.length === 0 || Boolean(shareDisabledReason)}
              onClick={onShareSelected}
            >
              <Share2 className="h-4 w-4" />
              Share with funder
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
          No items yet. Click “{addLabel}” to add one.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div
              key={row.key}
              className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-[auto_1fr_1.4fr_auto]"
            >
              <div className="flex items-end pb-2.5">
                <Checkbox
                  checked={selectedKeys.includes(row.key)}
                  disabled={!shareableKeys.includes(row.key)}
                  onCheckedChange={() => toggleRow(row.key)}
                  aria-label={`Select ${row.name.trim() || title} for sharing`}
                  title={
                    shareableKeys.includes(row.key)
                      ? undefined
                      : "Save this funder before sharing this row."
                  }
                />
              </div>
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
  allFunders,
  onClose,
  onSave,
  onShareTemplates,
  onShareComplete,
}: Props) {
  const [activeTab, setActiveTab] = useState("setup");
  const [name, setName] = useState("");
  const [defaultCcEmail, setDefaultCcEmail] = useState("");
  const [sendgridFromEmail, setSendgridFromEmail] = useState("");
  const [sendgridFromName, setSendgridFromName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [contractLink, setContractLink] = useState("");
  const [addendums, setAddendums] = useState<LinkRow[]>([]);
  const [disclosures, setDisclosures] = useState<LinkRow[]>([]);
  const [selectedAddendumKeys, setSelectedAddendumKeys] = useState<string[]>([]);
  const [selectedDisclosureKeys, setSelectedDisclosureKeys] = useState<string[]>([]);
  const [shareKind, setShareKind] = useState<FunderTemplateKind | null>(null);
  const [letterCompanyName, setLetterCompanyName] = useState("");
  const [letterLogoUrl, setLetterLogoUrl] = useState("");
  const [letterLogoFile, setLetterLogoFile] = useState<File | null>(null);
  const [letterWatermarkUrl, setLetterWatermarkUrl] = useState("");
  const [letterAccentStripLight, setLetterAccentStripLight] = useState("");
  const [letterAccentStripDark, setLetterAccentStripDark] = useState("");
  const [letterInfoTableIconBg, setLetterInfoTableIconBg] = useState("");
  const [letterWireBankName, setLetterWireBankName] = useState("");
  const [letterWireAddressLine1, setLetterWireAddressLine1] = useState("");
  const [letterWireCityStateZip, setLetterWireCityStateZip] = useState("");
  const [letterWireRoutingNumber, setLetterWireRoutingNumber] = useState("");
  const [letterWireAccountNumber, setLetterWireAccountNumber] = useState("");
  const [wireOpen, setWireOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setActiveTab("setup");
    setName(initial?.name ?? "");
    setDefaultCcEmail(initial?.defaultCcEmail ?? "");
    setSendgridFromEmail(initial?.sendgridFromEmail ?? "");
    setSendgridFromName(initial?.sendgridFromName ?? "");
    setIsActive(initial?.isActive !== false);
    setContractLink(initial?.signnowContractTemplateLink ?? "");
    setAddendums(toRows(initial?.signnowAddendumTemplates));
    setDisclosures(toRows(initial?.signnowDisclosureTemplates));
    setSelectedAddendumKeys([]);
    setSelectedDisclosureKeys([]);
    setShareKind(null);
    setLetterCompanyName(initial?.letterCompanyName ?? "");
    setLetterLogoUrl(initial?.letterLogoUrl ?? "");
    setLetterLogoFile(null);
    setLetterWatermarkUrl(initial?.letterWatermarkUrl ?? "");
    setLetterAccentStripLight(initial?.letterAccentStripLight ?? "");
    setLetterAccentStripDark(initial?.letterAccentStripDark ?? "");
    setLetterInfoTableIconBg(initial?.letterInfoTableIconBg ?? "");
    setLetterWireBankName(initial?.letterWireBankName ?? "");
    setLetterWireAddressLine1(initial?.letterWireAddressLine1 ?? "");
    setLetterWireCityStateZip(initial?.letterWireCityStateZip ?? "");
    setLetterWireRoutingNumber(initial?.letterWireRoutingNumber ?? "");
    setLetterWireAccountNumber(initial?.letterWireAccountNumber ?? "");
    setWireOpen(true);
    setError(null);
  }, [open, initial]);

  const [logoObjectUrl, setLogoObjectUrl] = useState("");

  useEffect(() => {
    if (!letterLogoFile) {
      setLogoObjectUrl("");
      return;
    }
    const url = URL.createObjectURL(letterLogoFile);
    setLogoObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [letterLogoFile]);

  const logoPreviewUrl = logoObjectUrl || letterLogoUrl.trim();

  const previewLight = normalizeHex(
    letterAccentStripLight,
    DEFAULT_LETTER_EMAIL_BRANDING.accentStripLight,
  );
  const previewDark = normalizeHex(
    letterAccentStripDark,
    DEFAULT_LETTER_EMAIL_BRANDING.accentStripDark,
  );
  const previewIconBg = normalizeHex(
    letterInfoTableIconBg,
    DEFAULT_LETTER_EMAIL_BRANDING.infoTableIconBg,
  );

  const hasWirePreview =
    letterCompanyName.trim() ||
    letterWireBankName.trim() ||
    letterWireAddressLine1.trim() ||
    letterWireCityStateZip.trim() ||
    letterWireRoutingNumber.trim() ||
    letterWireAccountNumber.trim();

  const otherFunders = (allFunders ?? []).filter(
    (funder) => funder.id && funder.id !== initial?.id,
  );

  /**
   * Sharing writes straight to the target funders, so it needs a saved source
   * funder to share from and at least one other funder to share to.
   */
  const shareDisabledReason = !onShareTemplates
    ? "Sharing is unavailable here."
    : !initial
      ? "Save this funder first, then share its templates."
      : otherFunders.length === 0
        ? "There is no other funder to share with yet."
        : null;

  /**
   * The server only shares templates already saved on the source funder, so a
   * row the user just typed cannot be ticked until the funder is saved.
   */
  const savedAddendumIdentities = new Set(
    (initial?.signnowAddendumTemplates ?? []).map(funderTemplateIdentity),
  );
  const savedDisclosureIdentities = new Set(
    (initial?.signnowDisclosureTemplates ?? []).map(funderTemplateIdentity),
  );
  const rowIsShareable = (row: LinkRow, saved: Set<string>) =>
    Boolean(row.name.trim() && row.link.trim()) &&
    saved.has(funderTemplateIdentity({ name: row.name.trim(), link: row.link.trim() }));

  const shareRows = shareKind === "addendum" ? addendums : disclosures;
  const shareSelectedKeys =
    shareKind === "addendum" ? selectedAddendumKeys : selectedDisclosureKeys;
  const shareSaved =
    shareKind === "addendum" ? savedAddendumIdentities : savedDisclosureIdentities;
  const shareItems = shareRows
    .filter((row) => shareSelectedKeys.includes(row.key) && rowIsShareable(row, shareSaved))
    .map((row) => ({ name: row.name.trim(), link: row.link.trim() }));

  /** Keeps the share selection in sync when rows are edited or removed. */
  const applyRows = (
    next: LinkRow[],
    setRows: (rows: LinkRow[]) => void,
    selected: string[],
    setSelected: (keys: string[]) => void,
  ) => {
    setRows(next);
    const liveKeys = new Set(next.map((row) => row.key));
    const pruned = selected.filter((key) => liveKeys.has(key));
    if (pruned.length !== selected.length) setSelected(pruned);
  };

  const buildPayload = (): FunderProfileInput | null => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Funder name is required.");
      return null;
    }

    const incompleteAddendum = addendums.find(
      (row) => Boolean(row.name.trim()) !== Boolean(row.link.trim()),
    );
    if (incompleteAddendum) {
      setError("Each addendum needs both a name and a SignNow link.");
      setActiveTab("setup");
      return null;
    }

    const incompleteDisclosure = disclosures.find(
      (row) => Boolean(row.name.trim()) !== Boolean(row.link.trim()),
    );
    if (incompleteDisclosure) {
      setError("Each disclosure needs both a name and a SignNow link.");
      setActiveTab("setup");
      return null;
    }

    const trimmedSendgridFrom = sendgridFromEmail.trim();
    if (trimmedSendgridFrom && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedSendgridFrom)) {
      setError("SendGrid From Email must be a single valid email address.");
      setActiveTab("setup");
      return null;
    }
    const trimmedSendgridName = sendgridFromName.trim();
    if (Boolean(trimmedSendgridFrom) !== Boolean(trimmedSendgridName)) {
      setError(
        "SendGrid From Email and From Name go together — set both (e.g. Tiberian Funding) or leave both blank.",
      );
      setActiveTab("setup");
      return null;
    }

    setError(null);
    return {
      name: trimmedName,
      defaultCcEmail: defaultCcEmail.trim() || "",
      sendgridFromEmail: trimmedSendgridFrom,
      sendgridFromName: trimmedSendgridName,
      isActive,
      signnowContractTemplateLink: contractLink.trim() || null,
      signnowAddendumTemplates: cleanRows(addendums),
      signnowDisclosureTemplates: cleanRows(disclosures),
      letterCompanyName: letterCompanyName.trim() || null,
      letterLogoUrl: letterLogoFile ? undefined : letterLogoUrl.trim() || null,
      letterWatermarkUrl: letterWatermarkUrl.trim() || null,
      letterAccentStripLight: letterAccentStripLight.trim() || null,
      letterAccentStripDark: letterAccentStripDark.trim() || null,
      letterInfoTableIconBg: letterInfoTableIconBg.trim() || null,
      letterWireBankName: letterWireBankName.trim() || null,
      letterWireAddressLine1: letterWireAddressLine1.trim() || null,
      letterWireCityStateZip: letterWireCityStateZip.trim() || null,
      letterWireRoutingNumber: letterWireRoutingNumber.trim() || null,
      letterWireAccountNumber: letterWireAccountNumber.trim() || null,
      documentsSource: "own",
      addendumDocumentsSource: "own",
      disclosureDocumentsSource: "own",
    };
  };

  const handleSubmit = async () => {
    const payload = buildPayload();
    if (!payload) return;
    await onSave(payload, letterLogoFile ? { letterLogoFile } : null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next: boolean) => (!next ? onClose() : undefined)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {initial ? `Edit ${initial.name}` : "Add funder"}
            </DialogTitle>
            <p className="text-sm text-muted-foreground">
              Update funder settings, manage SignNow templates, and configure letter branding.
            </p>
          </DialogHeader>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="setup">1. Funder setup</TabsTrigger>
              <TabsTrigger value="letter" disabled={!initial}>
                2. Letter Info
              </TabsTrigger>
            </TabsList>

            <TabsContent value="setup" className="space-y-5 mt-2">
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

              <div className="grid gap-2">
                <Label htmlFor="funder-sendgrid-from">SendGrid From Email</Label>
                <Input
                  id="funder-sendgrid-from"
                  type="email"
                  value={sendgridFromEmail}
                  onChange={(e) => setSendgridFromEmail(e.target.value)}
                  placeholder="e.g. contracts@nitroadvance.com"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="funder-sendgrid-from-name">SendGrid From Name</Label>
                <Input
                  id="funder-sendgrid-from-name"
                  value={sendgridFromName}
                  onChange={(e) => setSendgridFromName(e.target.value)}
                  placeholder="e.g. Tiberian Funding"
                />
                <p className="text-xs text-muted-foreground">
                  The verified SendGrid sender identity for this funder's contract, SignNow and payment
                  emails. Recipients see "From Name &lt;From Email&gt;". Leave both blank to use the
                  server default (SENDGRID_FROM_EMAIL / SENDGRID_FROM_NAME).
                </p>
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
                description="Add any number of addendum templates (name + SignNow link), or tick some and share them with another funder."
                rows={addendums}
                addLabel="Add addendum"
                onChange={(next) =>
                  applyRows(
                    next,
                    setAddendums,
                    selectedAddendumKeys,
                    setSelectedAddendumKeys,
                  )
                }
                selectedKeys={selectedAddendumKeys}
                onSelectionChange={setSelectedAddendumKeys}
                onShareSelected={() => setShareKind("addendum")}
                shareDisabledReason={shareDisabledReason}
                isRowShareable={(row) => rowIsShareable(row, savedAddendumIdentities)}
              />

              <TemplateLinkList
                title="Disclosures"
                description="Add any number of disclosure templates (name + SignNow link), or tick some and share them with another funder."
                rows={disclosures}
                addLabel="Add disclosure"
                onChange={(next) =>
                  applyRows(
                    next,
                    setDisclosures,
                    selectedDisclosureKeys,
                    setSelectedDisclosureKeys,
                  )
                }
                selectedKeys={selectedDisclosureKeys}
                onSelectionChange={setSelectedDisclosureKeys}
                onShareSelected={() => setShareKind("disclosure")}
                shareDisabledReason={shareDisabledReason}
                isRowShareable={(row) => rowIsShareable(row, savedDisclosureIdentities)}
              />
            </TabsContent>

            <TabsContent value="letter" className="space-y-5 mt-2">
              <InfoBanner>
                Branding and wire details for Payoff and Zero Balance letter emails. Upload a
                logo image to store it on Cloudinary. Leave optional fields blank to fall back
                to platform defaults.
              </InfoBanner>

              <div className="grid gap-2">
                <Label htmlFor="letter-company">Letter company name</Label>
                <Input
                  id="letter-company"
                  value={letterCompanyName}
                  onChange={(e) => setLetterCompanyName(e.target.value)}
                  placeholder="e.g. EJM VENTURES LLC"
                />
              </div>

              <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Label>Letter logo</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      PNG, JPG, WEBP, or SVG · max 5 MB. Saved to Cloudinary and used on
                      Payoff / Zero Balance letter emails.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => logoInputRef.current?.click()}
                  >
                    <Upload className="h-4 w-4" />
                    Upload new
                  </Button>
                </div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file && file.size > 5 * 1024 * 1024) {
                      setError("Letter logo must be 5 MB or smaller.");
                      e.target.value = "";
                      return;
                    }
                    setLetterLogoFile(file);
                    setError(null);
                  }}
                />
                <div className="flex min-h-[88px] items-center justify-center rounded-md border border-dashed bg-background px-3 py-4">
                  {logoPreviewUrl ? (
                    <img
                      src={logoPreviewUrl}
                      alt="Letter logo preview"
                      className="max-h-16 max-w-[200px] object-contain"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">No letter logo uploaded</p>
                  )}
                </div>
                {letterLogoUrl || letterLogoFile ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      setLetterLogoFile(null);
                      setLetterLogoUrl("");
                      if (logoInputRef.current) logoInputRef.current.value = "";
                    }}
                  >
                    Remove logo
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="letter-watermark">Watermark URL (optional)</Label>
                <Input
                  id="letter-watermark"
                  value={letterWatermarkUrl}
                  onChange={(e) => setLetterWatermarkUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="accent-light">Accent strip (light)</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Accent strip light color"
                      className="h-9 w-10 cursor-pointer rounded border bg-background p-1"
                      value={previewLight}
                      onChange={(e) => setLetterAccentStripLight(e.target.value)}
                    />
                    <Input
                      id="accent-light"
                      value={letterAccentStripLight}
                      onChange={(e) => setLetterAccentStripLight(e.target.value)}
                      placeholder={DEFAULT_LETTER_EMAIL_BRANDING.accentStripLight}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="accent-dark">Accent strip (dark)</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Accent strip dark color"
                      className="h-9 w-10 cursor-pointer rounded border bg-background p-1"
                      value={previewDark}
                      onChange={(e) => setLetterAccentStripDark(e.target.value)}
                    />
                    <Input
                      id="accent-dark"
                      value={letterAccentStripDark}
                      onChange={(e) => setLetterAccentStripDark(e.target.value)}
                      placeholder={DEFAULT_LETTER_EMAIL_BRANDING.accentStripDark}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="icon-bg">Info table icon background</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label="Info table icon background"
                      className="h-9 w-10 cursor-pointer rounded border bg-background p-1"
                      value={previewIconBg}
                      onChange={(e) => setLetterInfoTableIconBg(e.target.value)}
                    />
                    <Input
                      id="icon-bg"
                      value={letterInfoTableIconBg}
                      onChange={(e) => setLetterInfoTableIconBg(e.target.value)}
                      placeholder={DEFAULT_LETTER_EMAIL_BRANDING.infoTableIconBg}
                    />
                  </div>
                </div>
              </div>

              <div
                className="flex h-10 overflow-hidden rounded-md text-xs font-semibold uppercase tracking-wide text-white"
                aria-hidden
              >
                <div
                  className="flex w-10 items-center justify-center"
                  style={{ backgroundColor: previewIconBg }}
                >
                  I
                </div>
                <div
                  className="flex flex-1 items-center justify-center"
                  style={{
                    backgroundImage: `linear-gradient(90deg, ${previewLight} 0%, ${previewLight} 50%, ${previewDark} 50%, ${previewDark} 100%)`,
                  }}
                >
                  Preview of accent strip and info-table icon column
                </div>
              </div>

              <div className="rounded-lg border">
                <button
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                  onClick={() => setWireOpen((openNow) => !openNow)}
                >
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide">
                      Wire information
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Payment address block shown on payoff letters for this funder.
                    </p>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      wireOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {wireOpen ? (
                  <div className="space-y-4 border-t px-4 py-4">
                    <div className="grid gap-2">
                      <Label htmlFor="letter-bank">Bank / payment name</Label>
                      <Input
                        id="letter-bank"
                        value={letterWireBankName}
                        onChange={(e) => setLetterWireBankName(e.target.value)}
                        placeholder="e.g. EJM VENTURES NY LLC"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="letter-address">Address line 1</Label>
                      <Input
                        id="letter-address"
                        value={letterWireAddressLine1}
                        onChange={(e) => setLetterWireAddressLine1(e.target.value)}
                        placeholder="e.g. 609 BARNARD AVE"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="letter-city">City, state, zip</Label>
                      <Input
                        id="letter-city"
                        value={letterWireCityStateZip}
                        onChange={(e) => setLetterWireCityStateZip(e.target.value)}
                        placeholder="e.g. WOODMERE, NY 11598"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="grid gap-2">
                        <Label htmlFor="letter-routing">Routing number</Label>
                        <Input
                          id="letter-routing"
                          value={letterWireRoutingNumber}
                          onChange={(e) => setLetterWireRoutingNumber(e.target.value)}
                          placeholder="e.g. 067015096"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="letter-account">Account number</Label>
                        <Input
                          id="letter-account"
                          value={letterWireAccountNumber}
                          onChange={(e) => setLetterWireAccountNumber(e.target.value)}
                          placeholder="e.g. 110024817"
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              {hasWirePreview ? (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Payment address
                  </p>
                  <div className="space-y-0.5 text-sm">
                    {letterCompanyName.trim() ? (
                      <p className="font-semibold uppercase">{letterCompanyName.trim()}</p>
                    ) : null}
                    {letterWireBankName.trim() ? (
                      <p className="font-semibold uppercase text-muted-foreground">
                        {letterWireBankName.trim()}
                      </p>
                    ) : null}
                    {letterWireAddressLine1.trim() ? (
                      <p className="uppercase text-muted-foreground">
                        {letterWireAddressLine1.trim()}
                      </p>
                    ) : null}
                    {letterWireCityStateZip.trim() ? (
                      <p className="uppercase text-muted-foreground">
                        {letterWireCityStateZip.trim()}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 pt-1">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Routing
                      </p>
                      <p className="text-sm font-medium">
                        {letterWireRoutingNumber.trim() || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Account number
                      </p>
                      <p className="text-sm font-medium">
                        {letterWireAccountNumber.trim() || "—"}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </TabsContent>
          </Tabs>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={Boolean(saving)}>
              Cancel
            </Button>
            {activeTab === "letter" ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveTab("setup")}
                  disabled={Boolean(saving)}
                >
                  Back to setup
                </Button>
                <Button
                  type="button"
                  className="bg-[image:var(--brand-gradient)] hover:opacity-90"
                  onClick={() => void handleSubmit()}
                  disabled={Boolean(saving) || !name.trim()}
                >
                  {saving ? "Saving…" : "Save letter info"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                className="bg-[image:var(--brand-gradient)] hover:opacity-90"
                onClick={() => void handleSubmit()}
                disabled={Boolean(saving) || !name.trim()}
              >
                {saving ? "Saving…" : initial ? "Save setup" : "Add funder"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShareFunderTemplatesDialog
        open={Boolean(shareKind) && shareItems.length > 0 && Boolean(onShareTemplates)}
        kind={shareKind ?? "addendum"}
        items={shareItems}
        sourceFunderId={initial?.id ?? null}
        sourceFunderName={initial?.name}
        funders={otherFunders}
        onClose={() => setShareKind(null)}
        onShare={async (targetFunderIds) => {
          if (!onShareTemplates || !initial || !shareKind) {
            throw new Error("Save this funder before sharing its templates.");
          }
          return onShareTemplates({
            sourceFunderId: initial.id,
            kind: shareKind,
            templates: shareItems,
            targetFunderIds,
          });
        }}
        onShared={(message) => {
          if (shareKind === "addendum") setSelectedAddendumKeys([]);
          else setSelectedDisclosureKeys([]);
          onShareComplete?.(message);
        }}
      />
    </>
  );
}
