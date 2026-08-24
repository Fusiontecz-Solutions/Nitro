import prisma from '../config/prismaClient';
import {
    parseGmailMessageIdFromApplicationNote,
    parseGmailMessageIdFromClientNotes,
} from './pdfFileDedupeService';

export interface IsoSubmissionEmailThreadContext {
    gmailMessageId: string;
    gmailThreadId?: string;
    inReplyTo: string;
    references: string;
    replySubject: string;
}

export function buildApplicationRejectionEmailSubject(
    businessName?: string | null,
): string {
    const business = String(businessName || '').trim();
    return business ? `Application Rejected — ${business}` : 'Application Rejected';
}

/**
 * Gmail thread resolution removed with Gmail auto-create cleanup.
 * Returns null so rejection emails send as new messages (no In-Reply-To).
 */
export async function resolveIsoSubmissionEmailThreadContext(application: {
    id?: string;
    note?: string | null;
    createdById?: string | null;
    client?: { notes?: string | null } | null;
}): Promise<IsoSubmissionEmailThreadContext | null> {
    // Keep note parsers available for diagnostics; Gmail API path is gone.
    void parseGmailMessageIdFromApplicationNote(application?.note);
    void parseGmailMessageIdFromClientNotes(application?.client?.notes);
    void prisma;
    return null;
}
