import { useCallback, useEffect, useState } from "react";
import { toast } from "react-toastify";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createFunderProfile,
  deleteFunderProfile,
  fetchDocuSignAccountOptions,
  fetchFunderProfiles,
  updateFunderProfile,
} from "@/redux/actions/integrationSettingsActions";
import type { FunderProfile, FunderProfileInput } from "@/types/integrationSettingsTypes";
import FunderProfileModal from "./FunderProfileModal";

function DetailRow({ label, value }: { label: string; value?: string | null | boolean }) {
  if (value === undefined || value === null || value === "") return null;
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium break-all">{display}</span>
    </div>
  );
}

export default function FundersSettings() {
  const [rows, setRows] = useState<FunderProfile[]>([]);
  const [docusignOptions, setDocusignOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FunderProfile | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [funders, accounts] = await Promise.all([
        fetchFunderProfiles(null, { activeOnly: false }),
        fetchDocuSignAccountOptions(),
      ]);
      setRows(funders);
      setDocusignOptions(accounts);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to load funders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async (payload: FunderProfileInput, contractFile?: File | null) => {
    setSaving(true);
    try {
      if (editing) {
        await updateFunderProfile(editing.id, payload, contractFile);
        toast.success("Funder updated");
      } else {
        await createFunderProfile(payload, contractFile);
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
          Configure funders shown on Create Contract. Link each funder to its DocuSign account,
          upload a contract PDF (or use the default), and set allowed states when a funder should
          only appear for certain states.
        </p>
        <Button
          className="gap-2 bg-[var(--brand)] hover:bg-[var(--brand)]/90 shrink-0"
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
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <Card key={row.id} className={!row.isActive ? "opacity-70" : undefined}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{row.name}</CardTitle>
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
                <DetailRow label="DocuSign account" value={row.docusignAccountName || "—"} />
                <DetailRow label="Deal ID prefix" value={row.dealIdPrefix} />
                <DetailRow label="Contract PDF" value={row.contractPdfFileName} />
                <DetailRow
                  label="Allowed states"
                  value={
                    row.allowedStates?.length ? row.allowedStates.join(", ") : "All states"
                  }
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
        docusignOptions={docusignOptions}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}
