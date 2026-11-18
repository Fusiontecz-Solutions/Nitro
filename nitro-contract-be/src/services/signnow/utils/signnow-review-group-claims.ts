/**
 * Document groups a real Review (or send) has taken over from a background pre-warm.
 *
 * The warm copies the package and then seeds every document with the deal's values,
 * resolved from the contract row at the moment the warm started — it carries no
 * live "$25 wire fee" choice. A Review clicked while the copy was still running
 * waits on that same in-flight group, and then both queue for the group's write
 * lock. The warm still has its CRM reads and the draft link ahead of it, so Review
 * usually wrote first and the warm's seed landed on top: the first Review opened
 * with the disclosure deducting a $25 wire fee that had been unticked, and only a
 * second Review put the right amounts back.
 *
 * Review claims the group as soon as it has it; a warm that reaches the lock after
 * that leaves the documents alone. In-process only, like the write lock itself.
 */
const CLAIM_TTL_MS = 6 * 60 * 60 * 1000;

const claimedAt = new Map<string, number>();

function key(groupId: string): string {
  return String(groupId || '').trim();
}

function prune(now: number): void {
  for (const [id, at] of claimedAt) {
    if (now - at > CLAIM_TTL_MS) claimedAt.delete(id);
  }
}

export function claimSignNowGroupForReview(groupId: string, now = Date.now()): void {
  const id = key(groupId);
  if (!id) return;
  prune(now);
  claimedAt.set(id, now);
}

export function isSignNowGroupClaimedByReview(groupId: string, now = Date.now()): boolean {
  const at = claimedAt.get(key(groupId));
  return at != null && now - at <= CLAIM_TTL_MS;
}
