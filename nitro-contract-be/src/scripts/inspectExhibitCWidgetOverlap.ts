/**
 * READ-ONLY: print every Exhibit C widget with its page + rectangle, grouped by
 * page, so stacked widgets (two names on one line -> overlapping baked text)
 * are visible.
 *
 *   npx ts-node --transpile-only src/scripts/inspectExhibitCWidgetOverlap.ts
 */
import '../config/loadEnv';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import { signNowExhibitCTemplateId } from '../services/signnow/utils/signnow-addendum-templates';

const BUCKETS = ['fields', 'fillable_fields', 'texts', 'signatures', 'checks'] as const;

async function main() {
  const client = await createSignNowApiClient();
  const id = signNowExhibitCTemplateId();
  console.log('exhibit c template id:', id);
  const memberIds = new Set<string>();
  for (const path of [
    `/documentgroup/template/${id}`,
    `/v2/document-group-templates/${id}`,
  ]) {
    const r = await client.get(path, { validateStatus: () => true });
    if (r.status >= 400) continue;
    const row = r.data?.data || r.data || {};
    for (const bucket of [row.documents, row.template?.documents, row.document_group_template?.documents, row.templates, row.document_ids]) {
      for (const item of Array.isArray(bucket) ? bucket : []) {
        const did = typeof item === 'string' ? item : String(item?.id || item?.document_id || item?.unique_id || '').trim();
        if (did) memberIds.add(did);
      }
    }
  }
  if (!memberIds.size) memberIds.add(id);
  console.log('member documents:', [...memberIds].join(', '));
  for (const did of memberIds) {
    await dumpDoc(client, did);
  }
}

async function dumpDoc(client: any, did: string) {
  const res = await client.get(`/document/${did}`, { validateStatus: () => true });
  if (res.status >= 400) {
    console.log(`
== document ${did}: unreadable HTTP ${res.status}`);
    return;
  }
  const doc = res.data?.data || res.data;
  console.log(`
===== document ${did} "${doc?.document_name || ''}" =====`);
  console.log('document_name:', doc?.document_name, 'pages:', doc?.pages?.length);
  const rows: any[] = [];
  for (const bucket of BUCKETS) {
    for (const f of Array.isArray(doc?.[bucket]) ? doc[bucket] : []) {
      const a = f?.json_attributes || {};
      rows.push({
        bucket,
        name: a.name || f.name || f.field_name || a.label || f.label || '',
        type: f.type || a.type || '',
        role: f.role || f.signer || '',
        page: Number(a.page_number ?? f.page_number ?? 0),
        x: Number(a.x ?? f.x ?? 0),
        y: Number(a.y ?? f.y ?? 0),
        w: Number(a.width ?? f.width ?? 0),
        h: Number(a.height ?? f.height ?? 0),
        data: String(f.data || f.prefilled_text || '').slice(0, 40),
      });
    }
  }
  rows.sort((p, q) => p.page - q.page || p.y - q.y || p.x - q.x);
  for (const r of rows) {
    console.log(
      `p${r.page} y=${r.y} x=${r.x} w=${r.w} h=${r.h} [${r.bucket}/${r.type}] role=${r.role} ${r.name} ${r.data ? `data="${r.data}"` : ''}`,
    );
  }
  // Overlap report
  console.log('\n--- overlapping pairs ---');
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (a.page !== b.page) continue;
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) {
        console.log(`p${a.page}: ${a.name}(${a.bucket}) <-> ${b.name}(${b.bucket}) overlap ${ox}x${oy}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
