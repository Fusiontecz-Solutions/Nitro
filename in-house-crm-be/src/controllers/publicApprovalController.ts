import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prismaClient';
import {
  createPublicPortalToken,
  isPublicPortalTokenTableReady,
  sha256Hex,
} from '../services/publicPortalTokenService';

// For public pages we only return the minimal fields Approval needs.
const mapApplicationForApproval = (app: any) => {
  if (!app) return null;

  const client = app.client;
  return {
    _id: app.id,
    id: app.id,
    applicationId: app.applicationId,
    loanAmount: app.loanAmount,
    commissionPercentage: app.commissionPercentage,
    client: client
      ? {
          owner: {
            firstName: client.ownerFirstName,
            lastName: client.ownerLastName,
          },
          business: {
            name: client.businessName,
          },
        }
      : null,
  };
};

const mapTermsOfferForApproval = (offer: any) => {
  if (!offer) return offer;

  return {
    _id: offer.id,
    termsOfferId: offer.termsOfferId,
    approvedAmount: offer.approvedAmount,
    factorRate: offer.factorRate,
    paybackAmount: offer.paybackAmount,
    numberOfPayments: offer.numberOfPayments,
    offerExpiryDate: offer.offerExpiryDate,
    termLength: offer.termLength,
    commissionPercent: offer.commissionPercent,
    paymentAmount: offer.paymentAmount,
    percentOfGross: offer.percentOfGross,
    frequency: offer.frequency,
    buyRate: offer.buyRate,
    commissionAmount: offer.commissionAmount,
    position: offer.position,
    paymentSchedule: offer.paymentSchedule,
    paymentDays: offer.paymentDays,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
  };
};

const mapApplicationForPortalStatus = (app: any) => {
  if (!app) return null;
  const client = app.client;
  return {
    id: app.id,
    applicationId: app.applicationId,
    currentQueue: app.currentQueue,
    currentState: app.currentState,
    type: app.type,
    loanAmount: app.loanAmount,
    updatedAt: app.updatedAt,
    createdAt: app.createdAt,
    client: client
      ? {
          businessName: client.businessName,
          ownerFirstName: client.ownerFirstName,
          ownerLastName: client.ownerLastName,
        }
      : null,
  };
};

class PublicApprovalController {
  // Protected: generate a token for a given application (returns token only)
  async createToken(req: Request, res: Response) {
    try {
      const { applicationId } = req.params;
      const { expiresInDays } = req.body as { expiresInDays?: number };

      const applicationIdStr = Array.isArray(applicationId) ? applicationId[0] : applicationId;
      if (!applicationIdStr) {
        return res.status(400).json({ success: false, message: 'applicationId is required' });
      }

      let app: { id: string } | null = null;
      if (/^\d+$/.test(applicationIdStr)) {
        const numericAppId = Number(applicationIdStr);
        app = await prisma.application.findUnique({
          where: { applicationId: numericAppId },
          select: { id: true },
        });
      } else {
        // Allow UUID form as well (application `id` is a UUID in Prisma).
        app = await prisma.application.findUnique({
          where: { id: applicationIdStr },
          select: { id: true },
        });
      }

      if (!app) {
        return res.status(404).json({ success: false, message: 'Application not found' });
      }

      if (!(await isPublicPortalTokenTableReady())) {
        return res.status(503).json({
          success: false,
          code: 'TOKEN_TABLE_MISSING',
          message: 'Public approval token table is not available. Run migrations and try again.',
        });
      }

      const token = await createPublicPortalToken(
        app.id,
        typeof expiresInDays === 'number' && Number.isFinite(expiresInDays) && expiresInDays > 0
          ? { expiresInDays }
          : undefined,
      );

      if (!token) {
        return res.status(500).json({ success: false, message: 'Failed to generate token' });
      }

      return res.status(201).json({ success: true, token });
    } catch (error) {
      console.error('PublicApprovalController.createToken error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // Public: validate token + return minimal application + latest terms offers
  async getByToken(req: Request, res: Response) {
    try {
      const token = req.params.token;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Token is required' });
      }

      const tokenHash = sha256Hex(token);
      let tokenRecord: any = null;
      const tokenTableExists = await isPublicPortalTokenTableReady();
      if (tokenTableExists) {
        tokenRecord = await prisma.publicApprovalToken.findUnique({
          where: { tokenHash },
        });
      }

      const isUuidLikeToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);

      // Token-table not available yet OR token not found:
      // fallback to treating `:token` as an application UUID directly.
      if (!tokenRecord) {
        if (isUuidLikeToken) {
          const appRecord = await prisma.application.findUnique({
            where: { id: token },
            include: { client: true },
          });

          if (!appRecord) {
            return res.status(404).json({
              success: false,
              code: 'APPLICATION_NOT_FOUND',
              message: 'Application not found',
            });
          }

          const termsOffers = await prisma.termsOffer.findMany({
            where: { applicationId: appRecord.id },
            orderBy: { createdAt: 'desc' },
            take: 10,
          });

          return res.status(200).json({
            success: true,
            data: {
              application: mapApplicationForApproval(appRecord),
              termsOffers: termsOffers.map(mapTermsOfferForApproval),
              expiresAt: null,
            },
          });
        }

        return res.status(404).json({
          success: false,
          code: tokenTableExists ? 'TOKEN_NOT_FOUND' : 'TOKEN_TABLE_MISSING',
          message: 'Link not found',
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        return res.status(410).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          message: 'Link expired',
          expiresAt: tokenRecord.expiresAt,
        });
      }

      const appRecord = await prisma.application.findUnique({
        where: { id: tokenRecord.applicationId },
        include: { client: true },
      });

      if (!appRecord) {
        return res.status(404).json({ success: false, code: 'APPLICATION_NOT_FOUND', message: 'Application not found' });
      }

      const termsOffers = await prisma.termsOffer.findMany({
        where: { applicationId: tokenRecord.applicationId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      return res.status(200).json({
        success: true,
        data: {
          application: mapApplicationForApproval(appRecord),
          termsOffers: termsOffers.map(mapTermsOfferForApproval),
          expiresAt: tokenRecord.expiresAt ?? null,
        },
      });
    } catch (error) {
      console.error('PublicApprovalController.getByToken error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  /**
   * Public: application status for external recipients (token must exist in PublicApprovalToken; no UUID shortcut).
   */
  async getPortalStatusByToken(req: Request, res: Response) {
    try {
      const token = req.params.token;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Token is required' });
      }

      if (!(await isPublicPortalTokenTableReady())) {
        return res.status(503).json({
          success: false,
          code: 'TOKEN_TABLE_MISSING',
          message: 'Portal is temporarily unavailable',
        });
      }

      const tokenHash = sha256Hex(token);
      const tokenRecord = await prisma.publicApprovalToken.findUnique({
        where: { tokenHash },
      });

      if (!tokenRecord) {
        return res.status(404).json({
          success: false,
          code: 'TOKEN_NOT_FOUND',
          message: 'Link not found',
        });
      }

      if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
        return res.status(410).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          message: 'Link expired',
          expiresAt: tokenRecord.expiresAt,
        });
      }

      const appRecord = await prisma.application.findUnique({
        where: { id: tokenRecord.applicationId },
        include: { client: true },
      });

      if (!appRecord) {
        return res.status(404).json({
          success: false,
          code: 'APPLICATION_NOT_FOUND',
          message: 'Application not found',
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          application: mapApplicationForPortalStatus(appRecord),
          expiresAt: tokenRecord.expiresAt ?? null,
        },
      });
    } catch (error) {
      console.error('PublicApprovalController.getPortalStatusByToken error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // Public: create a short-lived authenticated session for the referring agent
  // derived from the given public approval token.
  //
  // This lets unregistered users use the existing authenticated UI
  // (upload documents, create/edit/delete comments, etc.) without showing
  // sidebar/tabs on the frontend.
  async createApprovalSession(req: Request, res: Response) {
    try {
      const token = req.params.token;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Token is required' });
      }

      const isUuidLikeToken =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);

      let applicationId: string | null = null;

      // Try resolve from publicApprovalToken table first (if migrated)
      if (await isPublicPortalTokenTableReady()) {
        const tokenHash = sha256Hex(token);
        const tokenRecord = await prisma.publicApprovalToken.findUnique({
          where: { tokenHash },
        });
        if (tokenRecord) applicationId = tokenRecord.applicationId;
      }

      // Fallback: treat token as application UUID directly
      if (!applicationId) {
        if (!isUuidLikeToken) {
          return res.status(404).json({ success: false, message: 'Link not found' });
        }
        applicationId = token;
      }

      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: {
          referringAgent: true,
          client: true,
        },
      });

      if (!application) {
        return res.status(404).json({ success: false, message: 'Application not found' });
      }

      // The recipient is the referring agent (see email send logic).
      if (!application.referringAgent) {
        return res.status(403).json({
          success: false,
          message: 'This link is not associated with a valid agent',
        });
      }

      const agent = application.referringAgent;

      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret) {
        return res.status(500).json({ success: false, message: 'Server misconfiguration (JWT_SECRET missing)' });
      }

      const payload = {
        name: `${agent.firstName} ${agent.lastName}`.trim(),
        email: agent.email,
        id: agent.id,
        role: agent.role,
        // Public approval links are sent to ISO/referring-agent recipients.
        // Keep auth role compatibility but tag actor type for downstream attribution.
        publicApprovalActor: 'ISO' as const,
      };

      const sessionToken = jwt.sign(payload, jwtSecret, { expiresIn: '1d' });
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.accessToken.create({
        data: {
          token: sessionToken,
          userId: agent.id,
          expiresAt,
        },
      });

      return res.status(200).json({
        success: true,
        token: sessionToken,
        user: {
          _id: agent.id,
          firstName: agent.firstName,
          lastName: agent.lastName,
          email: agent.email,
          phone: agent.phone,
          role: agent.role,
          isVerified: agent.isVerified,
          isActive: agent.isActive,
          profilePicture: agent.profilePicture ?? null,
        },
        applicationId: application.id,
      });
    } catch (error) {
      console.error('PublicApprovalController.createApprovalSession error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }
}

export default new PublicApprovalController();

