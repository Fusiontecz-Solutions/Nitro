import { normalizeRoleKey } from "@/lib/sessionRole";

/** Agent, Super Admin, and Operations may add/edit bank details on the application Overview tab. */
export function canManageBankDetailsOnOverview(role: string | null | undefined): boolean {
    const roleKey = normalizeRoleKey(role ?? "");
    return (
        roleKey === "CONTRACTS_LOG" ||
        roleKey === "OPERATIONS" ||
        roleKey === "AGENT"
    );
}
