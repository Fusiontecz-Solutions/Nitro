import prisma from '../config/prismaClient';
import { NotFoundError, ValidationError } from '../utils/errors';

const DEFAULT_API_BASE = 'https://api.datamerch.com/api/v2';

type DataMerchSession = {
    token: string;
    expiresAt: number;
};

let cachedSession: DataMerchSession | null = null;

export type DataMerchRecord = {
    category: string;
    note: string;
    addedBy: string | null;
    createdAt: string | null;
};

export type DataMerchMerchant = {
    fein: string | null;
    legalName: string | null;
    dba: string | null;
    address: string | null;
    street1: string | null;
    street2: string | null;
    city: string | null;
    state: string | null;
    industry: string | null;
    businessPhone: string | null;
    businessStartDate: string | null;
    records: DataMerchRecord[];
};

export type DataMerchLookupResult = {
    searchQuery: string;
    searchType: 'ein' | 'name';
    businessName: string | null;
    ein: string | null;
    merchants: DataMerchMerchant[];
    searchAttempts: string[];
    raw: unknown;
};

function datamerchApiBase(): string {
    return String(process.env.DATAMERCH_API_BASE_URL ?? DEFAULT_API_BASE).replace(/\/$/, '');
}

function datamerchAuthToken(): string {
    const token = String(process.env.DATAMERCH_AUTH_TOKEN ?? '').trim();
    if (!token) {
        throw new ValidationError('DataMerch is not configured (missing DATAMERCH_AUTH_TOKEN).');
    }
    return token;
}

function datamerchAuthKey(): string {
    const key = String(process.env.DATAMERCH_AUTH_KEY ?? '').trim();
    if (!key) {
        throw new ValidationError('DataMerch is not configured (missing DATAMERCH_AUTH_KEY).');
    }
    return key;
}

function normalizeEin(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    return digits.length === 9 ? digits : null;
}

function normalizeBusinessName(raw: string | null | undefined): string | null {
    const name = String(raw ?? '').trim();
    return name.length > 0 ? name : null;
}

function stripBusinessSuffix(name: string): string {
    return name
        .replace(
            /\s*,?\s*\b(LLC|L\.L\.C\.|INC|INCORPORATED|CORP|CORPORATION|LTD|CO|COMPANY|LP|LLP)\b\.?\s*$/gi,
            '',
        )
        .replace(/\s+/g, ' ')
        .trim();
}

/** DataMerch legal-name search uses keywords, not exact full legal names. */
export function buildNameSearchCandidates(businessName: string): string[] {
    const base = String(businessName ?? '').trim();
    if (!base) return [];

    const candidates: string[] = [base];
    const withoutSuffix = stripBusinessSuffix(base);
    if (withoutSuffix && withoutSuffix !== base) {
        candidates.push(withoutSuffix);
    }

    const words = withoutSuffix
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 2);

    if (words.length >= 3) {
        candidates.push(words.slice(0, 3).join(' '));
    }
    if (words.length >= 2) {
        candidates.push(words.slice(0, 2).join(' '));
    }
    if (words.length >= 1) {
        candidates.push(words[words.length - 1]);
    }

    const seen = new Set<string>();
    return candidates.filter((candidate) => {
        const key = candidate.toLowerCase();
        if (!candidate || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function parseSessionToken(payload: unknown): string | null {
    if (Array.isArray(payload)) {
        const first = payload[0];
        if (first && typeof first === 'object' && 'token' in first) {
            const token = String((first as { token?: unknown }).token ?? '').trim();
            return token || null;
        }
    }
    if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        const direct = String(obj.token ?? '').trim();
        if (direct) return direct;
        const nested = obj.data;
        if (nested && typeof nested === 'object') {
            const nestedToken = String((nested as { token?: unknown }).token ?? '').trim();
            if (nestedToken) return nestedToken;
        }
    }
    return null;
}

function extractApiMessage(payload: unknown, fallback: string): string {
    if (!payload || typeof payload !== 'object') return fallback;
    const obj = payload as { message?: string; error?: string };
    const message = String(obj.message ?? obj.error ?? '').trim();
    return message || fallback;
}

async function exchangeSessionToken(): Promise<string> {
    const now = Date.now();
    if (cachedSession && cachedSession.expiresAt > now + 30_000) {
        return cachedSession.token;
    }

    const body = JSON.stringify({
        auth: {
            authentication_token: datamerchAuthToken(),
            authentication_key: datamerchAuthKey(),
        },
    });

    const base = datamerchApiBase();
    const endpoints = [`${base}/token`, `${base}/get_token`];
    let lastError = 'DataMerch authentication failed.';

    for (const url of endpoints) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
            lastError = extractApiMessage(payload, `DataMerch auth failed (${response.status}).`);
            continue;
        }

        const sessionToken = parseSessionToken(payload);
        if (!sessionToken) {
            lastError = 'DataMerch auth response did not include a session token.';
            continue;
        }

        cachedSession = {
            token: sessionToken,
            expiresAt: now + 60 * 60 * 1000,
        };
        return sessionToken;
    }

    cachedSession = null;
    throw new ValidationError(lastError);
}

async function datamerchGet(pathSuffix: string): Promise<unknown> {
    const sessionToken = await exchangeSessionToken();
    const url = `${datamerchApiBase()}/${pathSuffix.replace(/^\//, '')}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
        },
    });

    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
        cachedSession = null;
        throw new ValidationError('DataMerch session expired. Please retry.');
    }
    if (!response.ok) {
        throw new ValidationError(
            extractApiMessage(payload, `DataMerch request failed (${response.status}).`),
        );
    }

    return payload;
}

function normalizeRecord(raw: unknown): DataMerchRecord | null {
    if (!raw || typeof raw !== 'object') return null;
    const source =
        'note' in (raw as Record<string, unknown>) &&
        (raw as { note?: unknown }).note &&
        typeof (raw as { note?: unknown }).note === 'object'
            ? ((raw as { note: Record<string, unknown> }).note as Record<string, unknown>)
            : (raw as Record<string, unknown>);

    const note = String(source.note ?? source.notes ?? '').trim();
    const category = String(source.category ?? 'Record').trim();
    if (!note && !category) return null;

    return {
        category: category || 'Record',
        note: note || '—',
        addedBy: source.added_by != null ? String(source.added_by) : null,
        createdAt: source.created_at != null ? String(source.created_at) : null,
    };
}

function normalizeMerchantEntry(raw: unknown): DataMerchMerchant | null {
    if (!raw || typeof raw !== 'object') return null;
    const wrapper = raw as Record<string, unknown>;
    const merchant =
        wrapper.merchant && typeof wrapper.merchant === 'object'
            ? (wrapper.merchant as Record<string, unknown>)
            : wrapper;

    const legalName = String(merchant.legal_name ?? merchant.name ?? '').trim() || null;
    const fein = String(merchant.fein ?? merchant.ein ?? '').trim() || null;
    const notesRaw = merchant.notes ?? merchant.records;
    const records = Array.isArray(notesRaw)
        ? notesRaw
              .map(normalizeRecord)
              .filter((record): record is DataMerchRecord => record != null)
        : [];

    if (!legalName && !fein && records.length === 0) return null;

    return {
        fein,
        legalName,
        dba: String(merchant.dba ?? '').trim() || null,
        address: String(merchant.address ?? '').trim() || null,
        street1: String(merchant.street1 ?? '').trim() || null,
        street2: String(merchant.street2 ?? '').trim() || null,
        city: String(merchant.city ?? '').trim() || null,
        state: String(merchant.state ?? '').trim() || null,
        industry: String(merchant.industry ?? '').trim() || null,
        businessPhone: String(merchant.business_phone ?? '').trim() || null,
        businessStartDate: normalizeMerchantDate(merchant.business_startdate),
        records,
    };
}

function normalizeMerchantDate(raw: unknown): string | null {
    const value = String(raw ?? '').trim();
    if (!value || value === '0001-01-01') return null;
    return value;
}

function coerceMerchants(payload: unknown): DataMerchMerchant[] {
    const list = Array.isArray(payload)
        ? payload
        : payload && typeof payload === 'object' && Array.isArray((payload as { merchants?: unknown[] }).merchants)
          ? ((payload as { merchants: unknown[] }).merchants ?? [])
          : [];

    return list
        .map(normalizeMerchantEntry)
        .filter((merchant): merchant is DataMerchMerchant => merchant != null);
}

function merchantKey(merchant: DataMerchMerchant): string {
    const feinDigits = String(merchant.fein ?? '').replace(/\D/g, '');
    if (feinDigits) return `fein:${feinDigits}`;
    return `name:${String(merchant.legalName ?? '').toLowerCase()}`;
}

function mergeMerchants(existing: DataMerchMerchant[], incoming: DataMerchMerchant[]): DataMerchMerchant[] {
    const map = new Map<string, DataMerchMerchant>();
    for (const merchant of [...existing, ...incoming]) {
        const key = merchantKey(merchant);
        const prior = map.get(key);
        if (!prior) {
            map.set(key, merchant);
            continue;
        }
        const recordKeys = new Set(
            prior.records.map((r) => `${r.category}|${r.note}|${r.createdAt ?? ''}`),
        );
        for (const record of merchant.records) {
            const recordKey = `${record.category}|${record.note}|${record.createdAt ?? ''}`;
            if (!recordKeys.has(recordKey)) {
                prior.records.push(record);
                recordKeys.add(recordKey);
            }
        }
    }
    return Array.from(map.values());
}

export const datamerchService = {
    normalizeEin,
    normalizeBusinessName,
    buildNameSearchCandidates,

    async searchMerchants(query: string): Promise<DataMerchLookupResult> {
        const trimmed = String(query ?? '').trim();
        if (!trimmed) {
            throw new ValidationError('A merchant EIN or business name is required for DataMerch lookup.');
        }

        const einDigits = normalizeEin(trimmed);
        const searchQuery = einDigits ?? trimmed;
        const searchType: 'ein' | 'name' = einDigits ? 'ein' : 'name';
        const encoded = encodeURIComponent(searchQuery);
        const raw = await datamerchGet(`merchants/${encoded}`);

        return {
            searchQuery,
            searchType,
            businessName: searchType === 'name' ? searchQuery : null,
            ein: einDigits,
            merchants: coerceMerchants(raw),
            searchAttempts: [searchQuery],
            raw,
        };
    },

    async searchMerchantsByNameWithFallback(businessName: string): Promise<DataMerchLookupResult> {
        const candidates = buildNameSearchCandidates(businessName);
        if (candidates.length === 0) {
            throw new ValidationError('A business name is required for DataMerch lookup.');
        }

        let merged: DataMerchMerchant[] = [];
        const attempts: string[] = [];
        let lastRaw: unknown = [];
        let matchedQuery = candidates[0];

        for (const candidate of candidates) {
            attempts.push(candidate);
            const result = await this.searchMerchants(candidate);
            lastRaw = result.raw;
            if (result.merchants.length > 0) {
                matchedQuery = candidate;
                merged = mergeMerchants(merged, result.merchants);
                // Stop after first keyword hit — DataMerch returns up to 5 partial matches.
                break;
            }
        }

        return {
            searchQuery: matchedQuery,
            searchType: 'name',
            businessName,
            ein: null,
            merchants: merged,
            searchAttempts: attempts,
            raw: lastRaw,
        };
    },

    async lookupForApplication(applicationId: string): Promise<DataMerchLookupResult> {
        const id = String(applicationId ?? '').trim();
        if (!id) {
            throw new ValidationError('applicationId is required.');
        }

        const application = await prisma.application.findFirst({
            where: {
                OR: [
                    { id },
                    ...(Number.isFinite(Number(id)) ? [{ applicationId: Number(id) }] : []),
                    { dealId: id },
                ],
            },
            include: {
                client: {
                    select: {
                        businessName: true,
                        businessEinNumber: true,
                    },
                },
            },
        });

        if (!application) {
            throw new NotFoundError('Application not found.');
        }

        const businessName = normalizeBusinessName(application.client?.businessName);
        const ein = normalizeEin(application.client?.businessEinNumber);

        if (ein) {
            try {
                const byEin = await this.searchMerchants(ein);
                if (byEin.merchants.length > 0) {
                    return { ...byEin, businessName, ein };
                }
            } catch {
                // Fall through to keyword legal-name search.
            }
        }

        if (businessName) {
            const byName = await this.searchMerchantsByNameWithFallback(businessName);
            return { ...byName, businessName, ein };
        }

        throw new ValidationError(
            'This deal has no business EIN or legal name. Add business details before running DataMerch.',
        );
    },
};
