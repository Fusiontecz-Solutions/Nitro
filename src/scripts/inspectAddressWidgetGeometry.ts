/**
 * READ-ONLY: dump the geometry (x/y/w/h, font size) of every address-ish widget
 * on each funder's contract template, so baked-text wrapping can be calibrated.
 *
 *   npx ts-node --transpile-only src/scripts/inspectAddressWidgetGeometry.ts
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

type Client = Awaited<ReturnType<typeof createSignNowApiClient>>;

async function originDocumentIds(client: Client, templateId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const path of [
    `/documentgroup/template/${templateId}`,
    `/v2/document-group-templates/${templateId}`,
  ]) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const row = res.data?.data || res.data || {};
    for (const bucket of [row.documents, row.template?.documents, row.templates]) {
      for (const item of Array.isArray(bucket) ? bucket : []) {
        const id =
          typeof item === 'string' ? item : String(item?.id || item?.document_id || '').trim();
        if (id) ids.add(id);
      }
    }
  }
  if (!ids.size) ids.add(templateId);
  return [...ids];
}

async function main() {
  const funders = await prisma.funderProfile.findMany({
    select: { name: true, signnowContractTemplateLink: true },
  });
  const client = await createSignNowApiClient();
  for (const funder of funders) {
    if (!funder.signnowContractTemplateLink) continue;
    for (const docId of await originDocumentIds(client, funder.signnowContractTemplateLink)) {
      const res = await client.get(`/document/${docId}`, { validateStatus: () => true });
      if (res.status >= 400) continue;
      const data = res.data?.data || res.data || {};
      const rows = Array.isArray(data.fields) ? data.fields : [];
      console.log(`\n===== ${funder.name} :: ${data.document_name || data.name} =====`);
      for (const field of rows) {
        const ja = field?.json_attributes || {};
        const name = String(ja.name || field?.name || '').trim();
        if (!/address|city|state|zip/i.test(name)) continue;
        console.log(
          `  ${name} p${ja.page_number ?? field.page_number} x=${ja.x} y=${ja.y} w=${ja.width} h=${ja.height} size=${ja.size ?? ja.font_size ?? ''} font=${ja.font ?? ''} role=${field.role ?? ''}`,
        );
      }
    }
  }
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
