/**
 * READ-ONLY diagnostic: for a recently sent SignNow document group, print each
 * document and how much of it actually carries a value — widget `prefilled_text`
 * / `data`, plus committed page `texts`. Used to tell "the mapping resolved
 * nothing" from "the prefill never reached this document".
 *
 *   npx ts-node --transpile-only src/scripts/inspectSentGroupFill.ts [envelopeId]
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

async function main() {
  let envelopeId = process.argv[2] || '';
  if (!envelopeId) {
    const rows = await prisma.document.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: { envelopeId: true, status: true, updatedAt: true, applicationId: true },
    });
    console.log('recent documents:');
    for (const r of rows) console.log(' ', r.updatedAt.toISOString(), r.status, r.envelopeId);
    envelopeId = rows[0]?.envelopeId || '';
  }
  if (!envelopeId) throw new Error('no envelope');
  const client = await createSignNowApiClient();
  const g = await client.get(`/documentgroup/${envelopeId}`, { validateStatus: () => true });
  if (g.status >= 400) throw new Error(`group ${g.status}: ${JSON.stringify(g.data).slice(0, 300)}`);
  const docs: any[] = g.data?.documents || g.data?.data?.documents || [];
  console.log(`\ngroup ${envelopeId} — ${docs.length} documents`);
  for (const d of docs) {
    const id = String(d.id || d.document_id || '');
    const res = await client.get(`/document/${id}`, { validateStatus: () => true });
    const data = res.data?.data || res.data || {};
    const name = String(data.document_name || data.original_filename || d.document_name || '');
    const fields: any[] = Array.isArray(data.fields) ? data.fields : [];
    const texts: any[] = Array.isArray(data.texts) ? data.texts : [];
    let filled = 0;
    const empties: string[] = [];
    for (const f of fields) {
      const j = f.json_attributes || {};
      const fname = String(j.name || f.field_name || f.name || '');
      const v = String(j.prefilled_text ?? f.prefilled_text ?? f.element?.data ?? '').trim();
      if (v) filled += 1;
      else if (fname) empties.push(fname);
    }
    console.log(
      `\n  "${name}" (${id})\n    fields=${fields.length} withValue=${filled} committedTexts=${texts.length}`,
    );
    if (empties.length) console.log('    empty:', empties.slice(0, 40).join(', '));
    if (texts.length) {
      console.log('    texts:', texts.slice(0, 12).map((t: any) => String(t.data ?? '').slice(0, 24)).join(' | '));
    }
  }
}

main()
  .catch((e) => {
    console.error('FAIL:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
