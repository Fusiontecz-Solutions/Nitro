/**
 * Run manually when PaymentTemplate is empty: npx ts-node src/scripts/seedPayoffWireTemplate.ts
 * Requires DATABASE_URL (same as the API).
 */
import prisma from '../config/prismaClient';
import { ensurePayoffWireTemplate } from '../bootstrap/ensurePayoffWireTemplate';
import { ensureZeroBalanceLetterTemplate } from '../bootstrap/ensureZeroBalanceLetterTemplate';

void (async () => {
  try {
    await prisma.$connect();
    await ensurePayoffWireTemplate();
    await ensureZeroBalanceLetterTemplate();
    const count = await prisma.paymentTemplate.count();
    console.log(`PaymentTemplate rows: ${count}`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
