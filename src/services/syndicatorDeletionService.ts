import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';

/** Auth/session rows that FK to User without DB cascade — must be removed before deleting the user. */
async function deleteUserAuthTokens(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.accessToken.deleteMany({ where: { userId } });
  await tx.verificationToken.deleteMany({ where: { userId } });
}

/**
 * Clears FK join data that would block deleting a Syndicator row (implicit application M-N,
 * details rows without Prisma FK cascade, notifications without cascade).
 */
export async function detachSyndicatorGraph(
  tx: Prisma.TransactionClient,
  syndicatorId: number,
): Promise<void> {
  const paymentSettings = await tx.syndicatorPaymentSetting.findMany({
    where: { syndicatorId },
    select: { id: true },
  });
  const paymentSettingIds = paymentSettings.map((p) => p.id);
  if (paymentSettingIds.length > 0) {
    await tx.repaymentPlan.deleteMany({
      where: { syndicatorPaymentSettingId: { in: paymentSettingIds } },
    });
  }

  await tx.applicationSyndicatorDetails.deleteMany({ where: { syndicatorId } });
  await tx.syndicatorNotification.deleteMany({ where: { syndicatorId } });
  await tx.syndicator.update({
    where: { id: syndicatorId },
    data: { applications: { set: [] } },
  });
}

/** Delete syndication profile; if linked to a CRM user, deletes that user (DB cascades Syndicator away). */
export async function deleteSyndicatorCascadeUser(syndicatorId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const synd = await tx.syndicator.findUnique({
      where: { id: syndicatorId },
      select: { id: true, userId: true },
    });
    if (!synd) {
      const err = new Error('Syndicator not found') as Error & { statusCode?: number };
      err.statusCode = 404;
      throw err;
    }
    await detachSyndicatorGraph(tx, syndicatorId);
    if (synd.userId) {
      await deleteUserAuthTokens(tx, synd.userId);
      await tx.user.delete({ where: { id: synd.userId } });
    } else {
      await tx.syndicator.delete({ where: { id: syndicatorId } });
    }
  });
}

/** Deletes a CRM user after clearing any linked syndicator subgraph (same cleanup as syndicator-first delete). */
export async function deleteUserAndLinkedSyndicator(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const synd = await tx.syndicator.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (synd) {
      await detachSyndicatorGraph(tx, synd.id);
    }
    await deleteUserAuthTokens(tx, userId);
    await tx.user.delete({ where: { id: userId } });
  });
}
