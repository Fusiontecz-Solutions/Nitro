import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

const ORIGIN = '9de2ff9d104443cbbc23a3c24449c76fb88b87cb';

async function dump(client: any, id: string, label: string) {
  const r = await client.get(`/document/${id}`, { validateStatus: () => true });
  const doc = r.data?.data || r.data;
  const texts = (doc?.texts || []) as any[];
  console.log(`\n-- ${label}: ${texts.length} texts`);
  for (const t of texts) console.log(`   id=${t.id} p${t.page_number} y=${t.y} x=${t.x} data="${t.data}"`);
  return texts;
}

async function main() {
  const client = await createSignNowApiClient();
  let copy = await client.post(`/template/${ORIGIN}/copy`, { document_name: 'ZZ probe delete me' }, { validateStatus: () => true });
  if (copy.status >= 400) copy = await client.post(`/document/${ORIGIN}/copy`, { document_name: 'ZZ probe delete me' }, { validateStatus: () => true });
  const id = String(copy.data?.id || copy.data?.data?.id || '');
  console.log('copy status', copy.status, 'id', id);
  if (!id) { console.log(JSON.stringify(copy.data).slice(0, 400)); return; }
  try {
    const mk = (data: string) => ([{ data, x: 197, y: 338, page_number: 0, font: 'Times New Roman', size: 10, color: '000000' }]);
    let res = await client.put(`/document/${id}`, { client_timestamp: Math.floor(Date.now() / 1000), fields: [], texts: mk('FIRST VALUE') }, { validateStatus: () => true });
    console.log('put1', res.status);
    const t1 = await dump(client, id, 'after put1 (no id)');

    res = await client.put(`/document/${id}`, { client_timestamp: Math.floor(Date.now() / 1000), fields: [], texts: mk('SECOND VALUE') }, { validateStatus: () => true });
    console.log('put2 (no id)', res.status);
    await dump(client, id, 'after put2 (no id)');

    // Now try reusing the existing element id
    const existing = await dump(client, id, 'before put3');
    const withIds = existing.map((t: any, i: number) => ({ ...t, data: `THIRD ${i}` }));
    res = await client.put(`/document/${id}`, { client_timestamp: Math.floor(Date.now() / 1000), fields: [], texts: withIds }, { validateStatus: () => true });
    console.log('put3 (with ids)', res.status, res.status >= 400 ? JSON.stringify(res.data).slice(0, 200) : '');
    await dump(client, id, 'after put3 (with ids)');

    // Try clearing with empty texts array
    res = await client.put(`/document/${id}`, { client_timestamp: Math.floor(Date.now() / 1000), fields: [], texts: [] }, { validateStatus: () => true });
    console.log('put4 (texts: [])', res.status);
    await dump(client, id, 'after put4 (empty texts)');

    // Try deleting one text element directly
    const left = await dump(client, id, 'before delete probe');
    if (left[0]?.id) {
      for (const path of [`/text/${left[0].id}`, `/document/${id}/text/${left[0].id}`, `/v2/documents/${id}/texts/${left[0].id}`]) {
        const d = await client.delete(path, { validateStatus: () => true });
        console.log('delete', path, d.status, d.status >= 400 ? JSON.stringify(d.data).slice(0, 160) : '');
        if (d.status < 400) break;
      }
      await dump(client, id, 'after delete probe');
    }
  } finally {
    const del = await client.delete(`/document/${id}`, { validateStatus: () => true });
    console.log('\ncleanup delete probe doc', del.status);
  }
}

main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => undefined));
