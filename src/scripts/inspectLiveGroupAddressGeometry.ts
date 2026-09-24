/**
 * READ-ONLY: dump the address widgets and baked address stamps of a live
 * document group, to compare what was published against the template box.
 *
 *   npx ts-node --transpile-only src/scripts/inspectLiveGroupAddressGeometry.ts <group-id-prefix>
 */
import '../config/loadEnv';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

async function main() {
  const prefix = String(process.argv[2] || '').trim();
  if (!prefix) throw new Error('Pass a document group id (or prefix).');
  const client = await createSignNowApiClient();
  let groupId = prefix;
  if (prefix.length < 32) {
    const res = await client.get('/user/documentgroups', {
      params: { limit: 100, offset: 0 },
      validateStatus: () => true,
    });
    const groups = res.data?.document_groups || res.data?.data || [];
    const hit = (Array.isArray(groups) ? groups : []).find((g: any) =>
      String(g?.id || g?.unique_id || '').startsWith(prefix),
    );
    if (!hit) throw new Error(`No group found starting with ${prefix}`);
    groupId = String(hit.id || hit.unique_id);
    console.log(`matched group ${groupId} :: ${hit.group_name || ''}`);
  }
  const res = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
  const docs = res.data?.documents || res.data?.data?.documents || [];
  for (const doc of Array.isArray(docs) ? docs : []) {
    const docId = String(doc?.id || doc?.document_id || '');
    const detail = await client.get(`/document/${docId}`, { validateStatus: () => true });
    const data = detail.data?.data || detail.data || {};
    console.log(`\n===== ${data.document_name || data.name} (${docId}) =====`);
    for (const field of Array.isArray(data.fields) ? data.fields : []) {
      const ja = field?.json_attributes || {};
      const name = String(ja.name || field?.name || '').trim();
      if (!/address/i.test(name)) continue;
      console.log(
        `  FIELD ${name} p${ja.page_number ?? field.page_number} x=${ja.x} y=${ja.y} w=${ja.width} h=${ja.height} size=${ja.size ?? ja.font_size} font=${ja.font} role=${field.role} value=${JSON.stringify(ja.prefilled_text ?? field.prefilled_text ?? '')}`,
      );
    }
    for (const text of Array.isArray(data.texts) ? data.texts : []) {
      if (!/\d{2,}|street|road|pkwy|ave/i.test(String(text?.data || ''))) continue;
      console.log(
        `  TEXT  p${text.page_number} x=${text.x} y=${text.y} size=${text.size} font=${text.font} data=${JSON.stringify(text.data)}`,
      );
    }
  }
}

main().catch((err) => {
  console.error('FAIL:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
