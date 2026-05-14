// @ts-nocheck
import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';

// Helper to map Prisma Application (with includes) to the API shape previously returned by Mongoose
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
        files,
        ...rest
    } = app;

    const mapUserLite = (u: any) =>
        u
            ? {
                  _id: u.id,
                  id: u.id,
                  firstName: u.firstName,
                  lastName: u.lastName,
                  email: u.email,
              }
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
        files: mappedFiles,
    };
};

// Map Prisma Notification to previous API shape (including nested documentRequestDetails)
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
        ...rest
    } = notification;

    return {
        ...rest,
        _id: id,
        id,
        title,
        message,
        type,
        recipient: recipient
            ? {
                  _id: recipient.id,
                  id: recipient.id,
                  firstName: recipient.firstName,
                  lastName: recipient.lastName,
                  email: recipient.email,
              }
            : recipientId, // in queries where recipient not included, keep id
        application: application
            ? {
                  _id: application.id,
                  id: application.id,
                  applicationId: application.applicationId,
                  priority: application.priority,
                  type: application.type,
                  currentQueue: application.currentQueue,
                  currentState: application.currentState,
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
    // Send document request notification
    async sendDocumentRequest(req: Request, res: Response) {
        try {
            const { applicationId, requestedDocuments, requestAdditional, reason, additionalComments } = req.body;
            const currentUserRole = (req as any).user?.role;
            const isFinalUnderwriter = currentUserRole === 'FINAL_UNDERWRITER';

            // Validate required fields - reason mandatory for Final Underwriter
            if (!applicationId) {
                return res.status(400).json({
                    success: false,
                    message: 'Application ID is required',
                });
            }
            if (isFinalUnderwriter && (!reason || (reason && reason.trim() === ''))) {
                return res.status(400).json({
                    success: false,
                    message: 'Reason is required when sending back for documentation',
                });
            }

            // Ensure requestedDocuments is an array (allow empty array)
            // Handle cases where requestedDocuments might be undefined, null, or not an array
            let documentsArray: string[] = [];
            if (requestedDocuments !== undefined && requestedDocuments !== null) {
                if (Array.isArray(requestedDocuments)) {
                    documentsArray = requestedDocuments;
                }
            }

            // Reason is optional for Underwriter, mandatory for Final Underwriter
            const reasonText = reason && reason.trim() ? reason.trim() : '';
            const additionalCommentsText = additionalComments && additionalComments.trim() ? additionalComments.trim() : '';
            const fullNote = additionalCommentsText ? `${reasonText}\n\nAdditional comments: ${additionalCommentsText}` : reasonText;

            // Resolve application by numeric applicationId or UUID id
            const applicationStr = String(applicationId);
            let application = null;

            if (/^\d+$/.test(applicationStr)) {
                application = await prisma.application.findUnique({
                    where: { applicationId: Number(applicationStr) },
                    include: {
                        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                        client: true,
                    },
                });
            } else {
                application = await prisma.application.findUnique({
                    where: { id: applicationStr },
                    include: {
                        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                        client: true,
                    },
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            // Get current user (the one sending the request) first
            const createdBy = (req as any).user?.id;
            if (!createdBy) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required',
                });
            }

            // Determine recipient (agent) - prefer referringAgent, fallback to salesRepresentative
            // If no agent is assigned, use the createdBy user as recipient (for general messages)
            const recipientId =
                (application as any).referringAgent?.id ||
                (application as any).salesRepresentative?.id ||
                createdBy; // Fallback to the user creating the request
            
            if (!recipientId) {
                return res.status(400).json({
                    success: false,
                    message: 'No recipient available for this notification',
                });
            }

            // Get application and client details for the message
            const clientName = (application as any).client?.business?.name || 
                             `${(application as any).client?.owner?.firstName || ''} ${(application as any).client?.owner?.lastName || ''}`.trim() ||
                             'Unknown Client';
            const applicationIdNumber = (application as any).applicationId || 'N/A';

            // Build notification content
            const notificationTitle = documentsArray.length > 0
                ? 'Document Request Required'
                : isFinalUnderwriter
                    ? 'Sent Back for Documentation (Final Underwriter)'
                    : 'Action Required';
            const notificationMessage = documentsArray.length > 0
                ? `Document request for Application #${applicationIdNumber} - ${clientName}. Please provide the requested documents.`
                : fullNote
                    ? `Action required for Application #${applicationIdNumber} - ${clientName}. ${fullNote}`
                    : `Action required for Application #${applicationIdNumber} - ${clientName}.`;

            // Collect all recipients: Agent(s) + Underwriters (when Final Underwriter)
            // Exclude the sender (createdBy) - don't notify yourself
            const recipientIds = new Set<string>();
            const app = application as any;
            const addIfNotSender = (id: string) => {
                const sid = String(id);
                if (sid && sid !== String(createdBy)) recipientIds.add(sid);
            };
            addIfNotSender(recipientId);
            if (app.referringAgentId) addIfNotSender(app.referringAgentId);
            if (app.salesRepresentativeId) addIfNotSender(app.salesRepresentativeId);
            if (isFinalUnderwriter) {
                const underwriters = await prisma.user.findMany({
                    where: { role: 'UNDERWRITER' },
                    select: { id: true },
                });
                underwriters.forEach((u) => addIfNotSender(u.id));
            }

            if (recipientIds.size === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No recipient available for this notification',
                });
            }

            // Create one notification per recipient (so Agent and Underwriters all get notified)
            const notificationData = {
                title: notificationTitle,
                message: notificationMessage,
                type: 'document_request',
                applicationId: application.id,
                documentRequestedDocuments: (documentsArray || []).map((d) => String(d || '').trim()).filter(Boolean),
                documentRequestAdditional: requestAdditional || false,
                createdById: createdBy,
            };
            let firstNotification: { id: string } | null = null;
            for (const recId of recipientIds) {
                const created = await prisma.notification.create({
                    data: { ...notificationData, recipientId: String(recId) },
                });
                if (!firstNotification) firstNotification = created;
            }

            // Update application: note, and queue/state for Final Underwriter
            const appUpdateData: { note?: string; currentQueue?: string; currentState?: string } = {};
            if (fullNote) appUpdateData.note = fullNote;
            if (isFinalUnderwriter) {
                appUpdateData.currentQueue = 'Underwriting';
                appUpdateData.currentState = 'In Progress';
            }
            let applicationToUpdate;
            if (Object.keys(appUpdateData).length > 0) {
                applicationToUpdate = await prisma.application.update({
                    where: { id: application.id },
                    data: appUpdateData,
                });
            } else {
                applicationToUpdate = await prisma.application.findUnique({
                    where: { id: application.id },
                });
            }
            
            // Log application update (only if applicationToUpdate exists)
            if (applicationToUpdate) {
                console.log('Application note updated and saved successfully:', {
                    applicationId: applicationToUpdate.applicationId,
                    note: applicationToUpdate.note,
                    noteLength: applicationToUpdate.note?.length,
                    noteValue: applicationToUpdate.note
                });
            }

            // Best-effort application activity log for document request
            try {
                const authUserForLog = {
                    id: createdBy,
                    role: (req as any).user?.role,
                } as any;
                const roleLabel = authUserForLog?.role
                    ? String(authUserForLog.role).toUpperCase().replace(/_/g, ' ')
                    : 'User';
                const actorName = (req as any).user?.name || '';

                await prisma.applicationActivityLog.create({
                    data: {
                        applicationId: application.id,
                        userId: createdBy,
                        userRole: authUserForLog.role as any,
                        actionType: 'DOCUMENT_REQUESTED',
                        actionDescription:
                            `${roleLabel} ${actorName}`.trim() + ' requested additional documents from the client.',
                        previousStatus: `${(application as any).currentQueue} / ${(application as any).currentState}`,
                        currentStatus: `${(applicationToUpdate as any)?.currentQueue ?? (application as any).currentQueue} / ${
                            (applicationToUpdate as any)?.currentState ?? (application as any).currentState
                        }`,
                        metadata: {
                            requestedDocuments: documentsArray,
                            requestAdditional: requestAdditional || false,
                            reason: reasonText,
                            additionalComments: additionalCommentsText,
                        } as any,
                    },
                });
            } catch (logError) {
                console.error('Failed to create application activity log for document request:', logError);
            }

            // Fetch the updated application with all relations for the response
            const updatedApplicationRecord = await prisma.application.findUnique({
                where: { id: application.id },
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    files: true,
                },
            });

            // Populate the notification before sending (use first created for API response)
            const notification = firstNotification;
            const populatedNotificationRecord = notification
                ? await prisma.notification.findUnique({
                      where: { id: notification.id },
                      include: {
                          recipient: { select: { id: true, firstName: true, lastName: true, email: true } },
                          application: {
                              select: { id: true, applicationId: true, priority: true, type: true, currentQueue: true, currentState: true },
                          },
                          createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                      },
                  })
                : null;

            const populatedNotification = populatedNotificationRecord ? mapNotificationToApi(populatedNotificationRecord) : null;

            // Map the updated application to API format
            const mappedApplication = updatedApplicationRecord ? mapApplicationToApi(updatedApplicationRecord) : null;

            return res.status(201).json({
                success: true,
                message: 'Document request notification sent successfully',
                data: populatedNotification,
                application: mappedApplication,
            });
        } catch (error: any) {
            console.error('Send document request notification error:', error?.message || error, error?.stack);
            const errMessage = error?.message || 'Internal server error';
            return res.status(500).json({
                success: false,
                message: errMessage,
            });
        }
    }

    /** In-app notifications for all active Final Underwriter users when an application enters their queue. */
    async notifyApplicationSentToFinalUnderwriter(req: Request, res: Response) {
        try {
            const { applicationId, underwriterName } = req.body;
            const createdBy = (req as any).user?.id;
            if (!createdBy) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required',
                });
            }
            if (!applicationId) {
                return res.status(400).json({
                    success: false,
                    message: 'Application ID is required',
                });
            }

            const applicationStr = String(applicationId);
            let application = null;

            if (/^\d+$/.test(applicationStr)) {
                application = await prisma.application.findUnique({
                    where: { applicationId: Number(applicationStr) },
                    include: { client: true },
                });
            } else {
                application = await prisma.application.findUnique({
                    where: { id: applicationStr },
                    include: { client: true },
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const senderName =
                (underwriterName && String(underwriterName).trim()) ||
                String((req as any).user?.name || '').trim() ||
                'Underwriter';

            const clientName =
                (application as any).client?.businessName ||
                `${(application as any).client?.ownerFirstName || ''} ${(application as any).client?.ownerLastName || ''}`.trim() ||
                'Client';
            const appIdNumber = (application as any).applicationId ?? '';

            const title = `${senderName} forwarded an application for final review`;
            const message = `Application${appIdNumber ? ` #${appIdNumber}` : ''} for ${clientName} is ready for Final Underwriter review.`;

            const finalUnderwriters = await prisma.user.findMany({
                where: { role: 'FINAL_UNDERWRITER', isActive: true },
                select: { id: true },
            });

            const senderId = String(createdBy);
            const recipients = finalUnderwriters
                .map((u) => String(u.id))
                .filter((id) => id && id !== senderId);

            if (recipients.length === 0) {
                return res.status(201).json({
                    success: true,
                    message: 'No Final Underwriter recipients to notify',
                    data: { notified: 0 },
                });
            }

            await prisma.notification.createMany({
                data: recipients.map((recipientId) => ({
                    title,
                    message,
                    type: 'application_update',
                    recipientId,
                    applicationId: application.id,
                    createdById: senderId,
                })),
            });

            return res.status(201).json({
                success: true,
                message: 'Final Underwriter notified successfully',
                data: { notified: recipients.length },
            });
        } catch (error: any) {
            console.error('Notify Final Underwriter error:', error?.message || error, error?.stack);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

    // Get notifications for a user
    async getNotifications(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required',
                });
            }

            const { isRead, limit, page } = req.query;

            // Parse and validate limit
            let limitNum = 50; // default
            if (limit !== undefined) {
                const parsedLimit = Number(limit);
                if (!isNaN(parsedLimit) && parsedLimit > 0) {
                    limitNum = Math.min(parsedLimit, 1000); // Cap at 1000 for performance
                }
            }

            // Parse and validate page
            let pageNum = 1;
            if (page !== undefined) {
                const parsedPage = Number(page);
                if (!isNaN(parsedPage) && parsedPage > 0) {
                    pageNum = parsedPage;
                }
            }

            const skip = (pageNum - 1) * limitNum;

            const role = String((req as any).user?.role || '').toUpperCase();
            const isSuperAdmin = role === 'SUPER_ADMIN' || role === 'SUPERADMIN';

            const personalOnlyRaw = req.query.personalOnly;
            const wantsPersonalOnly =
                personalOnlyRaw !== undefined &&
                (String(personalOnlyRaw).toLowerCase() === 'true' || String(personalOnlyRaw) === '1');

            // Super Admin without personalOnly: all notifications (agent / UW / FUW / etc.).
            // Super Admin with personalOnly=1: same inbox scoping as other roles (e.g. header bell).
            const where: any =
                isSuperAdmin && !wantsPersonalOnly ? {} : { recipientId: String(userId) };
            if (isRead !== undefined) {
                const isReadStr = String(isRead).toLowerCase();
                where.isRead = isReadStr === 'true' || isReadStr === '1';
            }

            const includeRelations = {
                recipient: { select: { id: true, firstName: true, lastName: true, email: true } },
                application: {
                    select: {
                        id: true,
                        applicationId: true,
                        priority: true,
                        type: true,
                        currentQueue: true,
                        currentState: true,
                    },
                },
                createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
            };

            const [notificationsRecords, total] = await Promise.all([
                prisma.notification.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limitNum,
                    include: includeRelations,
                }),
                prisma.notification.count({ where }),
            ]);

            const notifications = notificationsRecords.map((notif: any) => mapNotificationToApi(notif));

            return res.status(200).json({
                success: true,
                data: notifications,
                pagination: {
                    currentPage: pageNum,
                    totalItems: total,
                    itemsPerPage: limitNum,
                    totalPages: Math.max(1, Math.ceil(total / limitNum)),
                },
            });
        } catch (error: any) {
            console.error('Get notifications error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Internal server error',
            });
        }
    }

    // Mark a single notification as read by its unique id. Only the matching record is updated.
    async markAsRead(req: Request, res: Response) {
        try {
            const { id: notificationId } = req.params;
            const userId = (req as any).user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required',
                });
            }

            const notification = await prisma.notification.findUnique({ where: { id: notificationId } });
            if (!notification) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification not found',
                });
            }

            const role = String((req as any).user?.role || '').toUpperCase();
            const isSuperAdmin = role === 'SUPER_ADMIN' || role === 'SUPERADMIN';

            if (notification.recipientId !== userId && !isSuperAdmin) {
                return res.status(403).json({
                    success: false,
                    message: 'Unauthorized to mark this notification as read',
                });
            }

            const updated = await prisma.notification.update({
                where: { id: notificationId },
                data: { isRead: true, readAt: new Date() },
            });

            const populatedNotification = {
                _id: updated.id,
                id: updated.id,
                title: updated.title,
                message: updated.message,
                type: updated.type,
                recipient: updated.recipientId,
                application: updated.applicationId || null,
                documentRequestDetails:
                    updated.documentRequestedDocuments || updated.documentRequestAdditional !== undefined
                        ? {
                              requestedDocuments: updated.documentRequestedDocuments || [],
                              requestAdditional: !!updated.documentRequestAdditional,
                          }
                        : undefined,
                isRead: updated.isRead,
                readAt: updated.readAt,
                createdBy: updated.createdById || null,
                createdAt: updated.createdAt,
                updatedAt: updated.updatedAt,
            };

            return res.status(200).json({
                success: true,
                message: 'Notification marked as read',
                data: populatedNotification,
            });
        } catch (error: any) {
            console.error('Mark notification as read error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Internal server error',
            });
        }
    }

    // Mark all notifications as read for a user (inbox). Super Admin may pass ?allRecipients=true to mark every notification in the system (ops / global feed).
    async markAllAsRead(req: Request, res: Response) {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required',
                });
            }

            const role = String((req as any).user?.role || '').toUpperCase();
            const isSuperAdmin = role === 'SUPER_ADMIN' || role === 'SUPERADMIN';
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
                const now = new Date();
                const result = await prisma.notification.updateMany({
                    where: { isRead: false },
                    data: { isRead: true, readAt: now },
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

            return res.status(200).json({
                success: true,
                message: 'All notifications marked as read',
            });
        } catch (error: any) {
            console.error('Mark all notifications as read error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Internal server error',
            });
        }
    }

    // Delete a single notification (recipient can delete their own)
    async deleteNotification(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const userId = (req as any).user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required',
                });
            }

            const notification = await prisma.notification.findUnique({ where: { id } });
            if (!notification) {
                return res.status(404).json({
                    success: false,
                    message: 'Notification not found',
                });
            }

            if (String(notification.recipientId) !== String(userId)) {
                return res.status(403).json({
                    success: false,
                    message: 'Unauthorized to delete this notification',
                });
            }

            await prisma.notification.delete({ where: { id } });

            return res.status(200).json({
                success: true,
                message: 'Notification deleted successfully',
            });
        } catch (error: any) {
            console.error('Delete notification error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Internal server error',
            });
        }
    }

    // Get document requests for an application
    async getDocumentRequestsByApplication(req: Request, res: Response) {
        try {
            const { applicationId } = req.params;

            if (!applicationId) {
                return res.status(400).json({
                    success: false,
                    message: 'Application ID is required',
                });
            }

            const applicationStr = String(applicationId);
            let application = null;

            if (/^\d+$/.test(applicationStr)) {
                application = await prisma.application.findUnique({
                    where: { applicationId: Number(applicationStr) },
                    include: { files: true },
                });
            } else {
                application = await prisma.application.findUnique({
                    where: { id: applicationStr },
                    include: { files: true },
                });
            }
            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            // Get all document request notifications for this application
            const notificationsRecords = await prisma.notification.findMany({
                where: {
                    applicationId: application.id,
                    type: 'document_request',
                },
                orderBy: { createdAt: 'desc' },
            });

            // Extract all unique requested documents and their status
            const documentMap = new Map<string, { status: 'Complete' | 'Pending'; createdAt: Date; requestedBy?: any; message?: string }>();
            const generalRequests: { name: string; status: 'Pending'; createdAt: Date; requestedBy?: any; message?: string }[] = [];

            notificationsRecords.forEach((notification: any) => {
                const requestedDocs = notification.documentRequestedDocuments || [];

                // Specific document requests
                requestedDocs.forEach((docName: string) => {
                    const isUploaded = application.files?.some((file: any) => {
                        const fileName = file.originalName?.toLowerCase() || '';
                        const docNameLower = docName.toLowerCase();
                        return fileName.includes(docNameLower) || docNameLower.includes(fileName.split('.')[0]);
                    });

                    if (
                        !documentMap.has(docName) ||
                        (documentMap.get(docName)?.createdAt && notification.createdAt > documentMap.get(docName)!.createdAt)
                    ) {
                        documentMap.set(docName, {
                            status: isUploaded ? 'Complete' : 'Pending',
                            createdAt: notification.createdAt,
                            requestedBy: notification.createdBy,
                        });
                    }
                });

                // General "Sent Back for Documentation" requests (no specific docs - e.g. from Final Underwriter)
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

            // Convert map to array, then append general requests (Final Underwriter send-back)
            const documents = Array.from(documentMap.entries()).map(([name, data]) => ({
                name,
                status: data.status,
                createdAt: data.createdAt,
                requestedBy: data.requestedBy,
                message: data.message,
            }));

            // Add general requests (sorted by createdAt desc)
            generalRequests
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .forEach((req) => {
                    documents.push({
                        name: req.name,
                        status: req.status,
                        createdAt: req.createdAt,
                        requestedBy: req.requestedBy,
                        message: req.message,
                    });
                });

            return res.status(200).json({
                success: true,
                data: documents,
            });
        } catch (error: any) {
            console.error('Get document requests by application error:', error);
            return res.status(500).json({
                success: false,
                message: error.message || 'Internal server error',
            });
        }
    }
}

const notificationController = new NotificationController();
export default notificationController;

