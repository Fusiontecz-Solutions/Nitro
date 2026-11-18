import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "react-toastify";
import { CheckCircle2, Loader2, MoreHorizontal, Pencil, Plus, Power, Search, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { axiosGet, axiosPatch, axiosPost, axiosPut } from "@/redux/axios";
import { resolveEffectiveRole, resolveSessionUser } from "@/lib/sessionRole";
import { isSuperAdminAppRole, MANAGEABLE_ROLES, ROLE_LABELS, toAppRole, type AppRole } from "@/lib/roleAccess";

type TeamUser = {
  _id: string;
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  role: string;
  isActive: boolean;
  gmailConnected?: boolean;
  createdAt?: string;
};

type RoleFilter = "ALL" | AppRole;
type StatusFilter = "all" | "active" | "inactive";

const apiError = (err: any, fallback: string) => err?.response?.data?.message || err?.message || fallback;

async function fetchTeam(status: StatusFilter, search: string): Promise<TeamUser[]> {
  const res = await axiosGet("/users", {
    skipCache: true,
    params: { ...(status !== "all" ? { status } : {}), ...(search ? { search } : {}) },
  });
  const rows: TeamUser[] = Array.isArray(res.data?.data) ? res.data.data : [];
  // This app manages Super Admin / Contracts Log / Agent / Underwriter accounts only.
  return rows.filter((u) => toAppRole(u.role));
}

const ROLE_PILL: Record<AppRole, string> = {
  SUPER_ADMIN: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
  CONTRACTS_LOG: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  AGENT: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  UNDERWRITER: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: AppRole;
  password: string;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  role: "AGENT",
  password: "",
  isActive: true,
};

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const symbols = "!@#$%&*";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => chars[b % chars.length]).join("");
  // Backend policy: 8+ chars with upper, lower, digit and symbol — guarantee each class.
  return `${body.slice(0, 10)}${symbols[bytes[0] % symbols.length]}${bytes[1] % 10}Aa`;
}

function UserDialog({
  open,
  onOpenChange,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: TeamUser | null;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const isSelf = Boolean(editing && editing._id === resolveSessionUser()?.id);
  // Only a Super Admin may grant the Super Admin role (the API enforces this too).
  const assignableRoles = isSuperAdminAppRole(resolveEffectiveRole(undefined))
    ? MANAGEABLE_ROLES
    : MANAGEABLE_ROLES.filter((r) => r !== "SUPER_ADMIN" || toAppRole(editing?.role) === "SUPER_ADMIN");

  useEffect(() => {
    if (!open) return;
    setForm(
      editing
        ? {
            firstName: editing.firstName ?? "",
            lastName: editing.lastName ?? "",
            email: editing.email ?? "",
            phone: editing.phone ?? "",
            role: toAppRole(editing.role) ?? "AGENT",
            password: "",
            isActive: editing.isActive,
          }
        : { ...EMPTY_FORM, password: generatePassword() },
    );
  }, [open, editing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const valid =
    form.firstName.trim() &&
    form.lastName.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) &&
    (editing || form.password.length >= 8);

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      if (editing) {
        await axiosPut(`/users/${editing._id}`, {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || null,
          ...(isSelf ? {} : { role: form.role, isActive: form.isActive }),
        });
        toast.success("User updated");
      } else {
        await axiosPost("/auth/create-user", {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || undefined,
          password: form.password,
          role: form.role,
          status: form.isActive,
        });
        toast.success(`${ROLE_LABELS[form.role]} created. A welcome email with the temporary password was sent.`);
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(apiError(err, "Failed to save user"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit user" : "Add user"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Changing the role or deactivating signs the user out of every session."
              : "The user receives a welcome email with a temporary password."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>First name *</Label>
            <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Last name *</Label>
            <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Email *</Label>
            <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Role *</Label>
            <Select value={form.role} onValueChange={(v: string) => set("role", v as AppRole)} disabled={isSelf}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {assignableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!editing ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Temporary password *</Label>
              <div className="flex gap-2">
                <Input value={form.password} onChange={(e) => set("password", e.target.value)} />
                <Button type="button" variant="outline" onClick={() => set("password", generatePassword())}>
                  Generate
                </Button>
              </div>
            </div>
          ) : null}
          <label className={cn("flex items-center gap-2 text-sm sm:col-span-2", isSelf && "opacity-50")}>
            <input
              type="checkbox"
              className="size-4"
              checked={form.isActive}
              disabled={isSelf}
              onChange={(e) => set("isActive", e.target.checked)}
            />
            Active (can sign in)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={!valid} loading={saving}>
            {editing ? "Save changes" : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Super Admin: manage Agent / Underwriter / Super Admin accounts. */
export default function TeamManagement() {
  const queryClient = useQueryClient();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TeamUser | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const myId = resolveSessionUser()?.id;

  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const team = useQuery({
    queryKey: ["team-users", statusFilter, search],
    queryFn: () => fetchTeam(statusFilter, search),
  });

  const counts = useMemo(() => {
    const rows = team.data ?? [];
    return {
      ALL: rows.length,
      SUPER_ADMIN: rows.filter((u) => toAppRole(u.role) === "SUPER_ADMIN").length,
      CONTRACTS_LOG: rows.filter((u) => toAppRole(u.role) === "CONTRACTS_LOG").length,
      AGENT: rows.filter((u) => toAppRole(u.role) === "AGENT").length,
      UNDERWRITER: rows.filter((u) => toAppRole(u.role) === "UNDERWRITER").length,
    } as Record<RoleFilter, number>;
  }, [team.data]);

  const rows = useMemo(
    () => (team.data ?? []).filter((u) => roleFilter === "ALL" || toAppRole(u.role) === roleFilter),
    [team.data, roleFilter],
  );

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["team-users"] });

  const toggleActive = async (user: TeamUser) => {
    const verb = user.isActive ? "Deactivate" : "Activate";
    if (!window.confirm(`${verb} ${user.firstName} ${user.lastName}?`)) return;
    setTogglingId(user._id);
    try {
      await axiosPatch(`/users/${user._id}/toggle-active`, {});
      toast.success(`User ${user.isActive ? "deactivated" : "activated"}`);
      refresh();
    } catch (err) {
      toast.error(apiError(err, `Failed to ${verb.toLowerCase()} user`));
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="max-w-2xl text-sm text-muted-foreground">
          Create Agents and Underwriters, change roles and control who can sign in. Agents create applications and
          send them to the ISO; Underwriters claim and underwrite them.
        </p>
        <Button
          className="shrink-0 gap-2 bg-[image:var(--brand-gradient)] hover:opacity-90"
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> Add user
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(["ALL", ...MANAGEABLE_ROLES] as RoleFilter[]).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRoleFilter(r)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
                roleFilter === r
                  ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                  : "border-border bg-card text-foreground hover:border-[var(--brand)]/50",
              )}
            >
              {r === "ALL" ? "All users" : ROLE_LABELS[r]}
              <span className={cn("rounded-full px-1.5 text-xs", roleFilter === r ? "bg-white/20" : "bg-muted text-muted-foreground")}>
                {counts[r] ?? 0}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={(v: string) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative w-full lg:w-72">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search name or email" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-card">
        {team.isLoading ? (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading users…
          </p>
        ) : team.error ? (
          <p className="px-4 py-8 text-sm text-destructive">{apiError(team.error, "Failed to load users")}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No users match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Gmail</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const appRole = toAppRole(u.role)!;
                  return (
                    <TableRow key={u._id} className={!u.isActive ? "opacity-60" : undefined}>
                      <TableCell className="font-medium">
                        {u.firstName} {u.lastName}
                        {u._id === myId ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
                      </TableCell>
                      <TableCell className="break-all">{u.email}</TableCell>
                      <TableCell>
                        <span className={cn("rounded-full px-2 py-1 text-xs font-medium", ROLE_PILL[appRole])}>
                          {ROLE_LABELS[appRole]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 text-sm">
                          {u.isActive ? (
                            <CheckCircle2 className="size-4 text-emerald-500" />
                          ) : (
                            <XCircle className="size-4 text-muted-foreground" />
                          )}
                          {u.isActive ? "Active" : "Inactive"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {appRole === "CONTRACTS_LOG" ? "—" : u.gmailConnected ? "Connected" : "Not connected"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" disabled={togglingId === u._id}>
                              {togglingId === u._id ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing(u);
                                setDialogOpen(true);
                              }}
                            >
                              <Pencil className="mr-2 size-4" /> Edit
                            </DropdownMenuItem>
                            {u._id !== myId ? (
                              <DropdownMenuItem onSelect={() => void toggleActive(u)}>
                                <Power className="mr-2 size-4" /> {u.isActive ? "Deactivate" : "Activate"}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <UserDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} onSaved={refresh} />
    </div>
  );
}
