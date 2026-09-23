/**
 * READ-ONLY diagnostic: rebuild the exact prefill map Review publishes for a
 * SignNow group (contract defaults + live offer overrides, with NO CRM screen
 * payload), then resolve it against every widget on every document in that live
 * group. Tells "the server had no value" apart from "the value never reached
 * the document".
 *
 *   npx ts-node --transpile-only src/scripts/inspectReviewPrefillResolution.ts [envelopeId]
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import { signNowService } from '../services/signnow/signnow.service';
import { loadOfferDerivedValuesForContract } from '../services/contractOfferValueSync';
import { buildOfferPrefillOverrides } from '../services/signnow/utils/signnow-offer-values';
import {
  buildSignNowDocumentPrefillTexts,
  signNowPrefillOptionsForDocument,
} from '../services/signnow/utils/signnow-field-map';

async function main() {
  let envelopeId = process.argv[2] || '';
  if (!envelopeId) {
    const row = await prisma.document.findFirst({
      orderBy: { updatedAt: 'desc' },
      select: { envelopeId: true },
    });
    envelopeId = row?.envelopeId || '';
  }
  const document = await prisma.document.findUnique({
    where: { envelopeId },
    select: { applicationId: true },
  });
  const applicationId = String(document?.applicationId || '').trim();
  console.log(`group ${envelopeId}  application=${applicationId}`);

  // Exactly what `sendEnvelope`'s Review branch builds, minus the screen payload.
  const values: Record<string, string> = {};
  const { defaults } = await (signNowService as any).loadContractPrefillDefaults('', applicationId);
  for (const [key, value] of Object.entries(defaults as Record<string, string>)) {
    if (!String(values[key] ?? '').trim()) values[key] = value;
  }
  console.log(`\ncontract defaults: ${Object.keys(defaults).length} keys`);
  console.log(Object.keys(defaults).sort().join(', '));

  const liveOffer = await loadOfferDerivedValuesForContract({ applicationId });
  Object.assign(values, buildOfferPrefillOverrides(liveOffer, values));
  console.log(`\nprefill map after offer overrides: ${Object.keys(values).length} keys`);

  const client = await createSignNowApiClient();
  const group = await client.get(`/documentgroup/${envelopeId}`, { validateStatus: () => true });
  const docs: any[] = group.data?.documents || group.data?.data?.documents || [];
  for (const d of docs) {
    const id = String(d.id || d.document_id || '');
    const res = await client.get(`/document/${id}`, { validateStatus: () => true });
    const data = res.data?.data || res.data || {};
    const name = String(data.document_name || data.original_filename || '');
    const names: string[] = [];
    const live: Record<string, string> = {};
    for (const f of Array.isArray(data.fields) ? data.fields : []) {
      const j = f.json_attributes || {};
      const fieldName = String(j.name || f.field_name || f.name || '');
      if (!fieldName) continue;
      names.push(fieldName);
      live[fieldName] = String(j.prefilled_text ?? f.prefilled_text ?? f.element?.data ?? '').trim();
    }
    const options = signNowPrefillOptionsForDocument(name, names);
    const resolved: Record<string, string> = {};
    for (const t of buildSignNowDocumentPrefillTexts(names, values, options)) {
      resolved[t.field_name] = t.prefilled_text;
    }
    const resolvable = names.filter((n) => resolved[n]);
    const onDocument = names.filter((n) => live[n]);
    const lost = resolvable.filter((n) => !live[n]);
    console.log(
      `\n  "${name}" (${id}) kind=${options?.documentKind ?? '(none)'}\n` +
        `    widgets=${names.length}  server can resolve=${resolvable.length}  actually on document=${onDocument.length}`,
    );
    if (lost.length) {
      console.log(`    RESOLVED BUT NOT WRITTEN (${lost.length}):`);
      for (const n of lost.slice(0, 25)) console.log(`      ${n} = ${resolved[n]}`);
    }
    const unresolvable = names.filter((n) => !resolved[n] && !live[n]);
    if (unresolvable.length) {
      console.log(`    no server value (${unresolvable.length}): ${unresolvable.slice(0, 25).join(', ')}`);
    }
  }
}

main()
  .catch((e) => {
    console.error('FAIL:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
