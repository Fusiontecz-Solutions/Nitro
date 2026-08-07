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
] as const;

/** Public registration disabled — Super Admin only via bootstrap / create-user. */
export const PUBLIC_REGISTER_ROLES: readonly string[] = [];

/** Only role allowed to use this contract-workflow app. */
export const APP_ALLOWED_ROLES = ['SUPER_ADMIN'] as const;

export type RoleValue = (typeof ROLES)[number];

export function isValidRole(role: string): role is RoleValue {
  return ROLES.includes(role as RoleValue);
}
