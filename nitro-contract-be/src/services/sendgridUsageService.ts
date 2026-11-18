import axios from 'axios';

const SENDGRID_API_BASE = 'https://api.sendgrid.com/v3';
const CACHE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export type SendGridUsageSummary = {
  configured: boolean;
  /** Display label, e.g. "Free Plan". `SENDGRID_PLAN_NAME` overrides. */
  planName: string | null;
  /** `free` / `paid` as reported by SendGrid. */
  accountType: string | null;
  credits: {
    total: number | null;
    used: number | null;
    remaining: number | null;
    overage: number | null;
    /** `daily` / `monthly` etc. */
    resetFrequency: string | null;
    lastReset: string | null;
    nextReset: string | null;
  };
  /** SendGrid global stats for the current UTC day. */
  today: {
    date: string;
    requests: number;
    delivered: number;
    opens: number;
    clicks: number;
    bounces: number;
    blocks: number;
    spamReports: number;
  } | null;
  /** Pieces SendGrid refused (usually missing API key scopes). */
  warnings: string[];
  fetchedAt: string;
};

let cache: { at: number; value: SendGridUsageSummary } | null = null;
let inflight: Promise<SendGridUsageSummary> | null = null;

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function describeFailure(label: string, reason: unknown): string {
  const status = axios.isAxiosError(reason) ? reason.response?.status : undefined;
  if (status === 401 || status === 403) {
    return `${label}: API key lacks permission (status ${status})`;
  }
  const message = reason instanceof Error ? reason.message : String(reason);
  return `${label}: ${message}`;
}

/** Sums `requests` across every row/bucket a `/stats` response returns. */
function sumRequests(rows: unknown): number {
  if (!Array.isArray(rows)) return 0;
  let sum = 0;
  for (const row of rows) {
    for (const stat of row?.stats ?? []) sum += toNumber(stat?.metrics?.requests) ?? 0;
  }
  return sum;
}

/**
 * Plan size: `SENDGRID_MONTHLY_EMAIL_LIMIT` overrides what SendGrid reports,
 * for accounts whose `/user/credits` total doesn't match the purchased plan.
 */
function resolvePlanTotal(reported: number | null): number | null {
  const override = toNumber(process.env.SENDGRID_MONTHLY_EMAIL_LIMIT?.trim() || undefined);
  return override && override > 0 ? override : reported;
}

function buildPlanName(accountType: string | null): string | null {
  const override = process.env.SENDGRID_PLAN_NAME?.trim();
  if (override) return override;
  if (!accountType) return null;
  return `${accountType.charAt(0).toUpperCase()}${accountType.slice(1).toLowerCase()} Plan`;
}

async function fetchUsage(apiKey: string): Promise<SendGridUsageSummary> {
  const client = axios.create({
    baseURL: SENDGRID_API_BASE,
    timeout: REQUEST_TIMEOUT_MS,
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const date = todayUtc();

  const [creditsRes, accountRes, statsRes] = await Promise.allSettled([
    client.get('/user/credits'),
    client.get('/user/account'),
    client.get('/stats', { params: { start_date: date, end_date: date, aggregated_by: 'day' } }),
  ]);

  const warnings: string[] = [];

  const creditsData =
    creditsRes.status === 'fulfilled' ? (creditsRes.value.data as Record<string, unknown>) : null;
  if (creditsRes.status === 'rejected') warnings.push(describeFailure('Credits', creditsRes.reason));

  const accountData =
    accountRes.status === 'fulfilled' ? (accountRes.value.data as Record<string, unknown>) : null;
  if (accountRes.status === 'rejected') warnings.push(describeFailure('Account', accountRes.reason));

  let today: SendGridUsageSummary['today'] = null;
  if (statsRes.status === 'fulfilled') {
    const rows = Array.isArray(statsRes.value.data) ? statsRes.value.data : [];
    const metrics = (rows[0]?.stats?.[0]?.metrics ?? {}) as Record<string, unknown>;
    today = {
      date,
      requests: toNumber(metrics.requests) ?? 0,
      delivered: toNumber(metrics.delivered) ?? 0,
      opens: toNumber(metrics.unique_opens) ?? 0,
      clicks: toNumber(metrics.unique_clicks) ?? 0,
      bounces: toNumber(metrics.bounces) ?? 0,
      blocks: toNumber(metrics.blocks) ?? 0,
      spamReports: toNumber(metrics.spam_reports) ?? 0,
    };
  } else {
    warnings.push(describeFailure('Stats', statsRes.reason));
  }

  const total = resolvePlanTotal(toNumber(creditsData?.total));
  const resetFrequency = creditsData?.reset_frequency ? String(creditsData.reset_frequency) : null;
  const accountType = accountData?.type ? String(accountData.type) : null;
  const lastReset = creditsData?.last_reset ? String(creditsData.last_reset).slice(0, 10) : null;

  // `/user/credits` keeps `used` at 0 on paid plans, so count the period's
  // sends from global stats instead (requests since the last reset, UTC days).
  let used = toNumber(creditsData?.used);
  const periodStart = lastReset ?? `${date.slice(0, 8)}01`;
  if (periodStart === date && today) {
    used = Math.max(used ?? 0, today.requests);
  } else if (periodStart < date) {
    try {
      const periodRes = await client.get('/stats', {
        params: { start_date: periodStart, end_date: date, aggregated_by: 'month' },
      });
      used = Math.max(used ?? 0, sumRequests(periodRes.data));
    } catch (err) {
      warnings.push(describeFailure('Period stats', err));
    }
  }
  const remaining =
    total != null && used != null ? Math.max(0, total - used) : toNumber(creditsData?.remain);

  return {
    configured: true,
    planName: buildPlanName(accountType),
    accountType,
    credits: {
      total,
      used,
      remaining,
      overage: toNumber(creditsData?.overage),
      resetFrequency,
      lastReset: creditsData?.last_reset ? String(creditsData.last_reset) : null,
      nextReset: creditsData?.next_reset ? String(creditsData.next_reset) : null,
    },
    today,
    warnings,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Plan, credit balance and today's send volume straight from the SendGrid API.
 * Cached for a minute so dashboard refreshes don't burn SendGrid rate limits.
 */
export async function getSendGridUsageSummary(options?: {
  force?: boolean;
}): Promise<SendGridUsageSummary> {
  const apiKey = process.env.SENDGRID_API_KEY?.trim();
  if (!apiKey) {
    return {
      configured: false,
      planName: null,
      accountType: null,
      credits: {
        total: null,
        used: null,
        remaining: null,
        overage: null,
        resetFrequency: null,
        lastReset: null,
        nextReset: null,
      },
      today: null,
      warnings: ['SENDGRID_API_KEY is not set'],
      fetchedAt: new Date().toISOString(),
    };
  }

  if (!options?.force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  if (inflight) return inflight;

  inflight = fetchUsage(apiKey)
    .then((value) => {
      cache = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export const SENDGRID_CREDITS_EXHAUSTED_MESSAGE =
  'SendGrid email credits are used up, so the contract was not sent. ' +
  'Add credits or upgrade the SendGrid plan, then send again.';

/**
 * True only when SendGrid reports no credits left on a plan that cannot go
 * into overage. Unknown balances (missing key scope, SendGrid down) answer
 * false so a usage-API hiccup never blocks a send.
 */
export async function isSendGridOutOfCredits(): Promise<boolean> {
  const exhausted = (summary: SendGridUsageSummary) => {
    const remaining = summary.credits.remaining;
    if (!summary.configured || remaining === null) return false;
    if (summary.accountType?.toLowerCase() === 'paid') return false;
    return remaining <= 0;
  };
  try {
    if (!exhausted(await getSendGridUsageSummary())) return false;
    // The cached balance may predate a top-up or the daily reset; confirm live.
    return exhausted(await getSendGridUsageSummary({ force: true }));
  } catch (err) {
    console.warn('[SendGrid] credit check failed; allowing the send', err);
    return false;
  }
}
