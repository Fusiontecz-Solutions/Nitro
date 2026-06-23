// @ts-nocheck
import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import {
  resolveApplicationAttributedUserId,
  APPLICATION_USER_ATTRIBUTION_ERROR,
} from '../middleware/authMiddleware';
import { getAuthenticatedUserFromRequest } from '../services/applicationService';
import {
  createApplicationActivityLog,
  type ApplicationActivityActionType,
} from '../services/applicationActivityLogService';
import {
    scheduleApplicationStageNotification,
    notifyApplicationRejected,
} from '../services/applicationStageNotificationService';

/** Align with deal-pipeline queue labels (Agent, Underwriter, Final Underwriter, Contracted, Final). */
const normalizeQueueKey = (queue: string | null | undefined) =>
  String(queue ?? '')
    .trim()
    .replace(/[\s_-]+/g, '')
    .toLowerCase();

const normalizeCallStatusKey = (value: string | null | undefined) =>
  String(value ?? '')
    .trim()
    .replace(/[\s_-]+/g, '')
    .toLowerCase();

const isFundingCallRejected = (callStatus: string | null | undefined) =>
  normalizeCallStatusKey(callStatus) === 'rejected';

const QUEUES_THAT_CAN_MOVE_TO_FUNDING_CALL = new Set([
  'agent',
  'underwriter',
  'finalunderwriter',
  'contracted',
  'final',
]);

const shouldSetApplicationQueueToFundingCall = (currentQueue: string | null | undefined) =>
  QUEUES_THAT_CAN_MOVE_TO_FUNDING_CALL.has(normalizeQueueKey(currentQueue));

const mapFundingCallToApi = (record: any) => {
  if (!record) return record;

  const {
    id,
    applicationId,
    // Prisma relation fields are capitalized in your schema:
    // - `Application`
    // - `User`
    Application,
    createdById,
    User,
    createdAt,
    updatedAt,
    ...rest
  } = record;

  const mappedApplication =
    Application &&
    ({
      _id: Application.id,
      id: Application.id,
      applicationId: (Application as any).applicationId,
      priority: (Application as any).priority,
      type: (Application as any).type,
      currentQueue: (Application as any).currentQueue,
      currentState: (Application as any).currentState,
    } as any);

  const mappedCreatedBy =
    User &&
    ({
      _id: User.id,
      id: User.id,
      firstName: (User as any).firstName,
      lastName: (User as any).lastName,
      email: (User as any).email,
    } as any);

  return {
    ...rest,
    _id: id,
    id,
    application: mappedApplication ?? applicationId,
    createdBy: mappedCreatedBy ?? createdById,
    createdAt,
    updatedAt,
  };
};

class FundingCallController {
  async create(req: Request, res: Response) {
    try {
      const { application, callStatus, applicationStatus, remarks, followUpDate } = req.body;

      if (!application || !callStatus) {
        return res.status(400).json({
          success: false,
          message: 'Application and callStatus are required',
        });
      }

      const applicationStr = String(application);
      let appRecord = null;

      if (/^\d+$/.test(applicationStr)) {
        appRecord = await prisma.application.findUnique({
          where: { applicationId: Number(applicationStr) },
          include: { client: true, iso: true },
        });
      } else {
        appRecord = await prisma.application.findUnique({
          where: { id: applicationStr },
          include: { client: true, iso: true },
        });
      }

      if (!appRecord) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      const createdBy = await resolveApplicationAttributedUserId(req, {
        createdById: appRecord.createdById,
        salesRepresentativeId: appRecord.salesRepresentativeId,
      });
      if (!createdBy) {
        return res.status(400).json({
          success: false,
          message: APPLICATION_USER_ATTRIBUTION_ERROR,
        });
      }

      const parsedFollowUpDate =
        followUpDate && typeof followUpDate === 'string' && followUpDate.trim()
          ? new Date(followUpDate)
          : null;

      // If a funding call already exists for this application, update the most recent one
      const latestExisting = await prisma.fundingCall.findFirst({
        where: { applicationId: appRecord.id },
        orderBy: { createdAt: 'desc' },
      });

      let record;

      if (latestExisting) {
        record = await prisma.fundingCall.update({
          where: { id: latestExisting.id },
          data: {
            callStatus: String(callStatus),
            applicationStatus: applicationStatus ?? null,
            remarks: remarks ?? null,
            followUpDate: parsedFollowUpDate,
          },
          include: {
            Application: true,
            User: true,
          },
        });
      } else {
        record = await prisma.fundingCall.create({
          data: {
            applicationId: appRecord.id,
            callStatus: String(callStatus),
            applicationStatus: applicationStatus ?? null,
            remarks: remarks ?? null,
            followUpDate: parsedFollowUpDate,
            createdById: createdBy,
          },
          include: {
            Application: true,
            User: true,
          },
        });
      }

      let applicationForResponse = record.Application;
      const previousQueue = appRecord.currentQueue;
      const previousState = appRecord.currentState;
      const callStatusStr = String(callStatus);

      if (isFundingCallRejected(callStatusStr)) {
        const declineReason =
          (remarks && String(remarks).trim()) ||
          'Rejected during funding call';

        const declinedApp = await prisma.application.update({
          where: { id: appRecord.id },
          data: {
            currentQueue: 'Declined',
            currentState: 'CANCELLED',
            note: declineReason,
          },
        });
        applicationForResponse = { ...record.Application, ...declinedApp };

        try {
          const authUser = getAuthenticatedUserFromRequest(req);
          const roleLabel = authUser?.role
            ? String(authUser.role).toUpperCase().replace(/_/g, ' ')
            : 'User';
          const actorName = (req as any).user?.name || '';

          await createApplicationActivityLog({
            applicationId: appRecord.id,
            user: authUser,
            req,
            actionType: 'APPLICATION_REJECTED' as ApplicationActivityActionType,
            actionDescription:
              `${roleLabel} ${actorName}`.trim() +
              ` declined the application during funding call. Reason: ${declineReason}`,
            previousStatus: `${previousQueue} / ${previousState}`,
            currentStatus: `${declinedApp.currentQueue} / ${declinedApp.currentState}`,
            metadata: {
              reason: declineReason,
              fundingCallStatus: callStatusStr,
            },
          });
        } catch (logError) {
          console.error('Failed to create activity log for funding call rejection:', logError);
        }

        try {
          const recipientIds = new Set<string>();
          const addIfNotSender = (id: string | null | undefined) => {
            const sid = id ? String(id) : '';
            if (sid && sid !== String(createdBy)) recipientIds.add(sid);
          };
          addIfNotSender(appRecord.referringAgentId);
          addIfNotSender(appRecord.salesRepresentativeId);

          await notifyApplicationRejected({
            application: { ...appRecord, ...declinedApp },
            actorId: createdBy,
            reason: declineReason,
            extraRecipientIds: Array.from(recipientIds),
          });
        } catch (notificationError) {
          console.error('Failed to send funding call rejection notification:', notificationError);
        }
      } else if (shouldSetApplicationQueueToFundingCall(appRecord.currentQueue)) {
        const previousQueue = appRecord.currentQueue;
        const previousState = appRecord.currentState;
        const updatedApp = await prisma.application.update({
          where: { id: appRecord.id },
          data: {
            currentQueue: 'Funding Call',
            currentState: 'FUNDING_CALL',
          },
          include: {
            client: true,
            referringAgent: { select: { id: true } },
            salesRepresentative: { select: { id: true } },
            createdBy: { select: { id: true } },
          },
        });
        applicationForResponse = updatedApp
          ? { ...record.Application, ...updatedApp }
          : record.Application;

        scheduleApplicationStageNotification({
          application: updatedApp as any,
          previousQueue,
          previousState,
          actorId: createdBy,
          actorName: (req as any).user?.name || '',
          transitionAction: 'QUEUE_CHANGED',
        });
      }


      return res.status(201).json({
        success: true,
        message: isFundingCallRejected(callStatusStr)
          ? 'Application declined successfully'
          : 'Funding call saved successfully',
        data: mapFundingCallToApi({ ...record, Application: applicationForResponse }),
      });
    } catch (error) {
      console.error('Create funding call error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  async getByApplication(req: Request, res: Response) {
    try {
      const { application } = req.query;

      if (!application) {
        return res.status(400).json({
          success: false,
          message: 'Application is required',
        });
      }

      const applicationStr = String(application);
      let appRecord = null;

      if (/^\d+$/.test(applicationStr)) {
        appRecord = await prisma.application.findUnique({
          where: { applicationId: Number(applicationStr) },
        });
      } else {
        appRecord = await prisma.application.findUnique({
          where: { id: applicationStr },
        });
      }

      if (!appRecord) {
        return res.status(200).json({
          success: true,
          data: [],
        });
      }

      const records = await prisma.fundingCall.findMany({
        where: { applicationId: appRecord.id },
        orderBy: { createdAt: 'desc' },
        include: {
          Application: true,
          User: true,
        },
      });

      return res.status(200).json({
        success: true,
        data: records.map(mapFundingCallToApi),
      });
    } catch (error) {
      console.error('Get funding calls error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

const fundingCallController = new FundingCallController();
export default fundingCallController;

