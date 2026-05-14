import * as XLSX from 'xlsx';
import prisma from '../config/prismaClient';
import { applicationCreateUncheckedData } from '../utils/prisma/applicationCreateUncheckedData';
import {
    deriveFrequency,
    frequencySpecToStored,
    normalizeTermForOfferDecision,
} from '../utils/deriveFrequencyFromTerm';

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

async function applicationExistsByDealId(
    db: Pick<typeof prisma, 'application'> | DbTx,
    dealIdNormalized: string,
): Promise<boolean> {
    if (!dealIdNormalized) return false;
    const dealIdMarker = `[DEAL_ID:${dealIdNormalized}]`;
    const existing = await db.application.findFirst({
        where: {
            OR: [
                { dealId: { equals: dealIdNormalized, mode: 'insensitive' } },
                { note: { contains: dealIdMarker, mode: 'insensitive' } },
                { note: { contains: dealIdNormalized, mode: 'insensitive' } },
            ],
        },
        select: { id: true },
    });
    return Boolean(existing);
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
    failedCount: number;
    errors: BulkImportRowError[];
};

export type BulkImportProgress = {
    totalRows: number;
    processedRows: number;
    successCount: number;
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

function strOrNA(v: unknown): string {
    const t = trimStr(v);
    return t === '' ? NA : t;
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
            dealId: cell(row, col, 'dealId'),
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
 * Inserts applications (and related rows) from parsed sheet rows. One transaction per row so a failure never leaves a half-inserted graph.
 */
export async function ingestApplicationBulkRows(
    rows: Record<string, unknown>[],
    actorUserId: string,
    onProgress?: (progress: BulkImportProgress) => void,
): Promise<BulkImportSummary> {
    const errors: BulkImportRowError[] = [];
    let successCount = 0;
    const dealIdsSeenInBatch = new Set<string>();
    const clientCache = new Map<string, string>();

    for (const raw of rows) {
        const excelRowNumber = Number(raw.__excelRow) || 0;
        const emitProgress = (currentSuccess: number, currentFailed: number) => {
            if (!onProgress) return;
            onProgress({
                totalRows: rows.length,
                processedRows: currentSuccess + currentFailed,
                successCount: currentSuccess,
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
            emitProgress(successCount, errors.length);
            continue;
        }

        const dealIdKey = trimStr(raw.dealId);
        if (!dealIdKey) {
            errors.push({
                excelRowNumber,
                message: 'Missing deal id — row skipped.',
                dealName: dealNameTrim,
            });
            emitProgress(successCount, errors.length);
            continue;
        }

        const dealIdDedupeKey = dealIdKey.toLowerCase();
        if (dealIdsSeenInBatch.has(dealIdDedupeKey)) {
            errors.push({
                excelRowNumber,
                message: 'Duplicate deal id in this file — row skipped.',
                dealId: dealIdKey,
                dealName: dealNameTrim,
            });
            emitProgress(successCount, errors.length);
            continue;
        }

        if (await applicationExistsByDealId(prisma, dealIdKey)) {
            errors.push({
                excelRowNumber,
                message: 'An application with this deal id already exists — row skipped (no client or application created).',
                dealId: dealIdKey,
                dealName: dealNameTrim,
            });
            emitProgress(successCount, errors.length);
            continue;
        }

        const createdAt = parseExcelDate(raw.date);
        if (!createdAt) {
            errors.push({
                excelRowNumber,
                message: 'Invalid or missing date — row skipped.',
                dealId: dealIdKey,
                dealName: dealNameTrim,
            });
            emitProgress(successCount, errors.length);
            continue;
        }

        const typeVal = strOrNA(raw.type);
        const offerNum = parseMoneyToNumber(raw.offer);
        const feesNum = parseMoneyToNumber(raw.fees);
        const rateNum = parseRateToNumber(raw.rate);
        const commissionNum = parseMoneyToNumber(raw.commission) ?? 0;
        const isoCell = trimStr(raw.iso);
        const termStored = normalizeTermForOfferDecision(raw.term);
        const frequencyStored = frequencySpecToStored(deriveFrequency(trimStr(raw.term)));
        const repayPerPeriodNum = parseMoneyToNumber(raw.repayPerPeriod);
        const refinanceAmountNum = parseMoneyToNumber(raw.refinanceAmount);

        try {
            await prisma.$transaction(
                async (tx) => {
                    if (await applicationExistsByDealId(tx, dealIdKey)) {
                        throw new SkipRowIngestError(
                            'An application with this deal id already exists — row skipped (no client or application created).',
                        );
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
                            commissionAmount: commissionNum,
                            dealId: dealIdKey,
                            dealDisplayName: dealNameTrim,
                            currentQueue: 'Funded',
                            currentState: 'FUNDED',
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

                    const payoutIsoId = isoResolved.id;
                    await tx.isoApplicationPayout.create({
                        data: {
                            isoId: payoutIsoId,
                            applicationId: application.id,
                        },
                    });
                },
                { maxWait: 20_000, timeout: 60_000 },
            );

            dealIdsSeenInBatch.add(dealIdDedupeKey);
            successCount += 1;
            emitProgress(successCount, errors.length);
        } catch (e) {
            if (e instanceof SkipRowIngestError) {
                errors.push({
                    excelRowNumber,
                    message: e.message,
                    dealId: dealIdKey,
                    dealName: dealNameTrim,
                });
                emitProgress(successCount, errors.length);
                continue;
            }
            const msg = e instanceof Error ? e.message : String(e);
            errors.push({
                excelRowNumber,
                message: msg,
                dealId: dealIdKey,
                dealName: dealNameTrim,
            });
            emitProgress(successCount, errors.length);
        }
    }

    return {
        totalRows: rows.length,
        successCount,
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
            failedCount: parseErrors.length,
            errors: parseErrors,
        };
    }
    const ingest = await ingestApplicationBulkRows(rows, actorUserId);
    const mergedErrors = [...parseErrors, ...ingest.errors];
    return {
        totalRows: rows.length,
        successCount: ingest.successCount,
        failedCount: mergedErrors.length,
        errors: mergedErrors,
    };
}
