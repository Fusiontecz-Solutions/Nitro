/**
 * READ-ONLY: verify the Exhibit C `Text Field N` mapping against the live
 * templates.
 *
 * Nitro's Exhibit C names every widget; the Obsidian Capital Group copy of the
 * same page ships with SignNow's default `Text Field 1` … `Text Field 11` on the
 * same lines. This script pulls both templates, applies the same
 * "don't restore a widget onto an occupied spot" rule the publish uses, resolves
 * every surviving widget through the field map, and prints the ACH block the way
 * the merchant would see it — so a mapping change can be checked without sending
 * a document.
 *
 *   npx ts-node --transpile-only src/scripts/inspectExhibitCTextFieldMapping.ts
 *
 * `TOL=-1` disables the spot rule, which shows the duplicate widgets the restore
 * used to stack on every numbered slot.
 */
import '../config/loadEnv';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import {
  buildSignNowDocumentPrefillTexts,
  signNowPrefillOptionsForDocument,
  isMerchantRequiredSignerField,
} from '../services/signnow/utils/signnow-field-map';

const OBSIDIAN_EXHIBIT_C = 'a03909e9b544401e9a9f8a66e4acab150119ceaf';
const NITRO_EXHIBIT_C = '3621713302b746f793dd79c40244c580fa6500ba';
const TOL = Number(process.env.TOL ?? 8);

type W = { name: string; page: number; x: number; y: number; role: string; type: string };

async function widgets(client: any, id: string): Promise<W[]> {
  const res = await client.get(`/document/${id}`, { validateStatus: () => true });
  const d = res.data?.data || res.data || {};
  return (d.fields || []).map((f: any) => {
    const ja = f.json_attributes || {};
    return {
      name: String(ja.name || ''),
      page: Number(ja.page_number) || 0,
      x: Number(ja.x) || 0,
      y: Number(ja.y) || 0,
      role: String(f.role || ''),
      type: String(f.type || ''),
    };
  });
}

const prefill: Record<string, string> = {
  funding_provided: '10,000.00',
  funding_provided_direct: '7,175.00',
  disclosure_apr: '600.00',
  disclosure_avg_monthly_revenue: '100.00',
  disclosure_finance_charge: '4,000.00',
  disclosure_total_payment: '12,000.00',
  disclosure_monthly_cost: '23,984.00',
  disclosure_estimated_payment: '1,199.20',
  disclosure_payment_frequency: 'daily',
  client_name: 'MARY IRVIN',
  client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
  agreement_date: '09/19/2026',
  ach_authorization_account_holder_name: 'RE-NEW-IT RENOVATIONS, LLC',
  ach_authorization_account_holder_address: '3273 COVE CREEK ROAD',
  ach_authorization_account_holder_bank_name: 'SBI MORGAN',
  ach_authorization_account_holder_bank_account_number: '123456789',
  ach_authorization_account_holder_bank_routing_number: '987654321',
};

const LABELS: Record<number, string> = {
  337: '3a Account Holder Name', 362: '3b Account Holder DBA', 388: '3c Business Address',
  470: '4a Bank Name', 494: '4b Bank Portal Website', 521: '4c Bank Account Number',
  545: '4d Routing Number', 571: '4e Account Username', 598: '4f Bank Password',
  622: '4g Security Q/A 1', 648: '4h Security Q/A 2',
};
const labelFor = (y: number) =>
  LABELS[Object.keys(LABELS).map(Number).sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0]] || '';

async function main() {
  const client = await createSignNowApiClient();
  const live = await widgets(client, OBSIDIAN_EXHIBIT_C);
  const template = await widgets(client, NITRO_EXHIBIT_C);

  const present = new Set(live.map((w) => w.name.trim().toLowerCase()));
  const injected = template.filter((t) => {
    if (/^(signature|initials)/i.test(t.type)) return false;
    if (present.has(t.name.trim().toLowerCase())) return false;
    return !live.some(
      (l) => l.page === t.page && Math.abs(l.x - t.x) <= TOL && Math.abs(l.y - t.y) <= TOL,
    );
  });
  console.log(`live=${live.length} template=${template.length} injected=${injected.length}`);
  for (const t of injected) console.log('  INJECT', t.name, `p${t.page} y=${t.y} x=${t.x}`);

  const all = [...live, ...injected];
  const names = all.map((w) => w.name);
  const opts = signNowPrefillOptionsForDocument('EXHIBIT C OBSIDIAN CAPITAL GROUP', names);
  const filled = new Map(
    buildSignNowDocumentPrefillTexts(names, prefill, opts).map((r) => [r.field_name, r.prefilled_text]),
  );

  console.log('\n--- ACH block as the merchant would see it ---');
  for (const w of all.filter((x) => x.y > 320 && x.y < 680).sort((a, b) => a.y - b.y)) {
    const value = filled.get(w.name) || '';
    const req = isMerchantRequiredSignerField(w.name, w.page, opts);
    console.log(
      `  y=${String(w.y).padEnd(4)} ${labelFor(w.y).padEnd(26)} ${w.name.padEnd(28)} [${w.role}]` +
        ` ${value ? `= ${JSON.stringify(value)}` : req ? '= (merchant fills)' : '= (blank)'}`,
    );
  }
}
main().catch((e) => { console.error('FAIL:', String(e).slice(0, 400)); process.exitCode = 1; });
