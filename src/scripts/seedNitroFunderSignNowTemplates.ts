/**
 * Seeds / updates the Nitro Advance funder profile with the current hardcoded
 * SignNow contract + addendum + disclosure template ids.
 *
 * Usage: npx ts-node src/scripts/seedNitroFunderSignNowTemplates.ts
 */
import 'dotenv/config';
import prisma from '../config/prismaClient';
import {
  getSignNowAddendumTemplates,
  getSignNowDisclosureTemplates,
} from '../services/signnow/utils/signnow-addendum-templates';
import { SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID } from '../services/signnow/utils/signnow-client';
import { isWoodmereFinancialFunderName } from '../utils/funderDocumentSource';

async function main() {
  const contractLink = String(
    process.env.SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID ||
      SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID ||
      '',
  ).trim();

  if (!contractLink) {
    throw new Error(
      'SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID is missing — cannot seed main contract link.',
    );
  }

  const addendums = getSignNowAddendumTemplates().map((row) => ({
    name: row.name,
    link: row.templateId,
  }));
  const disclosures = getSignNowDisclosureTemplates().map((row) => ({
    name: row.name,
    link: row.templateId,
  }));

  const existing = await prisma.funderProfile.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  const nitro =
    existing.find((row) => isWoodmereFinancialFunderName(row.name, row.displayName)) ||
    existing.find((row) => /nitro\s*advance/i.test(String(row.name || ''))) ||
    null;

  const data = {
    signnowContractTemplateLink: contractLink,
    signnowAddendumTemplates: addendums,
    signnowDisclosureTemplates: disclosures,
    documentsSource: 'own',
    addendumDocumentsSource: 'own',
    disclosureDocumentsSource: 'own',
  };

  if (nitro) {
    const updated = await prisma.funderProfile.update({
      where: { id: nitro.id },
      data,
    });
    console.log('[seed] Updated Nitro funder SignNow templates', {
      id: updated.id,
      name: updated.name,
      contractLink,
      addendums: addendums.length,
      disclosures: disclosures.length,
    });
    return;
  }

  const created = await prisma.funderProfile.create({
    data: {
      name: 'Nitro Advance',
      displayName: 'Nitro Advance',
      assignsDealId: true,
      mainContractLayoutKey: 'contract',
      contractPdfFileName: 'Contract.pdf',
      sortOrder: 1,
      isActive: true,
      ...data,
    },
  });
  console.log('[seed] Created Nitro Advance funder with SignNow templates', {
    id: created.id,
    contractLink,
    addendums: addendums.length,
    disclosures: disclosures.length,
  });
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
