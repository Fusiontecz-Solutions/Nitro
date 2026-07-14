import * as XLSX from 'xlsx';
import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import { applicationCreateUncheckedData } from '../utils/prisma/applicationCreateUncheckedData';
import {
    deriveFrequency,
    frequencySpecToStored,
    normalizeTermForOfferDecision,
} from '../utils/deriveFrequencyFromTerm';
import { deriveOrganizationFromDealId } from '../utils/deriveOrganizationFromDealId';

type DbTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const NA = 'NA';
/** ISO row used when the sheet has commission but no ISO (schema requires `isoId` on `IsoApplicationPayout`). */
export const BULK_IMPORT_PLACEHOLDER_ISO_NAME = '[IMPORT] Unassigned ISO';

/** Thrown inside a row transaction to skip cleanly (e.g. duplicate deal id race). */
class SkipRowIngestError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SkipRowIngestError';
    }
}

/**
 * Sleep for the given milliseconds. Used between retry attempts for transient DB errors.
 */
function sleepMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Best-effort detection for transient database errors that are safe to retry. Covers Prisma's
 * connection / pool exhaustion / serialization codes as well as the textual fallbacks for raw
 * `pg` connection drops that surface from Neon's serverless driver under load.
 */
function isRetryableDbError(err: unknown): boolean {
    if (!err) return false;
    const anyErr = err as { code?: unknown; message?: unknown; name?: unknown };
    const code = typeof anyErr.code === 'string' ? anyErr.code : '';
    const name = typeof anyErr.name === 'string' ? anyErr.name : '';
    const message =
        typeof anyErr.message === 'string' ? anyErr.message.toLowerCase() : '';

    // Prisma error codes that are safe to retry.
    if (
        code === 'P1001' || // Can't reach DB server
        code === 'P1002' || // DB server timed out
        code === 'P1008' || // Operations timed out
        code === 'P1017' || // Server closed the connection
        code === 'P2024' || // Connection pool timeout
        code === 'P2034' // Transaction failed due to write conflict / serialization
    ) {
        return true;
    }

    // Postgres-level transient codes (serialization failure / deadlock).
    if (code === '40001' || code === '40P01' || code === '57P01' || code === '57P03') {
        return true;
    }

    if (
        name === 'PrismaClientRustPanicError' ||
        name === 'PrismaClientInitializationError'
    ) {
        return true;
    }

    if (!message) return false;
    return (
        message.includes('connection') ||
        message.includes('terminated unexpectedly') ||
        message.includes('econnreset') ||
        message.includes('etimedout') ||
        message.includes('socket hang up') ||
        message.includes('connection pool') ||
        message.includes('connection terminated') ||
        message.includes('write conflict') ||
        message.includes('deadlock detected')
    );
}

/**
 * Wrap a database operation so transient connection / serialization failures are retried with
 * exponential backoff. Non-retryable errors are re-thrown immediately so they still surface as
 * row-level errors in the import summary.
 */
async function withDbRetry<T>(
    op: () => Promise<T>,
    opts: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
    const maxAttempts = opts.maxAttempts ?? 5;
    const baseDelayMs = opts.baseDelayMs ?? 250;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await op();
        } catch (err) {
            lastErr = err;
            if (attempt >= maxAttempts || !isRetryableDbError(err)) {
                throw err;
            }
            const delay = baseDelayMs * 2 ** (attempt - 1);
            const jitter = Math.floor(Math.random() * baseDelayMs);
            if (opts.label) {
                console.warn(
                    `[bulk-import] transient DB error during ${opts.label} (attempt ${attempt}/${maxAttempts}); retrying in ${
                        delay + jitter
                    }ms`,
                    err instanceof Error ? err.message : err,
                );
            }
            await sleepMs(delay + jitter);
        }
    }
    throw lastErr;
}

type ExistingAppLookup = {
    id: string;
    clientId: string;
    isoId: string | null;
    dealId: string | null;
    note: string | null;
};

/**
 * Find an existing application by deal id. We accept legacy rows that only carry the deal id in
 * the `note` marker (`[DEAL_ID:xxx]`), in addition to the canonical `dealId` column.
 */
async function findApplicationByDealId(
    db: Pick<typeof prisma, 'application'> | DbTx,
    dealIdNormalized: string,
): Promise<ExistingAppLookup | null> {
    if (!dealIdNormalized) return null;
    const dealIdMarker = `[DEAL_ID:${dealIdNormalized}]`;
    const existing = await db.application.findFirst({
        where: {
            OR: [
                { dealId: { equals: dealIdNormalized, mode: 'insensitive' } },
                { note: { contains: dealIdMarker, mode: 'insensitive' } },
                { note: { contains: dealIdNormalized, mode: 'insensitive' } },
            ],
        },
        select: { id: true, clientId: true, isoId: true, dealId: true, note: true },
    });
    return existing as ExistingAppLookup | null;
}

export type BulkImportRowError = {
    excelRowNumber: number;
    message: string;
    dealId?: string | null;
    dealName?: string | null;
};

export type BulkImportSummary = {
    totalRows: number;
    successCount: number;
    /** Rows that matched an existing application by deal id and were updated in place. */
    updatedCount: number;
    failedCount: number;
    errors: BulkImportRowError[];
};

export type BulkImportProgress = {
    totalRows: number;
    processedRows: number;
    successCount: number;
    /** Rows that matched an existing application by deal id and were updated in place. */
    updatedCount: number;
    failedCount: number;
    currentExcelRowNumber?: number;
};

function trimStr(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString();
    // Strip BOM and zero-width chars that appear in exported CSV/Excel headers.
    return String(v)
        .replace(/^\uFEFF/, '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .trim();
}

/** Collapse header text for case-insensitive column matching (handles "Deal ID", "deal id", etc.). */
function canonicalHeader(h: unknown): string {
    return trimStr(h)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .replace(/\s+/g, ' ')
        .replace(/[^a-z0-9 ]+/g, '')
        .replace(/\s+/g, '');
}

/** Map normalized header → logical field key. */
function headerToFieldKey(canonical: string): string | null {
    const aliases: Record<string, string> = {
        dealid: 'dealId',
        dealno: 'dealId',
        id: 'dealId',
        dealname: 'dealName',
        merchant: 'dealName',
        client: 'dealName',
        businessname: 'dealName',
        date: 'date',
        fundeddate: 'date',
        type: 'type',
        status: 'status',
        offer: 'offer',
        funded: 'offer',
        fees: 'fees',
        fee: 'fees',
        commission: 'commission',
        iso: 'iso',
        broker: 'iso',
        term: 'term',
        tenor: 'term',
        loanterm: 'term',
        contractterm: 'term',
        repaymentterm: 'term',
        rate: 'rate',
        factorrate: 'rate',
        repayperperiod: 'repayPerPeriod',
        repaymentperperiod: 'repayPerPeriod',
        payperperiod: 'repayPerPeriod',
        paymentperperiod: 'repayPerPeriod',
        refinance: 'refinanceAmount',
        refi: 'refinanceAmount',
        refinanceamount: 'refinanceAmount',
        refinaceamount: 'refinanceAmount',
        refinancingamount: 'refinanceAmount',
        refinanceamt: 'refinanceAmount',
        refiamount: 'refinanceAmount',
        payoffamount: 'refinanceAmount',
        refinancepayoff: 'refinanceAmount',
        refirolloveramount: 'refinanceAmount',
    };
    return aliases[canonical.replace(/\s/g, '')] ?? aliases[canonical] ?? null;
}

/**
 * One client per business: strip trailing " #1", " #2", … from deal/merchant names so
 * "TTR MANUFACTURING #1" … "#3" all map to the same client ("TTR MANUFACTURING").
 */
export function baseBusinessNameForClientDedupe(dealName: string): string {
    const t = dealName.replace(/\s+/g, ' ').trim();
    const stripped = t.replace(/\s*#\d+\s*$/i, '').trim();
    return stripped || t;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Currency and Indian-style grouped integers: `$1,08,000.00` → 108000. */
export function parseMoneyToNumber(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && !Number.isNaN(v)) return v;
    let s = trimStr(v);
    if (!s) return null;
    s = s.replace(/\$/g, '').replace(/\s/g, '');
    const neg = s.startsWith('(') && s.endsWith(')');
    if (neg) s = s.slice(1, -1);
    s = s.replace(/,/g, '');
    if (!s) return null;
    const n = Number.parseFloat(s);
    if (Number.isNaN(n)) return null;
    return neg ? -n : n;
}

/**
 * Parses sheet dates and strings like `5-5-2023` (M-D-YYYY) without UTC shift surprises.
 * Handles Excel serial numbers (number or numeric string), ISO `YYYY-MM-DD`, and slash dates
 * (US MDY by default; if the first component is > 12, treats as DMY).
 */
export function parseExcelDate(v: unknown): Date | null {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
    if (typeof v === 'number' && Number.isFinite(v)) {
        const d = XLSX.SSF?.parse_date_code?.(v);
        if (d && typeof d.y === 'number') {
            return new Date(d.y, (d.m ?? 1) - 1, d.d ?? 1, 12, 0, 0, 0);
        }
        const epoch = new Date(1899, 11, 30, 12, 0, 0, 0);
        return new Date(epoch.getTime() + Math.round(v * 86400000));
    }
    const s = trimStr(v);
    if (!s) return null;

    // Plain numeric string from Excel (serial) when `sheet_to_json` / preview used raw values.
    if (/^-?\d+(\.\d+)?$/.test(s)) {
        const n = Number(s);
        if (Number.isFinite(n) && n >= 25569 && n < 600000) {
            return parseExcelDate(n);
        }
    }

    const isoYmd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (isoYmd) {
        const year = Number.parseInt(isoYmd[1], 10);
        const month = Number.parseInt(isoYmd[2], 10) - 1;
        const day = Number.parseInt(isoYmd[3], 10);
        const d = new Date(year, month, day, 12, 0, 0, 0);
        if (d.getFullYear() === year && d.getMonth() === month && d.getDate() === day) return d;
    }

    const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
    if (slash) {
        const first = Number.parseInt(slash[1], 10);
        const second = Number.parseInt(slash[2], 10);
        let year = Number.parseInt(slash[3], 10);
        if (year < 100) year += 2000;
        let month0: number;
        let day: number;
        if (first > 12) {
            // DMY: 25/03/2024
            day = first;
            month0 = second - 1;
        } else if (second > 12) {
            // MDY: 03/25/2024
            month0 = first - 1;
            day = second;
        } else {
            // Ambiguous (both ≤ 12): keep MDY for backward compatibility with US sheets.
            month0 = first - 1;
            day = second;
        }
        const d = new Date(year, month0, day, 12, 0, 0, 0);
        if (d.getFullYear() === year && d.getMonth() === month0 && d.getDate() === day) return d;
    }

    const d2 = new Date(s);
    return Number.isNaN(d2.getTime()) ? null : d2;
}

function buildColumnIndex(headerRow: unknown[]): Map<string, number> {
    const map = new Map<string, number>();
    headerRow.forEach((cell, idx) => {
        const raw = trimStr(cell);
        if (!raw) return;
        const key = headerToFieldKey(canonicalHeader(cell));
        if (key && !map.has(key)) map.set(key, idx);
    });
    return map;
}

function cell(row: unknown[], col: Map<string, number>, field: string): unknown {
    const i = col.get(field);
    if (i === undefined) return '';
    return row[i];
}

/** Prefer Excel formatted text (`cell.w`) so deal ids like `KK1000` are not lost to numeric coercion. */
function cellForField(
    ws: XLSX.WorkSheet,
    rowIndex0: number,
    row: unknown[],
    col: Map<string, number>,
    field: string,
): unknown {
    const i = col.get(field);
    if (i === undefined) return '';
    const addr = XLSX.utils.encode_cell({ r: rowIndex0, c: i });
    const sheetCell = ws[addr];
    const formatted = sheetCell?.w != null ? trimStr(sheetCell.w) : '';
    if (formatted) return formatted;
    return row[i];
}

function normalizeDealIdFromSheet(v: unknown): string {
    const raw = trimStr(v);
    if (!raw) return '';
    return raw.replace(/^['']+/g, '').trim();
}

async function getOrCreatePlaceholderIso(tx: DbTx): Promise<{ id: string }> {
    const existing = await tx.iso.findFirst({
        where: { name: BULK_IMPORT_PLACEHOLDER_ISO_NAME },
        select: { id: true },
    });
    if (existing) return existing;
    return tx.iso.create({
        data: {
            name: BULK_IMPORT_PLACEHOLDER_ISO_NAME,
            email: null,
            phone: null,
            bankAccountNo: NA,
            routingNumber: NA,
            commissionPercentage: 0,
        },
        select: { id: true },
    });
}

async function resolveIso(
    tx: DbTx,
    isoNameRaw: string,
    placeholderIsoId: string,
): Promise<{ id: string; isPlaceholder: boolean }> {
    const name = trimStr(isoNameRaw);
    if (!name) {
        return { id: placeholderIsoId, isPlaceholder: true };
    }
    const found = await tx.iso.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
    });
    if (found) return { id: found.id, isPlaceholder: false };
    const created = await tx.iso.create({
        data: {
            name,
            email: null,
            phone: null,
            bankAccountNo: NA,
            routingNumber: NA,
            commissionPercentage: 0,
        },
        select: { id: true },
    });
    return { id: created.id, isPlaceholder: false };
}

/**
 * Resolve or create a single Client for a deal row: same base name (after stripping " #N")
 * shares one client; applications stay distinct per deal id.
 */
async function ensureClientByDealName(
    tx: DbTx,
    dealName: string,
    actorUserId: string,
    cache: Map<string, string>,
): Promise<string> {
    const displayName = dealName.replace(/\s+/g, ' ').trim();
    const baseName = baseBusinessNameForClientDedupe(displayName);
    const cacheKey = baseName.toLowerCase();

    const cacheHit = cache.get(cacheKey);
    if (cacheHit) return cacheHit;

    let found = await tx.client.findFirst({
        where: { businessName: { equals: baseName, mode: 'insensitive' } },
        select: { id: true },
        orderBy: { clientId: 'asc' },
    });
    if (!found) {
        found = await tx.client.findFirst({
            where: { businessName: { equals: displayName, mode: 'insensitive' } },
            select: { id: true },
            orderBy: { clientId: 'asc' },
        });
    }
    if (!found && baseName.length > 0) {
        const numberedPrefix = `${baseName} #`;
        const legacyRows = await tx.client.findMany({
            where: { businessName: { startsWith: numberedPrefix, mode: 'insensitive' } },
            take: 40,
            select: { id: true, businessName: true },
            orderBy: { clientId: 'asc' },
        });
        const legacyRe = new RegExp(`^${escapeRegExp(baseName)}\\s*#\\d+\\s*$`, 'i');
        const legacy = legacyRows.find((r) => legacyRe.test(String(r.businessName).trim()));
        if (legacy) found = { id: legacy.id };
    }

    if (found) {
        cache.set(cacheKey, found.id);
        return found.id;
    }

    const created = await tx.client.create({
        data: {
            businessName: baseName,
            ownerFirstName: NA,
            ownerLastName: NA,
            createdById: actorUserId,
        },
        select: { id: true },
    });
    cache.set(cacheKey, created.id);
    return created.id;
}

/** Parse percent-like cells for rate columns (`1.39%`, `0.0139`, `1.39`). */
function parseRateToNumber(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number' && Number.isFinite(v)) {
        // Excel often stores percentage-formatted cells as fractions (e.g. 1.39% -> 0.0139).
        if (v > 0 && v < 1) return v * 100;
        return v;
    }
    let s = trimStr(v);
    if (!s) return null;
    s = s.replace(/%/g, '').trim();
    const n = parseMoneyToNumber(s);
    if (n == null) return null;
    // String values may still come as decimal fractions.
    if (n > 0 && n < 1) return n * 100;
    return n;
}

/**
 * Parses the first worksheet: row 1 = headers, data starts after optional summary row.
 */
export function parseApplicationBulkSheet(buffer: Buffer): {
    rows: Record<string, unknown>[];
    errors: BulkImportRowError[];
} {
    const errors: BulkImportRowError[] = [];
    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch (e) {
        errors.push({
            excelRowNumber: 0,
            message: `Failed to read workbook: ${e instanceof Error ? e.message : String(e)}`,
        });
        return { rows: [], errors };
    }
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        errors.push({ excelRowNumber: 0, message: 'Workbook has no sheets' });
        return { rows: [], errors };
    }
    const ws = workbook.Sheets[sheetName];
    // `raw: true` preserves numeric refinance/offer/fees cells; money/date parsers accept both strings and numbers.
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
    if (aoa.length < 2) {
        errors.push({
            excelRowNumber: 0,
            message: 'Expected a header row and at least one data row.',
        });
        return { rows: [], errors };
    }

    const headerRow = aoa[0] ?? [];
    const col = buildColumnIndex(headerRow);
    if (!col.has('dealName') || !col.has('dealId')) {
        errors.push({
            excelRowNumber: 1,
            message: 'Required columns "Deal Name" and "Deal ID" were not found (headers are matched case-insensitively).',
        });
        return { rows: [], errors };
    }

    // Start directly after the header row. This avoids accidentally dropping a real first data row.
    // Empty rows are skipped below and invalid rows are reported with exact Excel row numbers.
    const dataStartIndex = 1;

    const out: Record<string, unknown>[] = [];
    for (let r = dataStartIndex; r < aoa.length; r++) {
        const row = aoa[r] ?? [];
        const excelRowNumber = r + 1;
        const isEmpty = (row as unknown[]).every((c) => trimStr(c) === '');
        if (isEmpty) continue;

        out.push({
            __excelRow: excelRowNumber,
            dealId: normalizeDealIdFromSheet(cellForField(ws, r, row, col, 'dealId')),
            dealName: cell(row, col, 'dealName'),
            date: cell(row, col, 'date'),
            type: cell(row, col, 'type'),
            status: cell(row, col, 'status'),
            offer: cell(row, col, 'offer'),
            fees: cell(row, col, 'fees'),
            rate: cell(row, col, 'rate'),
            commission: cell(row, col, 'commission'),
            iso: cell(row, col, 'iso'),
            term: cell(row, col, 'term'),
            repayPerPeriod: cell(row, col, 'repayPerPeriod'),
            refinanceAmount: cell(row, col, 'refinanceAmount'),
        });
    }
    return { rows: out, errors };
}

/**
 * Inserts applications (and related rows) from parsed sheet rows, or updates an existing application
 * in place when its deal id already exists. One transaction per row so a failure never leaves a
 * half-inserted graph. Updates preserve the application's current `clientId` (we never re-parent an
 * existing application to a different client) and only overwrite fields that have an explicit value
 * in the sheet — empty cells leave existing values untouched.
 */
export async function ingestApplicationBulkRows(
    rows: Record<string, unknown>[],
    actorUserId: string,
    onProgress?: (progress: BulkImportProgress) => void,
): Promise<BulkImportSummary> {
    const errors: BulkImportRowError[] = [];
    let successCount = 0;
    let updatedCount = 0;
    const dealIdsSeenInBatch = new Set<string>();
    const clientCache = new Map<string, string>();

    for (const raw of rows) {
        const excelRowNumber = Number(raw.__excelRow) || 0;
        const emitProgress = (
            currentSuccess: number,
            currentUpdated: number,
            currentFailed: number,
        ) => {
            if (!onProgress) return;
            onProgress({
                totalRows: rows.length,
                processedRows: currentSuccess + currentUpdated + currentFailed,
                successCount: currentSuccess,
                updatedCount: currentUpdated,
                failedCount: currentFailed,
                currentExcelRowNumber: excelRowNumber || undefined,
            });
        };
        const dealNameTrim = trimStr(raw.dealName);
        if (!dealNameTrim) {
            errors.push({
                excelRowNumber,
                message: 'Missing deal name — row skipped.',
                dealId: trimStr(raw.dealId) || null,
            });
            emitProgress(successCount, updatedCount, errors.length);
            continue;
        }

        const dealIdKey = normalizeDealIdFromSheet(raw.dealId);
        if (!dealIdKey) {
            errors.push({
                excelRowNumber,
                message: 'Missing deal id — row skipped.',
                dealName: dealNameTrim,
            });
            emitProgress(successCount, updatedCount, errors.length);
            continue;
        }

        const dealIdDedupeKey = dealIdKey.toLowerCase();
        const mappedOrganization = deriveOrganizationFromDealId(dealIdKey);
        if (dealIdsSeenInBatch.has(dealIdDedupeKey)) {
            errors.push({
                excelRowNumber,
                message: 'Duplicate deal id in this file — row skipped.',
                dealId: dealIdKey,
                dealName: dealNameTrim,
            });
            emitProgress(successCount, updatedCount, errors.length);
            continue;
        }

        // Everything below this point must NEVER throw out of the loop — a transient DB blip on
        // row N must not stop the import of rows N+1..end. Any error is captured into `errors`
        // and the loop continues. Retryable errors (Neon connection drops, pool timeouts, etc.)
        // are retried automatically by `withDbRetry` before being recorded as a row failure.
        try {
            const existingApp = await withDbRetry(
                () => findApplicationByDealId(prisma, dealIdKey),
                { label: `findApplicationByDealId(row ${excelRowNumber})` },
            );

            const createdAt = parseExcelDate(raw.date);
            // Date is only mandatory when creating a brand-new application; updates can omit it
            // and we'll keep the previous `createdAt` intact.
            if (!existingApp && !createdAt) {
                errors.push({
                    excelRowNumber,
                    message: 'Invalid or missing date — row skipped.',
                    dealId: dealIdKey,
                    dealName: dealNameTrim,
                });
                emitProgress(successCount, updatedCount, errors.length);
                continue;
            }

            const typeRaw = trimStr(raw.type);
            const typeVal = typeRaw || NA;
            const offerNum = parseMoneyToNumber(raw.offer);
            const feesNum = parseMoneyToNumber(raw.fees);
            const rateNum = parseRateToNumber(raw.rate);
            const commissionRaw = trimStr(raw.commission);
            const commissionParsed = commissionRaw
                ? parseMoneyToNumber(raw.commission)
                : null;
            const commissionNumForCreate = commissionParsed ?? 0;
            const isoCell = trimStr(raw.iso);
            const termRaw = trimStr(raw.term);
            const termStored = normalizeTermForOfferDecision(raw.term);
            const frequencyStored = frequencySpecToStored(deriveFrequency(termRaw));
            const repayPerPeriodNum = parseMoneyToNumber(raw.repayPerPeriod);
            const refinanceAmountNum = parseMoneyToNumber(raw.refinanceAmount);

            const wasUpdate = await withDbRetry(
                () => prisma.$transaction(
                    async (tx): Promise<boolean> => {
                    // Re-check inside the transaction to avoid a duplicate-create race between the
                    // initial lookup and now (e.g. two concurrent imports).
                    const txExisting = await findApplicationByDealId(tx, dealIdKey);

                    if (txExisting) {
                        // UPDATE path: refresh the matched application in place. We never move the
                        // application to a different client and we leave any user-authored `note`
                        // text alone (only ensuring the `[DEAL_ID:xxx]` marker exists).
                        const updateData: Prisma.ApplicationUncheckedUpdateInput = {
                            dealId: dealIdKey,
                            dealDisplayName: dealNameTrim,
                            organization: mappedOrganization,
                        };

                        if (typeRaw) updateData.type = typeVal;
                        if (offerNum != null) updateData.loanAmount = offerNum;
                        if (commissionParsed != null) updateData.commissionAmount = commissionParsed;
                        if (createdAt) updateData.createdAt = createdAt;

                        // Ensure the deal-id marker is present in `note` so future lookups by the
                        // legacy `note`-marker path keep working. Existing user content is kept.
                        const dealIdMarker = `[DEAL_ID:${dealIdKey}]`;
                        const currentNote = txExisting.note ?? '';
                        if (!currentNote.toLowerCase().includes(dealIdMarker.toLowerCase())) {
                            updateData.note = currentNote
                                ? `${currentNote}\n${dealIdMarker}`
                                : dealIdMarker;
                        }

                        let payoutIsoId: string | null = null;
                        if (isoCell) {
                            const placeholderIso = await getOrCreatePlaceholderIso(tx);
                            const isoResolved = await resolveIso(tx, isoCell, placeholderIso.id);
                            updateData.isoId = isoResolved.isPlaceholder ? null : isoResolved.id;
                            payoutIsoId = isoResolved.id;
                        }

                        await tx.application.update({
                            where: { id: txExisting.id },
                            data: updateData,
                        });

                        // OfferDecision is 1:1 with Application — upsert keeps the same row.
                        // For updates, only overwrite columns that have an explicit value in the sheet
                        // so empty cells don't blank out real data. The `create` branch keeps the
                        // legacy default-to-0 behavior for newly minted decision rows.
                        const offerUpdate: Record<string, unknown> = {
                            decision: 'IMPORTED',
                        };
                        if (offerNum != null) offerUpdate.offer = offerNum;
                        if (feesNum != null) offerUpdate.fees = feesNum;
                        if (rateNum != null) offerUpdate.rate = rateNum;
                        if (termRaw) {
                            offerUpdate.term = termStored;
                            offerUpdate.frequency = frequencyStored;
                        }
                        if (repayPerPeriodNum != null) {
                            offerUpdate.repayPerPeriod = repayPerPeriodNum;
                        }
                        if (refinanceAmountNum != null) {
                            offerUpdate.refinanceAmount = refinanceAmountNum;
                        }

                        await tx.offerDecision.upsert({
                            where: { applicationId: txExisting.id },
                            update: offerUpdate,
                            create: {
                                applicationId: txExisting.id,
                                decision: 'IMPORTED',
                                offer: offerNum ?? 0,
                                rate: rateNum,
                                fees: feesNum ?? 0,
                                term: termStored,
                                frequency: frequencyStored,
                                repayPerPeriod: repayPerPeriodNum,
                                refinanceAmount: refinanceAmountNum,
                            },
                        });

                        // Make sure the new iso has a payout row, but don't delete other payouts
                        // (an application may legitimately have multiple iso payouts).
                        if (payoutIsoId) {
                            await tx.isoApplicationPayout.upsert({
                                where: {
                                    isoId_applicationId: {
                                        isoId: payoutIsoId,
                                        applicationId: txExisting.id,
                                    },
                                },
                                update: {},
                                create: {
                                    isoId: payoutIsoId,
                                    applicationId: txExisting.id,
                                },
                            });
                        }

                        return true;
                    }

                    // CREATE path (no existing match).
                    if (!createdAt) {
                        // Defensive — should have been filtered above, but the transaction may have
                        // raced with another import that deleted the previous match.
                        throw new SkipRowIngestError('Invalid or missing date — row skipped.');
                    }
                    const placeholderIso = await getOrCreatePlaceholderIso(tx);
                    const clientId = await ensureClientByDealName(tx, dealNameTrim, actorUserId, clientCache);

                    const isoResolved = await resolveIso(tx, isoCell, placeholderIso.id);
                    const applicationIsoId = isoResolved.isPlaceholder ? null : isoResolved.id;
                    const noteWithDealId = `[DEAL_ID:${dealIdKey}]`;

                    const application = await tx.application.create({
                        data: applicationCreateUncheckedData({
                            priority: NA,
                            type: typeVal,
                            salesRepresentativeId: actorUserId,
                            referringAgentId: null,
                            clientId,
                            createdById: actorUserId,
                            loanAmount: offerNum ?? null,
                            note: noteWithDealId,
                            commissionPercentage: 0,
                            commissionAmount: commissionNumForCreate,
                            dealId: dealIdKey,
                            dealDisplayName: dealNameTrim,
                            currentQueue: 'Funded',
                            currentState: 'FUNDED',
                            organization: mappedOrganization,
                            isoId: applicationIsoId,
                            createdAt,
                        }),
                    });

                    const offerDec = offerNum ?? 0;
                    const feesDec = feesNum ?? 0;
                    await tx.offerDecision.create({
                        data: {
                            applicationId: application.id,
                            decision: 'IMPORTED',
                            offer: offerDec,
                            rate: rateNum,
                            fees: feesDec,
                            term: termStored,
                            frequency: frequencyStored,
                            repayPerPeriod: repayPerPeriodNum,
                            refinanceAmount: refinanceAmountNum,
                        },
                    });

                    await tx.isoApplicationPayout.create({
                        data: {
                            isoId: isoResolved.id,
                            applicationId: application.id,
                        },
                    });
                    return false;
                },
                // Per-row transaction budget: under load Neon can take a while to allocate a
                // connection, so we give each row plenty of headroom rather than fail the whole job.
                { maxWait: 60_000, timeout: 120_000 },
                ),
                { label: `row ${excelRowNumber} transaction`, maxAttempts: 4 },
            );

            dealIdsSeenInBatch.add(dealIdDedupeKey);
            if (wasUpdate) {
                updatedCount += 1;
            } else {
                successCount += 1;
            }
            emitProgress(successCount, updatedCount, errors.length);
        } catch (e) {
            if (e instanceof SkipRowIngestError) {
                errors.push({
                    excelRowNumber,
                    message: e.message,
                    dealId: dealIdKey,
                    dealName: dealNameTrim,
                });
                emitProgress(successCount, updatedCount, errors.length);
                continue;
            }
            const msg = e instanceof Error ? e.message : String(e);
            errors.push({
                excelRowNumber,
                message: msg,
                dealId: dealIdKey,
                dealName: dealNameTrim,
            });
            emitProgress(successCount, updatedCount, errors.length);
            // Defensive: if a single row blows up with something extraordinary (e.g. an OOM-ish
            // crash, an unexpected throw from a helper), log and continue so the import never
            // stalls on row N.
            if (!(e instanceof Error)) {
                console.warn('[bulk-import] row error (non-Error):', e);
            }
        }
    }

    return {
        totalRows: rows.length,
        successCount,
        updatedCount,
        failedCount: errors.length,
        errors,
    };
}

export async function processApplicationBulkExcelBuffer(
    buffer: Buffer,
    actorUserId: string,
): Promise<BulkImportSummary> {
    const { rows, errors: parseErrors } = parseApplicationBulkSheet(buffer);
    if (parseErrors.length && rows.length === 0) {
        return {
            totalRows: 0,
            successCount: 0,
            updatedCount: 0,
            failedCount: parseErrors.length,
            errors: parseErrors,
        };
    }
    const ingest = await ingestApplicationBulkRows(rows, actorUserId);
    const mergedErrors = [...parseErrors, ...ingest.errors];
    return {
        totalRows: rows.length,
        successCount: ingest.successCount,
        updatedCount: ingest.updatedCount,
        failedCount: mergedErrors.length,
        errors: mergedErrors,
    };
}
