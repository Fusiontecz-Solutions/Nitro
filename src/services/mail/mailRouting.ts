/**
 * Which funder an outbound email belongs to, and therefore which provider sends it.
 *
 *   funder on 'gmail'    → the funder's own Gmail mailbox (FunderMailbox)
 *   funder on 'sendgrid' → SendGrid with the funder's verified sender (default)
 *   no funder yet        → the server Gmail mailbox (GMAIL_SENDER_EMAIL)
 *
 * The funder is the explicit one passed by the caller, else the funder on the
 * deal's most recent contract, else the funder picked on the deal's business
 * info. Matching reuses `resolveFunderProfile` (same rules as the signing portal
 * and payment letters).
 */
import prisma from '../../config/prismaClient';
import type { MailSender } from '../mailSenderIdentity';

export type MailRoute = 'funder_gmail' | 'sendgrid' | 'system_gmail' | 'smtp';

export interface MailFunder {
    id: string;
    name: string;
    mailProvider: 'sendgrid' | 'gmail';
    /** Verified SendGrid sender (also the display name for funder Gmail sends). */
    sender: MailSender | null;
}

export interface MailFunderLookup {
    funderProfileId?: string | null;
    funderName?: string | null;
    applicationId?: string | null;
}

async function funderNameForApplication(applicationId: string): Promise<{ funderName: string; state: string | null } | null> {
    const contract = await prisma.contract.findFirst({
        where: { applicationId, funderName: { not: null } },
        select: { funderName: true, state: true },
        orderBy: { updatedAt: 'desc' },
    });
    const fromContract = String(contract?.funderName ?? '').trim();
    if (fromContract) return { funderName: fromContract, state: contract?.state ?? null };

    const business = await prisma.businessInfo.findUnique({
        where: { applicationId },
        select: { funderName: true, state: true },
    });
    const fromBusiness = String(business?.funderName ?? '').trim();
    return fromBusiness ? { funderName: fromBusiness, state: business?.state ?? null } : null;
}

/** The funder an email belongs to, or null when the deal has no funder selected yet. */
export async function resolveMailFunder(lookup: MailFunderLookup): Promise<MailFunder | null> {
    const funderProfileId = String(lookup.funderProfileId ?? '').trim();
    let funderName = String(lookup.funderName ?? '').trim();
    let state: string | null = null;
    const applicationId = String(lookup.applicationId ?? '').trim();

    if (!funderProfileId && !funderName && applicationId) {
        const found = await funderNameForApplication(applicationId);
        if (!found) return null;
        funderName = found.funderName;
        state = found.state;
    }
    if (!funderProfileId && !funderName) return null;

    // Lazy import: funderProfileService pulls in PDF / upload services the mailer must not load eagerly.
    const { resolveFunderProfile } = await import('../funderProfileService');
    const profile = await resolveFunderProfile({ funderProfileId, funderName, state });
    if (!profile?.id) return null;

    const row = await prisma.funderProfile.findUnique({
        where: { id: String(profile.id) },
        select: { id: true, name: true, mailProvider: true, sendgridFromEmail: true, sendgridFromName: true },
    });
    if (!row) return null;
    const email = row.sendgridFromEmail?.trim();
    const name = row.sendgridFromName?.trim();
    return {
        id: row.id,
        name: row.name,
        mailProvider: row.mailProvider === 'gmail' ? 'gmail' : 'sendgrid',
        sender: email && name ? { email, name } : null,
    };
}

/**
 * Providers to try, in order. Later entries are used only when an earlier one
 * definitely did not send (see mailErrors.isSafeToFallback).
 */
export function planMailRoutes(funder: MailFunder | null): MailRoute[] {
    if (!funder) return ['system_gmail', 'sendgrid', 'smtp'];
    if (funder.mailProvider === 'gmail') return ['funder_gmail', 'sendgrid', 'system_gmail', 'smtp'];
    return ['sendgrid', 'system_gmail', 'smtp'];
}
