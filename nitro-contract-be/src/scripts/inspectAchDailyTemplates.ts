/**
 * READ-ONLY: dump the live widget inventory of every ACH Daily Addendum
 * template the CRM knows about (Nitro default, each funder profile's own row)
 * plus any template ids passed on the command line, then diff the widget names
 * so a new funder's ACH Daily can be mapped against the real names instead of
 * guessed ones.
 *
 *   npx ts-node --transpile-only src/scripts/inspectAchDailyTemplates.ts [templateId ...]
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import { signNowAchDailyTemplateId } from '../services/signnow/utils/signnow-addendum-templates';

type Client = Awaited<ReturnType<typeof createSignNowApiClient>>;

const FIELD_BUCKETS = ['fields', 'texts', 'signatures', 'checks', 'radiobuttons', 'enumerations'] as const;

function widgets(doc: any) {
  const out: any[] = [];
  for (const bucket of FIELD_BUCKETS) {
    for (const f of Array.isArray(doc?.[bucket]) ? doc[bucket] : []) {
      const j = f?.json_attributes || {};
      out.push({
        bucket,
        name: String(j.name || f.name || f.field_name || f.label || ''),
        type: f.type || j.type || '',
        role: f.role || f.role_name || '',
        required: f.required ?? j.required ?? '',
        page: j.page_number ?? f.page_number ?? '',
        x: j.x ?? '', y: j.y ?? '', w: j.width ?? '', h: j.height ?? '',
        prefilled_text: j.prefilled_text ?? f.prefilled_text ?? '',
      });
    }
  }
  return out.sort(
    (a, b) => Number(a.page) - Number(b.page) || Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x),
  );
}

async function originDocumentIds(client: Client, templateId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const path of [
    `/documentgroup/template/${templateId}`,
    `/v2/document-group-templates/${templateId}`,
  ]) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const row = res.data?.data || res.data || {};
    for (const bucket of [
      row.documents,
      row.template?.documents,
      row.document_group_template?.documents,
      row.templates,
      row.document_ids,
      row.template_ids,
    ]) {
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
  const targets: Array<[string, string]> = [];
  const push = (label: string, id?: string | null) => {
    const key = String(id || '').trim();
    if (key && !targets.some(([, t]) => t.toLowerCase() === key.toLowerCase())) targets.push([label, key]);
  };

  for (const id of process.argv.slice(2)) push(`ARG ${id}`, id);
  push('NITRO DEFAULT ACH DAILY', signNowAchDailyTemplateId());

  const funders = await prisma.funderProfile.findMany({
    select: { id: true, name: true, signnowAddendumTemplates: true },
  });
  for (const funder of funders) {
    for (const row of (funder.signnowAddendumTemplates as any[]) || []) {
      const name = String(row?.name || '');
      if (/ach/i.test(name) && /daily/i.test(name)) push(`${funder.name} :: ${name}`, row?.link);
    }
  }

  const client = await createSignNowApiClient();
  const collected = new Map<string, string[]>();

  for (const [label, templateId] of targets) {
    console.log(`\n===== ${label}  template=${templateId} =====`);
    const all: string[] = [];
    for (const id of await originDocumentIds(client, templateId)) {
      const res = await client.get(`/document/${id}`, { validateStatus: () => true });
      if (res.status >= 400) {
        console.log(`  document ${id}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
        continue;
      }
      const data = res.data?.data || res.data || {};
      const ws = widgets(data);
      console.log(
        `\n  -- document ${id}  "${data.document_name || data.original_filename || ''}"  pages=${data.page_count ?? (data.pages?.length ?? '?')}  ${ws.length} widget(s)`,
      );
      for (const w of ws) {
        console.log(
          `     p${w.page} [${w.bucket}/${w.type}] role=${w.role} req=${w.required} x=${w.x} y=${w.y} w=${w.w} h=${w.h} :: "${w.name}"${w.prefilled_text ? ` pre="${w.prefilled_text}"` : ''}`,
        );
        all.push(w.name);
      }
    }
    collected.set(label, [...new Set(all)].sort());
  }

  const labels = [...collected.keys()];
  for (let i = 1; i < labels.length; i += 1) {
    const a = collected.get(labels[0]) || [];
    const b = collected.get(labels[i]) || [];
    console.log(`\n===== DIFF  "${labels[0]}"  vs  "${labels[i]}" =====`);
    console.log(`  shared: ${a.filter((n) => b.includes(n)).length}`);
    console.log(`  only in "${labels[0]}" (${a.filter((n) => !b.includes(n)).length}): ${a.filter((n) => !b.includes(n)).join(', ')}`);
    console.log(`  only in "${labels[i]}" (${b.filter((n) => !a.includes(n)).length}): ${b.filter((n) => !a.includes(n)).join(', ')}`);
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
