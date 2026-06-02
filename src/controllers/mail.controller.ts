import { Request, Response } from 'express';
import {
    getSendGridMailFrom,
    isSendGridConfigured,
    sendSendGridMail,
} from '../config/nodemailer';

/**
 * POST /api/mail/send
 * Send payment template emails via SendGrid only (not Gmail OAuth or Gmail SMTP).
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

        const { to, subject, body, cc, bcc, replyTo } = req.body;

        if (!to) {
            res.status(400).json({
                success: false,
                message: 'Recipient (to) is required',
            });
            return;
        }

        if (!body) {
            res.status(400).json({
                success: false,
                message: 'Email body is required',
            });
            return;
        }

        const result = await sendSendGridMail({
            to,
            subject: subject || '',
            html: body,
            cc,
            bcc,
            replyTo,
            from: getSendGridMailFrom(),
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
