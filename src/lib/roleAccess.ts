/**
 * Front-end RBAC for the roles this app supports. Mirrors the backend
 * `constants/roles.ts` + `constants/rolePermissions.ts` — the backend is the
 * authority; this only decides what to show and where to route.
 */
import { normalizeRoleKey } from "./sessionRole";

export const APP_ALLOWED_ROLES = ["SUPER_ADMIN", "AGENT", "UNDERWRITER"] as const;
export type AppRole = (typeof APP_ALLOWED_ROLES)[number];

export const MANAGEABLE_ROLES: readonly AppRole[] = ["SUPER_ADMIN", "AGENT", "UNDERWRITER"];

export const ROLE_LABELS: Record<AppRole, string> = {
  SUPER_ADMIN: "Super Admin",
  AGENT: "Agent",
  UNDERWRITER: "Underwriter",
};

export function toAppRole(role: string | null | undefined): AppRole | null {
  const key = normalizeRoleKey(String(role ?? ""));
  return (APP_ALLOWED_ROLES as readonly string[]).includes(key) ? (key as AppRole) : null;
}

export const isAppAllowedRole = (role: string | null | undefined): boolean => toAppRole(role) !== null;
export const isAgentRole = (role: string | null | undefined) => toAppRole(role) === "AGENT";
export const isUnderwriterRole = (role: string | null | undefined) => toAppRole(role) === "UNDERWRITER";
export const isWorkflowRole = (role: string | null | undefined) =>
  isAgentRole(role) || isUnderwriterRole(role);

/** Queue page each workflow role lands on from the sidebar ("Applications"). */
export const WORKFLOW_QUEUE_PATH = "/pipeline";

/**
 * Routes a workflow role may open: `exact` matches the path itself, `prefix` matches
 * anything below it. Note `/applications` (the Super Admin list) is NOT allowed —
 * only application detail pages under it.
 */
const WORKFLOW_ROUTE_RULES: Record<"AGENT" | "UNDERWRITER", { exact: string[]; prefix: string[] }> = {
  AGENT: {
    exact: ["/", "/pipeline", "/create-applications", "/notifications", "/user-setting", "/template/playground"],
    // `/create-applications/:id` = edit an own draft before submitting it to underwriting.
    prefix: [
      "/applications",
      "/application-details",
      "/create-applications",
      "/view-terms-offer",
      "/view-position",
    ],
  },
  UNDERWRITER: {
    // Offer / position editors are part of underwriting (Create Offer tab links to them).
    exact: [
      "/",
      "/pipeline",
      "/notifications",
      "/user-setting",
      "/create-terms-offer",
      "/create-position",
      "/template/playground",
    ],
    prefix: [
      "/applications",
      "/application-details",
      "/edit-terms-offer",
      "/view-terms-offer",
      "/edit-position",
      "/view-position",
    ],
  },
};

export function isPathAllowedForRole(role: string | null | undefined, pathname: string): boolean {
  const appRole = toAppRole(role);
  if (!appRole) return false;
  if (appRole === "SUPER_ADMIN") return true;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname || "/";
  const rules = WORKFLOW_ROUTE_RULES[appRole];
  return rules.exact.includes(path) || rules.prefix.some((p) => path.startsWith(`${p}/`));
}

/** Settings tabs per role (`/user-setting?tab=`). */
export function settingsTabsForRole(role: string | null | undefined): string[] {
  const appRole = toAppRole(role);
  if (appRole === "SUPER_ADMIN") return ["profile", "email", "team", "isos", "roles", "funders", "email-plan"];
  return ["profile", "email"];
}

export const PERMISSIONS = {
  APPLICATION_CREATE: "application:create",
  UNDERWRITING_CLAIM: "underwriting:claim",
  UNDERWRITING_PERFORM: "underwriting:perform",
  UNDERWRITING_SEND_TO_AGENT: "underwriting:send_to_agent",
  AGENT_APPROVAL_ACT: "agent_approval:act",
  ISO_APPROVAL_SEND: "iso_approval:send",
  EMAIL_CONNECT: "email:connect",
  USER_MANAGE: "user:manage",
} as const;

type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[] | "all"> = {
  SUPER_ADMIN: "all",
  AGENT: [
    PERMISSIONS.APPLICATION_CREATE,
    PERMISSIONS.AGENT_APPROVAL_ACT,
    PERMISSIONS.ISO_APPROVAL_SEND,
    PERMISSIONS.EMAIL_CONNECT,
  ],
  UNDERWRITER: [
    PERMISSIONS.UNDERWRITING_CLAIM,
    PERMISSIONS.UNDERWRITING_PERFORM,
    PERMISSIONS.UNDERWRITING_SEND_TO_AGENT,
    PERMISSIONS.EMAIL_CONNECT,
  ],
};

export function roleCan(role: string | null | undefined, permission: Permission): boolean {
  const appRole = toAppRole(role);
  if (!appRole) return false;
  const perms = ROLE_PERMISSIONS[appRole];
  return perms === "all" || perms.includes(permission);
}
