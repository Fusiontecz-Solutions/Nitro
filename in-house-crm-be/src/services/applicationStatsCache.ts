import type { ApplicationStatsPayload } from './applicationStatsService';

type Entry = { expiresAt: number; data: ApplicationStatsPayload };

const store = new Map<string, Entry>();

/** Short TTL: repeat dashboard loads and parallel tabs hit memory, not Postgres. */
const TTL_MS = 8_000;

export function getApplicationStatsCache(key: string): ApplicationStatsPayload | null {
    const e = store.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
        store.delete(key);
        return null;
    }
    return e.data;
}

export function setApplicationStatsCache(key: string, data: ApplicationStatsPayload): void {
    store.set(key, { expiresAt: Date.now() + TTL_MS, data });
}
