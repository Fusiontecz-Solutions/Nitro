import type { Request, Response } from 'express';
import {
    getApplicationForUserByRef,
    getAuthenticatedUserFromRequest,
} from '../services/applicationService';
import {
    WorkflowError,
    getWorkflowSummary,
    listWorkflowQueue,
    returnToUnderwriter,
    sendToAgentApproval,
    submitToUnderwriting,
} from '../services/applicationWorkflowService';
import { getIsoApprovalThreadHistory } from '../services/isoApprovalThreadService';
import prisma from '../config/prismaClient';

const actorNameOf = (req: Request) => String(req.user?.name ?? '').trim();

function handleError(res: Response, error: unknown, label: string) {
    if (error instanceof WorkflowError) {
        return res.status(error.status).json({ success: false, message: error.message, code: error.code });
    }
    console.error(`${label} error:`, error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
}

/** Agent / Underwriter workflow endpoints (mounted under /applications). */
class ApplicationWorkflowController {
    async summary(req: Request, res: Response) {
        try {
            const user = getAuthenticatedUserFromRequest(req)!;
            const data = await getWorkflowSummary(user, req.query.scope, {
                startDate: req.query.startDate,
                endDate: req.query.endDate,
            });
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return handleError(res, error, 'Workflow summary');
        }
    }

    async queue(req: Request, res: Response) {
        try {
            const user = getAuthenticatedUserFromRequest(req)!;
            const data = await listWorkflowQueue(user, req.query);
            return res.status(200).json({ success: true, data });
        } catch (error) {
            return handleError(res, error, 'Workflow queue');
        }
    }

    async submitToUnderwriting(req: Request, res: Response) {
        try {
            const user = getAuthenticatedUserFromRequest(req)!;
            await submitToUnderwriting(req.params.id, user, actorNameOf(req), req);
            return res.status(200).json({ success: true, message: 'Application submitted to underwriting' });
        } catch (error) {
            return handleError(res, error, 'Submit to underwriting');
        }
    }

    async sendToAgentApproval(req: Request, res: Response) {
        try {
            const user = getAuthenticatedUserFromRequest(req)!;
            const note = String(req.body?.note ?? '').trim().slice(0, 2000);
            await sendToAgentApproval(req.params.id, user, actorNameOf(req), note, req);
            return res.status(200).json({ success: true, message: 'Application sent to the Agent for approval' });
        } catch (error) {
            return handleError(res, error, 'Send to agent approval');
        }
    }

    async returnToUnderwriter(req: Request, res: Response) {
        try {
            const user = getAuthenticatedUserFromRequest(req)!;
            const note = String(req.body?.note ?? '').trim().slice(0, 2000);
            await returnToUnderwriter(req.params.id, user, actorNameOf(req), note, req);
            return res.status(200).json({ success: true, message: 'Application returned to underwriting' });
        } catch (error) {
            return handleError(res, error, 'Return to underwriter');
        }
    }

    /** ISO approval email history: Gmail thread (incl. ISO replies) + every send recorded for the deal. */
    async emailThread(req: Request, res: Response) {
        try {
            const user = getAuthenticatedUserFromRequest(req);
            const { application, forbidden } = await getApplicationForUserByRef(req.params.id, user);
            if (forbidden) return res.status(403).json({ success: false, message: 'Forbidden' });
            if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

            const [history, sends] = await Promise.all([
                getIsoApprovalThreadHistory(application.id),
                prisma.outbound_communications.findMany({
                    where: { applicationId: application.id, recipientType: 'ISO' },
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                    select: {
                        id: true,
                        recipient: true,
                        subject: true,
                        templateName: true,
                        status: true,
                        metadata: true,
                        createdAt: true,
                        User: { select: { id: true, firstName: true, lastName: true } },
                    },
                }),
            ]);

            return res.status(200).json({
                success: true,
                data: {
                    ...history,
                    sends: sends.map((s) => {
                        const meta = (s.metadata && typeof s.metadata === 'object' ? s.metadata : {}) as Record<string, any>;
                        return {
                            id: s.id,
                            recipient: s.recipient,
                            subject: s.subject,
                            templateName: s.templateName,
                            status: s.status,
                            createdAt: s.createdAt,
                            sentBy: s.User ? `${s.User.firstName} ${s.User.lastName}`.trim() : null,
                            ccEmails: Array.isArray(meta.ccEmails) ? meta.ccEmails : [],
                            transport: meta.transport ?? null,
                            repliedOnExistingThread: Boolean(meta.gmail?.repliedOnExistingThread),
                            delivered: Array.isArray(meta.emailDelivery) ? meta.emailDelivery.some((d: any) => d?.ok) : null,
                        };
                    }),
                },
            });
        } catch (error) {
            return handleError(res, error, 'Email thread');
        }
    }
}

const applicationWorkflowController = new ApplicationWorkflowController();
export default applicationWorkflowController;
