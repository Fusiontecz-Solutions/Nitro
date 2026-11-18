/**
 * READ-ONLY: dump every widget (name, page, x/y/w/h, required, role) on each
 * Obsidian Capital Group SignNow template and report widget pairs whose boxes
 * overlap on the same page — those stacked pairs are what prints twice on the
 * signed PDF.
 *
 *   npx ts-node --transpile-only src/scripts/inspectObsidianOverlaps.ts
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

type Client = Awaited<ReturnType<typeof createSignNowApiClient>>;

const FIELD_BUCKETS = ['fields', 'texts', 'signatures', 'checks', 'radiobuttons'] as const;

type Widget = {
  bucket: string;
  name: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  required: boolean;
  role: string;
};

function widgets(doc: any): Widget[] {
  const out: Widget[] = [];
  for (const bucket of FIELD_BUCKETS) {
    for (const field of Array.isArray(doc?.[bucket]) ? doc[bucket] : []) {
      const ja = field?.json_attributes || {};
      const name = String(
        ja.name || field?.name || field?.field_name || field?.label || '',
      ).trim();
      if (!name) continue;
      out.push({
        bucket,
        name,
        page: Number(ja.page_number ?? field?.page_number ?? -1),
        x: Number(ja.x ?? field?.x ?? 0),
        y: Number(ja.y ?? field?.y ?? 0),
        w: Number(ja.width ?? field?.width ?? 0),
        h: Number(ja.height ?? field?.height ?? 0),
        required: Boolean(ja.required ?? field?.required),
        role: String(field?.role || ja.role || ''),
      });
    }
  }
  return out;
}

function overlaps(a: Widget, b: Widget): boolean {
  if (a.page !== b.page) return false;
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ox = Math.min(ax2, bx2) - Math.max(a.x, b.x);
  const oy = Math.min(ay2, by2) - Math.max(a.y, b.y);
  if (ox <= 0 || oy <= 0) return false;
  // Ignore hairline touches; report only real visual collisions.
  return ox > 2 && oy > 2;
}

async function originDocumentIds(client: Client, templateId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const path of [
    `/documentgroup/template/${templateId}`,
    `/v2/document-group-templates/${templateId}`,
  ]) {
    const res = await client.get(path, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const row = res.data?.data || res.data || {};
    const buckets = [
      row.documents,
      row.template?.documents,
      row.document_group_template?.documents,
      row.templates,
      row.document_ids,
      row.template_ids,
    ];
    for (const bucket of buckets) {
      for (const item of Array.isArray(bucket) ? bucket : []) {
        const id =
          typeof item === 'string'
            ? item
            : String(item?.id || item?.document_id || item?.unique_id || '').trim();
        if (id) ids.add(id);
      }
    }
  }
  if (!ids.size) ids.add(templateId);
  return [...ids];
}

function fmt(w: Widget): string {
  return `${w.name} [p${w.page} x=${w.x} y=${w.y} w=${w.w} h=${w.h}${w.required ? ' REQ' : ''}]`;
}

async function main() {
  const funder = await prisma.funderProfile.findFirst({
    where: { name: { contains: 'obsidian', mode: 'insensitive' } },
    select: {
      name: true,
      signnowContractTemplateLink: true,
      signnowAddendumTemplates: true,
      signnowDisclosureTemplates: true,
    },
  });
  if (!funder) throw new Error('No Obsidian FunderProfile found.');

  const client = await createSignNowApiClient();
  const targets: Array<[string, string]> = [];
  if (funder.signnowContractTemplateLink) {
    targets.push(['CONTRACT', funder.signnowContractTemplateLink]);
  }
  for (const row of (funder.signnowAddendumTemplates as any[]) || []) {
    if (row?.link) targets.push([`ADDENDUM: ${row.name}`, row.link]);
  }
  for (const row of (funder.signnowDisclosureTemplates as any[]) || []) {
    if (row?.link) targets.push([`DISCLOSURE: ${row.name}`, row.link]);
  }

  for (const [label, templateId] of targets) {
    for (const docId of await originDocumentIds(client, templateId)) {
      const res = await client.get(`/document/${docId}`, { validateStatus: () => true });
      if (res.status >= 400) continue;
      const data = res.data?.data || res.data || {};
      const all = widgets(data);
      const pairs: Array<[Widget, Widget]> = [];
      for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
          if (overlaps(all[i], all[j])) pairs.push([all[i], all[j]]);
        }
      }
      console.log('');
      console.log(
        `===== ${label} :: "${data.document_name || data.name}" (${all.length} widgets, ${pairs.length} overlapping pairs) =====`,
      );
      for (const [a, b] of pairs.sort((p, q) => p[0].page - q[0].page || p[0].y - q[0].y)) {
        console.log(`  OVERLAP  ${fmt(a)}  <>  ${fmt(b)}`);
      }
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
