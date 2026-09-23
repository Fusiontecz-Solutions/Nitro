/**
 * Registers Tiberian Funding's ACH Daily Addendum SignNow template on that
 * funder's profile, so Create Contract can attach it the same way it attaches
 * Obsidian's copy ("RECURRING BANK (ACH) PAYMENT AUTHORIZATION - Daily").
 *
 * The widget names on the Tiberian template are identical to the Nitro and
 * Obsidian copies of the same page (see `TIBERIAN_ACH_DAILY_FIELD_NAMES`), so
 * no field mapping is needed — the only thing missing was the Settings link.
 *
 * The row is named "ACH DAILY TIBERIAN FUNDING": the slug has to contain both
 * `ach` and `daily` for `knownLayoutKeyFromSettingsName` to give it the
 * `ach_daily` layout key, which is what keeps it a single-instance addendum
 * (never numbered as Exhibit C × N) while keeping the funder's own template id.
 * `resolveSignNowAddendaFromFunderLinks` then ships it to SignNow as plain
 * "ACH Daily", so the funder name never reaches the live document title.
 *
 * Idempotent — re-running only updates the link if it has changed.
 *
 * Usage: npx ts-node --transpile-only src/scripts/seedTiberianAchDailyTemplate.ts [templateId]
 */
import 'dotenv/config';
import prisma from '../config/prismaClient';

const DEFAULT_TEMPLATE_ID = 'd68dd23da9ba4a76b8a73356a1866db1ff2fde9f';
const ROW_NAME = 'ACH DAILY TIBERIAN FUNDING';

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
  // Match the same rule Create Contract uses: an ACH row that is daily, not weekly.
  const existing = rows.find((row) => {
    const name = String(row?.name || '');
    return /\bach\b/i.test(name) && /daily/i.test(name);
  });

  if (existing) {
    if (String(existing.link || '').toLowerCase() === templateId.toLowerCase()) {
      console.log('[seed] Tiberian ACH Daily already registered', {
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
  console.log('[seed] Registered Tiberian ACH Daily addendum template', {
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
