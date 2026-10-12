jest.mock('../config/prismaClient', () => ({ __esModule: true, default: {} }));

import { getApplicationStageAccess } from './applicationStageAccess';
import { roleHasPermission, PERMISSIONS } from '../constants/rolePermissions';
import {
    hasContractsLogAccess,
    isAppAllowedRole,
    isManageableRole,
    isSuperAdminRole,
    isValidRole,
} from '../constants/roles';
import { buildRawMimeMessage } from './gmail/gmailMailService';
import { buildAgentBucketWhere, buildUnderwriterBucketWhere } from './applicationWorkflowService';

describe('stage access for the Agent / Underwriter workflow', () => {
    const access = (role: string, currentQueue: string) =>
        getApplicationStageAccess({ role, currentQueue, currentState: null });

    it('keeps the Underwriter editing while the deal is in the Underwriter stage', () => {
        expect(access('UNDERWRITER', 'Underwriter').canEdit).toBe(true);
    });

    it('locks both workflow roles once underwriting is handed back to the Agent', () => {
        expect(access('UNDERWRITER', 'Agent Review').isPreview).toBe(true);
        expect(access('AGENT', 'Agent Review').isPreview).toBe(true);
        // Legacy label on older rows.
        expect(access('UNDERWRITER', 'Agent Approval').isPreview).toBe(true);
    });

    it('locks the Underwriter after the ISO email is sent', () => {
        expect(access('UNDERWRITER', 'Approval Sent').isPreview).toBe(true);
        expect(access('UNDERWRITER', 'Contract Pending').isPreview).toBe(true);
    });

    it('does not lock the Agent role at Approval Sent (ISO portal sessions carry that role)', () => {
        expect(access('AGENT', 'Approval Sent').canEdit).toBe(true);
    });

    it('never locks Super Admin', () => {
        expect(access('CONTRACTS_LOG', 'Agent Approval').canEdit).toBe(true);
        expect(access('CONTRACTS_LOG', 'Contract Pending').canEdit).toBe(true);
    });
});

describe('role permissions', () => {
    it('allows only the supported roles to sign in / be managed', () => {
        expect(isAppAllowedRole('agent')).toBe(true);
        expect(isAppAllowedRole('UNDERWRITER')).toBe(true);
        expect(isAppAllowedRole('CONTRACTS_LOG')).toBe(true);
        expect(isAppAllowedRole('SCRUBBING')).toBe(false);
        expect(isManageableRole('OPERATIONS')).toBe(false);
    });

    it('separates Agent and Underwriter capabilities', () => {
        expect(roleHasPermission('AGENT', PERMISSIONS.APPLICATION_CREATE)).toBe(true);
        expect(roleHasPermission('AGENT', PERMISSIONS.ISO_APPROVAL_SEND)).toBe(true);
        expect(roleHasPermission('AGENT', PERMISSIONS.UNDERWRITING_CLAIM)).toBe(false);
        expect(roleHasPermission('UNDERWRITER', PERMISSIONS.UNDERWRITING_SEND_TO_AGENT)).toBe(true);
        expect(roleHasPermission('UNDERWRITER', PERMISSIONS.APPLICATION_CREATE)).toBe(false);
        expect(roleHasPermission('UNDERWRITER', PERMISSIONS.USER_MANAGE)).toBe(false);
        expect(roleHasPermission('CONTRACTS_LOG', PERMISSIONS.USER_MANAGE)).toBe(true);
    });

    it('keeps SUPER_ADMIN as a separate role that sits above CONTRACTS_LOG', () => {
        expect(isValidRole('SUPER_ADMIN')).toBe(true);
        expect(isValidRole('CONTRACTS_LOG')).toBe(true);
        expect(isAppAllowedRole('SUPER_ADMIN')).toBe(true);
        expect(isManageableRole('SUPER_ADMIN')).toBe(true);
        expect(roleHasPermission('CONTRACTS_LOG', PERMISSIONS.CONTRACT_MANAGE)).toBe(true);
        expect(roleHasPermission('SUPER_ADMIN', PERMISSIONS.CONTRACT_MANAGE)).toBe(true);
        expect(hasContractsLogAccess('SUPER_ADMIN')).toBe(true);
        expect(hasContractsLogAccess('CONTRACTS_LOG')).toBe(true);
        expect(isSuperAdminRole('SUPER_ADMIN')).toBe(true);
        expect(isSuperAdminRole('CONTRACTS_LOG')).toBe(false);
    });
});

describe('Gmail MIME message', () => {
    it('carries threading headers and a base64 UTF-8 body', () => {
        const raw = buildRawMimeMessage({
            from: 'agent@example.com',
            to: 'iso@example.com',
            cc: ['ops@example.com'],
            subject: 'Re: Your Application Has Been Approved',
            html: '<p>Approved — café</p>',
            inReplyTo: '<abc@mail.gmail.com>',
            references: '<first@mail.gmail.com> <abc@mail.gmail.com>',
        });
        expect(raw).toContain('In-Reply-To: <abc@mail.gmail.com>');
        expect(raw).toContain('References: <first@mail.gmail.com> <abc@mail.gmail.com>');
        expect(raw).toContain('Cc: ops@example.com');
        expect(raw).toContain('Content-Transfer-Encoding: base64');
        expect(raw).toContain(Buffer.from('<p>Approved — café</p>', 'utf8').toString('base64'));
    });

    it('strips header injection attempts', () => {
        const raw = buildRawMimeMessage({
            to: 'iso@example.com\r\nBcc: evil@example.com',
            subject: 'Hi\r\nBcc: evil@example.com',
            html: '<p>x</p>',
        });
        expect(raw).not.toMatch(/\r\nBcc:/);
    });
});

describe('workflow queue buckets', () => {
    const json = (v: unknown) => JSON.stringify(v);

    it('scopes Agent buckets to the Agent’s own deals', () => {
        const where = json(buildAgentBucketWhere('awaiting_my_approval', 'agent-1'));
        expect(where).toContain('agent-1');
        expect(where).toContain('Agent Review');
        expect(where).toContain('Agent Approval');
    });

    it('shows Agent Review deals in the Underwriter Sent to Agent bucket', () => {
        expect(json(buildUnderwriterBucketWhere('sent_to_agent', 'uw-1'))).toContain('Agent Review');
    });

    it('only shows unclaimed deals in the Underwriter incoming pool', () => {
        const where = json(buildUnderwriterBucketWhere('incoming', 'uw-1'));
        expect(where).toContain('"assignedUnderwriterId":null');
        expect(where).not.toContain('uw-1');
    });

    it('limits My claimed to the signed-in Underwriter', () => {
        expect(json(buildUnderwriterBucketWhere('my_claimed', 'uw-1'))).toContain('"assignedUnderwriterId":"uw-1"');
    });

    it('shows Agent-returned deals in Needs Re-Review, not in Incoming / My claimed', () => {
        const reReview = json(buildUnderwriterBucketWhere('needs_re_review', 'uw-1'));
        expect(reReview).toContain('Needs Re-Review');
        expect(reReview).toContain('uw-1');
        expect(json(buildUnderwriterBucketWhere('my_claimed', 'uw-1'))).toMatch(/"NOT":\{"currentState":\{"equals":"Needs Re-Review"/);
        expect(json(buildUnderwriterBucketWhere('incoming', 'uw-1'))).toMatch(/"NOT":\{"currentState":\{"equals":"Needs Re-Review"/);
    });
});
