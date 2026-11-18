/**
 * READ-ONLY, exactly 2 SignNow GETs: the document group, then ONE document.
 * Shows how SignNow stores a value the Owner typed in Review before Finish.
 *
 *   npx ts-node --transpile-only src/scripts/_tmpInspectReviewEdit.ts <applicationId> [documentNameMatch]
 */
import '../config/loadEnv';
import fs from 'fs';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

const OUT_DIR =
  'C:/Users/HP/AppData/Local/Temp/claude/d--Nitro-Contract-CRM-nitro-contract-be/300b148c-659d-46bf-86a2-53f36708bce1/scratchpad';

async function main() {
  const applicationId = String(process.argv[2] || '').trim();
  const match = new RegExp(process.argv[3] || 'agreement|contract', 'i');
  if (!applicationId) throw new Error('applicationId required');
  const row = await prisma.document.findFirst({
    where: { applicationId },
    select: { envelopeId: true, status: true, sentAt: true },
  });
  const groupId = String(row?.envelopeId || '').trim();
  console.log('document row', row);
  if (!groupId) return;

  const client = await createSignNowApiClient();
  const group = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
  const docs: any[] = group.data?.documents || [];
  console.log('group', group.status, docs.map((d) => d.document_name || d.name));
  const doc = docs.find((d) => match.test(String(d.document_name || d.name || ''))) || docs[0];
  if (!doc) return;

  const res = await client.get(`/document/${doc.id}`, { validateStatus: () => true });
  const data = res.data || {};
  fs.writeFileSync(`${OUT_DIR}/review-edit-${doc.id}.json`, JSON.stringify(data, null, 1));
  console.log('document', res.status, data.document_name, 'saved full JSON');

  const MONEY = /\d[\d,]*\.\d{2}/;
  for (const container of ['fields', 'fillable_fields']) {
    for (const f of Array.isArray(data[container]) ? data[container] : []) {
      const j = typeof f.json_attributes === 'string' ? JSON.parse(f.json_attributes) : f.json_attributes || {};
      const vals = [j.prefilled_text, j.data, f.data, f.prefilled_text].map((v) => String(v ?? ''));
      if (!vals.some((v) => MONEY.test(v))) continue;
      console.log(container, JSON.stringify({
        name: j.name, role: f.role, element_id: f.element_id, page: f.page_number ?? j.page_number,
        x: f.x ?? j.x, y: f.y ?? j.y, prefilled_text: j.prefilled_text, attr_data: j.data, data: f.data,
      }));
    }
  }
  for (const t of Array.isArray(data.texts) ? data.texts : []) {
    if (!MONEY.test(String(t.data ?? ''))) continue;
    console.log('texts', JSON.stringify({ id: t.id, page: t.page_number, x: t.x, y: t.y, data: t.data, user_id: t.user_id, email: t.email }));
  }
}
main().catch((e) => console.error('ERR', e?.message || e)).finally(() => prisma.$disconnect());
