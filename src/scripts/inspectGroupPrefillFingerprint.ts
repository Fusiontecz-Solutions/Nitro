/**
 * READ-ONLY diagnostic: compare the prefill fingerprint stored against a SignNow
 * group with the fingerprint each candidate prefill map would produce, so the
 * values Review actually published can be identified after the fact.
 *
 *   npx ts-node --transpile-only src/scripts/inspectGroupPrefillFingerprint.ts <envelopeId>
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { signNowService } from '../services/signnow/signnow.service';
import { loadOfferDerivedValuesForContract } from '../services/contractOfferValueSync';
import { buildOfferPrefillOverrides } from '../services/signnow/utils/signnow-offer-values';

async function main() {
  const envelopeId = process.argv[2] || '';
  const row = await prisma.document.findUnique({
    where: { envelopeId },
    select: {
      envelopeId: true,
      status: true,
      applicationId: true,
      prefillFingerprint: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  console.log('document row:', JSON.stringify(row, null, 2));
  if (!row?.applicationId) return;

  const values: Record<string, string> = {};
  const { defaults } = await (signNowService as any).loadContractPrefillDefaults(
    '',
    row.applicationId,
  );
  Object.assign(values, defaults);
  const liveOffer = await loadOfferDerivedValuesForContract({ applicationId: row.applicationId });
  Object.assign(values, buildOfferPrefillOverrides(liveOffer, values));
  console.log(`\nserver-side prefill map today: ${Object.keys(values).length} keys`);
  console.log(Object.keys(values).sort().join(', '));
}

main()
  .catch((e) => {
    console.error('FAIL:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
