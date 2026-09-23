import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createFunderProfile,
  deleteFunderProfile,
  fetchFunderProfiles,
  shareFunderTemplates,
  updateFunderProfile,
  type FunderProfileFiles,
  type FunderTemplateKind,
} from "@/redux/actions/integrationSettingsActions";
import type {
  FunderProfile,
  FunderProfileInput,
  SignNowTemplateLinkItem,
} from "@/types/integrationSettingsTypes";
import FunderProfileModal from "./FunderProfileModal";

function DetailRow({ label, value }: { label: string; value?: string | null | number }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium break-all">{String(value)}</span>
    </div>
  );
}

export default function FundersSettings() {
  const [rows, setRows] = useState<FunderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FunderProfile | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchFunderProfiles(null, { activeOnly: false }));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load funders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (
    payload: FunderProfileInput,
    files?: FunderProfileFiles | null,
  ) => {
    setSaving(true);
    try {
      if (editing) {
        await updateFunderProfile(editing.id, payload, files);
        toast.success("Funder updated");
      } else {
        await createFunderProfile(payload, files);
        toast.success("Funder added");
      }
      setModalOpen(false);
      setEditing(null);
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save funder");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Sends a share to the server, which merges the templates into each target
   * funder's live row. The returned rows are folded back into local state so
   * the card counts and the dialog's "already has this" hints stay accurate.
   */
  const handleShareTemplates = async (input: {
    sourceFunderId: string;
    kind: FunderTemplateKind;
    templates: SignNowTemplateLinkItem[];
    targetFunderIds: string[];
  }) => {
    const { sourceFunderId, ...body } = input;
    const { result, message } = await shareFunderTemplates(sourceFunderId, body);
    const field =
      body.kind === "addendum"
        ? "signnowAddendumTemplates"
        : "signnowDisclosureTemplates";
    const byId = new Map(result.updated.map((entry) => [entry.funderId, entry]));
    setRows((prev) =>
      prev.map((row) => {
        const entry = byId.get(row.id);
        if (!entry) return row;
        return { ...row, [field]: [...(row[field] ?? []), ...entry.added] };
      }),
    );
    return message;
  };

  const handleDelete = async (row: FunderProfile) => {
    if (!window.confirm(`Delete funder "${row.name}"?`)) return;
    try {
      await deleteFunderProfile(row.id);
      toast.success("Funder deleted");
      await load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Configure funders shown on Create Contract, plus Letter Info (logo, colors, and
          wire details) used on Payoff and Zero Balance letters.
        </p>
        <Button
          className="gap-2 bg-[image:var(--brand-gradient)] hover:opacity-90 shrink-0"
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          Add funder
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading funders…
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No funders yet. Add one and paste its SignNow template links.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.id} className={!row.isActive ? "opacity-70" : undefined}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="truncate text-base">{row.name}</CardTitle>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditing(row);
                        setModalOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => void handleDelete(row)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {row.isActive ? "Active" : "Inactive"}
                </p>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <DetailRow
                  label="Contract link"
                  value={row.signnowContractTemplateLink || "—"}
                />
                <DetailRow
                  label="Addendums"
                  value={row.signnowAddendumTemplates?.length ?? 0}
                />
                <DetailRow
                  label="Disclosures"
                  value={row.signnowDisclosureTemplates?.length ?? 0}
                />
                <DetailRow label="Default CC" value={row.defaultCcEmail?.trim() || "—"} />
                <DetailRow
                  label="Letter company"
                  value={row.letterCompanyName?.trim() || "—"}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <FunderProfileModal
        open={modalOpen}
        saving={saving}
        initial={editing}
        allFunders={rows}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
        onShareTemplates={handleShareTemplates}
        onShareComplete={(message) => toast.success(message)}
      />
    </div>
  );
}
