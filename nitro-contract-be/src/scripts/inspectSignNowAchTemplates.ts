/**
 * READ-ONLY SignNow inspection: the real widget names on the ACH Daily,
 * ACH Weekly and Exhibit C templates.
 *
 *   npx ts-node --transpile-only src/scripts/inspectSignNowAchTemplates.ts
 *
 * Creates nothing and sends nothing — it only GETs, so it is safe against
 * production credentials and does not touch the daily document limit.
 *
 * The ids in this CRM are document-GROUP-TEMPLATE ids, so each one is resolved
 * to its member documents first (GET /document/{groupTemplateId} returns
 * "internal api error", which is what makes this look like an auth failure).
 *
 * Use the output to confirm which widgets actually exist before editing any
 * field map: a widget printed here that is absent from ACH_WEEKLY.ts FIELD_DEFS
 * is being filled by alias fallback in signnow-field-map.ts, which is how a date
 * or an amount can land in the Printed Name / Date boxes.
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import {
  signNowAchDailyTemplateId,
  signNowAchWeeklyTemplateId,
  signNowExhibitCTemplateId,
} from '../services/signnow/utils/signnow-addendum-templates';

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
      docs.push({ id, name: `(unreadable: HTTP ${res.status})`, widgets: [] });
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
  const client = await createSignNowApiClient();
  const targets: Array<[string, string]> = [
    ['ACH DAILY', signNowAchDailyTemplateId()],
    ['ACH WEEKLY', signNowAchWeeklyTemplateId()],
    ['EXHIBIT C', signNowExhibitCTemplateId()],
  ];

  const collected = new Map<string, string[]>();
  for (const [label, templateId] of targets) {
    console.log('');
    console.log(`===== ${label}  group-template=${templateId} =====`);
    const docs = await inspect(client, templateId);
    const all: string[] = [];
    for (const doc of docs) {
      console.log(`  document ${doc.id}  "${doc.name}"  ${doc.widgets.length} widget(s)`);
      for (const name of doc.widgets) console.log(`     ${name}`);
      all.push(...doc.widgets);
    }
    collected.set(label, [...new Set(all)].sort());
  }

  const daily = collected.get('ACH DAILY') || [];
  const weekly = collected.get('ACH WEEKLY') || [];
  const exhibitC = collected.get('EXHIBIT C') || [];

  if (daily.length && exhibitC.length) {
    const shared = daily.filter((n) => exhibitC.includes(n));
    const dailyOnly = daily.filter((n) => !exhibitC.includes(n));
    console.log('');
    console.log('===== ACH DAILY vs EXHIBIT C =====');
    console.log(`  shared widget names: ${shared.length}`);
    console.log(`  ACH Daily-only widget names: ${dailyOnly.length}`);
    if (dailyOnly.length) console.log(`    ${dailyOnly.join(', ')}`);
  }

  if (weekly.length) {
    console.log('');
    console.log('===== ACH WEEKLY bottom-section widgets =====');
    for (const name of weekly.filter((n) => /print|name|date|title|signature|amount|remit/i.test(n))) {
      console.log(`  ${name}`);
    }
    console.log('');
    console.log('  Compare against FIELD_DEFS in');
    console.log('  nitro-contract-fe/src/components/application/contractdata/ACH_WEEKLY.ts');
    console.log('  A widget above that is NOT in FIELD_DEFS is filled by alias fallback');
    console.log('  in signnow-field-map.ts — that is how a date or amount reaches the');
    console.log('  Printed Name / Date boxes.');
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
