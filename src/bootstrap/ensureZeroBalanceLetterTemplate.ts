import { PaymentTemplateType } from '@prisma/client';
import prisma from '../config/prismaClient';
import {
  ZERO_BALANCE_LETTER_BODY,
  ZERO_BALANCE_LETTER_NAME,
  ZERO_BALANCE_LETTER_VARIABLES,
} from '../data/zeroBalanceLetterTemplate';

/** Idempotent: creates the zero-balance letter HTML template if it is not already present. */
export async function ensureZeroBalanceLetterTemplate(): Promise<void> {
  const existing = await prisma.paymentTemplate.findFirst({
    where: { name: ZERO_BALANCE_LETTER_NAME },
  });
  if (existing) return;

  await prisma.paymentTemplate.create({
    // Relax Prisma typings here to avoid requiring id/updatedAt on seed data.
    data: {
      name: ZERO_BALANCE_LETTER_NAME,
      category: PaymentTemplateType.letter,
      variables: ZERO_BALANCE_LETTER_VARIABLES,
      body: ZERO_BALANCE_LETTER_BODY,
      status: 'active',
    } as any,
  });
  // eslint-disable-next-line no-console
  console.log(`Seeded payment template: ${ZERO_BALANCE_LETTER_NAME}`);
}
