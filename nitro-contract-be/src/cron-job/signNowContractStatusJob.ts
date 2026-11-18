import cron, { ScheduledTask } from 'node-cron';
import prisma from '../config/prismaClient';
import { getRedisClient } from '../config/redis';
import { signNowService } from '../services/signnow/signnow.service';
import { isSignNowEnvelopeId } from '../services/signnow/utils/signnow-client';
import { signNowWebhooksVerified } from '../services/signnow/utils/signnow-webhook-mode';

/**
 * Keeps SignNow contracts in step with the CRM without anyone clicking the
 * contract's refresh / eye button.
 *
 * Every tick (5s by default) it:
 *  1. Checks completed contracts whose signed copy has not reached the funder CC
 *     yet and runs the existing catch-up send (`reconcileCcSignedNotice`). This
 *     part is database-only; the catch-up throttles its own retries.
 *  2. Reads the live SignNow status of contracts still out for signature through
 *     `getGroupStatus` — the same path as the refresh button and the webhook —
 *     which moves the deal to Contract Signed, sends the CC notice and pushes
 *     `contract:signing-status` so open browsers update.
 *
 * Each status read costs 2–3 SignNow API calls, so the 5s cadence is spent only
 * on contracts that are actually being signed: sent in the last few minutes, or
 * a signer opened / finished the signing portal recently. Every other open
 * contract is read on a slow sweep, and none once older than the max age.
 *
 * With `SIGNNOW_WEBHOOK_SECRET` set the signed webhook is the only source of
 * status: this job makes no SignNow status reads at all (set
 * `SIGNNOW_STATUS_JOB_SWEEP_WITH_WEBHOOKS=true` to keep the slow sweep as a
 * backstop) and only chases CC notices, which is database work.
 */

const IN_FLIGHT_DOCUMENT_STATUSES = ['sent', 'delivered', 'viewed', 'signed', 'partially_signed'];
const LOCK_KEY = 'cron:signnow-contract-status';
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
/** Minimum gap between two CC catch-up checks of the same contract. */
const CC_CHECK_GAP_MS = MINUTE;
/** Only recently completed contracts are chased for a missing CC notice. */
const CC_CHECK_MAX_AGE_MS = 7 * DAY;

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || String(process.env[name] ?? '').trim() === '') return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

export function signNowContractStatusJobConfig() {
  const webhooksVerified = signNowWebhooksVerified();
  return {
    /** SignNow status reads; off when signed webhooks report status. */
    statusChecksEnabled:
      !webhooksVerified ||
      String(process.env.SIGNNOW_STATUS_JOB_SWEEP_WITH_WEBHOOKS || '').trim().toLowerCase() === 'true',
    enabled:
      String(process.env.SIGNNOW_STATUS_JOB_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
    tickSeconds: envInt('SIGNNOW_STATUS_JOB_TICK_SECONDS', 5, 5, 59),
    /** How long after a send / portal visit a contract counts as being signed. */
    activeWindowMinutes: envInt(
      'SIGNNOW_STATUS_JOB_ACTIVE_WINDOW_MINUTES',
      webhooksVerified ? 0 : 30,
      0,
      120,
    ),
    /** Status sweep for contracts nobody is signing right now. */
    idleCheckMinutes: envInt(
      'SIGNNOW_STATUS_JOB_IDLE_CHECK_MINUTES',
      webhooksVerified ? 60 : 30,
      1,
      24 * 60,
    ),
    maxAgeDays: envInt('SIGNNOW_STATUS_JOB_MAX_AGE_DAYS', 14, 1, 90),
    maxPerTick: envInt('SIGNNOW_STATUS_JOB_MAX_PER_TICK', 5, 1, 50),
  };
}

/** envelopeId → last signing-portal activity (link opened, signer finished). */
const signerActivityAt = new Map<string, number>();
/** envelopeId → last SignNow status read made by this job. */
const statusCheckedAt = new Map<string, number>();
/** envelopeId → last CC catch-up check made by this job. */
const ccCheckedAt = new Map<string, number>();

/**
 * Called by the signing portal when a signer opens their session or returns
 * from SignNow: the contract is being signed right now, so it is read every tick.
 */
export function markSignNowEnvelopeActive(envelopeId: string, at: number = Date.now()): void {
  const id = String(envelopeId || '').trim();
  if (id) signerActivityAt.set(id, at);
}

export function resetSignNowContractStatusJobState(): void {
  signerActivityAt.clear();
  statusCheckedAt.clear();
  ccCheckedAt.clear();
}

export type StatusCandidate = {
  envelopeId: string;
  applicationId: string;
  sentAt: Date | null;
  updatedAt: Date;
};

/** Minimum gap between two SignNow reads of one contract. */
export function statusCheckGapMs(
  row: StatusCandidate,
  now: number,
  config: ReturnType<typeof signNowContractStatusJobConfig>,
): number {
  const activeWindowMs = config.activeWindowMinutes * MINUTE;
  const sentMs = (row.sentAt ?? row.updatedAt).getTime();
  const lastActivity = Math.max(sentMs, signerActivityAt.get(row.envelopeId) ?? 0);
  if (now - lastActivity < activeWindowMs) return config.tickSeconds * 1000;
  return config.idleCheckMinutes * MINUTE;
}

/** Contracts whose gap has elapsed, least recently read first. */
export function selectDueStatusChecks(
  rows: StatusCandidate[],
  now: number,
  config: ReturnType<typeof signNowContractStatusJobConfig>,
): StatusCandidate[] {
  const activeGapMs = config.tickSeconds * 1000;
  return rows
    .filter((row) => isSignNowEnvelopeId(row.envelopeId))
    .filter((row) => {
      const gap = statusCheckGapMs(row, now, config);
      const last = statusCheckedAt.get(row.envelopeId);
      if (last === undefined) {
        // First sighting (e.g. just after a restart): a contract being signed is
        // read now; an idle one waits a full idle gap, so restarting the server
        // does not spend a burst of SignNow calls re-reading every open contract.
        if (gap <= activeGapMs) return true;
        statusCheckedAt.set(row.envelopeId, now);
        return false;
      }
      return now - last >= gap;
    })
    .sort(
      (a, b) => (statusCheckedAt.get(a.envelopeId) ?? 0) - (statusCheckedAt.get(b.envelopeId) ?? 0),
    )
    .slice(0, config.maxPerTick);
}

async function checkPendingCcNotices(now: number): Promise<number> {
  const rows = await prisma.document.findMany({
    where: {
      status: 'completed',
      ccSignedNoticeSentAt: null,
      completedAt: { gte: new Date(now - CC_CHECK_MAX_AGE_MS) },
    } as any,
    select: { envelopeId: true, applicationId: true },
  });
  let checked = 0;
  for (const row of rows) {
    if (!isSignNowEnvelopeId(row.envelopeId)) continue;
    const last = ccCheckedAt.get(row.envelopeId);
    if (last !== undefined && now - last < CC_CHECK_GAP_MS) continue;
    ccCheckedAt.set(row.envelopeId, now);
    checked += 1;
    try {
      await signNowService.reconcileCcSignedNotice(row.envelopeId, String(row.applicationId || ''));
    } catch (err) {
      console.warn('[SignNow status job] CC notice check failed', {
        envelopeId: row.envelopeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return checked;
}

async function checkOpenContractStatuses(now: number): Promise<number> {
  const config = signNowContractStatusJobConfig();
  const cutoff = new Date(now - config.maxAgeDays * DAY);
  const rows = await prisma.document.findMany({
    where: {
      status: { in: IN_FLIGHT_DOCUMENT_STATUSES },
      OR: [{ sentAt: { gte: cutoff } }, { sentAt: null, updatedAt: { gte: cutoff } }],
    },
    select: { envelopeId: true, applicationId: true, sentAt: true, updatedAt: true },
  });

  // Drop state for contracts that finished or aged out.
  const live = new Set(rows.map((row) => row.envelopeId));
  for (const map of [statusCheckedAt, signerActivityAt]) {
    for (const id of map.keys()) if (!live.has(id)) map.delete(id);
  }

  const due = selectDueStatusChecks(
    rows.map((row) => ({ ...row, applicationId: String(row.applicationId || '') })),
    now,
    config,
  );
  for (const row of due) {
    statusCheckedAt.set(row.envelopeId, now);
    try {
      const result = await signNowService.getGroupStatus(row.envelopeId, row.applicationId || undefined);
      if (result.status === 'completed' || result.status === 'voided') {
        console.info('[SignNow status job] contract reached a final status', {
          envelopeId: row.envelopeId,
          applicationId: row.applicationId || null,
          status: result.status,
        });
      }
    } catch (err) {
      console.warn('[SignNow status job] status check failed', {
        envelopeId: row.envelopeId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return due.length;
}

/** One pass of the job. */
export async function runSignNowContractStatusJob(
  now: number = Date.now(),
): Promise<{ statusChecks: number; ccChecks: number }> {
  const statusChecks = signNowContractStatusJobConfig().statusChecksEnabled
    ? await checkOpenContractStatuses(now)
    : 0;
  // After the status pass, so a contract completed on this tick is covered too.
  const ccChecks = await checkPendingCcNotices(now);
  return { statusChecks, ccChecks };
}

/**
 * With several API instances only one may run a tick, or each would spend its
 * own SignNow calls on the same contracts. Without Redis every tick just runs.
 */
async function acquireTickLock(ttlMs: number): Promise<boolean> {
  const redis = getRedisClient();
  if (!redis) return true;
  try {
    return (await redis.set(LOCK_KEY, String(process.pid), 'PX', ttlMs, 'NX')) === 'OK';
  } catch (err) {
    console.warn('[SignNow status job] redis lock failed; running tick anyway', err);
    return true;
  }
}

async function releaseTickLock(): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.del(LOCK_KEY);
  } catch {
    // The lock expires on its own.
  }
}

let task: ScheduledTask | null = null;

export function startSignNowContractStatusJob(): ScheduledTask | null {
  const config = signNowContractStatusJobConfig();
  if (!config.enabled || task) return task;
  task = cron.schedule(
    `*/${config.tickSeconds} * * * * *`,
    async () => {
      if (!(await acquireTickLock(60 * 1000))) return;
      try {
        await runSignNowContractStatusJob();
      } catch (err) {
        console.error('[SignNow status job] tick failed', err);
      } finally {
        await releaseTickLock();
      }
    },
    { name: 'signnow-contract-status', noOverlap: true },
  );
  const statusPart = !config.statusChecksEnabled
    ? 'status comes from signed webhooks only (no SignNow status reads)'
    : config.activeWindowMinutes > 0
      ? `contracts being signed are checked each tick, others every ${config.idleCheckMinutes} min`
      : `open contracts swept every ${config.idleCheckMinutes} min`;
  console.log(
    `[SignNow status job] every ${config.tickSeconds}s: ${statusPart}; CC notices of completed contracts are chased`,
  );
  return task;
}
