/**
 * Upsert Katan payoff and zero-balance letter templates from src/templates/payment-letters/.
 *
 * Usage: npx ts-node src/scripts/upsertKatanPaymentLetterTemplates.ts
 */
import fs from 'fs';
import path from 'path';
import prisma from '../config/prismaClient';
import { PaymentTemplateType } from '@prisma/client';

const LOGO_URL =
  'https://res.cloudinary.com/dfy6ahsqz/image/upload/v1780324705/white_logo_d8bsb1.svg';

const TEMPLATES_DIR = path.resolve(__dirname, '../templates/payment-letters');

type LetterSeed = {
  name: string;
  file: string;
  variables: string[];
};

const LETTER_SEEDS: LetterSeed[] = [
  {
    name: 'Payoff Wire Instructions',
    file: 'payoff-wire-instructions.html',
    variables: [
      'merchant_legal_name',
      'customer_id',
      'payoff_amount',
      'client_name',
      'letter_date',
      'bank_name',
      'bank_address_line1',
      'bank_city_state_zip',
      'routing_number',
      'account_number',
    ],
  },
  {
    name: 'Zero balance letter',
    file: 'zero-balance-letter.html',
    variables: [
      'letter_date',
      'merchant_legal_name',
      'agreement_date',
      'zero_balance_statement',
    ],
  },
];

function readTemplateBody(fileName: string): string {
  const filePath = path.join(TEMPLATES_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Template file not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8').trim();
}

void (async () => {
  try {
    await prisma.$connect();
    for (const seed of LETTER_SEEDS) {
      const body = readTemplateBody(seed.file);
      if (!body.includes(LOGO_URL)) {
        console.warn(`[warn] ${seed.file} does not reference the expected logo URL`);
      }

      const existing = await prisma.paymentTemplate.findFirst({
        where: {
          name: seed.name,
          category: PaymentTemplateType.letter,
        },
      });

      if (existing) {
        const updated = await prisma.paymentTemplate.update({
          where: { id: existing.id },
          data: {
            body,
            variables: seed.variables,
            status: 'active',
          },
        });
        console.log(`Updated: ${updated.name} (${updated.id})`);
      } else {
        const created = await prisma.paymentTemplate.create({
          data: {
            name: seed.name,
            category: PaymentTemplateType.letter,
            body,
            variables: seed.variables,
            status: 'active',
          },
        });
        console.log(`Created: ${created.name} (${created.id})`);
      }
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
