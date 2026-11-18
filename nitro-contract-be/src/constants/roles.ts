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
 *   SUPER_ADMIN  → top role: everything CONTRACTS_LOG can do + Super Admin-only features
 *   CONTRACTS_LOG → contract workflow + user / role management
 *   AGENT        → creates applications, approves underwriting, sends to ISO
 *   UNDERWRITER  → claims and underwrites incoming applications
 */
export const APP_ALLOWED_ROLES = ['SUPER_ADMIN', 'CONTRACTS_LOG', 'AGENT', 'UNDERWRITER'] as const;

/** Roles that may be created / assigned from user management (SUPER_ADMIN only by a SUPER_ADMIN). */
export const MANAGEABLE_ROLES = ['SUPER_ADMIN', 'CONTRACTS_LOG', 'AGENT', 'UNDERWRITER'] as const;

/** Roles that pass every CONTRACTS_LOG access check (SUPER_ADMIN sits above CONTRACTS_LOG). */
export const CONTRACTS_LOG_ACCESS_ROLES = ['SUPER_ADMIN', 'CONTRACTS_LOG'] as const;

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

/** SUPER_ADMIN only — gate for Super Admin-only features and for assigning SUPER_ADMIN. */
export function isSuperAdminRole(role: unknown): boolean {
  const r = normalizeRoleValue(role);
  return r === 'SUPER_ADMIN' || r === 'SUPERADMIN';
}

/** CONTRACTS_LOG or SUPER_ADMIN — use wherever CONTRACTS_LOG access is checked. */
export function hasContractsLogAccess(role: unknown): boolean {
  const r = normalizeRoleValue(role);
  return r === 'CONTRACTS_LOG' || r === 'CONTRACTSLOG' || isSuperAdminRole(r);
}
