/**
 * Syndicator repayment distribution removed with contract-workflow cleanup.
 * Kept as a no-op so any lingering callers compile.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export type PaymentLike = {
  id?: string;
  applicationId: string;
  amount: Prisma.Decimal | Prisma.DecimalJsLike | number | string;
  status?: string;
  scheduledDate?: Date | string | null;
  Date?: Date | string | null;
  notes?: string | null;
};

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function distributeSyndicatorCreditsForPayments(
  _prismaLike: PrismaLike,
  _payments: PaymentLike[],
): Promise<void> {
  // no-op: syndicator / collection payment models removed
}
