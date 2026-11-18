/**
 * Registers Tiberian Funding's Exhibit C Addendum SignNow template on that
 * funder's profile, so Create Contract can attach it the same way it attaches
 * Obsidian's copy.
 *
 * The widget names on the Tiberian template are the named Nitro layout
 * (see `TIBERIAN_EXHIBIT_C_FIELD_NAMES`), so no field mapping is needed — the
 * only thing missing was the Settings link itself.
 *
 * The row is named "EXHIBIT C TIBERIAN FUNDING" to match the Obsidian row: the
 * slug has to contain `exhibit_c` for `knownLayoutKeyFromSettingsName` to give
 * it the `exhibit_c` layout key, which is what allows the addendum to be
 * attached more than once (Exhibit C × N) while keeping the funder's own
 * template id.
 *
 * Idempotent — re-running only updates the link if it has changed.
 *
 * Usage: npx ts-node --transpile-only src/scripts/seedTiberianExhibitCTemplate.ts [templateId]
 */
import 'dotenv/config';
import prisma from '../config/prismaClient';

const DEFAULT_TEMPLATE_ID = '52b24e67e0664f1da8eec3d364015fc9c314334a';
const ROW_NAME = 'EXHIBIT C TIBERIAN FUNDING';

type LinkRow = { name?: string | null; link?: string | null };

async function main() {
  const templateId = String(process.argv[2] || DEFAULT_TEMPLATE_ID).trim();
  if (!/^[a-f0-9]{40}$/i.test(templateId)) {
    throw new Error(`Not a SignNow template id: "${templateId}"`);
  }

  const funder = await prisma.funderProfile.findFirst({
    where: { name: { contains: 'tiberian', mode: 'insensitive' } },
    select: { id: true, name: true, signnowAddendumTemplates: true },
  });
  if (!funder) throw new Error('No Tiberian Funding funder profile found.');

  const rows: LinkRow[] = Array.isArray(funder.signnowAddendumTemplates)
    ? (funder.signnowAddendumTemplates as LinkRow[])
    : [];
  const existing = rows.find((row) =>
    /\bexhibit\s*c\b/i.test(String(row?.name || '')),
  );

  if (existing) {
    if (String(existing.link || '').toLowerCase() === templateId.toLowerCase()) {
      console.log('[seed] Tiberian Exhibit C already registered', {
        funder: funder.name,
        name: existing.name,
        link: existing.link,
      });
      return;
    }
    existing.link = templateId;
  } else {
    rows.push({ name: ROW_NAME, link: templateId });
  }

  await prisma.funderProfile.update({
    where: { id: funder.id },
    data: { signnowAddendumTemplates: rows as object[] },
  });
  console.log('[seed] Registered Tiberian Exhibit C addendum template', {
    funder: funder.name,
    rows: rows.map((row) => `${row.name} -> ${row.link}`),
  });
}

main()
  .catch((err) => {
    console.error('[seed] failed', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
