import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import { decryptField, encryptField } from '../utils/fieldEncryption';

const mapBankDetailToApi = (detail: any) => {
  if (!detail) return detail;

  const {
    id,
    bankName,
    accountNumber,
    routingNumber,
    application,
    applicationId,
    createdBy,
    createdById,
    createdAt,
    updatedAt,
    ...rest
  } = detail;

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
    bankName,
    accountNumber: decryptField(accountNumber),
    routingNumber: decryptField(routingNumber),
    application: mappedApplication ?? applicationId,
    createdBy: mappedCreatedBy ?? createdById,
    createdAt,
    updatedAt,
  };
};

const resolveApplicationByAnyId = async (application: any) => {
  const applicationStr = String(application);

  if (/^\d+$/.test(applicationStr)) {
    // numeric business applicationId
    return prisma.application.findUnique({
      where: { applicationId: Number(applicationStr) },
    });
  }

  // assume UUID primary key
  return prisma.application.findUnique({
    where: { id: applicationStr },
  });
};

class BankDetailController {
  // Create a single bank detail
  async create(req: Request, res: Response) {
    try {
      const { bankName, accountNumber, routingNumber, application } = req.body;

      if (!accountNumber || !application) {
        return res.status(400).json({
          success: false,
          message: 'accountNumber and application are required',
        });
      }

      const applicationRecord = await resolveApplicationByAnyId(application);
      if (!applicationRecord) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      const createdBy = (req as any).user?.id;
      if (!createdBy) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required',
        });
      }

      const bankDetail = await prisma.bankDetail.create({
        data: {
          bankName: bankName ? String(bankName).trim() : '',
          accountNumber: encryptField(accountNumber),
          routingNumber: routingNumber ? encryptField(String(routingNumber)) : null,
          applicationId: applicationRecord.id,
          createdById: createdBy,
        } as any,
        include: {
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
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      return res.status(201).json({
        success: true,
        message: 'Bank detail created successfully',
        data: mapBankDetailToApi(bankDetail),
      });
    } catch (error) {
      console.error('Create bank detail error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Create multiple bank details at once
  async bulkCreate(req: Request, res: Response) {
    try {
      const { banks, application } = req.body;

      if (!banks || !Array.isArray(banks) || banks.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'banks array is required and must not be empty',
        });
      }

      if (!application) {
        return res.status(400).json({
          success: false,
          message: 'application is required',
        });
      }

      const applicationRecord = await resolveApplicationByAnyId(application);
      if (!applicationRecord) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      const createdBy = (req as any).user?.id;
      if (!createdBy) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required',
        });
      }

      const bankDetailsData = banks.map((bank: any) => {
        if (!bank.bankName || !bank.accountNumber) {
          throw new Error('Each bank must have bankName and accountNumber');
        }
        return {
          bankName: String(bank.bankName).trim(),
          accountNumber: encryptField(String(bank.accountNumber)),
          routingNumber: bank.routingNumber ? encryptField(String(bank.routingNumber)) : null,
        };
      });

      const createdBanks = await prisma.$transaction(
        bankDetailsData.map((data) =>
          prisma.bankDetail.create({
            data: {
              ...data,
              applicationId: applicationRecord.id,
              createdById: createdBy,
            },
            include: {
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
              createdBy: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          })
        )
      );

      return res.status(201).json({
        success: true,
        message: `${createdBanks.length} bank detail(s) created successfully`,
        data: createdBanks.map(mapBankDetailToApi),
      });
    } catch (error: any) {
      console.error('Bulk create bank details error:', error);
      if (error.message && error.message.includes('must have')) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get all bank details for a specific application
  async getAll(req: Request, res: Response) {
    try {
      const { application } = req.query;

      if (!application) {
        return res.status(400).json({
          success: false,
          message: 'application query parameter is required',
        });
      }

      const applicationRecord = await resolveApplicationByAnyId(application);
      if (!applicationRecord) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      const bankDetails = await prisma.bankDetail.findMany({
        where: { applicationId: applicationRecord.id },
        include: {
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
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({
        success: true,
        data: bankDetails.map(mapBankDetailToApi),
      });
    } catch (error) {
      console.error('Get all bank details error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get bank detail by ID
  async getById(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const bankDetail = await prisma.bankDetail.findUnique({
        where: { id },
        include: {
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
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      if (!bankDetail) {
        return res.status(404).json({
          success: false,
          message: 'Bank detail not found',
        });
      }

      return res.status(200).json({
        success: true,
        data: mapBankDetailToApi(bankDetail),
      });
    } catch (error) {
      console.error('Get bank detail by id error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Update bank detail
  async update(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { bankName, accountNumber, routingNumber, application } = req.body;

      const currentUserId = (req as any).user?.id as string | undefined;
      if (!currentUserId) {
        return res.status(401).json({
          success: false,
          message: 'User authentication required',
        });
      }

      // Require OTP-based approval for editing bank details
      const isBankEditApproved = await prisma.verificationToken.findFirst({
        where: {
          userId: currentUserId,
          tokenType: 'BANK_EDIT_VERIFIED',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!isBankEditApproved) {
        return res.status(403).json({
          success: false,
          message: 'OTP verification required to edit bank details',
        });
      }

      const existing = await prisma.bankDetail.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Bank detail not found',
        });
      }

      const data: any = {};

      if (application) {
        const applicationRecord = await resolveApplicationByAnyId(application);
        if (!applicationRecord) {
          return res.status(404).json({
            success: false,
            message: 'Application not found',
          });
        }
        data.applicationId = applicationRecord.id;
      }

      if (bankName !== undefined) {
        data.bankName = String(bankName).trim();
      }
      if (accountNumber !== undefined) {
        data.accountNumber = encryptField(String(accountNumber));
      }
      if (routingNumber !== undefined) {
        data.routingNumber = routingNumber ? encryptField(String(routingNumber)) : null;
      }

      const updatedBankDetail = await prisma.bankDetail.update({
        where: { id },
        data,
        include: {
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
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Bank detail updated successfully',
        data: mapBankDetailToApi(updatedBankDetail),
      });
    } catch (error) {
      console.error('Update bank detail error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Delete bank detail
  async delete(req: Request, res: Response) {
    try {
      const { id } = req.params;

      const existing = await prisma.bankDetail.findUnique({ where: { id } });
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Bank detail not found',
        });
      }

      await prisma.bankDetail.delete({ where: { id } });

      return res.status(200).json({
        success: true,
        message: 'Bank detail deleted successfully',
      });
    } catch (error) {
      console.error('Delete bank detail error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

const bankDetailController = new BankDetailController();
export default bankDetailController;

