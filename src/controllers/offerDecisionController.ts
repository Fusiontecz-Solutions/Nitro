// @ts-nocheck
import type { Request, Response } from 'express';
import prisma from '../config/prismaClient';
import type { AuthenticatedUser } from '../services/applicationService';
import { getUnderwriterClaimMutationDenial } from '../services/underwriterClaimGuard';
import {
    flagNeedsContractReinitiation,
    isQueueEligibleForContractReinitiation,
    offerDecisionValuesChanged,
} from '../services/contractReinitiationService';
import { recordContractWorkflowActivityLog } from '../services/contractWorkflowActivityLog';
import { syncApplicationToContractPending } from '../services/contractApplicationWorkflowSync';
import { createApplicationActivityLog } from '../services/applicationActivityLogService';
import { sanitizePaymentFrequencyForPersist } from '../utils/sanitizePaymentFrequency';
import { syncTermsOfferFromOfferDecision } from '../services/syncTermsOfferFromOfferDecision';

const authUserFromReq = (req: Request): AuthenticatedUser | null =>
  (req as any).user?.id
    ? { id: String((req as any).user.id), role: String((req as any).user.role || '') }
    : null;

/** Prisma `Application.id` (UUID v4 shape). Must be checked before any `\d+` heuristic — UUIDs can start with a digit. */
const APPLICATION_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/i;

// Resolve application by numeric applicationId or UUID id (reuse pattern from termsOfferController)
const findApplication = async (applicationIdOrUuid: unknown) => {
  const raw = Array.isArray(applicationIdOrUuid) ? applicationIdOrUuid[0] : applicationIdOrUuid;
  const str = raw != null && typeof raw !== 'object' ? String(raw).trim() : '';
  if (!str) return null;

  if (APPLICATION_UUID_RE.test(str)) {
    return prisma.application.findUnique({ where: { id: str } });
  }

  // Pure numeric => business `Application.applicationId` (display id), not UUID substring
  if (/^\d+$/.test(str)) {
    return prisma.application.findUnique({ where: { applicationId: Number(str) } });
  }

  // Deal profile id (e.g. BA1010) — OfferDecision.applicationId FK points at Application.id
  const byDealId = await prisma.application.findFirst({
    where: { dealId: { equals: str, mode: 'insensitive' } },
    orderBy: { updatedAt: 'desc' },
  });
  if (byDealId) return byDealId;

  return null;
};

const parseNumber = (value: any): number | null => {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]+/g, '');
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

const mapOfferDecisionToApi = (row: any) => {
  if (!row) return row;
  const {
    id,
    applicationId,
    decision,
    position,
    offer,
    rate,
    term,
    frequency,
    repayPerPeriod,
    monthlyPayment,
    fees,
    ourRemit,
    totalRemit,
    refinanceAmount,
    previousDealDate,
    declineReason,
    createdAt,
    updatedAt,
    ...rest
  } = row;

  return {
    ...rest,
    _id: id,
    id,
    application: applicationId,
    decision,
    position,
    offer,
    rate,
    term,
    frequency,
    repayPerPeriod,
    monthlyPayment,
    fees,
    ourRemit,
    totalRemit,
    refinanceAmount,
    previousDealDate,
    declineReason,
    createdAt,
    updatedAt,
  };
};

class OfferDecisionController {
  // Upsert approved/edited offer decision for an application
  async upsert(req: Request, res: Response) {
    try {
      const {
        applicationId: rawApplication,
        decision,
        position,
        offer,
        rate,
        term,
        frequency,
        repayPerPeriod,
        monthlyPayment,
        fees,
        ourRemit,
        totalRemit,
        refinanceAmount,
        previousDealDate,
      } = req.body;

      if (!rawApplication) {
        return res.status(400).json({
          success: false,
          message: 'applicationId is required',
        });
      }

      if (!decision) {
        return res.status(400).json({
          success: false,
          message: 'decision is required',
        });
      }

      const app = await findApplication(rawApplication);
      if (!app) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      const denyUw = getUnderwriterClaimMutationDenial(authUserFromReq(req), app);
      if (denyUw) {
        return res.status(denyUw.status).json({ success: false, message: denyUw.message });
      }

      /**
       * `OfferDecision.term` is `String?` in the DB, but the UI may send a number
       * (e.g. `2`) or a label (e.g. `"60 Days"`). Coerce to a clean string so Prisma
       * does not reject `Int` for a `String` column.
       */
      const parseTermForPrisma = (t: unknown): string | null => {
        if (t === null || t === undefined) return null;
        if (typeof t === 'number') {
          return Number.isFinite(t) ? String(Math.trunc(t)) : null;
        }
        const s = String(t).trim().replace(/\s+/g, ' ');
        if (!s || /^na$/i.test(s)) return null;
        return s;
      };

      const parseFrequencyForPrisma = (f: unknown): string | null =>
        sanitizePaymentFrequencyForPersist(f);

      const createData: any = {
        decision: String(decision),
        position: position ?? null,
        offer: parseNumber(offer),
        rate: parseNumber(rate),
        term: parseTermForPrisma(term),
        frequency: parseFrequencyForPrisma(frequency),
        repayPerPeriod: parseNumber(repayPerPeriod),
        monthlyPayment: parseNumber(monthlyPayment),
        fees: parseNumber(fees),
        ourRemit: parseNumber(ourRemit),
        totalRemit: parseNumber(totalRemit),
        refinanceAmount: parseNumber(refinanceAmount),
        previousDealDate: previousDealDate
          ? new Date(String(previousDealDate))
          : null,
        declineReason: null,
      };

      /** Partial update: only fields sent in the body are written (preserves position, ourRemit, etc.). */
      const body = req.body as Record<string, unknown>;
      const updateData: any = {
        decision: String(decision),
        declineReason: null,
      };
      if ('position' in body) updateData.position = position ?? null;
      if ('offer' in body) updateData.offer = parseNumber(offer);
      if ('rate' in body) updateData.rate = parseNumber(rate);
      if ('term' in body) updateData.term = parseTermForPrisma(term);
      if ('frequency' in body) updateData.frequency = parseFrequencyForPrisma(frequency);
      if ('repayPerPeriod' in body) updateData.repayPerPeriod = parseNumber(repayPerPeriod);
      if ('monthlyPayment' in body) updateData.monthlyPayment = parseNumber(monthlyPayment);
      if ('fees' in body) updateData.fees = parseNumber(fees);
      if ('ourRemit' in body) updateData.ourRemit = parseNumber(ourRemit);
      if ('totalRemit' in body) updateData.totalRemit = parseNumber(totalRemit);
      if ('refinanceAmount' in body) updateData.refinanceAmount = parseNumber(refinanceAmount);
      if ('previousDealDate' in body) {
        updateData.previousDealDate = previousDealDate
          ? new Date(String(previousDealDate))
          : null;
      }

      const priorOfferDecisionPromise = prisma.offerDecision.findUnique({
        where: { applicationId: app.id },
        select: {
          offer: true,
          rate: true,
          totalRemit: true,
          term: true,
          frequency: true,
        },
      });

      const result = await prisma.offerDecision.upsert({
        where: { applicationId: app.id },
        create: {
          applicationId: app.id,
          ...createData,
        },
        update: updateData,
      });

      const priorOfferDecision = await priorOfferDecisionPromise;

      const decisionNorm = String(decision).trim().toLowerCase();
      const authUser = authUserFromReq(req);
      const actorName = String((req as any).user?.name || '').trim();

      /**
       * Create & Save Offer → advance the deal to Contract Pending so Operations
       * can generate the contract. Keep this on the hot path so `meta` is accurate.
       */
      let movedToContractPending = false;
      if (decisionNorm === 'approved') {
        try {
          movedToContractPending = await syncApplicationToContractPending(
            prisma,
            app.id,
            { source: 'offerDecisionController.upsert' },
          );
        } catch (queueErr) {
          console.error(
            'OfferDecision upsert: failed to set Application to Contract Pending',
            queueErr,
          );
        }
      }

      const previousStatus =
        `${app.currentQueue ?? ''} / ${app.currentState ?? ''}`.trim();

      setImmediate(() => {
        void (async () => {
          const offerForCommission =
            result.offer != null ? Number(result.offer) : parseNumber(offer);
          const commissionPercentage = Number(app.commissionPercentage ?? 0);
          const newCommissionAmount =
            offerForCommission != null && Number.isFinite(offerForCommission)
              ? (Number(offerForCommission) * commissionPercentage) / 100
              : null;

          try {
            await prisma.application.update({
              where: { id: app.id },
              data: { commissionAmount: newCommissionAmount },
            });
          } catch (commissionErr) {
            console.error(
              'OfferDecision upsert: failed to update Application.commissionAmount',
              commissionErr,
            );
          }

          if (decisionNorm === 'approved') {
            try {
              await syncTermsOfferFromOfferDecision(app.id, authUser?.id ?? null);
            } catch (termsSyncErr) {
              console.error(
                'OfferDecision upsert: failed to sync TermsOffer from OfferDecision',
                termsSyncErr,
              );
            }

            try {
              const draftContract = await prisma.contract.findUnique({
                where: { applicationId: app.id },
                select: { id: true, status: true, offerId: true },
              });
              if (draftContract && draftContract.status === 'DRAFT') {
                const offerAmt =
                  result.offer != null && Number.isFinite(Number(result.offer))
                    ? Number(result.offer)
                    : null;
                const totalAmt =
                  result.totalRemit != null && Number.isFinite(Number(result.totalRemit))
                    ? Number(result.totalRemit)
                    : null;
                const moneyPatch: Record<string, unknown> = {};
                if (offerAmt != null) {
                  moneyPatch.approvedAmount = offerAmt;
                  moneyPatch.purchaseAmount = String(offerAmt);
                }
                if (totalAmt != null) {
                  moneyPatch.totalAmount = totalAmt;
                  moneyPatch.purchasePrice = String(totalAmt);
                }
                if (result.id && draftContract.offerId !== result.id) {
                  moneyPatch.offerId = result.id;
                }
                if (Object.keys(moneyPatch).length > 0) {
                  await prisma.contract.update({
                    where: { id: draftContract.id },
                    data: moneyPatch,
                  });
                }
              }
            } catch (contractSyncErr) {
              console.error(
                'OfferDecision upsert: failed to sync draft Contract amounts from OfferDecision',
                contractSyncErr,
              );
            }
          }

          if (movedToContractPending) {
            try {
              const actorPrefix = actorName || authUser?.role || 'User';
              await createApplicationActivityLog({
                applicationId: app.id,
                user: authUser,
                req,
                actionType: 'QUEUE_CHANGED',
                actionDescription: `${actorPrefix} saved offer and moved deal to Contract Pending.`,
                previousStatus,
                currentStatus: 'Contract Pending / CONTRACT_PENDING',
                metadata: {
                  source: 'offerDecisionController.upsert',
                  offer: result.offer ?? null,
                },
              });
            } catch (logErr) {
              console.error(
                'OfferDecision upsert: failed to write Contract Pending activity log',
                logErr,
              );
            }
          }

          try {
            const existingContract = await prisma.contract.findUnique({
              where: { applicationId: app.id },
              select: { id: true },
            });
            const offerChanged = offerDecisionValuesChanged(priorOfferDecision, {
              offer: result.offer,
              rate: result.rate,
              totalRemit: result.totalRemit,
              term: result.term,
              frequency: result.frequency,
            });
            if (
              existingContract &&
              offerChanged &&
              isQueueEligibleForContractReinitiation(app.currentQueue)
            ) {
              await flagNeedsContractReinitiation(app.id);
              await recordContractWorkflowActivityLog(
                app.id,
                'REINITIATION_REQUIRED',
                {
                  user: authUser,
                  req,
                  actorName,
                  source: 'offerDecisionController.upsert',
                },
                {
                  previousStatus,
                  metadata: {
                    contractId: existingContract.id,
                    priorOffer: priorOfferDecision?.offer ?? null,
                    newOffer: result.offer ?? null,
                    priorRate: priorOfferDecision?.rate ?? null,
                    newRate: result.rate ?? null,
                    priorTotalRemit: priorOfferDecision?.totalRemit ?? null,
                    newTotalRemit: result.totalRemit ?? null,
                  },
                },
              );
            }
          } catch (reinitErr) {
            console.error(
              'OfferDecision upsert: failed to flag contract reinitiation',
              reinitErr,
            );
          }
        })();
      });

      return res.status(200).json({
        success: true,
        message: 'Offer decision saved successfully',
        data: mapOfferDecisionToApi(result),
        meta: {
          movedToContractPending,
        },
      });
    } catch (error) {
      console.error('OfferDecision upsert error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Explicit decline endpoint with reason
  async decline(req: Request, res: Response) {
    try {
      const { applicationId: rawApplication, declineReason, decision } = req.body;

      if (!rawApplication) {
        return res.status(400).json({
          success: false,
          message: 'applicationId is required',
        });
      }

      const reason = (declineReason ?? '').toString().trim();
      if (!reason) {
        return res.status(400).json({
          success: false,
          message: 'declineReason is required',
        });
      }

      const app = await findApplication(rawApplication);
      if (!app) {
        return res.status(404).json({
          success: false,
          message: 'Application not found',
        });
      }

      const denyUw = getUnderwriterClaimMutationDenial(authUserFromReq(req), app);
      if (denyUw) {
        return res.status(denyUw.status).json({ success: false, message: denyUw.message });
      }

      const result = await prisma.offerDecision.upsert({
        where: { applicationId: app.id },
        create: {
          applicationId: app.id,
          decision: decision ? String(decision) : 'declined',
          declineReason: reason,
        },
        update: {
          decision: decision ? String(decision) : 'declined',
          declineReason: reason,
        },
      });

      /**
       * On decline there is no approved offer amount, so the mirrored
       * `Application.commissionAmount` (computed from the offer) must be cleared
       * to avoid stale values after a previously-approved offer is declined.
       */
      try {
        await prisma.application.update({
          where: { id: app.id },
          data: { commissionAmount: null },
        });
      } catch (commissionErr) {
        console.error(
          'OfferDecision decline: failed to clear Application.commissionAmount',
          commissionErr,
        );
      }

      return res.status(200).json({
        success: true,
        message: 'Offer decision declined successfully',
        data: mapOfferDecisionToApi(result),
      });
    } catch (error) {
      console.error('OfferDecision decline error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  // Get decision by application (for future use)
  async getByApplication(req: Request, res: Response) {
    try {
      const { application } = req.query;

      if (!application) {
        return res.status(400).json({
          success: false,
          message: 'application query param is required',
        });
      }

      const app = await findApplication(application);
      if (!app) {
        return res.status(200).json({
          success: true,
          data: null,
        });
      }

      const row = await prisma.offerDecision.findUnique({
        where: { applicationId: app.id },
      });

      if (!row) {
        return res.status(200).json({
          success: true,
          data: null,
        });
      }

      return res.status(200).json({
        success: true,
        data: mapOfferDecisionToApi(row),
      });
    } catch (error) {
      console.error('OfferDecision getByApplication error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }
}

const offerDecisionController = new OfferDecisionController();
export default offerDecisionController;

