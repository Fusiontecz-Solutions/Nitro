import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const sendgridApiKey = process.env.SENDGRID_API_KEY?.trim();
const useSendgrid = Boolean(sendgridApiKey);

/** True when SendGrid API key or classic Gmail SMTP user+pass is configured. */
export function isOutboundSmtpConfigured(): boolean {
    if (sendgridApiKey) return true;
    return Boolean(
        process.env.SMTP_AUTH_USER?.trim() && process.env.SMTP_AUTH_PASS?.trim(),
    );
}

/**
 * Default From header. SendGrid requires a verified sender; use SMTP_FROM,
 * MAIL_FROM, SENDGRID_FROM_EMAIL, or SENDGRID_AUTH_USER (verified address).
 */
export function getDefaultMailFrom(): string {
    const explicit =
        process.env.SMTP_FROM?.trim() ||
        process.env.MAIL_FROM?.trim() ||
        process.env.SENDGRID_FROM_EMAIL?.trim();
    if (explicit) {
        return explicit.includes('<') ? explicit : `"CRM" <${explicit}>`;
    }
    if (useSendgrid) {
        const verified = process.env.SENDGRID_AUTH_USER?.trim();
        if (verified) return `"CRM" <${verified}>`;
    }
    const gmailUser = process.env.SMTP_AUTH_USER?.trim();
    if (gmailUser) return `"CRM" <${gmailUser}>`;
    return '"CRM" <noreply@localhost>';
}

function createTransporter() {
    if (useSendgrid) {
        const port = Number(process.env.SENDGRID_SMTP_PORT) || 587;
        return nodemailer.createTransport({
            host: process.env.SENDGRID_SMTP_HOST?.trim() || 'smtp.sendgrid.net',
            port,
            secure: port === 465,
            auth: {
                // SendGrid SMTP always uses the literal username "apikey"
                user: 'apikey',
                pass: sendgridApiKey,
            },
        });
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
            from: from || getDefaultMailFrom(),
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

export default sendMail;
