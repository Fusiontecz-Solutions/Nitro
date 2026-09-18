/**
 * READ-ONLY: dump the live widget names on every Obsidian Capital Group
 * SignNow template (contract, addendums, disclosure) as stored on its
 * FunderProfile row, so the field map can be verified/corrected against the
 * real templates instead of guessing.
 *
 *   npx ts-node --transpile-only src/scripts/inspectObsidianTemplates.ts
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

type Client = Awaited<ReturnType<typeof createSignNowApiClient>>;

const FIELD_BUCKETS = ['fields', 'texts', 'signatures', 'checks', 'radiobuttons'] as const;

function widgetNames(doc: any): string[] {
  const out: string[] = [];
  for (const bucket of FIELD_BUCKETS) {
    for (const field of Array.isArray(doc?.[bucket]) ? doc[bucket] : []) {
      const name =
        field?.json_attributes?.name || field?.name || field?.field_name || field?.label;
      if (name) out.push(String(name));
    }
  }
  return out;
}

async function originDocumentIds(client: Client, templateId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const path of [
    `/documentgroup/template/${templateId}`,
    `/v2/document-group-templates/${templateId}`,
  ]) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const row = res.data?.data || res.data || {};
    const buckets = [
      row.documents,
      row.template?.documents,
      row.document_group_template?.documents,
      row.templates,
      row.document_ids,
      row.template_ids,
    ];
    for (const bucket of buckets) {
      for (const item of Array.isArray(bucket) ? bucket : []) {
        const id =
          typeof item === 'string'
            ? item
            : String(item?.id || item?.document_id || item?.unique_id || '').trim();
        if (id) ids.add(id);
      }
    }
  }
  if (!ids.size) ids.add(templateId);
  return [...ids];
}

async function inspect(client: Client, templateId: string) {
  const docs: Array<{ id: string; name: string; widgets: string[] }> = [];
  for (const id of await originDocumentIds(client, templateId)) {
    const res = await client.get(`/document/${id}`, { validateStatus: () => true });
    if (res.status >= 400) {
      // Not a group template — try it directly as a single-document template id.
      docs.push({ id, name: `(unreadable via /document: HTTP ${res.status})`, widgets: [] });
      continue;
    }
    const data = res.data?.data || res.data || {};
    docs.push({
      id,
      name: String(data.document_name || data.name || data.original_filename || ''),
      widgets: widgetNames(data),
    });
  }
  return docs;
}

async function main() {
  const funder = await prisma.funderProfile.findFirst({
    where: { name: { contains: 'obsidian', mode: 'insensitive' } },
    select: {
      id: true,
      name: true,
      signnowContractTemplateLink: true,
      signnowAddendumTemplates: true,
      signnowDisclosureTemplates: true,
    },
  });
  if (!funder) throw new Error('No Obsidian FunderProfile found.');

  const client = await createSignNowApiClient();
  const targets: Array<[string, string]> = [];
  if (funder.signnowContractTemplateLink) {
    targets.push(['CONTRACT', funder.signnowContractTemplateLink]);
  }
  for (const row of (funder.signnowAddendumTemplates as any[]) || []) {
    if (row?.link) targets.push([`ADDENDUM: ${row.name}`, row.link]);
  }
  for (const row of (funder.signnowDisclosureTemplates as any[]) || []) {
    if (row?.link) targets.push([`DISCLOSURE: ${row.name}`, row.link]);
  }

  for (const [label, templateId] of targets) {
    console.log('');
    console.log(`===== ${label}  template=${templateId} =====`);
    const docs = await inspect(client, templateId);
    for (const doc of docs) {
      console.log(`  document ${doc.id}  "${doc.name}"  ${doc.widgets.length} widget(s)`);
      for (const name of doc.widgets) console.log(`     ${name}`);
    }
  }
}

main()
  .catch((err) => {
    console.error('');
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
