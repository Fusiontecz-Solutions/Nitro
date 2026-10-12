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

/** SendGrid is switched off: every CRM email is sent through the Gmail API. */
const SENDGRID_DISABLED = true as boolean;

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

  const total = toNumber(creditsData?.total);
  const resetFrequency = creditsData?.reset_frequency ? String(creditsData.reset_frequency) : null;
  const accountType = accountData?.type ? String(accountData.type) : null;

  return {
    configured: true,
    planName: buildPlanName(accountType),
    accountType,
    credits: {
      total,
      used: toNumber(creditsData?.used),
      remaining: toNumber(creditsData?.remain),
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
  // SendGrid disabled — all mail goes through Gmail, so there is no SendGrid plan to report.
  const apiKey = SENDGRID_DISABLED ? undefined : process.env.SENDGRID_API_KEY?.trim();
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
      warnings: [SENDGRID_DISABLED ? 'SendGrid is disabled — email is sent through Gmail' : 'SENDGRID_API_KEY is not set'],
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
