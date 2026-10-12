// @ts-nocheck
import { hasContractsLogAccess } from '../constants/roles';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import prisma from '../config/prismaClient';
import { buildAgentApplicationVisibilityWhere } from '../services/applicationService';
import { sendDocumentRequestEmail } from '../services/emailService';
import {
    findFulfilledDocumentForRequest,
    getDocumentRequestConfig,
    humanizeDocumentRequestLabels,
} from '../constants/documentRequestTypes';
import { loadDocumentRequestFulfillmentContext } from '../services/documentRequestFulfillmentService';
import { resolveCrmFrontendBaseUrl, buildPublicDocumentRequestPortalUrl } from '../utils/crmFrontendUrl';
import { createPublicPortalToken } from '../services/publicPortalTokenService';
import {
    deriveCategory,
    deriveActionUrl,
    NOTIFICATION_CATEGORIES,
} from '../services/notificationCategory';
import { notifyApplicationStageChange } from '../services/applicationStageNotificationService';
import { recordCommunicationAudit } from '../services/systemActivityLogService';
import { storeSgMessageIdOnOutbound } from '../services/outboundCommunicationService';

const NOTIFICATION_BUCKETS = ['inbox', 'todo', 'follow_up', 'snoozed', 'done'] as const;
const NOTIFICATION_IMPORTANCE = ['urgent', 'high', 'normal', 'low'] as const;

const mapApplicationToApi = (app: any) => {
    if (!app) return app;
    const {
        id,
        applicationId,
        priority,
        type,
        note,
        currentQueue,
        currentState,
        createdAt,
        updatedAt,
        referringAgent,
        salesRepresentative,
        createdBy,
        client,
        iso,
        files,
        ...rest
    } = app;

    const mapUserLite = (u: any) =>
        u
            ? { _id: u.id, id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }
            : undefined;

    const mappedClient =
        client &&
        ({
            ...client,
            _id: client.id,
            id: client.id,
            clientId: client.clientId,
            business: {
                name: client.businessName,
                email: client.businessEmail || '',
                number: client.businessNumber || '',
                website: client.businessWebsite || '',
                incorporationDate: client.businessIncorporationDate,
                incorporationState: client.businessIncorporationState || '',
                businessEntityType: client.businessEntityType || '',
                einNumber: client.businessEinNumber || '',
                annualRevenue: client.businessAnnualRevenue ?? undefined,
                monthlyRevenue: client.businessMonthlyRevenue ?? undefined,
                address: {
                    address1: client.businessAddress1 || '',
                    address2: client.businessAddress2 || '',
                    city: client.businessCity || '',
                    state: client.businessState || '',
                    zipCode: client.businessZipCode || '',
                },
            },
            owner: {
                firstName: client.ownerFirstName,
                middleName: client.ownerMiddleName || '',
                lastName: client.ownerLastName,
                email: client.ownerEmail || '',
                mobileNumber: client.ownerMobileNumber || '',
                dateOfBirth: client.ownerDateOfBirth,
                ssn: client.ownerSsn || '',
                ficoScore: client.ownerFicoScore ?? undefined,
                ownershipStartDate: client.ownerOwnershipStartDate,
                ownershipPercentage: client.ownerOwnershipPercentage ?? undefined,
                address: {
                    address1: client.ownerAddress1 || '',
                    address2: client.ownerAddress2 || '',
                    city: client.ownerCity || '',
                    state: client.ownerState || '',
                    zipCode: client.ownerZipCode || '',
                },
            },
        } as any);

    const mappedFiles =
        files?.map((f: any) => ({
            _id: f.id,
            id: f.id,
            url: f.url,
            publicId: f.publicId,
            originalName: f.originalName,
            mimeType: f.mimeType,
            size: f.size,
            uploadedAt: f.uploadedAt,
        })) || [];

    return {
        ...rest,
        _id: id,
        id,
        applicationId,
        priority,
        type,
        note,
        currentQueue,
        currentState,
        createdAt,
        updatedAt,
        referringAgent: mapUserLite(referringAgent),
        salesRepresentative: mapUserLite(salesRepresentative),
        createdBy: mapUserLite(createdBy),
        client: mappedClient,
        iso: iso ? { _id: iso.id, id: iso.id, name: iso.name, email: iso.email || '' } : undefined,
        files: mappedFiles,
    };
};

const APPLICATION_INCLUDE_FOR_DOCUMENT_REQUEST = {
    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
    iso: { select: { id: true, name: true, email: true } },
    client: true,
};

const NOTIFICATION_LIST_INCLUDE = {
    recipient: { select: { id: true, firstName: true, lastName: true, email: true } },
    application: {
        select: {
            id: true,
            applicationId: true,
            priority: true,
            type: true,
            currentQueue: true,
            currentState: true,
            loanAmount: true,
            dealId: true,
            dealDisplayName: true,
            client: { select: { businessName: true, ownerFirstName: true, ownerLastName: true } },
        },
    },
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
};

const mapNotificationToApi = (notification: any) => {
    if (!notification) return notification;
    const {
        id,
        title,
        message,
        type,
        recipient,
        recipientId,
        application,
        applicationId,
        documentRequestedDocuments,
        documentRequestAdditional,
        isRead,
        readAt,
        createdBy,
        createdById,
        createdAt,
        updatedAt,
        category,
        bucket,
        importance,
        snoozedUntil,
        isArchived,
        actionUrl,
        ...rest
    } = notification;

    const resolvedCategory =
        category && category !== 'system' ? category : deriveCategory(type, application);
    const resolvedActionUrl =
        actionUrl ||
        deriveActionUrl({
            category: resolvedCategory,
            type,
            applicationNumber: application?.applicationId,
            applicationUuid: applicationId ?? application?.id,
        });

    return {
        ...rest,
        _id: id,
        id,
        title,
        message,
        type,
        category: resolvedCategory,
        bucket: bucket ?? 'inbox',
        importance: importance ?? 'normal',
        snoozedUntil: snoozedUntil ?? null,
        isArchived: isArchived ?? false,
        actionUrl: resolvedActionUrl,
        recipient: recipient
            ? {
                  _id: recipient.id,
                  id: recipient.id,
                  firstName: recipient.firstName,
                  lastName: recipient.lastName,
                  email: recipient.email,
              }
            : recipientId,
        application: application
            ? {
                  _id: application.id,
                  id: application.id,
                  applicationId: application.applicationId,
                  priority: application.priority,
                  type: application.type,
                  currentQueue: application.currentQueue,
                  currentState: application.currentState,
                  loanAmount: application.loanAmount ?? null,
                  dealId: application.dealId ?? null,
                  dealDisplayName: application.dealDisplayName ?? null,
                  businessName: application.client?.businessName ?? null,
                  ownerName: application.client
                      ? `${application.client.ownerFirstName || ''} ${application.client.ownerLastName || ''}`.trim() ||
                        null
                      : null,
              }
            : applicationId,
        documentRequestDetails:
            documentRequestedDocuments || documentRequestAdditional !== undefined
                ? {
                      requestedDocuments: documentRequestedDocuments || [],
                      requestAdditional: !!documentRequestAdditional,
                  }
                : undefined,
        isRead,
        readAt,
        createdBy: createdBy
            ? {
                  _id: createdBy.id,
                  id: createdBy.id,
                  firstName: createdBy.firstName,
                  lastName: createdBy.lastName,
                  email: createdBy.email,
              }
            : createdById,
        createdAt,
        updatedAt,
    };
};

class NotificationController {
    async sendDocumentRequest(req: Request, res: Response) {
        try {
            const {
                applicationId,
                requestedDocuments,
                requestAdditional,
                reason,
                additionalComments,
                isoEmail,
                additionalToEmails,
                ccEmails,
                emailHtml,
                emailSubject,
            } = req.body;
            const currentUserRole = (req as any).user?.role;
            const isFinalUnderwriter = currentUserRole === 'UNDERWRITER';
            const isIsoEmailRequest = Object.prototype.hasOwnProperty.call(req.body, 'isoEmail');

            if (!applicationId) {
                return res.status(400).json({ success: false, message: 'Application ID is required' });
            }
            if (isFinalUnderwriter && (!reason || String(reason).trim() === '')) {
                return res.status(400).json({
                    success: false,
                    message: 'Reason is required when sending back for documentation',
                });
            }

            let documentsArray: string[] = [];
            if (requestedDocuments !== undefined && requestedDocuments !== null && Array.isArray(requestedDocuments)) {
                documentsArray = requestedDocuments.map((d) => String(d || '').trim()).filter(Boolean);
            }

            if (isIsoEmailRequest && documentsArray.length === 0 && !requestAdditional) {
                return res.status(400).json({
                    success: false,
                    message: 'Select at least one document type or Request Additional Documents',
                });
            }

            const reasonText = reason && String(reason).trim() ? String(reason).trim() : '';
            const additionalCommentsText =
                additionalComments && String(additionalComments).trim()
                    ? String(additionalComments).trim()
                    : '';
            const fullNote = additionalCommentsText
                ? `${reasonText}\n\nAdditional comments: ${additionalCommentsText}`
                : reasonText;

            const applicationStr = String(applicationId);
            const application = /^\d+$/.test(applicationStr)
                ? await prisma.application.findUnique({
                      where: { applicationId: Number(applicationStr) },
                      include: APPLICATION_INCLUDE_FOR_DOCUMENT_REQUEST,
                  })
                : await prisma.application.findUnique({
                      where: { id: applicationStr },
                      include: APPLICATION_INCLUDE_FOR_DOCUMENT_REQUEST,
                  });

            if (!application) {
                return res.status(404).json({ success: false, message: 'Application not found' });
            }

            const createdBy = (req as any).user?.id;
            if (!createdBy) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }

            const app = application as any;
            const client = app.client;
            const clientName =
                client?.businessName ||
                `${client?.ownerFirstName || ''} ${client?.ownerLastName || ''}`.trim() ||
                'Unknown Client';
            const applicationIdNumber = app.applicationId || 'N/A';

            const primaryIsoEmail = isIsoEmailRequest ? String(isoEmail || '').trim() : '';
            const extraToEmails = Array.isArray(additionalToEmails)
                ? additionalToEmails.map((e) => String(e || '').trim()).filter(Boolean)
                : [];
            const emailCcList = Array.isArray(ccEmails)
                ? ccEmails.map((e) => String(e || '').trim()).filter(Boolean)
                : [];
            const emailToList = [...(primaryIsoEmail ? [primaryIsoEmail] : []), ...extraToEmails];
            const uniqueEmailTo = [...new Set(emailToList.map((e) => e.toLowerCase()))].map(
                (lower) => emailToList.find((e) => e.toLowerCase() === lower) || lower,
            );

            if (isIsoEmailRequest && uniqueEmailTo.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'At least one recipient email (ISO To or Additional To) is required',
                });
            }

            const recipientIds = new Set<string>();
            const addIfNotSender = (id: string) => {
                const sid = String(id);
                if (sid && sid !== String(createdBy)) recipientIds.add(sid);
            };
            const agentRecipientId = app.referringAgent?.id || app.salesRepresentative?.id;
            if (agentRecipientId) addIfNotSender(agentRecipientId);
            if (app.referringAgentId) addIfNotSender(app.referringAgentId);
            if (app.salesRepresentativeId) addIfNotSender(app.salesRepresentativeId);
            if (isFinalUnderwriter) {
                const underwriters = await prisma.user.findMany({
                    where: { role: 'SCRUBBING' },
                    select: { id: true },
                });
                underwriters.forEach((u) => addIfNotSender(u.id));
            }

            if (recipientIds.size === 0 && uniqueEmailTo.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No recipient available for this notification',
                });
            }

            const notificationTitle =
                documentsArray.length > 0
                    ? 'Document Request Required'
                    : isFinalUnderwriter
                      ? 'Sent Back for Documentation (Underwriter)'
                      : 'Action Required';
            const notificationMessage =
                documentsArray.length > 0
                    ? `Document request for Application #${applicationIdNumber} - ${clientName}. Please provide the requested documents.`
                    : fullNote
                      ? `Action required for Application #${applicationIdNumber} - ${clientName}. ${fullNote}`
                      : `Action required for Application #${applicationIdNumber} - ${clientName}.`;

            const notificationData = {
                title: notificationTitle,
                message: notificationMessage,
                type: 'document_request',
                category: deriveCategory('document_request', application as any),
                applicationId: application.id,
                documentRequestedDocuments: documentsArray,
                documentRequestAdditional: requestAdditional || false,
                createdById: createdBy,
            };

            let firstNotification: { id: string } | null = null;
            if (recipientIds.size > 0) {
                for (const recId of recipientIds) {
                    const created = await prisma.notification.create({
                        data: { ...notificationData, recipientId: String(recId) },
                    });
                    if (!firstNotification) firstNotification = created;
                }
            } else if (documentsArray.length > 0 || requestAdditional) {
                firstNotification = await prisma.notification.create({
                    data: {
                        ...notificationData,
                        recipientId: String(createdBy),
                        isRead: true,
                        readAt: new Date(),
                        isArchived: true,
                    },
                });
            }

            const appUpdateData: { note?: string; currentQueue?: string; currentState?: string } = {};
            if (fullNote) appUpdateData.note = fullNote;
            if (isFinalUnderwriter) {
                appUpdateData.currentQueue = 'Scrubbing';
                appUpdateData.currentState = 'In Progress';
            }
            if (Object.keys(appUpdateData).length > 0) {
                await prisma.application.update({ where: { id: application.id }, data: appUpdateData });
            }

            if (isIsoEmailRequest && app.isoId && primaryIsoEmail) {
                try {
                    await prisma.iso.update({ where: { id: app.isoId }, data: { email: primaryIsoEmail } });
                } catch (isoUpdateErr) {
                    console.error('Failed to persist ISO email after document request:', isoUpdateErr);
                }
            }

            let emailSent = false;
            let emailError: string | undefined;
            const emailedTo: string[] = [];
            const emailedCc: string[] = [];

            if (isIsoEmailRequest && uniqueEmailTo.length > 0) {
                const crmBase = resolveCrmFrontendBaseUrl();
                let viewApplicationUrl: string | undefined;
                try {
                    const portalToken = await createPublicPortalToken(application.id, { expiresInDays: 90 });
                    if (portalToken && crmBase) {
                        viewApplicationUrl = buildPublicDocumentRequestPortalUrl(crmBase, portalToken);
                    }
                } catch (tokenErr) {
                    console.error('Document request: public portal token generation failed:', tokenErr);
                }

                const resolvedEmailHtml =
                    typeof emailHtml === 'string' && emailHtml.trim() ? emailHtml.trim() : undefined;
                const resolvedEmailSubject =
                    typeof emailSubject === 'string' && emailSubject.trim() ? emailSubject.trim() : undefined;
                const trackingId = randomUUID();
                const authUserForEmail = { id: createdBy, role: (req as any).user?.role };
                const roleLabelForEmail = authUserForEmail?.role
                    ? String(authUserForEmail.role).toUpperCase().replace(/_/g, ' ')
                    : 'User';
                const actorNameForEmail = (req as any).user?.name || '';

                try {
                    await recordCommunicationAudit(req, {
                        outboundCommunicationId: trackingId,
                        applicationId: application.id,
                        channel: 'EMAIL',
                        recipientType: 'ISO',
                        recipient: uniqueEmailTo.join(', '),
                        subject: resolvedEmailSubject,
                        body: resolvedEmailHtml,
                        templateName: 'Document request template',
                        actionType: 'DOCUMENT_REQUESTED',
                        user: authUserForEmail,
                        currentStatus: `${app.currentQueue} / ${app.currentState}`,
                        actionDescription:
                            `${roleLabelForEmail} ${actorNameForEmail}`.trim() +
                            ' sent the document request template to the ISO.',
                        metadata: {
                            requestedDocuments: documentsArray,
                            requestAdditional: requestAdditional || false,
                            reason: reasonText,
                            additionalComments: additionalCommentsText,
                            emailedTo: uniqueEmailTo,
                            emailedCc: emailCcList,
                            template: 'document-request',
                            status: 'sent',
                            delivery: { status: 'sent', sentAt: new Date().toISOString() },
                        },
                    });
                } catch (auditErr) {
                    console.error('Failed to create communication audit for document request email:', auditErr);
                }

                const emailResult = await sendDocumentRequestEmail({
                    to: uniqueEmailTo,
                    cc: emailCcList,
                    isoName: app.iso?.name || undefined,
                    clientName,
                    applicationNumber: applicationIdNumber,
                    requestedDocuments: humanizeDocumentRequestLabels(documentsArray),
                    requestAdditional: Boolean(requestAdditional),
                    note: reasonText || undefined,
                    viewApplicationUrl,
                    html: resolvedEmailHtml,
                    subject: resolvedEmailSubject,
                    trackingId,
                });
                emailSent = emailResult.sent;
                emailError = emailResult.error;
                if (emailSent) {
                    emailedTo.push(...uniqueEmailTo);
                    emailedCc.push(...emailCcList);
                    if (emailResult.sgMessageId) {
                        try {
                            await storeSgMessageIdOnOutbound(trackingId, emailResult.sgMessageId);
                        } catch (metaErr) {
                            console.error('Failed to store SendGrid message id for document request email:', metaErr);
                        }
                    }
                }
            }

            const updatedApplicationRecord = await prisma.application.findUnique({
                where: { id: application.id },
                include: {
                    ...APPLICATION_INCLUDE_FOR_DOCUMENT_REQUEST,
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    files: { select: { id: true, url: true, originalName: true, mimeType: true, size: true, uploadedAt: true } },
                },
            });

            const populatedNotificationRecord = firstNotification
                ? await prisma.notification.findUnique({
                      where: { id: firstNotification.id },
                      include: NOTIFICATION_LIST_INCLUDE,
                  })
                : null;

            let message = 'Document request notification sent successfully';
            if (emailSent && recipientIds.size > 0) {
                message = 'Document request emailed to ISO and in-app notification sent successfully';
            } else if (emailSent) {
                message = 'Document request sent to ISO by email';
            }

            if (isIsoEmailRequest && uniqueEmailTo.length > 0 && !emailSent) {
                return res.status(502).json({
                    success: false,
                    message: `Document request saved but ISO email was not sent: ${emailError || 'Unknown error'}`,
                    data: populatedNotificationRecord ? mapNotificationToApi(populatedNotificationRecord) : null,
                    application: updatedApplicationRecord ? mapApplicationToApi(updatedApplicationRecord) : null,
                    emailSent: false,
                    emailError: emailError || 'Unknown error',
                    emailedTo,
                    emailedCc,
                });
            }

            return res.status(201).json({
                success: true,
                message,
                data: populatedNotificationRecord ? mapNotificationToApi(populatedNotificationRecord) : null,
                application: updatedApplicationRecord ? mapApplicationToApi(updatedApplicationRecord) : null,
                emailSent,
                emailError: emailError || undefined,
                emailedTo,
                emailedCc,
            });
        } catch (error: any) {
            console.error('Send document request notification error:', error?.message || error, error?.stack);
            return res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
        }
    }

    async notifyApplicationSentToFinalUnderwriter(req: Request, res: Response) {
        try {
            const { applicationId, underwriterName } = req.body;
            const createdBy = (req as any).user?.id;
            if (!createdBy) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }
            if (!applicationId) {
                return res.status(400).json({ success: false, message: 'Application ID is required' });
            }

            const applicationStr = String(applicationId);
            const application = /^\d+$/.test(applicationStr)
                ? await prisma.application.findUnique({
                      where: { applicationId: Number(applicationStr) },
                      include: { client: true },
                  })
                : await prisma.application.findUnique({
                      where: { id: applicationStr },
                      include: { client: true },
                  });

            if (!application) {
                return res.status(404).json({ success: false, message: 'Application not found' });
            }

            const senderName =
                (underwriterName && String(underwriterName).trim()) ||
                String((req as any).user?.name || '').trim() ||
                'Scrubbing';

            const finalUnderwriters = await prisma.user.findMany({
                where: { role: 'UNDERWRITER', isActive: true },
                select: { id: true },
            });
            const senderId = String(createdBy);
            const recipients = finalUnderwriters.map((u) => String(u.id)).filter((id) => id && id !== senderId);

            if (recipients.length === 0) {
                return res.status(201).json({
                    success: true,
                    message: 'No Underwriter recipients to notify',
                    data: { notified: 0 },
                });
            }

            await notifyApplicationStageChange({
                application: application as any,
                actorId: senderId,
                actorName: senderName,
                actorRole: 'SCRUBBING',
                transitionAction: 'SEND_TO_FINAL_UNDERWRITER',
            });

            return res.status(201).json({
                success: true,
                message: 'Underwriter notified successfully',
                data: { notified: recipients.length },
            });
        } catch (error: any) {
            console.error('Notify Underwriter error:', error?.message || error, error?.stack);
            return res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
        }
    }

    async getNotifications(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }

            const { isRead, limit, page, bucket, category, importance, archived, includeSnoozed } = req.query;
            let limitNum = 50;
            if (limit !== undefined) {
                const parsedLimit = Number(limit);
                if (!isNaN(parsedLimit) && parsedLimit > 0) limitNum = Math.min(parsedLimit, 200);
            }
            let pageNum = 1;
            if (page !== undefined) {
                const parsedPage = Number(page);
                if (!isNaN(parsedPage) && parsedPage > 0) pageNum = parsedPage;
            }
            const skip = (pageNum - 1) * limitNum;

            const role = String((req as any).user?.role || '').toUpperCase();
            const isSuperAdmin = hasContractsLogAccess(role);
            const personalOnlyRaw = req.query.personalOnly;
            const wantsPersonalOnly =
                personalOnlyRaw !== undefined &&
                (String(personalOnlyRaw).toLowerCase() === 'true' || String(personalOnlyRaw) === '1');

            const where: any = isSuperAdmin && !wantsPersonalOnly ? {} : { recipientId: String(userId) };
            if (isRead !== undefined) {
                const isReadStr = String(isRead).toLowerCase();
                where.isRead = isReadStr === 'true' || isReadStr === '1';
            }

            const andClauses: any[] = [];
            const bucketStr = bucket !== undefined ? String(bucket).trim().toLowerCase() : '';
            if (bucketStr) where.bucket = bucketStr;
            if (category !== undefined && String(category).trim()) {
                where.category = String(category).trim().toLowerCase();
            }
            if (importance !== undefined && String(importance).trim()) {
                where.importance = String(importance).trim().toLowerCase();
            }

            const wantsArchived =
                archived !== undefined &&
                (String(archived).toLowerCase() === 'true' || String(archived) === '1');
            where.isArchived = wantsArchived;

            const wantsIncludeSnoozed =
                includeSnoozed !== undefined &&
                (String(includeSnoozed).toLowerCase() === 'true' || String(includeSnoozed) === '1');
            if (!wantsIncludeSnoozed && bucketStr !== 'snoozed') {
                andClauses.push({
                    OR: [
                        { bucket: { not: 'snoozed' } },
                        { snoozedUntil: null },
                        { snoozedUntil: { lte: new Date() } },
                    ],
                });
            }
            if (andClauses.length > 0) {
                where.AND = Array.isArray(where.AND)
                    ? [...where.AND, ...andClauses]
                    : where.AND
                      ? [where.AND, ...andClauses]
                      : andClauses;
            }

            const roleNorm = String((req as any).user?.role || '')
                .trim()
                .toUpperCase()
                .replace(/-/g, '_');
            if (roleNorm === 'AGENT' && userId) {
                const agentAppScope = buildAgentApplicationVisibilityWhere(String(userId));
                const existingAnd = where.AND ? (Array.isArray(where.AND) ? where.AND : [where.AND]) : [];
                where.AND = [...existingAnd, { OR: [{ applicationId: null }, { application: agentAppScope }] }];
            }

            const [notificationsRecords, total] = await Promise.all([
                prisma.notification.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limitNum,
                    include: NOTIFICATION_LIST_INCLUDE,
                }),
                prisma.notification.count({ where }),
            ]);

            return res.status(200).json({
                success: true,
                data: notificationsRecords.map((notif: any) => mapNotificationToApi(notif)),
                pagination: {
                    currentPage: pageNum,
                    totalItems: total,
                    itemsPerPage: limitNum,
                    totalPages: Math.max(1, Math.ceil(total / limitNum)),
                },
            });
        } catch (error: any) {
            console.error('Get notifications error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }

    async markAsRead(req: Request, res: Response) {
        try {
            const { id: notificationId } = req.params;
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }

            const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
            if (!notification) {
                return res.status(404).json({ success: false, message: 'Notification not found' });
            }

            const role = String((req as any).user?.role || '').toUpperCase();
            const isSuperAdmin = hasContractsLogAccess(role);
            if (notification.recipientId !== userId && !isSuperAdmin) {
                return res.status(403).json({ success: false, message: 'Unauthorized to mark this notification as read' });
            }

            const updated = await prisma.notification.update({
                where: { id: notificationId },
                data: { isRead: true, readAt: new Date() },
            });

            return res.status(200).json({
                success: true,
                message: 'Notification marked as read',
                data: {
                    _id: updated.id,
                    id: updated.id,
                    title: updated.title,
                    message: updated.message,
                    type: updated.type,
                    isRead: updated.isRead,
                    readAt: updated.readAt,
                    createdAt: updated.createdAt,
                    updatedAt: updated.updatedAt,
                },
            });
        } catch (error: any) {
            console.error('Mark notification as read error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }

    async markAllAsRead(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }

            const role = String((req as any).user?.role || '').toUpperCase();
            const isSuperAdmin = hasContractsLogAccess(role);
            const allRecipientsRaw = req.query.allRecipients;
            const wantsAllRecipients =
                allRecipientsRaw !== undefined &&
                (String(allRecipientsRaw).toLowerCase() === 'true' || String(allRecipientsRaw) === '1');

            if (wantsAllRecipients) {
                if (!isSuperAdmin) {
                    return res.status(403).json({
                        success: false,
                        message: 'Only Super Admin can mark all notifications as read for every recipient',
                    });
                }
                const result = await prisma.notification.updateMany({
                    where: { isRead: false },
                    data: { isRead: true, readAt: new Date() },
                });
                return res.status(200).json({
                    success: true,
                    message: 'All notifications marked as read',
                    updatedCount: result.count,
                });
            }

            await prisma.notification.updateMany({
                where: { recipientId: userId, isRead: false },
                data: { isRead: true, readAt: new Date() },
            });
            return res.status(200).json({ success: true, message: 'All notifications marked as read' });
        } catch (error: any) {
            console.error('Mark all notifications as read error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }

    async deleteNotification(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }

            const notification = await prisma.notification.findUnique({ where: { id } });
            if (!notification) {
                return res.status(404).json({ success: false, message: 'Notification not found' });
            }
            if (String(notification.recipientId) !== String(userId)) {
                return res.status(403).json({ success: false, message: 'Unauthorized to delete this notification' });
            }

            await prisma.notification.delete({ where: { id } });
            return res.status(200).json({ success: true, message: 'Notification deleted successfully' });
        } catch (error: any) {
            console.error('Delete notification error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }

    async getSummary(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }

            const base: any = { recipientId: String(userId), isArchived: false };
            const now = new Date();
            const dueOrNotSnoozed = {
                OR: [{ bucket: { not: 'snoozed' } }, { snoozedUntil: null }, { snoozedUntil: { lte: now } }],
            };

            const [total, unread, urgent, bucketGroups, categoryGroups] = await Promise.all([
                prisma.notification.count({ where: base }),
                prisma.notification.count({ where: { ...base, isRead: false, AND: [dueOrNotSnoozed] } }),
                prisma.notification.count({ where: { ...base, importance: 'urgent', AND: [dueOrNotSnoozed] } }),
                prisma.notification.groupBy({ by: ['bucket'], where: base, _count: { _all: true } }),
                prisma.notification.groupBy({ by: ['category'], where: base, _count: { _all: true } }),
            ]);

            const toMap = (groups: any[], key: string) =>
                groups.reduce((acc: Record<string, number>, g: any) => {
                    acc[String(g[key] ?? 'system')] = g._count?._all ?? 0;
                    return acc;
                }, {});

            return res.status(200).json({
                success: true,
                data: {
                    total,
                    unread,
                    urgent,
                    byBucket: toMap(bucketGroups, 'bucket'),
                    byCategory: toMap(categoryGroups, 'category'),
                },
            });
        } catch (error: any) {
            console.error('Get notification summary error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }

    private buildTriagePatch(body: any): { patch: Record<string, unknown>; error?: string } {
        const patch: Record<string, unknown> = {};
        if (body.bucket !== undefined) {
            const b = String(body.bucket).trim().toLowerCase();
            if (!NOTIFICATION_BUCKETS.includes(b as any)) {
                return { patch, error: `Invalid bucket. Allowed: ${NOTIFICATION_BUCKETS.join(', ')}` };
            }
            patch.bucket = b;
            if (b !== 'snoozed') patch.snoozedUntil = null;
        }
        if (body.importance !== undefined) {
            const imp = String(body.importance).trim().toLowerCase();
            if (!NOTIFICATION_IMPORTANCE.includes(imp as any)) {
                return { patch, error: `Invalid importance. Allowed: ${NOTIFICATION_IMPORTANCE.join(', ')}` };
            }
            patch.importance = imp;
        }
        if (body.category !== undefined && String(body.category).trim()) {
            const cat = String(body.category).trim().toLowerCase();
            if (!NOTIFICATION_CATEGORIES.includes(cat as any)) {
                return { patch, error: `Invalid category. Allowed: ${NOTIFICATION_CATEGORIES.join(', ')}` };
            }
            patch.category = cat;
        }
        if (body.snoozedUntil !== undefined) {
            if (body.snoozedUntil === null || String(body.snoozedUntil).trim() === '') {
                patch.snoozedUntil = null;
            } else {
                const d = new Date(body.snoozedUntil);
                if (Number.isNaN(d.getTime())) return { patch, error: 'Invalid snoozedUntil date' };
                patch.snoozedUntil = d;
                patch.bucket = 'snoozed';
            }
        }
        if (body.isArchived !== undefined) patch.isArchived = Boolean(body.isArchived);
        if (body.isRead !== undefined) {
            patch.isRead = Boolean(body.isRead);
            patch.readAt = body.isRead ? new Date() : null;
        }
        return { patch };
    }

    async updateNotificationState(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }
            const role = String((req as any).user?.role || '').toUpperCase();
            const isSuperAdmin = hasContractsLogAccess(role);
            const notification = await prisma.notification.findUnique({ where: { id } });
            if (!notification) {
                return res.status(404).json({ success: false, message: 'Notification not found' });
            }
            if (String(notification.recipientId) !== String(userId) && !isSuperAdmin) {
                return res.status(403).json({ success: false, message: 'Unauthorized to update this notification' });
            }
            const { patch, error } = this.buildTriagePatch(req.body ?? {});
            if (error) return res.status(400).json({ success: false, message: error });
            if (Object.keys(patch).length === 0) {
                return res.status(400).json({ success: false, message: 'No valid fields to update' });
            }
            const updatedRecord = await prisma.notification.update({
                where: { id },
                data: patch,
                include: NOTIFICATION_LIST_INCLUDE,
            });
            return res.status(200).json({
                success: true,
                message: 'Notification updated',
                data: mapNotificationToApi(updatedRecord),
            });
        } catch (error: any) {
            console.error('Update notification state error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }

    async bulkUpdate(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User authentication required' });
            }
            const role = String((req as any).user?.role || '').toUpperCase();
            const isSuperAdmin = hasContractsLogAccess(role);
            const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: any) => String(x)).filter(Boolean) : [];
            if (ids.length === 0) {
                return res.status(400).json({ success: false, message: 'ids array is required' });
            }
            const { patch, error } = this.buildTriagePatch(req.body?.patch ?? {});
            if (error) return res.status(400).json({ success: false, message: error });
            if (Object.keys(patch).length === 0) {
                return res.status(400).json({ success: false, message: 'No valid fields to update' });
            }
            const where: any = isSuperAdmin ? { id: { in: ids } } : { id: { in: ids }, recipientId: String(userId) };
            const result = await prisma.notification.updateMany({ where, data: patch });
            return res.status(200).json({
                success: true,
                message: `${result.count} notification(s) updated`,
                updatedCount: result.count,
            });
        } catch (error: any) {
            console.error('Bulk update notifications error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }

    async getDocumentRequestsByApplication(req: Request, res: Response) {
        try {
            const { applicationId } = req.params;
            if (!applicationId) {
                return res.status(400).json({ success: false, message: 'Application ID is required' });
            }

            const applicationStr = String(applicationId);
            const application = /^\d+$/.test(applicationStr)
                ? await prisma.application.findUnique({
                      where: { applicationId: Number(applicationStr) },
                      include: { files: { select: { id: true, url: true, originalName: true, mimeType: true } } },
                  })
                : await prisma.application.findUnique({
                      where: { id: applicationStr },
                      include: { files: { select: { id: true, url: true, originalName: true, mimeType: true } } },
                  });
            if (!application) {
                return res.status(404).json({ success: false, message: 'Application not found' });
            }

            const fulfillmentContext = await loadDocumentRequestFulfillmentContext(application.id);
            const applicationFiles = fulfillmentContext?.applicationFiles ?? application.files ?? [];
            const contractFiles = fulfillmentContext?.contractFiles ?? [];

            const notificationsRecords = await prisma.notification.findMany({
                where: { applicationId: application.id, type: 'document_request' },
                orderBy: { createdAt: 'desc' },
                include: { createdBy: { select: { id: true, firstName: true, lastName: true, email: true } } },
            });

            const documentMap = new Map<
                string,
                {
                    status: 'Complete' | 'Pending';
                    createdAt: Date;
                    requestedBy?: any;
                    message?: string;
                    label?: string;
                    fileUrl?: string;
                    fileId?: string;
                    contractUploadKey?: string;
                }
            >();
            const generalRequests: {
                name: string;
                status: 'Pending';
                createdAt: Date;
                requestedBy?: any;
                message?: string;
            }[] = [];

            notificationsRecords.forEach((notification: any) => {
                const requestedDocs = notification.documentRequestedDocuments || [];
                requestedDocs.forEach((docSlug: string) => {
                    const config = getDocumentRequestConfig(docSlug);
                    const fulfilled = findFulfilledDocumentForRequest(docSlug, { applicationFiles, contractFiles });
                    const isUploaded = fulfilled != null;
                    if (
                        !documentMap.has(docSlug) ||
                        (documentMap.get(docSlug)?.createdAt &&
                            notification.createdAt > documentMap.get(docSlug)!.createdAt)
                    ) {
                        documentMap.set(docSlug, {
                            status: isUploaded ? 'Complete' : 'Pending',
                            createdAt: notification.createdAt,
                            requestedBy: notification.createdBy,
                            label: config?.label,
                            fileUrl: fulfilled?.url,
                            fileId: fulfilled?.fileId,
                            contractUploadKey: config?.contractUploadKey,
                        });
                    }
                });
                if (requestedDocs.length === 0 && notification.message) {
                    generalRequests.push({
                        name: 'Sent Back for Documentation',
                        status: 'Pending',
                        createdAt: notification.createdAt,
                        requestedBy: notification.createdBy,
                        message: notification.message,
                    });
                }
            });

            const documents = Array.from(documentMap.entries()).map(([name, data]) => ({
                name,
                label: data.label,
                status: data.status,
                createdAt: data.createdAt,
                requestedBy: data.requestedBy,
                message: data.message,
                fileUrl: data.fileUrl,
                fileId: data.fileId,
                contractUploadKey: data.contractUploadKey,
            }));
            generalRequests
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .forEach((row) => {
                    documents.push({
                        name: row.name,
                        status: row.status,
                        createdAt: row.createdAt,
                        requestedBy: row.requestedBy,
                        message: row.message,
                    });
                });

            return res.status(200).json({ success: true, data: documents });
        } catch (error: any) {
            console.error('Get document requests by application error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
        }
    }
}

const notificationController = new NotificationController();
export default notificationController;
