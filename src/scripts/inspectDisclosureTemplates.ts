/**
 * READ-ONLY: dump the live widget inventory of every State Disclosure template
 * the CRM knows about (platform default + each funder profile's own row) and
 * report, widget by widget, whether the SignNow field map can resolve a value
 * for it from a realistic CRM prefill payload.
 *
 *   npx ts-node --transpile-only src/scripts/inspectDisclosureTemplates.ts [templateId ...]
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import { signNowDisclosureTemplateId } from '../services/signnow/utils/signnow-addendum-templates';
import {
  signNowPrefillOptionsForDocument,
  buildSignNowDocumentPrefillTexts,
  shouldSkipSignNowPrefill,
} from '../services/signnow/utils/signnow-field-map';
import { buildOfferPrefillOverrides } from '../services/signnow/utils/signnow-offer-values';
import { resolveOfferDerivedContractValues } from '../services/contractOfferValueSync';

type Client = Awaited<ReturnType<typeof createSignNowApiClient>>;

const FIELD_BUCKETS = ['fields', 'texts', 'signatures', 'checks', 'radiobuttons', 'enumerations'] as const;

function widgets(doc: any) {
  const out: any[] = [];
  for (const bucket of FIELD_BUCKETS) {
    for (const f of Array.isArray(doc?.[bucket]) ? doc[bucket] : []) {
      const j = f?.json_attributes || {};
      out.push({
        bucket,
        name: String(j.name || f.name || f.field_name || f.label || ''),
        type: f.type || j.type || '',
        role: f.role || f.role_name || '',
        page: j.page_number ?? f.page_number ?? '',
        y: j.y ?? '',
      });
    }
  }
  return out.sort((a, b) => Number(a.page) - Number(b.page) || Number(a.y) - Number(b.y));
}

async function originDocumentIds(client: Client, templateId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const path of [
    `/documentgroup/template/${templateId}`,
    `/v2/document-group-templates/${templateId}`,
  ]) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const row = res.data?.data || res.data || {};
    for (const bucket of [row.documents, row.template?.documents, row.document_group_template?.documents, row.templates, row.document_ids, row.template_ids]) {
      for (const item of Array.isArray(bucket) ? bucket : []) {
        const id = typeof item === 'string' ? item : String(item?.id || item?.document_id || item?.unique_id || '').trim();
        if (id && !ids.includes(id)) ids.push(id);
      }
    }
  }
  if (!ids.length) ids.push(templateId);
  return ids;
}

/**
 * What the backend actually holds for a package when the CRM screen posts
 * nothing disclosure-specific: the contract columns + the live offer overrides.
 */
const OFFER = {
  offer: 50000,
  totalRemit: 72500,
  term: '60 Days',
  frequency: 'Daily',
  repayPerPeriod: 1208.33,
  fees: 2.9,
  refinanceAmount: null,
};

/** Exactly what the backend holds when the CRM screen posts no disclosure keys. */
const BACKEND_ONLY_VALUES: Record<string, string> = (() => {
  const base: Record<string, string> = {
    client_name: 'ACME LLC',
    legal_name: 'ACME LLC',
    agreement_date: '09/22/2026',
    signature_date: '09/22/2026',
    // Client.businessMonthlyRevenue, as loadContractPrefillDefaults publishes it.
    disclosure_avg_monthly_revenue: '120,000.00',
    avarage_monthly_income: '120,000.00',
    monthly_income: '120,000.00',
  };
  Object.assign(
    base,
    buildOfferPrefillOverrides(
      { values: resolveOfferDerivedContractValues(OFFER), includeWireFee: true },
      base,
    ),
  );
  return base;
})();

async function main() {
  const targets: Array<[string, string]> = [];
  const push = (label: string, id?: string | null) => {
    const key = String(id || '').trim();
    if (key && !targets.some(([, t]) => t.toLowerCase() === key.toLowerCase())) targets.push([label, key]);
  };
  for (const id of process.argv.slice(2)) push(`ARG ${id}`, id);
  push('PLATFORM DEFAULT DISCLOSURE', signNowDisclosureTemplateId());

  const funders = await prisma.funderProfile.findMany({
    select: { id: true, name: true, signnowDisclosureTemplates: true, signnowAddendumTemplates: true },
  });
  for (const funder of funders) {
    for (const bucket of [funder.signnowDisclosureTemplates, funder.signnowAddendumTemplates]) {
      for (const row of (bucket as any[]) || []) {
        const name = String(row?.name || '');
        if (/disclo/i.test(name)) push(`${funder.name} :: ${name}`, row?.link);
      }
    }
  }

  const client = await createSignNowApiClient();
  for (const [label, templateId] of targets) {
    console.log(`\n===== ${label}  template=${templateId} =====`);
    for (const id of await originDocumentIds(client, templateId)) {
      const res = await client.get(`/document/${id}`, { validateStatus: () => true });
      if (res.status >= 400) {
        console.log(`  document ${id}: HTTP ${res.status}`);
        continue;
      }
      const data = res.data?.data || res.data || {};
      const docName = String(data.document_name || data.original_filename || '');
      const ws = widgets(data).filter((w) => w.bucket !== 'signatures');
      const names = ws.map((w) => w.name);
      const opts = signNowPrefillOptionsForDocument(docName, names);
      const filled: Record<string, string> = {};
      for (const t of buildSignNowDocumentPrefillTexts(names, BACKEND_ONLY_VALUES, opts)) {
        filled[t.field_name] = t.prefilled_text;
      }
      console.log(`\n  -- "${docName}"  doc=${id}  kind=${opts?.documentKind ?? '(none)'}  ${ws.length} widget(s)`);
      let empty = 0;
      for (const w of ws) {
        const value = filled[w.name];
        if (!value) empty += 1;
        console.log(
          `     p${w.page} y=${w.y} role=${w.role} ${value ? 'FILLED' : 'EMPTY '} skip=${shouldSkipSignNowPrefill(w.name, opts)} :: "${w.name}"${value ? ` = ${value}` : ''}`,
        );
      }
      console.log(`     >>> ${ws.length - empty}/${ws.length} filled from backend-only values`);
    }
  }
}

main()
  .catch((err) => {
    console.error('FAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
