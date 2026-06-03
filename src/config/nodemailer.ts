import nodemailer from 'nodemailer';

const sendgridApiKey = process.env.SENDGRID_API_KEY?.trim();
const useSendgrid = Boolean(sendgridApiKey);

/** True when `SENDGRID_API_KEY` is set (payment letters require this). */
export function isSendGridConfigured(): boolean {
    return Boolean(sendgridApiKey);
}

/** True when SendGrid API key or classic Gmail SMTP user+pass is configured. */
export function isOutboundSmtpConfigured(): boolean {
    if (sendgridApiKey) return true;
    return Boolean(
        process.env.SMTP_AUTH_USER?.trim() && process.env.SMTP_AUTH_PASS?.trim(),
    );
}

const DEFAULT_DISPLAY_NAME = 'Woodmere Financial';

const LEGACY_MAIL_FROM_NAMES = new Set([
    'crm',
    'in-house crm',
    'ih crm',
    'in house crm',
]);

/** Display name for outbound SMTP / SendGrid (read at send time, not module load). */
function getMailFromDisplayName(): string {
    const envName =
        process.env.MAIL_FROM_NAME?.trim() ||
        process.env.SENDGRID_FROM_NAME?.trim();
    if (envName && !LEGACY_MAIL_FROM_NAMES.has(envName.toLowerCase())) {
        return envName;
    }
    return DEFAULT_DISPLAY_NAME;
}

/** Strip optional `"Name"` wrapper and extract the bare email from a From value. */
function extractEmailAddress(raw: string): string {
    const trimmed = raw.trim();
    const angle = trimmed.match(/<([^>]+)>/);
    if (angle?.[1]) return angle[1].trim();
    return trimmed;
}

function resolveVerifiedFromEmail(): string | undefined {
    return (
        process.env.SMTP_FROM?.trim() ||
        process.env.MAIL_FROM?.trim() ||
        process.env.SENDGRID_FROM_EMAIL?.trim() ||
        process.env.SENDGRID_AUTH_USER?.trim() ||
        process.env.SMTP_AUTH_USER?.trim()
    );
}

/** Nodemailer + SendGrid: object `from` is more reliable than a formatted string. */
export function buildMailFrom(optionalRaw?: string): { name: string; address: string } {
    const raw = optionalRaw?.trim() || resolveVerifiedFromEmail();
    if (!raw) {
        if (sendgridApiKey) {
            throw new Error(
                'SendGrid is configured but no verified From email is set. Add SENDGRID_FROM_EMAIL or SENDGRID_AUTH_USER to .env.',
            );
        }
        throw new Error(
            'Outbound email is not configured. Set SENDGRID_FROM_EMAIL (or SENDGRID_API_KEY + verified sender).',
        );
    }
    return {
        name: getMailFromDisplayName(),
        address: extractEmailAddress(raw),
    };
}

function formatMailFromAddress(emailOrFrom: string): string {
    const { name, address } = buildMailFrom(emailOrFrom);
    return `"${name}" <${address}>`;
}

/** From address for SendGrid-only sends (verified sender in SendGrid). */
export function getSendGridMailFrom(): string {
    const { name, address } = buildMailFrom(
        process.env.SENDGRID_FROM_EMAIL?.trim() ||
            process.env.SENDGRID_AUTH_USER?.trim(),
    );
    return `"${name}" <${address}>`;
}

function createSendGridTransporter() {
    const port = Number(process.env.SENDGRID_SMTP_PORT) || 587;
    return nodemailer.createTransport({
        host: process.env.SENDGRID_SMTP_HOST?.trim() || 'smtp.sendgrid.net',
        port,
        secure: port === 465,
        auth: {
            user: 'apikey',
            pass: sendgridApiKey,
        },
    });
}

/**
 * Default From header. SendGrid requires a verified sender; use SMTP_FROM,
 * MAIL_FROM, SENDGRID_FROM_EMAIL, or SENDGRID_AUTH_USER (verified address).
 * Display name defaults to Woodmere Financial (override with MAIL_FROM_NAME or SENDGRID_FROM_NAME).
 */
export function getDefaultMailFrom(): string {
    const { name, address } = buildMailFrom();
    return `"${name}" <${address}>`;
}

function createTransporter() {
    if (useSendgrid) {
        return createSendGridTransporter();
    }

    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        service: 'gmail',
        port: 587,
        secure: false,
        auth: {
            user: process.env.SMTP_AUTH_USER,
            pass: process.env.SMTP_AUTH_PASS,
        },
    });
}

const transporter = createTransporter();

interface SendMailOptions {
    to: string | string[];
    subject: string;
    html: string;
    from?: string;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    attachments?: Array<{
        filename?: string | false;
        content?: Buffer | string;
        path?: string;
        cid?: string;
        contentType?: string;
        contentDisposition?: 'inline' | 'attachment';
    }>;
}

const sendMail = async (
    optionsOrTo: SendMailOptions | string,
    legacySubject?: string,
    legacyHtml?: string,
) => {
    try {
        const options: SendMailOptions =
            typeof optionsOrTo === 'string'
                ? {
                      to: optionsOrTo,
                      subject: legacySubject || '',
                      html: legacyHtml || '',
                  }
                : optionsOrTo;

        const { to, subject, html, from, cc, bcc, replyTo, attachments } = options;

        const mailOptions = {
            from: buildMailFrom(from),
            to,
            subject,
            html,
            cc,
            bcc,
            replyTo,
            ...(attachments?.length ? { attachments } : {}),
        };

        const response = await transporter.sendMail(mailOptions);
        return response;
    } catch (error) {
        console.error('SMTP sendMail failed:', error);
        throw error;
    }
};

/** Send mail via SendGrid SMTP only (never Gmail OAuth or Gmail SMTP). */
export async function sendSendGridMail(options: SendMailOptions) {
    if (!sendgridApiKey) {
        throw new Error(
            'SendGrid is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL on the server.',
        );
    }
    const transporter = createSendGridTransporter();
    const { to, subject, html, from, cc, bcc, replyTo, attachments } = options;
    const mailOptions = {
        from: buildMailFrom(
            from ||
                process.env.SENDGRID_FROM_EMAIL?.trim() ||
                process.env.SENDGRID_AUTH_USER?.trim(),
        ),
        to,
        subject,
        html,
        cc,
        bcc,
        replyTo,
        ...(attachments?.length ? { attachments } : {}),
    };
    return transporter.sendMail(mailOptions);
}

export default sendMail;
