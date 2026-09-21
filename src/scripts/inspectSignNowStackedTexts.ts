/**
 * READ-ONLY: for a live SignNow document group, list the committed `texts[]`
 * page stamps and show which ones stack — two stamps on the same spot, or a
 * stale stamp sitting inside a widget's box. This is what prints twice on the
 * signing view / signed PDF.
 *
 *   npx ts-node --transpile-only src/scripts/inspectSignNowStackedTexts.ts <groupIdOrPrefix>
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

type Stamp = { id: string; page: number; x: number; y: number; data: string };
type Widget = { name: string; page: number; x: number; y: number; w: number; h: number };

const TOLERANCE = 6;

function stamps(doc: any): Stamp[] {
  return (Array.isArray(doc?.texts) ? doc.texts : []).map((row: any) => ({
    id: String(row?.id || ''),
    page: Number(row?.page_number) || 0,
    x: Number(row?.x) || 0,
    y: Number(row?.y) || 0,
    data: String(row?.data ?? '').trim(),
  }));
}

function widgets(doc: any): Widget[] {
  const out: Widget[] = [];
  for (const bucket of ['fields', 'signatures', 'checks', 'radiobuttons']) {
    for (const field of Array.isArray(doc?.[bucket]) ? doc[bucket] : []) {
      const ja = field?.json_attributes || {};
      const name = String(ja.name || field?.name || '').trim();
      if (!name) continue;
      out.push({
        name,
        page: Number(ja.page_number ?? field?.page_number ?? 0),
        x: Number(ja.x ?? field?.x ?? 0),
        y: Number(ja.y ?? field?.y ?? 0),
        w: Number(ja.width ?? field?.width ?? 0),
        h: Number(ja.height ?? field?.height ?? 0),
      });
    }
  }
  return out;
}

function near(a: { page: number; x: number; y: number }, b: { page: number; x: number; y: number }) {
  return a.page === b.page && Math.abs(a.x - b.x) <= TOLERANCE && Math.abs(a.y - b.y) <= TOLERANCE;
}

function insideBox(s: Stamp, w: Widget) {
  const margin = 4;
  return (
    s.page === w.page &&
    s.x >= w.x - margin &&
    s.x <= w.x + w.w + margin &&
    s.y >= w.y - margin &&
    s.y <= w.y + w.h + margin
  );
}

async function main() {
  const arg = String(process.argv[2] || '').trim();
  if (!arg) throw new Error('Pass a document group id (or a prefix of one).');
  let groupId = arg;
  if (arg.length < 40) {
    const doc = await prisma.document.findFirst({
      where: { envelopeId: { startsWith: arg } },
      orderBy: { updatedAt: 'desc' },
      select: { envelopeId: true, status: true, applicationId: true },
    });
    if (!doc) throw new Error(`No Document row with envelopeId starting ${arg}`);
    console.log('matched Document row:', doc);
    groupId = doc.envelopeId;
  }

  const client = await createSignNowApiClient();
  const groupRes = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
  if (groupRes.status >= 400) throw new Error(`group ${groupId}: HTTP ${groupRes.status}`);
  const group = groupRes.data?.data || groupRes.data || {};
  const docs = Array.isArray(group.documents) ? group.documents : [];
  console.log(`group ${groupId}: ${docs.length} document(s)`);

  for (const d of docs) {
    const docId = String(d?.id || '');
    const res = await client.get(`/document/${docId}`, { validateStatus: () => true });
    if (res.status >= 400) continue;
    const doc = res.data?.data || res.data || {};
    const allStamps = stamps(doc).filter((s) => s.data);
    const allWidgets = widgets(doc);
    console.log('');
    console.log(
      `===== "${doc.document_name || doc.name}" (${allStamps.length} stamps, ${allWidgets.length} widgets) =====`,
    );

    const reported = new Set<number>();
    for (let i = 0; i < allStamps.length; i += 1) {
      for (let j = i + 1; j < allStamps.length; j += 1) {
        const a = allStamps[i];
        const b = allStamps[j];
        if (a.page !== b.page) continue;
        const dx = Math.abs(a.x - b.x);
        const dy = Math.abs(a.y - b.y);
        if (dx > 40 || dy > 14) continue;
        reported.add(i);
        reported.add(j);
        console.log(
          `  STACK p${a.page} dx=${dx} dy=${dy}  "${a.data}" (x=${a.x} y=${a.y})  <>  "${b.data}" (x=${b.x} y=${b.y})`,
        );
      }
    }

    for (let i = 0; i < allStamps.length; i += 1) {
      const s = allStamps[i];
      if (!reported.has(i)) continue;
      const anchored = allWidgets.find((w) => near(s, { page: w.page, x: w.x, y: w.y }));
      const boxed = allWidgets.find((w) => insideBox(s, w));
      console.log(
        `    "${s.data}" p${s.page} x=${s.x} y=${s.y} -> anchorMatch=${anchored?.name || 'NONE'} boxMatch=${boxed?.name || 'NONE'}`,
      );
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
