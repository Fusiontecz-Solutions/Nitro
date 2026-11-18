import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

const ORIGIN = '9de2ff9d104443cbbc23a3c24449c76fb88b87cb';

async function texts(client: any, id: string, label: string) {
  const r = await client.get(`/document/${id}`, { validateStatus: () => true });
  const doc = r.data?.data || r.data;
  const t = (doc?.texts || []) as any[];
  console.log(`-- ${label}: ${t.length}`, t.map((x) => `${x.data}@${x.y}`).join(' | '));
  return t;
}

async function main() {
  const client = await createSignNowApiClient();
  const copy = await client.post(`/template/${ORIGIN}/copy`, { document_name: 'ZZ probe2 delete me' }, { validateStatus: () => true });
  const id = String(copy.data?.id || '');
  console.log('copy', copy.status, id);
  if (!id) return;
  try {
    const t = (data: string, y: number) => ({ data, x: 197, y, page_number: 0, font: 'Times New Roman', size: 10, color: '000000' });
    await client.put(`/document/${id}`, { client_timestamp: Math.floor(Date.now() / 1000), fields: [], texts: [t('A', 100), t('B', 200), t('C', 300)] }, { validateStatus: () => true });
    const all = await texts(client, id, 'seeded');
    const one = all.find((x: any) => x.data === 'B');
    const d = await client.delete(`/document/${id}/text/${one.id}`, { validateStatus: () => true });
    console.log('delete B ->', d.status, JSON.stringify(d.data).slice(0, 120));
    await texts(client, id, 'after delete B');
  } finally {
    console.log('cleanup', (await client.delete(`/document/${id}`, { validateStatus: () => true })).status);
  }
}
main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => undefined));
