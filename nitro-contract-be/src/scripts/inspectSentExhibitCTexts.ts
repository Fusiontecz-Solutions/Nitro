/** READ-ONLY: dump fields + texts (with coordinates) of Exhibit C documents in the newest sent group. */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

async function main() {
  const docs = await prisma.document.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 5,
    select: { envelopeId: true, status: true, sentAt: true, updatedAt: true, applicationId: true },
  });
  console.log(docs.map((d) => `${d.envelopeId} ${d.status} sent=${d.sentAt} upd=${d.updatedAt}`).join('\n'));
  const client = await createSignNowApiClient();
  for (const d of docs.slice(0, 2)) {
    const g = await client.get(`/documentgroup/${d.envelopeId}`, { validateStatus: () => true });
    if (g.status >= 400) { console.log('group fail', d.envelopeId, g.status); continue; }
    const members = (g.data?.documents || []) as any[];
    console.log(`\n##### group ${d.envelopeId} (${members.length} docs)`);
    for (const m of members) {
      const name = String(m?.document_name || m?.name || '');
      if (!/exhibit/i.test(name)) continue;
      const r = await client.get(`/document/${m.id}`, { validateStatus: () => true });
      if (r.status >= 400) { console.log('doc fail', m.id, r.status); continue; }
      const doc = r.data?.data || r.data;
      console.log(`\n=== "${name}" ${m.id}`);
      for (const bucket of ['fields', 'fillable_fields', 'texts'] as const) {
        for (const f of Array.isArray(doc?.[bucket]) ? doc[bucket] : []) {
          const a = f?.json_attributes || {};
          console.log(
            `  [${bucket}] p${a.page_number ?? f.page_number} y=${a.y ?? f.y} x=${a.x ?? f.x} ` +
              `name=${a.name || f.name || f.field_name || '(none)'} role=${f.role || ''} ` +
              `data="${String(f.data || a.data || '').slice(0, 45)}" pre="${String(f.prefilled_text || a.prefilled_text || '').slice(0, 45)}"`,
          );
        }
      }
    }
  }
}

main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect().catch(() => undefined));
