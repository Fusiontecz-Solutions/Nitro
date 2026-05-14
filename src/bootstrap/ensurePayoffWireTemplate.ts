import { PaymentTemplateType } from '@prisma/client';
import prisma from '../config/prismaClient';
import {
  PAYOFF_WIRE_LETTER_BODY,
  PAYOFF_WIRE_LETTER_NAME,
  PAYOFF_WIRE_LETTER_VARIABLES,
} from '../data/payoffWireLetterTemplate';

/** Ensures the canonical formatted payoff wire template exists and is synced. */
export async function ensurePayoffWireTemplate(): Promise<void> {
  const existing = await prisma.paymentTemplate.findFirst({
    where: { name: PAYOFF_WIRE_LETTER_NAME },
  });
  if (existing) {
    await prisma.paymentTemplate.update({
      where: { id: existing.id },
      data: {
        category: PaymentTemplateType.letter,
        variables: PAYOFF_WIRE_LETTER_VARIABLES,
        body: PAYOFF_WIRE_LETTER_BODY,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`Synced payment template: ${PAYOFF_WIRE_LETTER_NAME}`);
    return;
  }

  await prisma.paymentTemplate.create({
    // Type assertion keeps this in line with other payment template seeders while
    // avoiding overly strict Prisma typings that expect id/updatedAt here.
    data: {
      name: PAYOFF_WIRE_LETTER_NAME,
      category: PaymentTemplateType.letter,
      variables: PAYOFF_WIRE_LETTER_VARIABLES,
      body: PAYOFF_WIRE_LETTER_BODY,
      status: 'active',
    } as any,
  });
  // eslint-disable-next-line no-console
  console.log(`Seeded payment template: ${PAYOFF_WIRE_LETTER_NAME}`);
}
