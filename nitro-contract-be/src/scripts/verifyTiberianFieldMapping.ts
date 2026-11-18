/**
 * READ-ONLY: run the SignNow field map against a live Tiberian Funding SignNow
 * template and report, per widget, what value it would receive. Defaults to the
 * contract; pass a template id to check an addendum instead — the Exhibit C
 * Addendum is `52b24e67e0664f1da8eec3d364015fc9c314334a`.
 *
 * Every widget lands in exactly one bucket:
 *   MAPPED   — prefilled from CRM data
 *   SIGNER   — left empty on purpose for the merchant / guarantor to complete
 *   BLANK    — left empty on purpose (signature, initials, printed glyph,
 *              Notification-of-Assignment merchant list)
 *   UNMAPPED — nothing resolved and nothing explains why. Must stay empty.
 *
 *   npx ts-node --transpile-only src/scripts/verifyTiberianFieldMapping.ts [templateId]
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import {
  buildSignNowDocumentPrefillTexts,
  isMerchantRequiredSignerField,
  shouldSkipSignNowPrefill,
  signNowPrefillOptionsForDocument,
} from '../services/signnow/utils/signnow-field-map';

/** Sentinel CRM prefill — one recognisable value per id the contract can use. */
const PREFILL: Record<string, string> = {
  client_legal_name: 'ACME WIDGETS LLC',
  doing_business_as: 'ACME WIDGETS',
  entity_type: 'Limited Liability Company',
  security_tax_ein: '12-3456789',
  business_address: '100 Main St',
  business_address_city: 'Hartford',
  business_address_state: 'CT',
  business_address_zip: '06103',
  /** Merchant contact block — Owner 1's home address, never the business's. */
  business_address_contract: '12 Oak Ln',
  business_address_contract_city: 'New Haven',
  business_address_contract_state: 'CT',
  business_address_contract_zip: '06510',
  agreement_date: '09/21/2026',
  purchase_price: '50,000.00',
  purchased_amount: '72,500.00',
  purchase_percent: '12',
  remittance: '1,208.33',
  payment_frequency: 'Weekly',
  net_to_merchant: '48,500.00',
  appendix_underwriting_fees: '1,475.00',
  client_name: 'JANE OWNER',
  owner_print_title: 'Managing Member',
  client_email: 'jane@acmewidgets.com',
  client_phone: '8605551234',
  guaranty_guarantor1_ss: '123-45-6789',
  guarantor_address: '12 Oak Ln',
  guarantor_address_city: 'New Haven',
  guarantor_address_state: 'CT',
  guarantor_address_zip: '06510',
  owner2_guarantor_name: 'JOHN OWNER2',
  owner2_print_title: 'Member',
  owner2_email: 'john@acmewidgets.com',
  owner2_phone: '8605559876',
  guaranty_guarantor2_ss: '987-65-4321',
  owner2_address: '14 Oak Ln, Hartford, CT 06103',
  ach_authorization_account_holder_name: 'ACME WIDGETS LLC',
  /** Exhibit C ACH block — the holder / bank lines the CRM owns. */
  ach_authorization_account_holder_dba: 'ACME WIDGETS',
  ach_authorization_account_holder_address: '100 Main St, Hartford, CT 06103',
  ach_authorization_account_holder_bank_name: 'FIRST NATIONAL BANK',
  ach_authorization_account_holder_bank_account_number: '000123456789',
  ach_authorization_account_holder_bank_routing_number: '011000015',
  /** EPA Addendum — the early-payoff ledger rows the CRM owns (EPO holds 3). */
  epo_received_date_1: '10/15/2026',
  epo_amount_received_1: '5,000.00',
  epo_received_date_2: '11/15/2026',
  epo_amount_received_2: '7,500.00',
  epo_received_date_3: '12/15/2026',
  epo_amount_received_3: '10,000.00',
  case_id: 'CASE-4821',
  funder_name: 'Tiberian Funding',
};

async function main() {
  const templateId =
    process.argv[2] ||
    (
      await prisma.funderProfile.findFirst({
        where: { name: { contains: 'tiberian', mode: 'insensitive' } },
        select: { signnowContractTemplateLink: true },
      })
    )?.signnowContractTemplateLink ||
    '';
  if (!templateId) throw new Error('No Tiberian contract template id configured.');

  const client = await createSignNowApiClient();
  const docIds: string[] = [];
  for (const path of [
    `/documentgroup/template/${templateId}`,
    `/v2/document-group-templates/${templateId}`,
  ]) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const row = res.data?.data || res.data || {};
    for (const bucket of [
      row.documents,
      row.template?.documents,
      row.document_group_template?.documents,
      row.templates,
      row.document_ids,
      row.template_ids,
    ]) {
      for (const item of Array.isArray(bucket) ? bucket : []) {
        const id =
          typeof item === 'string'
            ? item
            : String(item?.id || item?.document_id || item?.unique_id || '').trim();
        if (id && !docIds.includes(id)) docIds.push(id);
      }
    }
  }
  if (!docIds.length) docIds.push(templateId);

  let unmapped = 0;
  for (const id of docIds) {
    const res = await client.get(`/document/${id}`, { validateStatus: () => true });
    const data = res.data?.data || res.data || {};
    const documentName = String(data.document_name || data.original_filename || '');
    const fields: any[] = [];
    for (const bucket of ['fields', 'texts', 'signatures', 'checks', 'radiobuttons']) {
      for (const f of Array.isArray(data?.[bucket]) ? data[bucket] : []) {
        const j = f?.json_attributes || {};
        const name = j.name || f.name || f.field_name || '';
        if (name) {
          fields.push({
            name: String(name),
            type: String(f.type || ''),
            page: Number(j.page_number ?? 0),
            glyph: String(j.prefilled_text ?? ''),
          });
        }
      }
    }
    fields.sort((a, b) => a.page - b.page);
    const names = fields.map((f) => f.name);
    const opts = signNowPrefillOptionsForDocument(documentName, names);
    const values = new Map(
      buildSignNowDocumentPrefillTexts(names, PREFILL, opts).map((t) => [
        t.field_name,
        t.prefilled_text,
      ]),
    );

    console.log(`\n===== "${documentName}" (${id})`);
    console.log(`      documentKind = ${opts?.documentKind ?? '(none)'}   ${fields.length} widgets\n`);
    for (const f of fields) {
      const value = values.get(f.name);
      let bucket: string;
      if (value) bucket = 'MAPPED  ';
      else if (isMerchantRequiredSignerField(f.name, f.page, opts)) bucket = 'SIGNER  ';
      else if (shouldSkipSignNowPrefill(f.name, opts)) bucket = 'BLANK   ';
      else {
        bucket = 'UNMAPPED';
        unmapped += 1;
      }
      const note = f.glyph ? `  (template glyph "${f.glyph}")` : '';
      console.log(
        `  ${bucket} p${String(f.page + 1).padStart(2)} ${f.name.padEnd(36)} ${value ? `= ${value}` : ''}${note}`,
      );
    }
  }
  console.log(`\nUNMAPPED widgets: ${unmapped}`);
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
