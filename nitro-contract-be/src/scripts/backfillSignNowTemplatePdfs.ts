/**
 * One-time migration: archive every existing SignNow template PDF to Cloudinary.
 *
 *   npx ts-node --transpile-only src/scripts/backfillSignNowTemplatePdfs.ts --dry-run
 *   npx ts-node --transpile-only src/scripts/backfillSignNowTemplatePdfs.ts
 *   npx ts-node --transpile-only src/scripts/backfillSignNowTemplatePdfs.ts --limit=5
 *   npx ts-node --transpile-only src/scripts/backfillSignNowTemplatePdfs.ts --force
 *
 * Templates that already have an archived PDF are skipped, so the script is safe
 * to re-run and can be resumed with `--limit` if the SignNow daily document
 * limit is tight. `--force` re-fetches and replaces existing archives — use it
 * only after a template was edited in SignNow.
 *
 * Each template costs exactly one SignNow download; afterwards the CRM preview
 * endpoints serve that PDF from the DB + Cloudinary and never call SignNow again.
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { backfillSignNowTemplatePdfs } from '../services/signnow/utils/signnow-template-pdf-backfill';

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function numericFlag(name: string): number {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  const value = Number(String(hit || '').split('=')[1]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function main(): Promise<void> {
  const dryRun = flag('dry-run');
  const force = flag('force');
  const limit = numericFlag('limit');

  console.log(
    `[backfill] SignNow template PDFs — ${dryRun ? 'DRY RUN' : 'live'}${force ? ', force' : ''}${limit ? `, limit ${limit}` : ''}`,
  );

  const results = await backfillSignNowTemplatePdfs({
    dryRun,
    force,
    limit,
    onProgress: (result) => {
      const label =
        result.identity.name ||
        result.identity.layoutKey ||
        result.identity.signnowTemplateId;
      const suffix = result.error ? ` — ${result.error}` : '';
      console.log(
        `  ${result.outcome.padEnd(16)} ${result.identity.signnowTemplateId.slice(0, 8)}  ${label}${suffix}`,
      );
    },
  });

  const tally = results.reduce<Record<string, number>>((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] || 0) + 1;
    return acc;
  }, {});
  console.log('[backfill] done', tally);

  if (results.some((row) => row.outcome === 'failed')) {
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('[backfill] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
