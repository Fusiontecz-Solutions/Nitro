import { Request, Response } from 'express';
import axios from 'axios';
import prisma from '../config/prismaClient';
import oAuth2Client from '../config/gmail';
import {
    fetchRecentPdfEmails,
    // getMessageDetails,
    downloadAttachment,
    fetchAllEmails,
    getMessageDetails,
    autoCreateApplicationsFromEmails,
    sendEmail,
} from '../services/gmail.service';
import sendMail, {
    getDefaultMailFrom,
    isOutboundSmtpConfigured,
} from '../config/nodemailer';

/**
 * Manually trigger Gmail sync
 */

// export async function syncGmail(req: Request, res: Response): Promise<void> {
//     try {
//         const { accessToken, type, pageToken } = req.body;

//         if (!accessToken) {
//             res.status(400).json({
//                 success: false,
//                 message: 'Access token is required',
//             });
//             return;
//         }

//         if (type === 'pdf') {
//             const messages = await fetchRecentPdfEmails(accessToken);

//             res.status(200).json({
//                 success: true,
//                 total: messages.length,
//                 data: messages,
//             });

//             return;
//         }

//         const result = await fetchAllEmails(accessToken, pageToken, 15);

//         res.status(200).json({
//             success: true,
//             count: result.messages.length,
//             nextPageToken: result.nextPageToken,
//             data: result.messages,
//         });

//     } catch (error: any) {
//         res.status(500).json({
//             success: false,
//             message: error.message,
//         });
//     }
// }

export async function syncGmail(req: Request, res: Response): Promise<void> {
    try {
        const { accessToken, type, pageToken } = req.body;

        if (!accessToken) {
            res.status(400).json({
                success: false,
                message: 'Access token is required',
            });
            return;
        }

        // ✅ PDF Emails
        if (type === 'pdf') {
            const messages = await fetchRecentPdfEmails(accessToken);

            res.status(200).json({
                success: true,
                total: messages.length,
                data: messages,
            });

            return;
        }

        // ✅ Map Types
        let label: any;

        switch (type) {
            case "inbox":
                label = "INBOX";
                break;

            case "sent":
                label = "SENT";
                break;

            case "draft":
                label = "DRAFT";
                break;

            case "starred":
                label = "STARRED";
                break;

            case "important":
                label = "IMPORTANT";
                break;

            default:
                label = undefined;
        }

        const result = await fetchAllEmails(
            accessToken,
            pageToken,
            15,
            label
        );

        res.status(200).json({
            success: true,
            count: result.messages.length,
            nextPageToken: result.nextPageToken,
            data: result.messages,
        });

    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
}

/**
 * Get single email details
 */
// export async function getEmailDetails(req: Request, res: Response): Promise<void> {
//     try {
//         const { messageId } = req.params;
//         const { accessToken } = req.body;

//         if (!messageId || !accessToken) {
//             res.status(400).json({
//                 success: false,
//                 message: 'Message ID and access token are required',
//             });
//             return;
//         }

//         const message = await getMessageDetails(messageId, accessToken);

//         res.status(200).json({
//             success: true,
//             data: message,
//         });
//     } catch (error: any) {
//         res.status(500).json({
//             success: false,
//             message: error.message,
//         });
//     }
// }


export async function getEmailDetails(req: Request, res: Response): Promise<void> {
    try {
        const { messageId } = req.params;
        // const accessToken = req.body;
        const authHeader = req.headers.authorization;
        const accessToken = authHeader?.split(" ")[1];

        if (!messageId || !accessToken) {
            res.status(400).json({
                success: false,
                message: 'Message ID and access token are required',
            });
            return;
        }

        const message = await getMessageDetails(messageId, { accessToken });

        res.status(200).json({
            success: true,
            data: message,
        });

    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
}

export async function getAttachment(req: Request, res: Response): Promise<void> {
    try {
        const { messageId } = req.body;

        const authHeader = req.headers.authorization;
        const accessToken = authHeader?.split(" ")[1];

        if (!messageId || !accessToken) {
            res.status(400).json({
                success: false,
                message: "Message ID and access token are required",
            });
            return;
        }

        const message = await getMessageDetails(messageId, { accessToken });

        const allParts: any[] = [];
        const collectParts = (part: any) => {
            if (!part) return;
            if (part.body?.attachmentId) allParts.push(part);
            if (Array.isArray(part.parts)) part.parts.forEach(collectParts);
        };

        collectParts(message.payload);

        const hasFilename = (p: any) =>
            p?.filename && String(p.filename).trim().length > 0;
        const pdfWithName = allParts.filter(
            (p) => hasFilename(p) && String(p.filename).toLowerCase().endsWith('.pdf')
        );
        /** Prefer a named PDF, else any named attachment, else first part (may lack filename in API). */
        const attachmentPart =
            pdfWithName[0] || allParts.find(hasFilename) || allParts[0];

        if (!attachmentPart) {
            res.status(404).json({
                success: false,
                message: "Attachment not found",
            });
            return;
        }

        const fileBuffer = await downloadAttachment(
            messageId,
            attachmentPart.body.attachmentId,
            accessToken
        );

        const rawName = hasFilename(attachmentPart)
            ? String(attachmentPart.filename).trim()
            : 'attachment.pdf';
        const safeForHeader = rawName.replace(/[\r\n"]/g, '_');

        res.setHeader(
            "Content-Type",
            attachmentPart.mimeType || "application/octet-stream"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${safeForHeader}"`
        );

        res.status(200).send(fileBuffer);
    } catch (error: any) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
}

/**
 * POST /api/gmail/auto-create-applications
 * Scans recent INBOX emails for PDF attachments, extracts business data,
 * and auto-creates Clients + Applications in the CRM.
 *
 * Body: { accessToken: string }
 * Requires authenticated user (req.user.id used as creator).
 */
export async function autoCreateFromEmails(req: Request, res: Response): Promise<void> {
    try {
        const { accessToken } = req.body;
        const userId = (req as any).user?.id;

        if (!accessToken) {
            res.status(400).json({
                success: false,
                message: 'Access token is required',
            });
            return;
        }

        if (!userId) {
            res.status(401).json({
                success: false,
                message: 'User authentication required',
            });
            return;
        }

        const results = await autoCreateApplicationsFromEmails(accessToken, userId);

        res.status(200).json({
            success: true,
            message: `Processed ${results.length} PDF attachment(s) from emails`,
            total: results.length,
            data: results,
        });
    } catch (error: any) {
        console.error('Auto-create applications from emails error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to auto-create applications from emails',
        });
    }
}

/**
 * POST /api/gmail/send
 * Compose and send an email via Gmail API.
 *
 * Body:
 *   accessToken  - Gmail OAuth access token (required)
 *   to           - recipient email(s), string or string[] (required)
 *   subject      - email subject (required)
 *   body         - HTML email body (required)
 *   cc           - CC recipient(s), string or string[] (optional)
 *   bcc          - BCC recipient(s), string or string[] (optional)
 *   from         - sender address (optional, defaults to authenticated Gmail user)
 *   replyTo      - Reply-To header (optional)
 *   threadId     - existing thread ID when replying (optional)
 *   inReplyTo    - Message-ID of the message being replied to (optional)
 *   references   - References header for threading (optional)
 */
export async function sendCompose(req: Request, res: Response): Promise<void> {
    try {
        const {
            accessToken,
            to,
            subject,
            body,
            cc,
            bcc,
            from,
            replyTo,
            threadId,
            inReplyTo,
            references,
        } = req.body;

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

        let result: any;

        if (isOutboundSmtpConfigured()) {
            // Force sender to backend SMTP account for CRM-generated letters/emails.
            result = await sendMail({
                to,
                subject: subject || '',
                html: body,
                cc,
                bcc,
                replyTo,
                from: getDefaultMailFrom(),
            });
            if (!result) {
                throw new Error('Failed to send email via SMTP');
            }
        } else {
            if (!accessToken) {
                res.status(400).json({
                    success: false,
                    message: 'Access token is required',
                });
                return;
            }

            result = await sendEmail({
                accessToken,
                to,
                subject: subject || '',
                body,
                cc,
                bcc,
                from,
                replyTo,
                threadId,
                inReplyTo,
                references,
            });
        }

        res.status(200).json({
            success: true,
            message: 'Email sent successfully',
            data: result,
        });
    } catch (error: any) {
        console.error('Send email error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to send email',
        });
    }
}

/**
 * GET /api/v1/gmail/me (authenticated)
 * Returns the Gmail mailbox address for the current user by calling Gmail's
 * `users/me/profile` with an access token minted from `User.googleRefreshToken`.
 * The CRM account switcher UI uses this so the connected mailbox appears after OAuth.
 */
export async function getGmailLinkedAccount(req: Request, res: Response): Promise<void> {
    try {
        const userId = req.user?.id;
        if (!userId) {
            res.status(401).json({ success: false, message: 'Unauthorized' });
            return;
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { email: true, googleRefreshToken: true },
        });

        if (!user) {
            res.status(404).json({ success: false, message: 'User not found' });
            return;
        }

        if (!user.googleRefreshToken) {
            res.status(200).json({
                success: true,
                connected: false,
                crmEmail: user.email,
                gmailEmail: null,
            });
            return;
        }

        oAuth2Client.setCredentials({
            refresh_token: user.googleRefreshToken,
        });
        const accessTokenResponse = await oAuth2Client.getAccessToken();
        const accessToken = accessTokenResponse?.token;

        if (!accessToken) {
            res.status(500).json({
                success: false,
                message: 'Could not obtain Gmail access token from refresh token',
            });
            return;
        }

        let gmailEmail = '';
        try {
            const profileResp = await axios.get<{ emailAddress?: string }>(
                'https://gmail.googleapis.com/gmail/v1/users/me/profile',
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                },
            );
            gmailEmail = String(profileResp.data?.emailAddress || '').trim();
        } catch (err: any) {
            console.error(
                'getGmailLinkedAccount: gmail profile failed:',
                err?.response?.data || err?.message,
            );
        }

        res.status(200).json({
            success: true,
            connected: true,
            crmEmail: user.email,
            gmailEmail: gmailEmail || null,
        });
    } catch (error: any) {
        console.error('getGmailLinkedAccount:', error);
        res.status(500).json({
            success: false,
            message: error?.message || 'Failed to resolve Gmail mailbox',
        });
    }
}