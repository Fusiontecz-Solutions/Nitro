/**
 * Capability matrix for the roles this app supports. Enforced by
 * `requirePermission` on the workflow routes and exposed read-only via
 * GET /roles/permissions so Super Admin can see exactly what each role can do.
 */
import { normalizeRoleValue } from './roles';

export const PERMISSIONS = {
    DASHBOARD_VIEW: 'dashboard:view',
    APPLICATION_CREATE: 'application:create',
    APPLICATION_VIEW_OWN: 'application:view_own',
    APPLICATION_VIEW_ALL: 'application:view_all',
    APPLICATION_SUBMIT_UNDERWRITING: 'application:submit_underwriting',
    UNDERWRITING_CLAIM: 'underwriting:claim',
    UNDERWRITING_PERFORM: 'underwriting:perform',
    UNDERWRITING_SEND_TO_AGENT: 'underwriting:send_to_agent',
    AGENT_APPROVAL_ACT: 'agent_approval:act',
    ISO_APPROVAL_SEND: 'iso_approval:send',
    EMAIL_CONNECT: 'email:connect',
    CONTRACT_MANAGE: 'contract:manage',
    USER_MANAGE: 'user:manage',
    ISO_MANAGE: 'iso:manage',
    WORKFLOW_OVERSIGHT: 'workflow:oversight',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_LABELS: Record<Permission, string> = {
    'dashboard:view': 'View dashboard',
    'application:create': 'Create new applications',
    'application:view_own': 'View own / assigned applications',
    'application:view_all': 'View all applications',
    'application:submit_underwriting': 'Submit applications to underwriting',
    'underwriting:claim': 'Claim applications from the underwriting pool',
    'underwriting:perform': 'Perform underwriting (offers, bank analysis, documents)',
    'underwriting:send_to_agent': 'Send underwritten applications to the Agent for approval',
    'agent_approval:act': 'Review underwriting and approve / request changes',
    'iso_approval:send': 'Send the ISO approval email',
    'email:connect': 'Connect a Gmail mailbox',
    'contract:manage': 'Generate and manage contracts',
    'user:manage': 'Create, edit and deactivate users',
    'iso:manage': 'Manage ISO records',
    'workflow:oversight': 'Oversee the whole application workflow',
};

const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
    SUPER_ADMIN: ALL_PERMISSIONS,
    AGENT: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.APPLICATION_CREATE,
        PERMISSIONS.APPLICATION_VIEW_OWN,
        PERMISSIONS.APPLICATION_SUBMIT_UNDERWRITING,
        PERMISSIONS.AGENT_APPROVAL_ACT,
        PERMISSIONS.ISO_APPROVAL_SEND,
        PERMISSIONS.EMAIL_CONNECT,
    ],
    UNDERWRITER: [
        PERMISSIONS.DASHBOARD_VIEW,
        PERMISSIONS.APPLICATION_VIEW_OWN,
        PERMISSIONS.UNDERWRITING_CLAIM,
        PERMISSIONS.UNDERWRITING_PERFORM,
        PERMISSIONS.UNDERWRITING_SEND_TO_AGENT,
        PERMISSIONS.EMAIL_CONNECT,
    ],
};

export function roleHasPermission(role: unknown, permission: Permission): boolean {
    const perms = ROLE_PERMISSIONS[normalizeRoleValue(role)];
    return Boolean(perms && perms.includes(permission));
}
