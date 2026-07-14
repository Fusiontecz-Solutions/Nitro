import prisma from '../config/prismaClient';
import { getAccessTokenForRefreshToken } from '../config/gmail';
import { getMessageDetails } from './gmail.service';
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

function getHeaderValue(
    headers: Array<{ name?: string; value?: string }> | undefined,
    name: string,
): string {
    if (!Array.isArray(headers)) return '';
    const target = name.toLowerCase();
    return (
        headers.find((h) => String(h?.name || '').toLowerCase() === target)?.value?.trim() ||
        ''
    );
}

function ensureAngleBrackets(messageId: string): string {
    const trimmed = String(messageId || '').trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed;
    const inner = trimmed.replace(/^<|>$/g, '');
    return inner ? `<${inner}>` : '';
}

export function buildApplicationRejectionEmailSubject(
    businessName?: string | null,
): string {
    const business = String(businessName || '').trim();
    return business ? `Application Rejected — ${business}` : 'Application Rejected';
}

/** Prefixes the branded decline subject for thread replies (RFC threading uses In-Reply-To / References). */
function buildReplySubject(properSubject: string): string {
    const subject = String(properSubject || '').trim() || 'Application Rejected';
    if (/^re:\s/i.test(subject)) return subject;
    return `Re: ${subject}`;
}

function buildReferencesHeader(existingReferences: string, messageId: string): string {
    const mid = ensureAngleBrackets(messageId);
    if (!mid) return String(existingReferences || '').trim();
    const refs = String(existingReferences || '').trim();
    if (!refs) return mid;
    if (refs.includes(mid)) return refs;
    return `${refs} ${mid}`.trim();
}

async function resolveGmailAccessTokenForApplication(
    application: { createdById?: string | null },
): Promise<string | null> {
    const createdById = application.createdById
        ? String(application.createdById).trim()
        : '';
    if (createdById) {
        const user = await prisma.user.findUnique({
            where: { id: createdById },
            select: { googleRefreshToken: true },
        });
        const refreshToken = String(user?.googleRefreshToken || '').trim();
        if (refreshToken) {
            return getAccessTokenForRefreshToken(refreshToken, createdById);
        }
    }

    const envRefreshToken = String(process.env.GOOGLE_REFRESH_TOKEN || '').trim();
    if (envRefreshToken) {
        return getAccessTokenForRefreshToken(envRefreshToken, 'env-gmail');
    }

    return null;
}

function resolveStoredGmailMessageId(application: {
    note?: string | null;
    client?: { notes?: string | null } | null;
}): string | null {
    return (
        parseGmailMessageIdFromApplicationNote(application.note) ||
        parseGmailMessageIdFromClientNotes(application.client?.notes) ||
        null
    );
}

/**
 * Resolve Gmail / RFC headers for the ISO submission email so decline templates
 * can reply in the same thread (`In-Reply-To` / `References` / `Re:` subject).
 */
export async function resolveIsoSubmissionEmailThreadContext(
    application: {
        note?: string | null;
        createdById?: string | null;
        client?: { notes?: string | null } | null;
    },
    fallbackSubject: string,
): Promise<IsoSubmissionEmailThreadContext | null> {
    const gmailMessageId = resolveStoredGmailMessageId(application);
    if (!gmailMessageId) return null;

    const accessToken = await resolveGmailAccessTokenForApplication(application);
    if (!accessToken) {
        console.warn(
            '[reject-thread] No Gmail access token available for application source message',
            gmailMessageId,
        );
        return null;
    }

    try {
        const message = await getMessageDetails(gmailMessageId, { accessToken });
        const headers = message?.payload?.headers as
            | Array<{ name?: string; value?: string }>
            | undefined;
        const rfcMessageId = getHeaderValue(headers, 'Message-ID');
        if (!rfcMessageId) {
            console.warn(
                '[reject-thread] Gmail message missing Message-ID header',
                gmailMessageId,
            );
            return null;
        }

        const inReplyTo = ensureAngleBrackets(rfcMessageId);
        const references = buildReferencesHeader(
            getHeaderValue(headers, 'References'),
            inReplyTo,
        );
        return {
            gmailMessageId,
            gmailThreadId: message?.threadId ? String(message.threadId) : undefined,
            inReplyTo,
            references,
            replySubject: buildReplySubject(fallbackSubject),
        };
    } catch (error) {
        console.error(
            '[reject-thread] Failed to load Gmail message for decline threading:',
            gmailMessageId,
            error,
        );
        return null;
    }
}
