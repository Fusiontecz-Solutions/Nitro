/**
 * READ-ONLY: dump the live widget inventory for the Flex Addendum, PayOff
 * Addendum (Refi) and Exhibit A templates (plus any template id passed on the
 * command line) so their prefill mappings can be built against real names.
 *
 *   npx ts-node --transpile-only src/scripts/inspectAddendumWidgets.ts [templateId ...]
 */
import '../config/loadEnv';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import {
  signNowFlexAddendumTemplateId,
  signNowPayoffAddendumTemplateId,
  signNowExhibitATemplateId,
} from '../services/signnow/utils/signnow-addendum-templates';

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
        prefilled: j.prefilled_text ?? f.prefilled_text ?? '',
        type: f.type || j.type || '',
        role: f.role || f.role_name || '',
        page: j.page_number ?? f.page_number ?? '',
        y: j.y ?? '',
        x: j.x ?? '',
      });
    }
  }
  return out.sort(
    (a, b) =>
      Number(a.page) - Number(b.page) || Number(a.y) - Number(b.y) || Number(a.x) - Number(b.x),
  );
}

async function documentIdsForTemplate(client: Client, templateId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const path of [`/documentgroup/template/${templateId}`, `/v2/document-group-templates/${templateId}`]) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const row = res.data?.data || res.data || {};
    for (const bucket of [row.documents, row.template?.documents, row.document_group_template?.documents, row.templates]) {
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
  const client = await createSignNowApiClient();
  const targets: Array<[string, string]> = [
    ['FLEX ADDENDUM', signNowFlexAddendumTemplateId()],
    ['PAYOFF ADDENDUM (REFI)', signNowPayoffAddendumTemplateId()],
    ['EXHIBIT A', signNowExhibitATemplateId()],
  ];
  for (const id of process.argv.slice(2).filter(Boolean)) targets.push([`ARG ${id}`, id]);

  for (const [label, templateId] of targets) {
    console.log(`\n================ ${label} :: ${templateId} ================`);
    const ids = await documentIdsForTemplate(client, templateId);
    for (const docId of ids) {
      const res = await client.get(`/document/${docId}`, { validateStatus: () => true });
      if (res.status >= 400) {
        console.log(`  [${docId}] HTTP ${res.status} ${JSON.stringify(res.data).slice(0, 200)}`);
        continue;
      }
      const doc = res.data;
      console.log(`  --- document ${docId} :: "${doc?.document_name || doc?.name || ''}" (${(doc?.pages || []).length} pages)`);
      for (const w of widgets(doc)) {
        console.log(
          `    p${w.page} y=${w.y} ${w.bucket}/${w.type} name="${w.name}" role="${w.role}" prefilled="${String(w.prefilled).slice(0, 40)}"`,
        );
      }
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
