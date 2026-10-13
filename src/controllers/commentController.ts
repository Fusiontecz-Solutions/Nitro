import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import sendMail, { isOutboundSmtpConfigured } from '../config/nodemailer';
import {
  getApplicationForUser,
  getAuthenticatedUserFromRequest,
  type AuthenticatedUser,
} from '../services/applicationService';
import { getUnderwriterClaimMutationDenial } from '../services/underwriterClaimGuard';
import { notifyDealUsersOfComment } from '../services/publicPortalCommentNotificationService';
import { sendExternalCommentToIsoEmail } from '../services/isoExternalCommentMailService';
import { resolveApplicationDisplayNumber } from '../utils/applicationDisplayNumber';

const applicationAccessDeniedMessage =
  'Forbidden: you do not have access to this application';

const applicationCommentAccessSelect = {
  id: true,
  currentQueue: true,
  claimedByUnderwriterId: true,
  assignedUnderwriterId: true,
  clientId: true,
  applicationId: true,
  dealId: true,
} as const;

type ApplicationCommentAccessRow = {
  id: string;
  currentQueue: string;
  claimedByUnderwriterId?: string | null;
  assignedUnderwriterId?: string | null;
  clientId: string;
  applicationId: number;
  dealId?: string | null;
};

async function requireApplicationAccessById(
  req: Request,
  res: Response,
  applicationId: string,
): Promise<ApplicationCommentAccessRow | null> {
  const publicApprovalActor = String((req as any).user?.publicApprovalActor || '').toUpperCase();
  if (publicApprovalActor === 'CLIENT' || publicApprovalActor === 'ISO') {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: applicationCommentAccessSelect,
    });
    if (!application) {
      res.status(404).json({ success: false, message: 'Application not found' });
      return null;
    }
    return application;
  }

  const authUser = getAuthenticatedUserFromRequest(req);
  const { application, forbidden } = await getApplicationForUser({ id: applicationId }, authUser);
  if (forbidden) {
    res.status(403).json({ success: false, message: applicationAccessDeniedMessage });
    return null;
  }
  if (!application) {
    res.status(404).json({ success: false, message: 'Application not found' });
    return null;
  }
  return application;
}

async function requireApplicationAccessForComment(
  req: Request,
  res: Response,
  commentApplicationId: string,
): Promise<boolean> {
  const app = await requireApplicationAccessById(req, res, commentApplicationId);
  return app != null;
}

const mapCommentToApi = (comment: any) => {
  if (!comment) return comment;

  const {
    id,
    commentId,
    application,
    applicationId,
    createdBy,
    createdById,
    content,
    isEdited,
    isDeleted,
    createdAt,
    updatedAt,
    ...rest
  } = comment;

  const mappedCreatedBy =
    createdBy &&
    ({
      _id: createdBy.id,
      id: createdBy.id,
      firstName: createdBy.firstName,
      lastName: createdBy.lastName,
      email: createdBy.email,
      role: createdBy.role,
      profilePicture: createdBy.profilePicture ?? null,
    } as any);

  const mappedApplication =
    application &&
    ({
      _id: application.id,
      id: application.id,
      applicationId: application.applicationId,
    } as any);

  return {
    ...rest,
    _id: id,
    id,
    commentId,
    application: mappedApplication ?? applicationId,
    createdBy: mappedCreatedBy ?? createdById,
    content,
    isEdited,
    isDeleted,
    createdAt,
    updatedAt,
  };
};

class CommentController {
  // Create a new comment on an application
  async create(req: Request, res: Response) {
    try {
      const { applicationId } = req.params;
      const { content, type } = req.body;
      const userId = (req as any).user?.id;
      const publicApprovalActor = String((req as any).user?.publicApprovalActor || '').toUpperCase();
      const isPublicClientActor = publicApprovalActor === 'CLIENT';
      const isPublicIsoActor = publicApprovalActor === 'ISO';

      if (!content || !content.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Comment content is required',
        });
      }

      let application: ApplicationCommentAccessRow | null = null;
      if (isPublicClientActor || isPublicIsoActor) {
        application = await prisma.application.findUnique({
          where: { id: applicationId },
          select: applicationCommentAccessSelect,
        });
        if (!application) {
          return res.status(404).json({
            success: false,
            message: 'Application not found',
          });
        }
      } else {
        application = await requireApplicationAccessById(req, res, applicationId);
        if (!application) {
          return;
        }
      }

      if (!isPublicClientActor && !isPublicIsoActor && userId) {
        const uwActor: AuthenticatedUser = {
          id: String(userId),
          role: String((req as any).user?.role || ''),
        };
        const denyUw = getUnderwriterClaimMutationDenial(uwActor, application);
        if (denyUw) {
          return res.status(denyUw.status).json({ success: false, message: denyUw.message });
        }
      }

      // Normalize comment type - default to Internal Comment
      const rawType = typeof type === 'string' ? type.trim() : '';
      const normalizedType = isPublicIsoActor
        ? 'ISO Comment'
        : rawType.toLowerCase() === 'iso comment' || rawType.toLowerCase() === 'iso'
          ? 'ISO Comment'
          : rawType.toLowerCase() === 'external comment' || rawType.toLowerCase() === 'external'
          ? 'External Comment'
          : 'Internal Comment';

      const comment = await prisma.comment.create({
        // Cast to any so this stays compatible even if prisma types are not yet regenerated
        data: {
          applicationId: application.id,
          content: content.trim(),
          type: normalizedType,
          // Public approval session comments should be attributed to client/unregistered actor.
          createdById: isPublicClientActor ? null : userId || null,
        } as any,
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
              profilePicture: true,
            },
          },
          application: {
            select: { id: true, applicationId: true },
          },
        },
      });

      // Re-open ISO Query pipeline when ISO posts a new comment after prior resolution.
      if (normalizedType === 'ISO Comment') {
        await prisma.application.update({
          where: { id: application.id },
          data: { isoQueryResolved: false },
        });
      }

      const isPublicActor = isPublicClientActor || isPublicIsoActor;
      const actorName = String((req as any).user?.name || '').trim() || null;

      // In-app bell + `comment:new` socket for everyone on the deal (and all Super Admins).
      // Public ISO sessions map to a CRM user — pass null so that user still gets a row.
      void notifyDealUsersOfComment({
        applicationId: application.id,
        commentBody: content.trim(),
        commentType: normalizedType,
        actorName,
        actorRole: isPublicActor ? null : String((req as any).user?.role || '') || null,
        createdById: isPublicActor ? null : userId || null,
        preferIsoActorLabel: isPublicIsoActor,
      }).catch((err) => console.error('[comment] deal notification failed:', err));

      // Staff External Comment → email the ISO with a "Reply in portal" link.
      if (normalizedType === 'External Comment' && !isPublicActor) {
        void sendExternalCommentToIsoEmail({
          applicationId: application.id,
          commentBody: content.trim(),
          actorName,
          actorUserId: userId || null,
        });
      }

      // Email Underwriter(s) when ISO comments are added from approval page.
      if (normalizedType === 'ISO Comment') {
        try {
          const finalUwRecipients = new Set<string>();
          let latestFinalUwActor: string | null = null;

          const latestFinalUwLog = await prisma.applicationActivityLog.findFirst({
            where: {
              applicationId: application.id,
              userRole: 'UNDERWRITER' as any,
            },
            orderBy: { createdAt: 'desc' },
            select: { userId: true },
          });
          latestFinalUwActor = latestFinalUwLog?.userId ? String(latestFinalUwLog.userId) : null;
          if (latestFinalUwActor) {
            finalUwRecipients.add(latestFinalUwActor);
          }

          // Fallback: notify active Final Underwriters if no dedicated one found from activity.
          if (finalUwRecipients.size === 0) {
            const finalUnderwriters = await prisma.user.findMany({
              where: { role: 'UNDERWRITER', isActive: true },
              select: { id: true },
            });
            finalUnderwriters.forEach((u) => finalUwRecipients.add(String(u.id)));
          }

          if (finalUwRecipients.size > 0 && isOutboundSmtpConfigured()) {
            const isoActorName = actorName || 'ISO';
            const clientRecord = await prisma.client.findUnique({
              where: { id: application.clientId },
              select: {
                businessName: true,
                ownerFirstName: true,
                ownerLastName: true,
              },
            });
            const clientName =
              clientRecord?.businessName ||
              `${clientRecord?.ownerFirstName || ''} ${clientRecord?.ownerLastName || ''}`.trim() ||
              'Client';
            const appNumber = resolveApplicationDisplayNumber(application) || 'N/A';

            const recipientUsers = await prisma.user.findMany({
              where: { id: { in: Array.from(finalUwRecipients) } },
              select: { email: true, firstName: true, lastName: true },
            });
            const mailTargets = recipientUsers
              .map((u) => (u.email || '').trim())
              .filter(Boolean);
            if (mailTargets.length > 0) {
              const html = `
                <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
                  <h3 style="margin: 0 0 12px;">ISO Comment Notification</h3>
                  <p style="margin: 0 0 8px;"><strong>Application:</strong> #${appNumber}</p>
                  <p style="margin: 0 0 8px;"><strong>Client:</strong> ${clientName}</p>
                  <p style="margin: 0 0 8px;"><strong>From:</strong> ${isoActorName}</p>
                  <p style="margin: 0 0 8px;"><strong>Comment:</strong> ${content.trim()}</p>
                  <p style="margin: 0;">Please review the approval page and update values if needed.</p>
                </div>
              `;
              await sendMail({
                to: mailTargets,
                subject: `ISO comment received for Application #${appNumber}`,
                html,
              });
            }
          }
        } catch (notifyError) {
          console.error('ISO comment notification/email failed:', notifyError);
        }
      }

      return res.status(201).json({
        success: true,
        message: 'Comment added successfully',
        data: mapCommentToApi(comment),
      });
    } catch (error) {
      console.error('Create comment error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get all comments for an application
  async getByApplication(req: Request, res: Response) {
    try {
      const { applicationId } = req.params;

      const application = await requireApplicationAccessById(req, res, applicationId);
      if (!application) {
        return;
      }

      const commentsRecords = await prisma.comment.findMany({
        where: {
          applicationId: application.id,
          isDeleted: false,
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
              profilePicture: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const comments = commentsRecords.map(mapCommentToApi);

      return res.status(200).json({
        success: true,
        data: comments,
      });
    } catch (error) {
      console.error('Get comments by application error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get single comment by ID
  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const commentRecord = await prisma.comment.findUnique({
        where: { id },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profilePicture: true,
            },
          },
          application: {
            select: { id: true, applicationId: true },
          },
        },
      });

      if (!commentRecord) {
        return res.status(404).json({
          success: false,
          message: 'Comment not found',
        });
      }

      if (commentRecord.isDeleted) {
        return res.status(404).json({
          success: false,
          message: 'Comment has been deleted',
        });
      }

      const allowed = await requireApplicationAccessForComment(
        req,
        res,
        commentRecord.applicationId,
      );
      if (!allowed) {
        return;
      }

      return res.status(200).json({
        success: true,
        data: mapCommentToApi(commentRecord),
      });
    } catch (error) {
      console.error('Get comment by ID error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Update comment
  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { content, type } = req.body;
      const userId = (req as any).user?.id;

      if (!content || !content.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Comment content is required',
        });
      }

      const comment = await prisma.comment.findUnique({ where: { id } });

      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Comment not found',
        });
      }

      const appRow = await requireApplicationAccessById(req, res, comment.applicationId);
      if (!appRow) {
        return;
      }

      if (userId) {
        const denyUw = getUnderwriterClaimMutationDenial(
          { id: String(userId), role: String((req as any).user?.role || '') },
          appRow,
        );
        if (denyUw) {
          return res.status(denyUw.status).json({ success: false, message: denyUw.message });
        }
      }

      if (comment.isDeleted) {
        return res.status(400).json({
          success: false,
          message: 'Cannot edit a deleted comment',
        });
      }

      if (!comment.createdById || comment.createdById !== userId) {
        return res.status(403).json({
          success: false,
          message: 'You can only edit your own comments',
        });
      }

      // Normalize type if provided; otherwise keep existing
      let normalizedType: string | undefined;
      if (typeof type === 'string' && type.trim()) {
        const rawType = type.trim();
        normalizedType =
          rawType.toLowerCase() === 'iso comment' || rawType.toLowerCase() === 'iso'
            ? 'ISO Comment'
            : rawType.toLowerCase() === 'external comment' || rawType.toLowerCase() === 'external'
            ? 'External Comment'
            : 'Internal Comment';
      }

      const updatedRecord = await prisma.comment.update({
        where: { id },
        data: {
          content: content.trim(),
          isEdited: true,
        ...(normalizedType ? { type: normalizedType } : {}),
        },
        include: {
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profilePicture: true,
            },
          },
        },
      });

      const updatedComment = mapCommentToApi(updatedRecord);

      return res.status(200).json({
        success: true,
        message: 'Comment updated successfully',
        data: updatedComment,
      });
    } catch (error) {
      console.error('Update comment error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Delete comment (soft delete)
  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id as string | undefined;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      }

      const comment = await prisma.comment.findUnique({ where: { id } });

      if (!comment) {
        return res.status(404).json({
          success: false,
          message: 'Comment not found',
        });
      }

      const appRowDel = await requireApplicationAccessById(req, res, comment.applicationId);
      if (!appRowDel) {
        return;
      }
      const denyUwDel = getUnderwriterClaimMutationDenial(
        { id: String(userId), role: String((req as any).user?.role || '') },
        appRowDel,
      );
      if (denyUwDel) {
        return res.status(denyUwDel.status).json({ success: false, message: denyUwDel.message });
      }

      if (comment.isDeleted) {
        return res.status(400).json({
          success: false,
          message: 'Comment is already deleted',
        });
      }

      // Allow deletion only by the comment creator (soft delete).
      if (!comment.createdById || String(comment.createdById) !== String(userId)) {
        return res.status(403).json({
          success: false,
          message: 'You can only delete your own comments',
        });
      }

      await prisma.comment.update({
        where: { id },
        data: {
          isDeleted: true,
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Comment deleted successfully',
      });
    } catch (error) {
      console.error('Delete comment error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get comment count for an application
  async getCount(req: Request, res: Response) {
    try {
      const { applicationId } = req.params;

      const application = await requireApplicationAccessById(req, res, applicationId);
      if (!application) {
        return;
      }

      const count = await prisma.comment.count({
        where: {
          applicationId: application.id,
          isDeleted: false,
        },
      });

      return res.status(200).json({
        success: true,
        data: { count },
      });
    } catch (error) {
      console.error('Get comment count error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

const commentController = new CommentController();
export default commentController;

