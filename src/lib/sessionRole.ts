import { jwtDecode } from "jwt-decode";

export function normalizeRoleKey(role: string): string {
  const r = role.trim();
  if (!r) return "";
  let key = r.toUpperCase().replace(/\s+/g, "_");
  if (key === "FINALUNDERWRITER" || key === "FINAL_UNDERWRITER") key = "UNDERWRITER";
  if (key === "SUPERADMIN") key = "SUPER_ADMIN";
  return key;
}

export function resolveSessionRole(
  loginUser: { role?: string } | undefined,
): string {
  try {
    const raw = localStorage.getItem("user");
    if (raw) {
      const u = JSON.parse(raw) as { role?: string };
      if (u?.role && typeof u.role === "string") return u.role;
    }
  } catch {
    /* ignore invalid JSON */
  }
  return loginUser?.role ?? localStorage.getItem("role") ?? "";
}

/**
 * Prefer JWT role (matches the active token after impersonation); then storage / Redux fallbacks.
 */
export function resolveEffectiveRole(
  loginUser: { role?: string } | undefined,
): string {
  try {
    const token = localStorage.getItem("token");
    if (token) {
      const decoded = jwtDecode<{ role?: string }>(token);
      if (
        decoded?.role &&
        typeof decoded.role === "string" &&
        decoded.role.trim() !== ""
      ) {
        return decoded.role;
      }
    }
  } catch {
    /* ignore */
  }
  return resolveSessionRole(loginUser);
}

export function isSuperAdminRole(role?: string | null): boolean {
  const key = normalizeRoleKey(String(role ?? ""));
  return key === "SUPER_ADMIN";
}
