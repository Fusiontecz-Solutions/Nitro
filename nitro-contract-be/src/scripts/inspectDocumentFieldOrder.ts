/**
 * READ-ONLY diagnostic: dump one live SignNow document's widgets in the order
 * the API returns them, with role, page and whether a value is on them. Used to
 * tell a partial prefill write apart from a partial widget copy.
 *
 *   npx ts-node --transpile-only src/scripts/inspectDocumentFieldOrder.ts <documentId>
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

async function main() {
  const documentId = process.argv[2] || '';
  if (!documentId) throw new Error('usage: inspectDocumentFieldOrder.ts <documentId>');
  const client = await createSignNowApiClient();
  const res = await client.get(`/document/${documentId}`, { validateStatus: () => true });
  const data = res.data?.data || res.data || {};
  console.log(
    `"${data.document_name || data.original_filename || ''}" pages=${data.page_count ?? data.pages?.length ?? '?'}`,
  );
  const fields: any[] = Array.isArray(data.fields) ? data.fields : [];
  console.log(`fields=${fields.length}  texts=${(data.texts || []).length}\n`);
  let index = 0;
  for (const f of fields) {
    const j = f.json_attributes || {};
    const name = String(j.name || f.field_name || f.name || '');
    const value = String(j.prefilled_text ?? f.prefilled_text ?? f.element?.data ?? '').trim();
    console.log(
      `${String(index).padStart(3)} ${value ? 'VALUE' : '     '} ` +
        `type=${String(f.type || '').padEnd(10)} role=${String(f.role || '').padEnd(12)} ` +
        `p=${String(j.page_number ?? f.page_number ?? '')} req=${f.required ?? j.required ?? ''} ` +
        `:: ${name}${value ? ` = ${value}` : ''}`,
    );
    index += 1;
  }
}

main()
  .catch((e) => {
    console.error('FAIL:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
