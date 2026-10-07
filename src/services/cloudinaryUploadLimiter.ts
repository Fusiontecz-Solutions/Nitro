/**
 * Process-wide gate for Cloudinary uploads.
 *
 * Callers may fire uploads in parallel (batch KYC upload, application PDF attach, etc.);
 * this module keeps the number of *in-flight* Cloudinary requests bounded and shares a
 * single back-off window across all callers. Previously each call site either serialised
 * uploads (slow: a 3-file KYC batch cost >100s) or fired them all at once (every request
 * hit HTTP 429 and the whole batch was dropped).
 *
 * Env overrides:
 *   CLOUDINARY_MAX_CONCURRENT_UPLOADS  (default 3)
 *   CLOUDINARY_UPLOAD_MAX_ATTEMPTS     (default 6)
 */

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_MAX_ATTEMPTS = 6;
const MAX_BACKOFF_MS = 10_000;

function envInt(key: string, fallback: number, min: number, max: number): number {
    const raw = Number(String(process.env[key] || '').trim());
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.min(max, Math.max(min, Math.floor(raw)));
}

export function cloudinaryMaxConcurrency(): number {
    return envInt('CLOUDINARY_MAX_CONCURRENT_UPLOADS', DEFAULT_MAX_CONCURRENT, 1, 12);
}

export function cloudinaryMaxAttempts(): number {
    return envInt('CLOUDINARY_UPLOAD_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS, 1, 10);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Readable message for a Cloudinary failure. The SDK sometimes rejects with a plain
 * `{ error: { message, http_code } }` object (no top-level `message`), which `String()`
 * would turn into "[object Object]".
 */
export function describeCloudinaryError(error: unknown): string {
    const e = error as any;
    const inner = e?.error && typeof e.error === 'object' ? e.error : null;
    const message = e?.message || inner?.message;
    const code = e?.http_code || inner?.http_code;
    if (message) return code ? `${message} (HTTP ${code})` : String(message);
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error) || 'Unknown Cloudinary error';
    } catch {
        return 'Unknown Cloudinary error';
    }
}

export function isCloudinaryRateLimitError(error: unknown): boolean {
    const e = error as any;
    const msg = describeCloudinaryError(error);
    const code = Number(e?.http_code || e?.httpCode || e?.error?.http_code || 0);
    return code === 429 || /429|rate.?limit|too many requests/i.test(msg);
}

/** `Retry-After` (seconds or HTTP date) when Cloudinary surfaces it on the error. */
function retryAfterMsFromError(error: unknown): number | null {
    const headers =
        (error as any)?.headers ||
        (error as any)?.response?.headers ||
        (error as any)?.error?.headers;
    const raw = headers?.['retry-after'] ?? headers?.['Retry-After'];
    if (raw == null) return null;
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) return Math.min(MAX_BACKOFF_MS, asNumber * 1000);
    const asDate = Date.parse(String(raw));
    if (Number.isFinite(asDate)) return Math.min(MAX_BACKOFF_MS, Math.max(0, asDate - Date.now()));
    return null;
}

let active = 0;
const waiters: Array<() => void> = [];
/** Shared back-off deadline: a 429 seen by one upload pauses every other upload too. */
let cooldownUntil = 0;

function release(): void {
    active = Math.max(0, active - 1);
    const next = waiters.shift();
    if (next) next();
}

async function acquire(): Promise<void> {
    const limit = cloudinaryMaxConcurrency();
    if (active >= limit) {
        await new Promise<void>((resolve) => waiters.push(resolve));
    }
    active += 1;
}

async function waitOutCooldown(): Promise<void> {
    for (;;) {
        const remaining = cooldownUntil - Date.now();
        if (remaining <= 0) return;
        await sleep(Math.min(remaining, MAX_BACKOFF_MS));
    }
}

/** Make every queued upload wait, not just the one that saw the 429. */
function openCooldown(ms: number): void {
    const until = Date.now() + ms;
    if (until > cooldownUntil) cooldownUntil = until;
}

/**
 * Run one Cloudinary call under the shared concurrency gate, retrying HTTP 429 with
 * jittered exponential back-off. Non-rate-limit errors are rethrown immediately.
 */
export async function runCloudinaryUpload<T>(
    label: string,
    task: (attempt: number) => Promise<T>,
): Promise<T> {
    const maxAttempts = cloudinaryMaxAttempts();
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        await waitOutCooldown();
        await acquire();
        try {
            return await task(attempt);
        } catch (error: unknown) {
            lastError = error;
            if (!isCloudinaryRateLimitError(error) || attempt >= maxAttempts) {
                throw error;
            }
            const base = Math.min(MAX_BACKOFF_MS, 600 * Math.pow(2, attempt - 1));
            const jitter = Math.floor(Math.random() * 400);
            const waitMs = retryAfterMsFromError(error) ?? base + jitter;
            openCooldown(waitMs);
            console.warn(
                `[cloudinary] 429 on ${label} (attempt ${attempt}/${maxAttempts}) — pausing uploads ${waitMs}ms…`,
            );
        } finally {
            release();
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Cloudinary upload failed after retries');
}

/**
 * Run tasks with bounded parallelism. Used for batches that are not themselves Cloudinary
 * calls but wrap one (upload + DB row), so the gate above still governs the network side.
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const size = Math.max(1, Math.min(limit, items.length || 1));

    const runners = Array.from({ length: size }, async () => {
        for (;;) {
            const index = cursor++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}
