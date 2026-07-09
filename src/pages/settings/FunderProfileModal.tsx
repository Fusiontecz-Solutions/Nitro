import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  FileText,
  Info,
  Loader2,
  Mail,
  MapPin,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "react-toastify";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { US_STATES } from "@/constants/usStates";
import {
  DEFAULT_CONTRACT_FILENAME,
  deleteFunderDocument,
  fetchFunderDocuments,
  uploadFunderAddendumDocument,
  uploadFunderDisclosureDocument,
  type FunderProfileFiles,
} from "@/redux/actions/integrationSettingsActions";
import type { FunderProfile, FunderProfileInput } from "@/types/integrationSettingsTypes";
import { DOCUSIGN_DEFAULT_CC_EMAIL } from "@/components/application/docusignCcList";
import {
  DISCLOSURE_FREQUENCY_OPTIONS,
  FUNDER_ADDENDUM_COORDINATE_LAYOUT_OPTIONS,
  isFunderAddendumRow,
  isFunderDisclosureRow,
  type FunderDocumentTemplateRow,
} from "@/utils/funderLayoutKeys";
import {
  canManageFunderDocuments,
  FUNDER_DOCUMENTS_SOURCE_OPTIONS,
  normalizeFunderDocumentsSource,
} from "@/utils/funderDocumentSource";

type Props = {
  open: boolean;
  saving?: boolean;
  initial?: FunderProfile | null;
  allFunders?: FunderProfile[];
  docusignOptions: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSave: (payload: FunderProfileInput, files?: FunderProfileFiles | null) => Promise<void>;
};

const emptyForm: FunderProfileInput = {
  name: "",
  defaultCcEmail: "",
  isActive: true,
  allowedStates: [],
  documentsSource: "own",
  sharedDocumentsFunderId: null,
};

const ADDENDUM_PRESETS = [
  { name: "Flex Addendum", type: "flex_addendum" },
  { name: "Balance Transfer", type: "balance_transfer" },
  { name: "ACH Authorization", type: "ach_authorization" },
] as const;

function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function UploadCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function DocBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
      {children}
    </span>
  );
}

function EmptyDocList({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}

export default function FunderProfileModal({
  open,
  saving,
  initial,
  allFunders = [],
  docusignOptions,
  onClose,
  onSave,
}: Props) {
  const [activeTab, setActiveTab] = useState("setup");
  const [showStateRules, setShowStateRules] = useState(false);

  const [form, setForm] = useState<FunderProfileInput>(emptyForm);
  const [statesText, setStatesText] = useState("");
  const [excludedStatesText, setExcludedStatesText] = useState("");
  const [contractFile, setContractFile] = useState<File | null>(null);

  const [documents, setDocuments] = useState<FunderDocumentTemplateRow[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [docActionId, setDocActionId] = useState<string | null>(null);

  const [disclosureState, setDisclosureState] = useState("Texas");
  const [disclosureFrequency, setDisclosureFrequency] = useState("daily");
  const [disclosureFile, setDisclosureFile] = useState<File | null>(null);
  const [disclosureUploading, setDisclosureUploading] = useState(false);

  const [addendumName, setAddendumName] = useState("Flex Addendum");
  const [addendumCoordKey, setAddendumCoordKey] = useState("flex_addendum");
  const [addendumFile, setAddendumFile] = useState<File | null>(null);
  const [addendumUploading, setAddendumUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const disclosureInputRef = useRef<HTMLInputElement>(null);
  const addendumInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async (funderId: string) => {
    setDocumentsLoading(true);
    try {
      const rows = await fetchFunderDocuments(funderId);
      setDocuments(rows);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load documents");
      setDocuments([]);
    } finally {
      setDocumentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    setActiveTab("setup");
    setShowStateRules(false);
    setContractFile(null);
    setDisclosureFile(null);
    setAddendumFile(null);
    setAddendumName("Flex Addendum");
    setAddendumCoordKey("flex_addendum");
    setDisclosureState("Texas");
    setDisclosureFrequency("daily");
    setDocuments([]);

    if (initial) {
      setForm({
        name: initial.name,
        dealIdPrefix: initial.dealIdPrefix ?? "",
        docusignAccountProfileId: initial.docusignAccountProfileId ?? null,
        defaultCcEmail: initial.defaultCcEmail ?? "",
        isActive: initial.isActive,
        documentsSource: initial.documentsSource ?? "own",
        sharedDocumentsFunderId: initial.sharedDocumentsFunderId ?? null,
      });
      setStatesText((initial.allowedStates ?? []).join(", "));
      setExcludedStatesText((initial.excludedStates ?? []).join(", "));
      setShowStateRules(
        Boolean(initial.allowedStates?.length || initial.excludedStates?.length),
      );
      void loadDocuments(initial.id);
    } else {
      setForm(emptyForm);
      setStatesText("");
      setExcludedStatesText("");
    }
  }, [open, initial, loadDocuments]);

  const set = (key: keyof FunderProfileInput, value: string | number | boolean | null) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const currentContractLabel =
    contractFile?.name || initial?.contractPdfFileName || DEFAULT_CONTRACT_FILENAME;

  const disclosureRows = documents.filter(isFunderDisclosureRow);
  const addendumRows = documents.filter(isFunderAddendumRow);

  const documentsSource = normalizeFunderDocumentsSource(form.documentsSource);
  const effectiveProfile = initial
    ? {
        id: initial.id,
        documentsSource,
        sharedDocumentsFunderId: form.sharedDocumentsFunderId ?? null,
      }
    : null;
  const canUploadDocs = effectiveProfile ? canManageFunderDocuments(effectiveProfile) : false;

  const sharedOwnerFunder = allFunders.find(
    (f) => f.id === form.sharedDocumentsFunderId,
  );
  const otherFundersForShare = allFunders.filter((f) => f.id !== initial?.id);

  const addendumTypeLabel = (type: string) =>
    FUNDER_ADDENDUM_COORDINATE_LAYOUT_OPTIONS.find((o) => o.value === type)?.label ?? type;

  const handleSubmit = async () => {
    if (!form.name.trim()) return;

    const allowedStates = statesText
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const excludedStates = excludedStatesText
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const payload: FunderProfileInput = {
      name: form.name.trim(),
      dealIdPrefix: form.dealIdPrefix?.trim() || undefined,
      allowedStates,
      excludedStates,
      docusignAccountProfileId: form.docusignAccountProfileId || null,
      defaultCcEmail: form.defaultCcEmail?.trim() ?? "",
      isActive: form.isActive,
      documentsSource: form.documentsSource,
      sharedDocumentsFunderId:
        form.documentsSource === "shared" ? form.sharedDocumentsFunderId || null : null,
    };

    if (initial) {
      payload.mainContractLayoutKey = initial.mainContractLayoutKey;
      payload.assignsDealId = initial.assignsDealId;
      payload.sortOrder = initial.sortOrder;
    }

    await onSave(payload, { contractFile });
  };

  const handleUploadDisclosure = async () => {
    if (!initial?.id) return;
    if (!disclosureFile) {
      toast.error("Select a PDF file first.");
      return;
    }
    setDisclosureUploading(true);
    try {
      await uploadFunderDisclosureDocument(initial.id, {
        state: disclosureState,
        frequency: disclosureFrequency,
        file: disclosureFile,
      });
      toast.success(`Saved: ${disclosureState} · ${disclosureFrequency}`);
      setDisclosureFile(null);
      if (disclosureInputRef.current) disclosureInputRef.current.value = "";
      await loadDocuments(initial.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setDisclosureUploading(false);
    }
  };

  const handleUploadAddendum = async () => {
    if (!initial?.id) return;
    if (!addendumName.trim()) {
      toast.error("Enter a name for this addendum.");
      return;
    }
    if (!addendumFile) {
      toast.error("Select a PDF file first.");
      return;
    }
    setAddendumUploading(true);
    try {
      await uploadFunderAddendumDocument(initial.id, {
        name: addendumName.trim(),
        coordinateLayoutKey: addendumCoordKey,
        file: addendumFile,
      });
      toast.success(`Saved: ${addendumName.trim()}`);
      setAddendumFile(null);
      if (addendumInputRef.current) addendumInputRef.current.value = "";
      await loadDocuments(initial.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setAddendumUploading(false);
    }
  };

  const handleDeleteDocument = async (row: FunderDocumentTemplateRow) => {
    if (!initial?.id) return;
    if (!window.confirm(`Remove "${row.name}"?`)) return;
    setDocActionId(row.id);
    try {
      await deleteFunderDocument(initial.id, row.id);
      toast.success("Removed");
      await loadDocuments(initial.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not remove");
    } finally {
      setDocActionId(null);
    }
  };

  const applyAddendumPreset = (preset: (typeof ADDENDUM_PRESETS)[number]) => {
    setAddendumName(preset.name);
    setAddendumCoordKey(preset.type);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? `Edit ${initial.name}` : "Add funder"}</DialogTitle>
          <p className="text-sm text-muted-foreground pt-1">
            {initial
              ? "Update funder settings and manage PDFs used on contracts. Set default CC email(s) on the setup tab."
              : "Create the funder first, then set default CC email(s) and upload disclosure/addendum PDFs."}
          </p>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="setup">1. Funder setup</TabsTrigger>
            <TabsTrigger value="documents" disabled={!initial}>
              2. Upload PDFs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="setup" className="space-y-5 mt-2">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="f-name">Funder name</Label>
                <Input
                  id="f-name"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="e.g. Woodmere Financial, TEXAS FUNDING GROUP"
                />
              </div>

              <div className="rounded-lg border border-[var(--brand)]/25 bg-[var(--brand)]/5 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-[var(--brand)]" aria-hidden />
                  <Label htmlFor="f-default-cc" className="text-sm font-semibold">
                    Default CC email(s)
                  </Label>
                </div>
                <Input
                  id="f-default-cc"
                  type="text"
                  value={form.defaultCcEmail ?? ""}
                  onChange={(e) => set("defaultCcEmail", e.target.value)}
                  placeholder="info@woodmerefinancial.com, billing@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Used as the default CC on contracts for this funder. Leave blank to use{" "}
                  <span className="font-medium">{DOCUSIGN_DEFAULT_CC_EMAIL}</span>. When set, it
                  replaces the platform default (not added alongside it). Separate multiple emails
                  with commas.
                </p>
              </div>

              <div className="grid gap-2">
                <Label>DocuSign account</Label>
                <Select
                  value={form.docusignAccountProfileId || "__none__"}
                  onValueChange={(v: string) =>
                    set("docusignAccountProfileId", v === "__none__" ? null : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {docusignOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Contracts for this funder are sent from this DocuSign account.
                </p>
              </div>

              <div className="grid gap-2">
                <Label>Main contract PDF</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setContractFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left transition-colors hover:bg-muted/50"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {contractFile ? "Change contract PDF" : "Click to choose contract PDF"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{currentContractLabel}</p>
                  </div>
                </button>
                {!initial && (
                  <p className="text-xs text-muted-foreground">
                    Optional — uses default ({DEFAULT_CONTRACT_FILENAME}) if empty.
                  </p>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2 sm:gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="f-prefix">Deal ID prefix</Label>
                  <Input
                    id="f-prefix"
                    value={form.dealIdPrefix ?? ""}
                    onChange={(e) => set("dealIdPrefix", e.target.value)}
                    placeholder="WF"
                  />
                </div>
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.isActive !== false}
                      onChange={(e) => set("isActive", e.target.checked)}
                    />
                    Funder is active
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-lg border">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
                onClick={() => setShowStateRules((v) => !v)}
              >
                <span className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  State rules (optional)
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${showStateRules ? "rotate-180" : ""}`}
                />
              </button>
              {showStateRules && (
                <div className="space-y-4 border-t px-4 pb-4 pt-3">
                  <div className="grid gap-2">
                    <Label htmlFor="f-states">Only show in these states</Label>
                    <Input
                      id="f-states"
                      value={statesText}
                      onChange={(e) => setStatesText(e.target.value)}
                      placeholder="Texas, TX"
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave blank to show in all states. Use allowed states to limit where this funder appears.
                    </p>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="f-excluded-states">Hide in these states</Label>
                    <Input
                      id="f-excluded-states"
                      value={excludedStatesText}
                      onChange={(e) => setExcludedStatesText(e.target.value)}
                      placeholder="Texas, TX"
                    />
                    <p className="text-xs text-muted-foreground">
                      Example: hide Woodmere Financial when the deal is in Texas.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {!initial && (
              <InfoBanner>
                After you click <strong>Add funder</strong>, reopen this funder to upload state
                disclosures and addendum PDFs on the <strong>Upload PDFs</strong> tab.
              </InfoBanner>
            )}
          </TabsContent>

          <TabsContent value="documents" className="space-y-5 mt-2">
            <UploadCard
              title="Addendum & disclosure source"
              description="Choose where this funder gets its addendum and state disclosure PDFs. The main contract PDF is always per funder."
            >
              <div className="space-y-2">
                {FUNDER_DOCUMENTS_SOURCE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                      documentsSource === opt.value
                        ? "border-[var(--brand)] bg-[var(--brand)]/5"
                        : "hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="radio"
                      name="documentsSource"
                      className="mt-1"
                      checked={documentsSource === opt.value}
                      onChange={() => {
                        set("documentsSource", opt.value);
                        if (opt.value !== "shared") {
                          set("sharedDocumentsFunderId", null);
                        }
                      }}
                    />
                    <span>
                      <span className="text-sm font-medium">{opt.label}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.description}</p>
                    </span>
                  </label>
                ))}
              </div>

              {documentsSource === "shared" && (
                <div className="grid gap-2 pt-1">
                  <Label>Share PDFs with</Label>
                  <Select
                    value={form.sharedDocumentsFunderId || "__pick__"}
                    onValueChange={(v: string) =>
                      set("sharedDocumentsFunderId", v === "__pick__" ? null : v)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select funder" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__pick__">Select funder…</SelectItem>
                      {otherFundersForShare.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Upload addendums and disclosures on the selected funder — both funders will use
                    those PDFs.
                  </p>
                </div>
              )}

              {documentsSource === "platform" && (
                <InfoBanner>
                  Woodmere Financial uses the platform addendums and disclosures already
                  configured in the system. No uploads needed here.
                </InfoBanner>
              )}

              {documentsSource === "shared" && sharedOwnerFunder && !canUploadDocs && (
                <InfoBanner>
                  PDFs are managed on <strong>{sharedOwnerFunder.name}</strong>. Edit that funder to
                  upload or change addendums and disclosures.
                </InfoBanner>
              )}

              <p className="text-xs text-muted-foreground">
                Save setup (tab 1) after changing this setting.
              </p>
            </UploadCard>

            {documentsSource === "platform" ? null : (
              <>
            <UploadCard
              title="State disclosure PDFs"
              description="Some states require a disclosure page on the contract. Upload one PDF for each state + payment schedule combination."
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>State</Label>
                  <Select value={disclosureState} onValueChange={setDisclosureState}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {US_STATES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Merchant pays</Label>
                  <Select value={disclosureFrequency} onValueChange={setDisclosureFrequency}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DISCLOSURE_FREQUENCY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <input
                ref={disclosureInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={!canUploadDocs}
                onChange={(e) => setDisclosureFile(e.target.files?.[0] ?? null)}
              />
              {canUploadDocs ? (
                <>
              <button
                type="button"
                onClick={() => disclosureInputRef.current?.click()}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left hover:bg-muted/40"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm">
                  {disclosureFile ? disclosureFile.name : "Choose disclosure PDF"}
                </span>
              </button>

              <Button
                type="button"
                className="w-full bg-[var(--brand)] hover:bg-[var(--brand)]/90"
                disabled={disclosureUploading || !disclosureFile}
                onClick={() => void handleUploadDisclosure()}
              >
                {disclosureUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  `Save disclosure for ${disclosureState} (${disclosureFrequency})`
                )}
              </Button>
                </>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Uploaded ({disclosureRows.length})
                </p>
                {documentsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : disclosureRows.length > 0 ? (
                  <ul className="divide-y rounded-md border text-sm">
                    {disclosureRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <DocBadge>{row.state || "—"}</DocBadge>
                          <DocBadge>{row.frequency || "—"}</DocBadge>
                          <span className="truncate text-muted-foreground">{row.name}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive"
                          disabled={docActionId === row.id || !canUploadDocs}
                          onClick={() => void handleDeleteDocument(row)}
                          title="Remove"
                        >
                          {docActionId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyDocList message="No disclosures yet. Pick a state, frequency, and PDF above." />
                )}
              </div>
            </UploadCard>

            <UploadCard
              title="Addendum PDFs"
              description="Extra pages attached to the contract (flex addendum, balance transfer, etc.). Pick a type, name it, and upload the PDF."
            >
              <div className="flex flex-wrap gap-2">
                {ADDENDUM_PRESETS.map((preset) => (
                  <Button
                    key={preset.type}
                    type="button"
                    size="sm"
                    variant={
                      addendumCoordKey === preset.type && addendumName === preset.name
                        ? "default"
                        : "outline"
                    }
                    className={
                      addendumCoordKey === preset.type && addendumName === preset.name
                        ? "bg-[var(--brand)] hover:bg-[var(--brand)]/90"
                        : undefined
                    }
                    onClick={() => applyAddendumPreset(preset)}
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>

              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="addendum-name">Display name</Label>
                  <Input
                    id="addendum-name"
                    value={addendumName}
                    onChange={(e) => setAddendumName(e.target.value)}
                    placeholder="Flex Addendum"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Addendum type</Label>
                  <Select
                    value={addendumCoordKey}
                    onValueChange={(v: string) => {
                      setAddendumCoordKey(v);
                      const match = ADDENDUM_PRESETS.find((p) => p.type === v);
                      if (match && !addendumName.trim()) setAddendumName(match.name);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FUNDER_ADDENDUM_COORDINATE_LAYOUT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Signature field positions come from the platform template — you only upload the
                    PDF for this funder.
                  </p>
                </div>
              </div>

              <input
                ref={addendumInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={!canUploadDocs}
                onChange={(e) => setAddendumFile(e.target.files?.[0] ?? null)}
              />
              {canUploadDocs ? (
                <>
              <button
                type="button"
                onClick={() => addendumInputRef.current?.click()}
                className="flex w-full items-center gap-3 rounded-lg border border-dashed px-4 py-3 text-left hover:bg-muted/40"
              >
                <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="text-sm">
                  {addendumFile ? addendumFile.name : "Choose addendum PDF"}
                </span>
              </button>

              <Button
                type="button"
                className="w-full bg-[var(--brand)] hover:bg-[var(--brand)]/90"
                disabled={addendumUploading || !addendumFile || !addendumName.trim()}
                onClick={() => void handleUploadAddendum()}
              >
                {addendumUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Uploading…
                  </>
                ) : (
                  `Save addendum: ${addendumName.trim() || "…"}`
                )}
              </Button>
                </>
              ) : null}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Uploaded ({addendumRows.length})
                </p>
                {documentsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </div>
                ) : addendumRows.length > 0 ? (
                  <ul className="divide-y rounded-md border text-sm">
                    {addendumRows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center justify-between gap-3 px-3 py-2.5"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {addendumTypeLabel(row.type)}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-destructive"
                          disabled={docActionId === row.id || !canUploadDocs}
                          onClick={() => void handleDeleteDocument(row)}
                          title="Remove"
                        >
                          {docActionId === row.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyDocList message="No addendums yet. Use a quick pick above or enter a name and upload." />
                )}
              </div>
            </UploadCard>
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {activeTab === "setup" ? (
            <Button
              className="bg-[var(--brand)] hover:bg-[var(--brand)]/90"
              disabled={saving || !form.name.trim()}
              onClick={() => void handleSubmit()}
            >
              {saving ? "Saving…" : initial ? "Save setup" : "Add funder"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setActiveTab("setup")}>
                Back to setup
              </Button>
              <Button
                className="bg-[var(--brand)] hover:bg-[var(--brand)]/90"
                disabled={saving || !form.name.trim()}
                onClick={() => void handleSubmit()}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
