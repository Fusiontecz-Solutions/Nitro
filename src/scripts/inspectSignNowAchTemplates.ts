/**
 * READ-ONLY SignNow inspection: what widgets do the ACH Daily, ACH Weekly and
 * Exhibit C templates actually carry?
 *
 *   npx ts-node --transpile-only src/scripts/inspectSignNowAchTemplates.ts
 *
 * Creates nothing and sends nothing — it only GETs templates, so it is safe to
 * run against production credentials and does not touch the daily copy limit.
 * Use it to confirm that ACH Daily really needs the Exhibit C `*_p1` widget
 * names before changing the ACH Daily field map.
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

async function inspect(client: Client, templateId: string) {
  const paths = [
    `/document/${templateId}`,
    `/documentgroup/${templateId}`,
    `/v2/document-group-templates/${templateId}`,
  ];
  for (const path of paths) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const data = res.data?.data || res.data || {};
    const docs = Array.isArray(data.documents) ? data.documents : [data];
    const names: string[] = [];
    for (const doc of docs) names.push(...widgetNames(doc));
    return {
      path,
      documentName: String(data.document_name || data.name || data.template_name || ''),
      documentCount: docs.length,
      widgets: [...new Set(names)].sort(),
    };
  }
  return null;
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
    console.log(`\n===== ${label}  id=${templateId} =====`);
    const info = await inspect(client, templateId);
    if (!info) {
      console.log('  not readable with these credentials');
      continue;
    }
    collected.set(label, info.widgets);
    console.log(`  resolved via ${info.path}`);
    console.log(`  name: "${info.documentName}"  documents: ${info.documentCount}`);
    console.log(`  ${info.widgets.length} widget(s):`);
    for (const name of info.widgets) console.log(`    ${name}`);
  }

  const daily = collected.get('ACH DAILY');
  const exhibitC = collected.get('EXHIBIT C');
  if (daily && exhibitC) {
    const shared = daily.filter((name) => exhibitC.includes(name));
    const dailyOnly = daily.filter((name) => !exhibitC.includes(name));
    console.log('\n===== ACH DAILY vs EXHIBIT C =====');
    console.log(`  shared widget names: ${shared.length}`);
    console.log(`  ACH Daily-only widget names: ${dailyOnly.length}`);
    if (dailyOnly.length) console.log(`    ${dailyOnly.join(', ')}`);
    console.log(
      shared.length === daily.length
        ? '  => ACH Daily reuses the Exhibit C widget NAMES. Keep the field map; the\n' +
            '     fix belongs in which DATA fills them, not in renaming widgets.'
        : '  => ACH Daily has widget names of its own. It needs its own field map.',
    );
  }
}

main()
  .catch((err) => {
    console.error('\nFAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
