import { AsyncLocalStorage } from 'async_hooks';

export type SignNowTimingContext = {
  requestId: string;
  startedAt: number;
  signNowApiCalls: number;
  databaseQueries: number;
  retries: number;
  pollingAttempts: number;
  draftReuseSkipped: boolean;
  draftReuseSkipReason: string | null;
  disclosureEnabled: boolean;
  monthlyFeeEnabled: boolean;
  documentCount: number;
};

const storage = new AsyncLocalStorage<SignNowTimingContext>();

export function getSignNowTiming(): SignNowTimingContext | undefined {
  return storage.getStore();
}

export function createSignNowTimingContext(requestId: string): SignNowTimingContext {
  return {
    requestId,
    startedAt: Date.now(),
    signNowApiCalls: 0,
    databaseQueries: 0,
    retries: 0,
    pollingAttempts: 0,
    draftReuseSkipped: false,
    draftReuseSkipReason: null,
    disclosureEnabled: false,
    monthlyFeeEnabled: false,
    documentCount: 0,
  };
}

export function runWithSignNowTiming<T>(
  ctx: SignNowTimingContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

export function countSignNowApiCall(): void {
  const ctx = storage.getStore();
  if (ctx) ctx.signNowApiCalls += 1;
}

export function countSignNowDb(n = 1): void {
  const ctx = storage.getStore();
  if (ctx) ctx.databaseQueries += n;
}

export function countSignNowRetry(n = 1): void {
  const ctx = storage.getStore();
  if (ctx) ctx.retries += n;
}

export function countSignNowPoll(n = 1): void {
  const ctx = storage.getStore();
  if (ctx) ctx.pollingAttempts += n;
}

export function logSignNowTiming(
  step: string,
  durationMs: number,
  extra?: Record<string, unknown>,
): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  const payload: Record<string, unknown> = {
    requestId: ctx.requestId,
    step,
    durationMs,
    elapsedMs: Date.now() - ctx.startedAt,
  };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue;
      payload[key] = value;
    }
  }
  console.info('[SignNow] timing', payload);
}

export async function measureSignNowStep<T>(
  step: string,
  extra: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    logSignNowTiming(step, Date.now() - started, extra);
  }
}
