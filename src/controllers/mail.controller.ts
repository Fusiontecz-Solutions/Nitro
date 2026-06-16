import { Request, Response } from 'express';
import {
    getSendGridMailFrom,
    isSendGridConfigured,
    sendSendGridMail,
} from '../config/nodemailer';
import { sendTrackedPaymentTemplateMail } from '../services/paymentMailSendService';
import { buildHtmlPdfMailAttachment } from '../services/emailHtmlPdfAttachment.service';

/**
 * POST /api/mail/send
 * Send payment template emails via SendGrid only (not Gmail OAuth or Gmail SMTP).
 * When `applicationId` + deal metadata are supplied, the send is tracked end-to-end
 * via SendGrid webhooks (delivered / opened / clicked / bounced).
 */
export async function sendPaymentMail(req: Request, res: Response): Promise<void> {
    try {
        if (!isSendGridConfigured()) {
            res.status(503).json({
                success: false,
                message:
                    'Payment letters require SendGrid. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL on the server (connected Gmail is not used).',
            });
            return;
        }

        const body = req.body as Record<string, unknown>;
        const to = typeof body.to === 'string' ? body.to.trim() : '';
        const subject = typeof body.subject === 'string' ? body.subject : '';
        const htmlBody = typeof body.body === 'string' ? body.body : '';
        const cc = body.cc as string | string[] | undefined;
        const bcc = body.bcc as string | string[] | undefined;
        const replyTo = typeof body.replyTo === 'string' ? body.replyTo : undefined;

        const applicationId =
            typeof body.applicationId === 'string' ? body.applicationId.trim() : '';
        const dealKey = typeof body.dealKey === 'string' ? body.dealKey.trim() : '';
        const templateName = typeof body.templateName === 'string' ? body.templateName.trim() : '';
        const category = typeof body.category === 'string' ? body.category.trim() : '';

        if (!to) {
            res.status(400).json({
                success: false,
                message: 'Recipient (to) is required',
            });
            return;
        }

        if (!htmlBody) {
            res.status(400).json({
                success: false,
                message: 'Email body is required',
            });
            return;
        }

        if (applicationId) {
            if (!dealKey || !templateName || !category) {
                res.status(400).json({
                    success: false,
                    message:
                        'dealKey, templateName, and category are required when applicationId is provided',
                });
                return;
            }

            const tracked = await sendTrackedPaymentTemplateMail(req, {
                to,
                subject: subject || '',
                body: htmlBody,
                cc,
                bcc,
                replyTo,
                applicationId,
                dealKey,
                templateName,
                category,
            });

            if (!tracked.ok) {
                res.status(tracked.status).json({
                    success: false,
                    message: tracked.message,
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'Email sent successfully',
                data: {
                    paymentMailLog: tracked.paymentMailLog,
                    sgMessageId: tracked.sgMessageId ?? null,
                },
            });
            return;
        }

        const pdfFilenameBase = templateName || subject || 'letter';
        const pdfAttachment = await buildHtmlPdfMailAttachment(htmlBody, pdfFilenameBase);

        const result = await sendSendGridMail({
            to,
            subject: subject || '',
            html: htmlBody,
            cc,
            bcc,
            replyTo,
            from: getSendGridMailFrom(),
            attachments: pdfAttachment ? [pdfAttachment] : undefined,
        });

        if (!result) {
            throw new Error('Failed to send email via SMTP');
        }

        res.status(200).json({
            success: true,
            message: 'Email sent successfully',
            data: result,
        });
    } catch (error: any) {
        console.error('Payment mail send error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to send email',
        });
    }
}
