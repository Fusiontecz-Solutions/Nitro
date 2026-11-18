/**
 * READ-ONLY diagnostic: for a SignNow document group (or the most recent one),
 * print the Contract row the server prefills Review from, so "the mapping
 * resolved nothing" can be told apart from "the contract holds nothing".
 *
 *   npx ts-node --transpile-only src/scripts/inspectContractPrefillDefaults.ts [envelopeId]
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';

async function main() {
  let envelopeId = process.argv[2] || '';
  if (!envelopeId) {
    const row = await prisma.document.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { envelopeId: true },
    });
    envelopeId = row?.envelopeId || '';
  }
  const document = await prisma.document.findUnique({
    where: { envelopeId },
    select: { applicationId: true, status: true },
  });
  const applicationId = String(document?.applicationId || '').trim();
  console.log(`group ${envelopeId}  status=${document?.status}  application=${applicationId}`);
  if (!applicationId) return;

  const contracts = await prisma.contract.findMany({
    where: { applicationId },
    orderBy: { updatedAt: 'desc' },
  });
  console.log(`\ncontract rows for this application: ${contracts.length}`);
  for (const contract of contracts) {
    console.log(`\n== contract id=${contract.id} updatedAt=${contract.updatedAt?.toISOString?.()}`);
    for (const key of [
      'legalName',
      'customerName',
      'doingBusinessAs',
      'federalTaxIdEin',
      'clientName',
      'clientEmail',
      'clientPhone',
      'businessAddress',
      'businessAddressCity',
      'businessAddressState',
      'businessAddressZip',
      'businessAddressContract',
      'purchasePrice',
      'purchaseAmount',
      'purchasePercent',
      'remittance',
      'appendixUnderwritingFees',
    ]) {
      const value = (contract as Record<string, unknown>)[key];
      console.log(`   ${key.padEnd(26)} = ${JSON.stringify(value ?? null)}`);
    }
    const overrides = contract.contractPrefillOverrides;
    const keys =
      overrides && typeof overrides === 'object' && !Array.isArray(overrides)
        ? Object.keys(overrides as Record<string, unknown>)
        : [];
    console.log(`   contractPrefillOverrides keys (${keys.length}): ${keys.slice(0, 40).join(', ')}`);
  }
}

main()
  .catch((e) => {
    console.error('FAIL:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
