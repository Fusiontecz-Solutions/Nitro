import prisma from '../config/prismaClient';

/**
 * Renumber ClientOwner.sortOrder so every client has a dense, unique 0..n-1 sequence.
 *
 * Rows written before slot numbering was enforced can share a sortOrder. The read
 * path now applies a total order, so the UI is already stable, but duplicate slots
 * still make `owners[ownerIndex - 1]` ambiguous for anything that addresses an owner
 * by position. This repairs the stored data to match.
 *
 * Ordering is preserved exactly as the application now reads it — sortOrder, then
 * createdAt, then id — so no owner changes position. Idempotent; safe to re-run.
 *
 * Run:  npx ts-node src/scripts/repairClientOwnerSortOrder.ts [--apply]
 * Without --apply it only reports what it would change.
 */

async function main() {
  const apply = process.argv.includes('--apply');

  const owners = await prisma.clientOwner.findMany({
    orderBy: [{ clientId: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, clientId: true, sortOrder: true, firstName: true, lastName: true },
  });

  const byClient = new Map<string, typeof owners>();
  for (const owner of owners) {
    const key = String(owner.clientId);
    const list = byClient.get(key) ?? [];
    list.push(owner);
    byClient.set(key, list);
  }

  const updates: Array<{ id: string; from: number | null; to: number }> = [];
  let clientsWithDuplicates = 0;

  for (const [clientId, list] of byClient) {
    const seen = new Set<number>();
    let hasDuplicate = false;
    for (const owner of list) {
      const current = Number(owner.sortOrder ?? 0);
      if (seen.has(current)) hasDuplicate = true;
      seen.add(current);
    }
    if (hasDuplicate) {
      clientsWithDuplicates += 1;
      console.info(
        `client ${clientId}: ${list.length} owners, duplicate sortOrder — ` +
          list
            .map((o) => `${o.sortOrder}:${[o.firstName, o.lastName].filter(Boolean).join(' ')}`)
            .join(' | '),
      );
    }
    list.forEach((owner, index) => {
      if (Number(owner.sortOrder ?? -1) !== index) {
        updates.push({ id: owner.id, from: owner.sortOrder ?? null, to: index });
      }
    });
  }

  console.info(
    `\n${byClient.size} clients scanned, ${clientsWithDuplicates} with duplicate sortOrder, ` +
      `${updates.length} owner rows to renumber.`,
  );

  if (!updates.length) return;
  if (!apply) {
    console.info('Dry run — re-run with --apply to write these changes.');
    return;
  }

  for (const update of updates) {
    await prisma.clientOwner.update({
      where: { id: update.id },
      data: { sortOrder: update.to },
    });
  }
  console.info(`Renumbered ${updates.length} owner rows.`);
}

main()
  .catch((error) => {
    console.error('repairClientOwnerSortOrder failed', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
