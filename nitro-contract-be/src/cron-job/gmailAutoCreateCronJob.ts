import cron, { validate as validateCronExpression, type ScheduledTask } from 'node-cron';
import type { Role } from '@prisma/client';
import prisma from '../config/prismaClient';
import { runGmailAutoCreateForUser } from '../services/gmail/gmailAutoCreateService';

/**
 * Gmail PDF auto-create sweep (ported from Katam's crmGmailCronJob).
 *
 * Each tick visits every active user with a connected Gmail mailbox and
 * auto-create switched on, and turns new deal emails into applications owned
 * by that user. Per-mailbox Redis locks (in the service) keep several API
 * instances from processing the same mailbox at once.
 *
 * Env:
 *   GMAIL_AUTO_CREATE_CRON_ENABLED  'false' disables the job (default on)
 *   GMAIL_PDF_INBOX_CRON            cron expression (default every minute)
 *   GMAIL_AUTO_CREATE_ROLES         roles whose mailboxes are swept (default AGENT,SUPER_ADMIN)
 */

const DEFAULT_GMAIL_INBOX_CRON = '* * * * *';
const DEFAULT_ROLES = ['AGENT', 'SUPER_ADMIN'];

let sweepInProgress = false;
let task: ScheduledTask | null = null;

function resolveCronExpression(): string {
    const raw = String(process.env.GMAIL_PDF_INBOX_CRON ?? '').trim();
    if (!raw) return DEFAULT_GMAIL_INBOX_CRON;
    if (!validateCronExpression(raw)) {
        console.warn(`[gmail-auto-create] invalid GMAIL_PDF_INBOX_CRON="${raw}"; using ${DEFAULT_GMAIL_INBOX_CRON}`);
        return DEFAULT_GMAIL_INBOX_CRON;
    }
    return raw;
}

export function readGmailAutoCreateRoles(): Role[] {
    const raw = String(process.env.GMAIL_AUTO_CREATE_ROLES ?? '').trim();
    const roles = raw
        ? raw.split(',').map((r) => r.trim().toUpperCase().replace(/-/g, '_')).filter(Boolean)
        : DEFAULT_ROLES;
    return roles as Role[];
}

export async function runGmailAutoCreateSweep(): Promise<void> {
    if (sweepInProgress) return;
    sweepInProgress = true;
    try {
        const users = await prisma.user.findMany({
            where: {
                googleRefreshToken: { not: null },
                gmailAutoCreateEnabled: true,
                isActive: true,
                role: { in: readGmailAutoCreateRoles() },
            },
            select: { id: true, email: true },
        });
        for (const user of users) {
            try {
                const outcome = await runGmailAutoCreateForUser(user.id);
                if (outcome.status === 'ok' && outcome.created.length > 0) {
                    console.log(`[gmail-auto-create] user=${user.email || user.id} created=${outcome.created.length}`);
                }
            } catch (err) {
                // Revoked grant, Gmail outage… — log and move on to the next mailbox.
                console.error(`[gmail-auto-create] failed for user=${user.email || user.id}:`, (err as Error)?.message || err);
            }
        }
    } finally {
        sweepInProgress = false;
    }
}

export function startGmailAutoCreateCronJob(): ScheduledTask | null {
    if (String(process.env.GMAIL_AUTO_CREATE_CRON_ENABLED ?? '').trim().toLowerCase() === 'false') {
        console.log('[gmail-auto-create] cron disabled (GMAIL_AUTO_CREATE_CRON_ENABLED=false)');
        return null;
    }
    if (task) return task;
    const expression = resolveCronExpression();
    task = cron.schedule(
        expression,
        () => {
            void runGmailAutoCreateSweep().catch((err) => {
                console.error('[gmail-auto-create] sweep rejected:', err);
            });
        },
        { name: 'gmail-auto-create', noOverlap: true },
    );
    console.log(`[gmail-auto-create] cron scheduled "${expression}" for roles ${readGmailAutoCreateRoles().join(',')}`);
    return task;
}
