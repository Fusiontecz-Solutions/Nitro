import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { axiosDelete, axiosGet, axiosPost, axiosPut } from "@/redux/axios";

type IsoRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  bankAccountNo: string;
  routingNumber: string;
  commissionPercentage: number;
  status?: string | null;
  applications?: unknown[];
};

type IsoForm = {
  name: string;
  email: string;
  phone: string;
  bankAccountNo: string;
  routingNumber: string;
  commissionPercentage: string;
};

const EMPTY: IsoForm = { name: "", email: "", phone: "", bankAccountNo: "", routingNumber: "", commissionPercentage: "0" };

const apiError = (err: any, fallback: string) => err?.response?.data?.message || err?.message || fallback;
const mask = (value: string | null | undefined) => (value ? `••••${String(value).slice(-4)}` : "—");

async function fetchIsos(): Promise<IsoRow[]> {
  const res = await axiosGet("/iso", { skipCache: true });
  return Array.isArray(res.data?.data) ? res.data.data : [];
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium break-all">{value === undefined || value === null || value === "" ? "—" : String(value)}</span>
    </div>
  );
}

/** Super Admin: ISO records Agents link to applications (approval requests go to the ISO email). */
export default function IsoManagement() {
  const queryClient = useQueryClient();
  const isos = useQuery({ queryKey: ["iso-admin-list"], queryFn: fetchIsos });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IsoRow | null>(null);
  const [form, setForm] = useState<IsoForm>(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            name: editing.name ?? "",
            email: editing.email ?? "",
            phone: editing.phone ?? "",
            bankAccountNo: editing.bankAccountNo ?? "",
            routingNumber: editing.routingNumber ?? "",
            commissionPercentage: String(editing.commissionPercentage ?? 0),
          }
        : EMPTY,
    );
  }, [open, editing]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["iso-admin-list"] });
    void queryClient.invalidateQueries({ queryKey: ["iso-options"] });
  };

  const set = (key: keyof IsoForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const commission = Number(form.commissionPercentage);
  const valid =
    form.name.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) &&
    form.bankAccountNo.trim() &&
    form.routingNumber.trim() &&
    Number.isFinite(commission) &&
    commission >= 0 &&
    commission <= 100;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() || null,
      bankAccountNo: form.bankAccountNo.trim(),
      routingNumber: form.routingNumber.trim(),
      commissionPercentage: commission,
    };
    try {
      if (editing) {
        await axiosPut(`/iso/${editing.id}`, payload);
        toast.success("ISO updated");
      } else {
        await axiosPost("/iso", payload);
        toast.success("ISO added");
      }
      setOpen(false);
      setEditing(null);
      refresh();
    } catch (err) {
      toast.error(apiError(err, "Failed to save ISO"));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: IsoRow) => {
    if (!window.confirm(`Delete ISO "${row.name}"?`)) return;
    try {
      await axiosDelete(`/iso/${row.id}`);
      toast.success("ISO deleted");
      refresh();
    } catch (err) {
      toast.error(apiError(err, "Failed to delete ISO"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          ISOs Agents can link to new applications. The ISO email receives the approval request; once the ISO
          approves, the application moves to Contract Pending.
        </p>
        <Button
          className="shrink-0 gap-2 bg-[image:var(--brand-gradient)] hover:opacity-90"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Add ISO
        </Button>
      </div>

      {isos.isLoading ? (
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading ISOs…
        </div>
      ) : isos.error ? (
        <p className="text-sm text-destructive">{apiError(isos.error, "Failed to load ISOs")}</p>
      ) : (isos.data ?? []).length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          No ISOs yet. Add one so Agents can link it to their applications.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(isos.data ?? []).map((row) => (
            <Card key={row.id} className={String(row.status ?? "active") !== "active" ? "opacity-70" : undefined}>
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
                        setOpen(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => void handleDelete(row)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs capitalize text-muted-foreground">{row.status || "active"}</p>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <DetailRow label="Email" value={row.email} />
                <DetailRow label="Phone" value={row.phone} />
                <DetailRow label="Commission" value={`${row.commissionPercentage ?? 0}%`} />
                <DetailRow label="Account" value={mask(row.bankAccountNo)} />
                <DetailRow label="Applications" value={Array.isArray(row.applications) ? row.applications.length : 0} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={(next: boolean) => !saving && setOpen(next)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit ISO" : "Add ISO"}</DialogTitle>
            <DialogDescription>Approval requests from Agents are emailed to this address.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name *</Label>
              <Input value={form.name} onChange={set("name")} />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={set("email")} />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={set("phone")} />
            </div>
            <div className="space-y-1.5">
              <Label>Bank account no. *</Label>
              <Input value={form.bankAccountNo} onChange={set("bankAccountNo")} />
            </div>
            <div className="space-y-1.5">
              <Label>Routing number *</Label>
              <Input value={form.routingNumber} onChange={set("routingNumber")} />
            </div>
            <div className="space-y-1.5">
              <Label>Commission % *</Label>
              <Input type="number" min={0} max={100} step="0.01" value={form.commissionPercentage} onChange={set("commissionPercentage")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={!valid} loading={saving}>
              {editing ? "Save changes" : "Add ISO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
