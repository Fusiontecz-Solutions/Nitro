/**
 * READ-ONLY: dump the live widget inventory (name, page, box, role, type) on
 * every document inside the Tiberian Funding SignNow contract template, so the
 * field map can be built against the real template instead of guessing.
 *
 *   npx ts-node --transpile-only src/scripts/inspectTiberianTemplates.ts [templateId]
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

type Client = Awaited<ReturnType<typeof createSignNowApiClient>>;

const FIELD_BUCKETS = ['fields', 'texts', 'signatures', 'checks', 'radiobuttons', 'enumerations', 'attachments'] as const;

function widgets(doc: any) {
  const out: any[] = [];
  for (const bucket of FIELD_BUCKETS) {
    for (const f of Array.isArray(doc?.[bucket]) ? doc[bucket] : []) {
      const j = f?.json_attributes || {};
      out.push({
        bucket,
        name: j.name || f.name || f.field_name || f.label || '',
        label: j.label || f.label || '',
        prefilled_text: j.prefilled_text ?? f.prefilled_text ?? '',
        type: f.type || j.type || '',
        role: f.role || f.role_name || '',
        required: f.required ?? j.required ?? '',
        page: j.page_number ?? f.page_number ?? '',
        x: j.x ?? '', y: j.y ?? '', w: j.width ?? '', h: j.height ?? '',
      });
    }
  }
  return out.sort((a, b) => (Number(a.page) - Number(b.page)) || (Number(a.y) - Number(b.y)) || (Number(a.x) - Number(b.x)));
}

async function originDocumentIds(client: Client, templateId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const path of [`/documentgroup/template/${templateId}`, `/v2/document-group-templates/${templateId}`]) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const row = res.data?.data || res.data || {};
    console.log(`  [${path}] group name: ${row.name || row.template_name || row.document_group_template?.name || ''}`);
    for (const bucket of [row.documents, row.template?.documents, row.document_group_template?.documents, row.templates, row.document_ids, row.template_ids]) {
      for (const item of Array.isArray(bucket) ? bucket : []) {
        const id = typeof item === 'string' ? item : String(item?.id || item?.document_id || item?.unique_id || '').trim();
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
  }
  if (!ids.length) ids.push(templateId);
  return ids;
}

async function main() {
  const argId = process.argv[2];
  const funder = await prisma.funderProfile.findFirst({
    where: { name: { contains: 'tiberian', mode: 'insensitive' } },
    select: { id: true, name: true, signnowContractTemplateLink: true, signnowAddendumTemplates: true, signnowDisclosureTemplates: true },
  });
  console.log('FunderProfile:', JSON.stringify(funder, null, 2));

  const targets: Array<[string, string]> = [];
  if (argId) targets.push(['ARG', argId]);
  if (funder?.signnowContractTemplateLink) targets.push(['CONTRACT', funder.signnowContractTemplateLink]);
  for (const row of (funder?.signnowAddendumTemplates as any[]) || []) if (row?.link) targets.push([`ADDENDUM: ${row.name}`, row.link]);
  for (const row of (funder?.signnowDisclosureTemplates as any[]) || []) if (row?.link) targets.push([`DISCLOSURE: ${row.name}`, row.link]);

  const seen = new Set<string>();
  const client = await createSignNowApiClient();
  for (const [label, templateId] of targets) {
    if (seen.has(templateId)) continue;
    seen.add(templateId);
    console.log(`\n===== ${label}  template=${templateId} =====`);
    for (const id of await originDocumentIds(client, templateId)) {
      const res = await client.get(`/document/${id}`, { validateStatus: () => true });
      if (res.status >= 400) { console.log(`  document ${id}: HTTP ${res.status}`); continue; }
      const data = res.data?.data || res.data || {};
      const ws = widgets(data);
      console.log(`\n  -- document ${id}  "${data.document_name || data.original_filename || ''}"  pages=${data.page_count ?? (data.pages?.length ?? '?')}  ${ws.length} widget(s)`);
      for (const w of ws) {
        console.log(`     p${w.page} [${w.bucket}/${w.type}] role=${w.role} req=${w.required} x=${w.x} y=${w.y} w=${w.w} h=${w.h} :: "${w.name}"${w.label ? ` label="${w.label}"` : ''}${w.prefilled_text ? ` pre="${w.prefilled_text}"` : ''}`);
      }
    }
  }
}

main().catch((e) => { console.error('FAIL:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
