// @ts-nocheck
import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import type { AuthenticatedUser } from '../services/applicationService';
import { getUnderwriterClaimMutationDenial } from '../services/underwriterClaimGuard';
import { sanitizePaymentFrequencyForPersist } from '../utils/sanitizePaymentFrequency';

const authUserFromReq = (req: Request): AuthenticatedUser | null =>
  (req as any).user?.id
    ? { id: String((req as any).user.id), role: String((req as any).user.role || '') }
    : null;

const mapPositionToApi = (position: any) => {
  if (!position) return position;

  const {
    id,
    positionId,
    application,
    applicationId,
    createdBy,
    createdById,
    createdAt,
    updatedAt,
    ...rest
  } = position;

  const mappedApplication =
    application &&
    ({
      _id: application.id,
      id: application.id,
      applicationId: application.applicationId,
      priority: application.priority,
      type: application.type,
      currentQueue: application.currentQueue,
      currentState: application.currentState,
    } as any);

  const mappedCreatedBy =
    createdBy &&
    ({
      _id: createdBy.id,
      id: createdBy.id,
      firstName: createdBy.firstName,
      lastName: createdBy.lastName,
      email: createdBy.email,
    } as any);

  return {
    ...rest,
    _id: id,
    id,
    positionId,
    application: mappedApplication ?? applicationId,
    createdBy: mappedCreatedBy ?? createdById,
    createdAt,
    updatedAt,
  };
};

const parseAmount = (value: any): number => {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;

  const cleaned = String(value).replace(/[^0-9.-]+/g, '');
  if (!cleaned) return NaN;

  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
};

const optNum = (value: any): number | undefined => {
  const n = parseAmount(value);
  return Number.isFinite(n) ? n : undefined;
};
const optInt = (value: any): number | undefined => {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : undefined;
};

class PositionController {
  // Create a new position
  async create(req: Request, res: Response) {
    try {
      const {
        position,
        factorRate,
        ach,
        percentOfGross,
        funder,
        paybackAmount,
        fundingDate,
        activeStatus,
        fundedAmount,
        frequency,
        closeDate,
        notes,
        application,
        status,
        loanAmount,
        paymentTerm,
        mcaEstBalance,
        mcaPercentPaid,
        pmtsLeft,
        monthlyMcaPmts,
        carryForward,
        mcaRemit,
        lastPaymentDate,
        allocatedBankAnalysisId,
      } = req.body;

      if (
        !position ||
        !factorRate ||
        !ach ||
        !percentOfGross ||
        !funder ||
        !paybackAmount ||
        !fundingDate ||
        !fundedAmount ||
        !frequency ||
        !closeDate ||
        !application
      ) {
        return res.status(400).json({
          success: false,
          message: 'All required fields must be provided',
        });
      }

      // Accept application as UUID or numeric applicationId so Scrubbing-created positions link correctly
      const applicationExists = await this.resolveApplicationByAnyId(String(application));
      if (!applicationExists) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      const appGuard = await prisma.application.findUnique({
        where: { id: applicationExists.id },
        select: { currentQueue: true, claimedByUnderwriterId: true },
      });
      const denyCreate = getUnderwriterClaimMutationDenial(authUserFromReq(req), appGuard);
      if (denyCreate) {
        return res.status(denyCreate.status).json({ success: false, message: denyCreate.message });
      }

      const paybackAmountNum = parseAmount(paybackAmount);
      const fundedAmountNum = parseAmount(fundedAmount);

      const fundingDateObj = new Date(fundingDate);
      const closeDateObj = new Date(closeDate);
      const lastPaymentDateObj =
        lastPaymentDate != null && String(lastPaymentDate).trim() !== ''
          ? new Date(lastPaymentDate)
          : null;
      if (isNaN(fundingDateObj.getTime()) || isNaN(closeDateObj.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid date format',
        });
      }
      if (lastPaymentDateObj && isNaN(lastPaymentDateObj.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid last payment date format',
        });
      }

      const createdBy = (req as any).user?.id || null;

      const newPosition = await prisma.position.create({
        data: {
          position,
          factorRate,
          ach,
          percentOfGross,
          funder,
          paybackAmount: paybackAmountNum,
          fundingDate: fundingDateObj,
          activeStatus: activeStatus !== undefined ? !!activeStatus : false,
          fundedAmount: fundedAmountNum,
          frequency: sanitizePaymentFrequencyForPersist(frequency) || 'Daily',
          closeDate: closeDateObj,
          notes: notes || '',
          applicationId: applicationExists.id,
          createdById: createdBy,
          status: status != null ? String(status).trim() || null : null,
          loanAmount: optNum(loanAmount),
          paymentTerm: optInt(paymentTerm),
          mcaEstBalance: optNum(mcaEstBalance),
          mcaPercentPaid: optNum(mcaPercentPaid),
          pmtsLeft: optInt(pmtsLeft),
          monthlyMcaPmts: optNum(monthlyMcaPmts),
          carryForward: optNum(carryForward),
          mcaRemit: optNum(mcaRemit),
          lastPaymentDate: lastPaymentDateObj,
          allocatedBankAnalysisId: optInt(allocatedBankAnalysisId),
        },
      });

      return res.status(201).json({
        success: true,
        message: 'Position created successfully',
        data: mapPositionToApi(newPosition),
      });
    } catch (error) {
      console.error('Create position error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Resolve application by UUID (id) or numeric applicationId — role-independent; returns same application for Agent and Scrubbing
  private async resolveApplicationByAnyId(applicationParam: string): Promise<{ id: string } | null> {
    const s = String(applicationParam).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) {
      const app = await prisma.application.findUnique({
        where: { applicationId: Number(s) },
        select: { id: true },
      });
      return app;
    }
    const app = await prisma.application.findUnique({
      where: { id: s },
      select: { id: true },
    });
    return app;
  }

  // Get all positions with optional filters. application filter is required for application-scoped usage (only return positions for that application).
  async getAll(req: Request, res: Response) {
    try {
      const { application, activeStatus } = req.query;

      const where: any = {};
      if (application) {
        const app = await this.resolveApplicationByAnyId(String(application));
        if (!app) {
          return res.status(200).json({
            success: true,
            data: [],
          });
        }
        where.applicationId = app.id;
      }
      if (activeStatus !== undefined) {
        where.activeStatus = activeStatus === 'true';
      }

      const positions = await prisma.position.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({
        success: true,
        data: positions.map(mapPositionToApi),
      });
    } catch (error) {
      console.error('Get all positions error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get position by UUID id
  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const position = await prisma.position.findUnique({
        where: { id },
      });

      if (!position) {
        return res.status(404).json({
          success: false,
          message: 'Position not found',
        });
      }

      return res.status(200).json({
        success: true,
        data: mapPositionToApi(position),
      });
    } catch (error) {
      console.error('Get position by id error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get position by numeric positionId
  async getByPositionId(req: Request, res: Response) {
    try {
      const { positionId } = req.params;

      const position = await prisma.position.findUnique({
        where: { positionId: Number(positionId) },
      });

      if (!position) {
        return res.status(404).json({
          success: false,
          message: 'Position not found',
        });
      }

      return res.status(200).json({
        success: true,
        data: mapPositionToApi(position),
      });
    } catch (error) {
      console.error('Get position by positionId error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Update position
  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const {
        position,
        factorRate,
        ach,
        percentOfGross,
        funder,
        paybackAmount,
        fundingDate,
        activeStatus,
        fundedAmount,
        frequency,
        closeDate,
        notes,
        application,
        status,
        loanAmount,
        paymentTerm,
        mcaEstBalance,
        mcaPercentPaid,
        pmtsLeft,
        monthlyMcaPmts,
        carryForward,
        mcaRemit,
        lastPaymentDate,
        allocatedBankAnalysisId,
      } = req.body;

      const positionDoc = await prisma.position.findUnique({ where: { id } });
      if (!positionDoc) {
        return res.status(404).json({
          success: false,
          message: 'Position not found',
        });
      }

      const appGuard = await prisma.application.findUnique({
        where: { id: positionDoc.applicationId },
        select: { currentQueue: true, claimedByUnderwriterId: true },
      });
      const denyUpdate = getUnderwriterClaimMutationDenial(authUserFromReq(req), appGuard);
      if (denyUpdate) {
        return res.status(denyUpdate.status).json({ success: false, message: denyUpdate.message });
      }

      const data: any = {};

      if (application) {
        const app = await this.resolveApplicationByAnyId(String(application));
        if (!app) {
          return res.status(404).json({
            success: false,
            message: 'Application not found',
          });
        }
        data.applicationId = app.id;
      }

      if (position !== undefined) data.position = position;
      if (factorRate !== undefined) data.factorRate = factorRate;
      if (ach !== undefined) data.ach = ach;
      if (percentOfGross !== undefined) data.percentOfGross = percentOfGross;
      if (funder !== undefined) data.funder = funder;
      if (paybackAmount !== undefined) {
        data.paybackAmount = parseAmount(paybackAmount);
      }
      if (fundingDate !== undefined) {
        const fundingDateObj = new Date(fundingDate);
        if (isNaN(fundingDateObj.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid funding date format',
          });
        }
        data.fundingDate = fundingDateObj;
      }
      if (activeStatus !== undefined) data.activeStatus = !!activeStatus;
      if (fundedAmount !== undefined) {
        data.fundedAmount = parseAmount(fundedAmount);
      }
      if (frequency !== undefined) {
        const sanitized = sanitizePaymentFrequencyForPersist(frequency);
        if (sanitized != null) data.frequency = sanitized;
      }
      if (closeDate !== undefined) {
        const closeDateObj = new Date(closeDate);
        if (isNaN(closeDateObj.getTime())) {
          return res.status(400).json({
            success: false,
            message: 'Invalid close date format',
          });
        }
        data.closeDate = closeDateObj;
      }
      if (notes !== undefined) data.notes = notes;
      if (status !== undefined) data.status = status != null ? String(status).trim() || null : undefined;
      if (loanAmount !== undefined) data.loanAmount = optNum(loanAmount);
      if (paymentTerm !== undefined) data.paymentTerm = optInt(paymentTerm);
      if (mcaEstBalance !== undefined) data.mcaEstBalance = optNum(mcaEstBalance);
      if (mcaPercentPaid !== undefined) data.mcaPercentPaid = optNum(mcaPercentPaid);
      if (pmtsLeft !== undefined) data.pmtsLeft = optInt(pmtsLeft);
      if (monthlyMcaPmts !== undefined) data.monthlyMcaPmts = optNum(monthlyMcaPmts);
      if (carryForward !== undefined) data.carryForward = optNum(carryForward);
      if (mcaRemit !== undefined) data.mcaRemit = optNum(mcaRemit);
      if (allocatedBankAnalysisId !== undefined) {
        data.allocatedBankAnalysisId = optInt(allocatedBankAnalysisId);
      }
      if (lastPaymentDate !== undefined) {
        if (lastPaymentDate == null || String(lastPaymentDate).trim() === '') {
          data.lastPaymentDate = null;
        } else {
          const lastPaymentDateObj = new Date(lastPaymentDate);
          if (isNaN(lastPaymentDateObj.getTime())) {
            return res.status(400).json({
              success: false,
              message: 'Invalid last payment date format',
            });
          }
          data.lastPaymentDate = lastPaymentDateObj;
        }
      }

      const updated = await prisma.position.update({
        where: { id },
        data,
      });

      return res.status(200).json({
        success: true,
        message: 'Position updated successfully',
        data: mapPositionToApi(updated),
      });
    } catch (error: any) {
      console.error('Update position error:', error);

      // Handle common Prisma errors more gracefully so we don't always return a 500
      if (error?.code === 'P2025') {
        // Record not found
        return res.status(404).json({
          success: false,
          message: 'Position not found',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Delete position
  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const positionDoc = await prisma.position.findUnique({
        where: { id },
        select: { applicationId: true },
      });
      if (!positionDoc) {
        return res.status(404).json({
          success: false,
          message: 'Position not found',
        });
      }
      const appGuard = await prisma.application.findUnique({
        where: { id: positionDoc.applicationId },
        select: { currentQueue: true, claimedByUnderwriterId: true },
      });
      const denyDelete = getUnderwriterClaimMutationDenial(authUserFromReq(req), appGuard);
      if (denyDelete) {
        return res.status(denyDelete.status).json({ success: false, message: denyDelete.message });
      }

      try {
        await prisma.position.delete({ where: { id } });
      } catch (err: any) {
        if (err.code === 'P2025') {
          return res.status(404).json({
            success: false,
            message: 'Position not found',
          });
        }
        throw err;
      }

      return res.status(200).json({
        success: true,
        message: 'Position deleted successfully',
      });
    } catch (error) {
      console.error('Delete position error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

const positionController = new PositionController();
export default positionController;

