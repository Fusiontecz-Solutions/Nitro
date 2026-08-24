/**
 * Align Nitro Advance DocuSign account profile with the working platform
 * demo JWT (.env). Fixes user_not_found caused by prod impersonation user + na4 base
 * on a demo integration key.
 *
 * Run: npx --yes tsx src/scripts/healHarborDocusignProfile.ts
 */
import 'dotenv/config';
import prisma from '../config/prismaClient';
import { getDocusignJwtSession } from '../services/docusign/utils/docusign-jwt';
import { getDocusignJwtSessionForProfile, clearDocusignProfileJwtCache } from '../services/docusign/utils/docusign-profile-jwt';

async function main() {
  const platformUserId = String(process.env.DOCUSIGN_IMPERSONATED_USER_ID || '').trim();
  const platformBaseUri = String(process.env.DOCUSIGN_BASE_URI || '').trim();
  const platformKey = String(
    process.env.DOCUSIGN_INTEGRATION_KEY || process.env.DOCUSIGN_CLIENT_ID || '',
  ).trim();
  const platformRsa = String(process.env.DOCUSIGN_RSA_PRIVATE_KEY || '').trim();

  if (!platformUserId || !platformBaseUri || !platformKey || !platformRsa) {
    throw new Error('Platform DocuSign JWT env vars are incomplete');
  }

  console.log('1) Resolve platform demo account GUID…');
  const session = await getDocusignJwtSession();
  console.log(`   accountId=${session.accountId} baseUri=${session.baseUri}`);

  const harbor = await prisma.docuSignAccountProfile.findFirst({
    where: {
      OR: [
        { name: { equals: 'NITRO ADVANCE', mode: 'insensitive' } },
        { name: { equals: 'HARBOR VIEW CAPITAL', mode: 'insensitive' } },
      ],
    },
  });
  if (!harbor) throw new Error('Nitro Advance / HARBOR VIEW CAPITAL DocuSign account profile not found');

  console.log('2) Before:', {
    id: harbor.id,
    impersonatedUserId: harbor.impersonatedUserId,
    accountId: harbor.accountId,
    baseUri: harbor.baseUri,
    integrationKeyPrefix: String(harbor.integrationKey || '').slice(0, 8),
  });

  const updated = await prisma.docuSignAccountProfile.update({
    where: { id: harbor.id },
    data: {
      integrationKey: platformKey,
      impersonatedUserId: platformUserId,
      accountId: session.accountId,
      baseUri: platformBaseUri.replace(/\/restapi\/?$/i, '') || 'https://demo.docusign.net',
      rsaPrivateKey: platformRsa,
      isActive: true,
    },
  });

  clearDocusignProfileJwtCache(String(updated.id));

  console.log('3) After:', {
    id: updated.id,
    impersonatedUserId: updated.impersonatedUserId,
    accountId: updated.accountId,
    baseUri: updated.baseUri,
    integrationKeyPrefix: String(updated.integrationKey || '').slice(0, 8),
  });

  console.log('4) Verify funder-profile JWT…');
  const profileSession = await getDocusignJwtSessionForProfile(String(updated.id), {
    integrationKey: updated.integrationKey,
    impersonatedUserId: updated.impersonatedUserId,
    rsaPrivateKey: String(updated.rsaPrivateKey || ''),
    accountId: updated.accountId,
    baseUri: updated.baseUri,
  });
  console.log(
    `   OK accountId=${profileSession.accountId} baseUri=${profileSession.baseUri}`,
  );
  console.log('\nNitro Advance DocuSign profile healed.');
}

main()
  .catch((e) => {
    console.error(e?.response?.data || e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
