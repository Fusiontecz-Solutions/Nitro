/**
 * Role values matching Prisma enum Role.
 * Used for GET /roles and validation.
 */
/** Must stay in sync with `enum Role` in `prisma/schema/application.prisma`. */
export const ROLES = [
  'AGENT',
  'SCRUBBING',
  'UNDERWRITER',
  'ACCOUNTANT',
  'ACCOUNTS',
  'ADMIN',
  'OPERATIONS',
  'SYNDICATOR',
  'SUPER_ADMIN',
  'CONTRACTS_LOG',
] as const;

/** Public registration disabled — Super Admin only via bootstrap / create-user. */
export const PUBLIC_REGISTER_ROLES: readonly string[] = [];

/**
 * Roles that may sign in to this app:
 *   CONTRACTS_LOG → contract workflow + user / role management
 *   AGENT        → creates applications, approves underwriting, sends to ISO
 *   UNDERWRITER  → claims and underwrites incoming applications
 */
export const APP_ALLOWED_ROLES = ['CONTRACTS_LOG', 'AGENT', 'UNDERWRITER'] as const;

/** Roles a Super Admin may create / assign from user management. */
export const MANAGEABLE_ROLES = ['CONTRACTS_LOG', 'AGENT', 'UNDERWRITER'] as const;

/** Workflow roles that must not reach contract / integration modules. */
export const WORKFLOW_ROLES = ['AGENT', 'UNDERWRITER'] as const;

export type RoleValue = (typeof ROLES)[number];

export function isValidRole(role: string): role is RoleValue {
  return ROLES.includes(role as RoleValue);
}

export function normalizeRoleValue(role: unknown): string {
  return String(role ?? '')
    .trim()
    .toUpperCase()
    .replace(/-/g, '_');
}

export function isAppAllowedRole(role: unknown): boolean {
  return (APP_ALLOWED_ROLES as readonly string[]).includes(normalizeRoleValue(role));
}

export function isManageableRole(role: unknown): boolean {
  return (MANAGEABLE_ROLES as readonly string[]).includes(normalizeRoleValue(role));
}
