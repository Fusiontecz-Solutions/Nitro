import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Minus } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { axiosGet } from "@/redux/axios";
import { ROLE_LABELS, toAppRole } from "@/lib/roleAccess";

type PermissionMatrix = {
  permissions: Array<{ key: string; label: string }>;
  roles: Array<{ role: string; permissions: string[] }>;
};

async function fetchMatrix(): Promise<PermissionMatrix> {
  const res = await axiosGet("/roles/permissions", { skipCache: true });
  return res.data?.data as PermissionMatrix;
}

/** Super Admin: what each role can do (enforced server-side by `requirePermission`). */
export default function RolePermissions() {
  const { data, isLoading, error } = useQuery({ queryKey: ["role-permissions"], queryFn: fetchMatrix, staleTime: 10 * 60_000 });

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        Permissions are enforced by the API for every request. Assign a role to a user on the Team tab; the change takes
        effect immediately (the user is signed out of existing sessions).
      </p>
      <div className="rounded-md border border-border bg-card">
        {isLoading ? (
          <p className="flex items-center gap-2 px-4 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading permissions…
          </p>
        ) : error || !data ? (
          <p className="px-4 py-8 text-sm text-destructive">Failed to load the permission matrix.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Capability</TableHead>
                  {data.roles.map((r) => (
                    <TableHead key={r.role} className="text-center">
                      {ROLE_LABELS[toAppRole(r.role) ?? "AGENT"] ?? r.role}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.permissions.map((p) => (
                  <TableRow key={p.key}>
                    <TableCell>
                      <p className="font-medium">{p.label}</p>
                      <p className="text-xs text-muted-foreground">{p.key}</p>
                    </TableCell>
                    {data.roles.map((r) => (
                      <TableCell key={r.role} className="text-center">
                        {r.permissions.includes(p.key) ? (
                          <Check className="mx-auto size-4 text-emerald-500" aria-label="Allowed" />
                        ) : (
                          <Minus className="mx-auto size-4 text-muted-foreground" aria-label="Not allowed" />
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
