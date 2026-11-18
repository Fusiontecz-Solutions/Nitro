/**
 * Outbound mail failure classification.
 *
 * A failed send is either
 *   - `not_sent`  — the provider certainly did not accept the message (no token,
 *                   not configured, 4xx rejection, connection refused before any
 *                   request). Safe to try another provider.
 *   - `ambiguous` — the provider may have accepted it (timeout, connection reset
 *                   mid-request, 5xx). Never resent automatically through another
 *                   provider: the recipient could get the email twice.
 */
export type MailFailureKind = 'not_sent' | 'ambiguous';
export type MailProviderName = 'gmail' | 'sendgrid' | 'smtp';

export class MailDeliveryError extends Error {
    readonly kind: MailFailureKind;
    readonly provider: MailProviderName | null;
    readonly status?: number;

    constructor(message: string, options: { kind: MailFailureKind; provider?: MailProviderName | null; status?: number; cause?: unknown }) {
        super(message);
        this.name = 'MailDeliveryError';
        this.kind = options.kind;
        this.provider = options.provider ?? null;
        this.status = options.status;
        if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
    }
}

/** The idempotency ledger already holds this key as sent / in flight. */
export class DuplicateMailSendError extends Error {
    readonly code = 'MAIL_DUPLICATE_SEND';
    constructor(
        readonly idempotencyKey: string,
        readonly state: string,
    ) {
        super(
            state === 'sent'
                ? 'This email was already sent.'
                : 'This email may already have been sent (previous attempt did not confirm). Check the recipient before sending again.',
        );
        this.name = 'DuplicateMailSendError';
    }
}

/** Errors raised before any request reached the provider. */
const PRE_REQUEST_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'EAUTH', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNECTION']);
/** Errors raised once a request may already be with the provider. */
const MID_REQUEST_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EPIPE', 'ESOCKET', 'ERR_SOCKET_CONNECTION_TIMEOUT']);

function errorCode(error: unknown): string {
    const err = error as { code?: unknown; cause?: { code?: unknown } } | null;
    return String(err?.code ?? err?.cause?.code ?? '').toUpperCase();
}

/** HTTP APIs (Gmail, SendGrid v3): classify by response status or transport error. */
export function classifyHttpFailure(error: unknown, status?: number): MailFailureKind {
    const httpStatus = status ?? (error as { response?: { status?: number } })?.response?.status;
    if (typeof httpStatus === 'number') {
        // 4xx (incl. 429): rejected, not accepted. 5xx: the provider may have queued it.
        return httpStatus >= 500 ? 'ambiguous' : 'not_sent';
    }
    const name = String((error as { name?: string })?.name ?? '');
    if (name === 'TimeoutError' || name === 'AbortError') return 'ambiguous';
    const code = errorCode(error);
    if (PRE_REQUEST_CODES.has(code)) return 'not_sent';
    return 'ambiguous';
}

/** SMTP (SendGrid relay, Gmail SMTP): any SMTP reply code is a rejection; dropped sockets are not. */
export function classifySmtpFailure(error: unknown): MailFailureKind {
    const err = error as { responseCode?: number; code?: string } | null;
    if (typeof err?.responseCode === 'number' && err.responseCode >= 400) return 'not_sent';
    const code = errorCode(error);
    if (PRE_REQUEST_CODES.has(code)) return 'not_sent';
    if (MID_REQUEST_CODES.has(code)) return 'ambiguous';
    return 'ambiguous';
}

export function failureKindOf(error: unknown): MailFailureKind {
    if (error instanceof MailDeliveryError) return error.kind;
    if (error instanceof DuplicateMailSendError) return 'not_sent';
    return 'ambiguous';
}

/** True only when another provider may safely try the same email. */
export function isSafeToFallback(error: unknown): boolean {
    return error instanceof MailDeliveryError && error.kind === 'not_sent';
}

export function notSent(message: string, provider: MailProviderName | null, cause?: unknown): MailDeliveryError {
    return new MailDeliveryError(message, { kind: 'not_sent', provider, cause });
}
