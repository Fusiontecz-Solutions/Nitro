/**
 * READ-ONLY: dump the live widget inventory on the Nitro/Obsidian EPA Addendum
 * template and any other EPA template id passed on the command line, so a new
 * funder's EPA mapping can be built against the real widget names.
 *
 *   npx ts-node --transpile-only src/scripts/inspectEpaTemplates.ts [templateId ...]
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import { signNowEpaTemplateId } from '../services/signnow/utils/signnow-addendum-templates';

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
  const args = process.argv.slice(2).filter(Boolean);
  const targets: Array<[string, string]> = [['NITRO/OBSIDIAN EPA', signNowEpaTemplateId()]];
  for (const id of args) targets.push([`ARG ${id}`, id]);

  const client = await createSignNowApiClient();
  for (const [label, templateId] of targets) {
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
