import { createHash } from 'crypto';
import { extractOne } from './clearS2sClient';

type ClearReportKind = 'person' | 'business';

export type ClearLienJudgmentKind = 'lien' | 'judgment';

export type ClearLienJudgmentRecord = {
    source: 'clear';
    kind: ClearLienJudgmentKind;
    groupId: string;
    reportKind: ClearReportKind;
    caseNumber?: string;
    court?: string;
    filingDate?: string;
    amount?: string;
    parties?: string;
    status?: string;
    description?: string;
    /** Uploaded CLEAR PDF URL for this report group, when available. */
    pdfUrl?: string;
};

/** NY Court evidence row written into metadata.judgements / metadata.liens. */
export type ClearNyCourtEvidenceItem = {
    id: string;
    kind: 'record';
    name: string;
    url: string;
    source: 'clear';
    court?: string;
    filingDate?: string;
    amount?: string;
    parties?: string;
    caseNumber?: string;
    status?: string;
};

const RECORD_BLOCK_TAGS = [
    'Judgment',
    'Judgement',
    'CivilJudgment',
    'JudgmentRecord',
    'JudgementRecord',
    'Lien',
    'TaxLien',
    'LienRecord',
    'LienJudgment',
    'LienAndJudgment',
    'LienJudgmentRecord',
] as const;

function decodeXmlEntities(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function cleanText(value: string | undefined | null): string {
    return decodeXmlEntities(String(value ?? ''))
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function firstField(block: string, tags: string[]): string {
    for (const tag of tags) {
        const value = cleanText(extractOne(block, tag));
        if (value) return value;
    }
    return '';
}

function extractNamedBlocks(xml: string, tags: readonly string[]): Array<{ tag: string; body: string }> {
    const found: Array<{ tag: string; body: string }> = [];
    for (const tag of tags) {
        const pattern = new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'gi');
        for (const match of xml.matchAll(pattern)) {
            found.push({ tag, body: match[1] ?? '' });
        }
    }
    return found;
}

function classifyRecord(tag: string, block: string): ClearLienJudgmentKind {
    const typeText = [
        tag,
        firstField(block, [
            'DocumentType',
            'FilingType',
            'Type',
            'RecordType',
            'LienType',
            'JudgmentType',
            'JudgementType',
            'Description',
        ]),
    ]
        .join(' ')
        .toLowerCase();

    if (/\bliens?\b|\btax\s*lien\b|\bucc\b/.test(typeText) && !/\bjudg(?:e)?ments?\b/.test(typeText)) {
        return 'lien';
    }
    if (/\bjudg(?:e)?ments?\b/.test(typeText) && !/\bliens?\b/.test(typeText)) {
        return 'judgment';
    }
    if (/^lien/i.test(tag) || /TaxLien/i.test(tag)) return 'lien';
    if (/judg/i.test(tag)) return 'judgment';
    // Mixed LienJudgment wrappers: prefer judgment when both words present without clearer signal.
    if (/lien/i.test(typeText) && !/judg/i.test(typeText)) return 'lien';
    return 'judgment';
}

function buildParties(block: string): string {
    const creditor = firstField(block, ['Creditor', 'CreditorName', 'Plaintiff', 'PlaintiffName']);
    const debtor = firstField(block, ['Debtor', 'DebtorName', 'Defendant', 'DefendantName']);
    const parties = firstField(block, ['Parties', 'PartyNames', 'Party']);
    if (creditor && debtor) return `${creditor} v. ${debtor}`;
    if (parties) return parties;
    return [creditor, debtor].filter(Boolean).join(' / ');
}

function parseRecordBlock(
    tag: string,
    block: string,
    meta: { groupId: string; reportKind: ClearReportKind },
): ClearLienJudgmentRecord | null {
    const caseNumber = firstField(block, [
        'CaseNumber',
        'CaseNo',
        'DocketNumber',
        'DocketNo',
        'FilingNumber',
        'FileNumber',
        'DocumentNumber',
        'Number',
    ]);
    const court = firstField(block, [
        'Court',
        'CourtName',
        'CourtLocation',
        'FilingOffice',
        'Jurisdiction',
        'County',
    ]);
    const filingDate = firstField(block, [
        'FilingDate',
        'FileDate',
        'DateFiled',
        'JudgmentDate',
        'JudgementDate',
        'RecordDate',
        'Date',
    ]);
    const amount = firstField(block, [
        'Amount',
        'JudgmentAmount',
        'JudgementAmount',
        'LienAmount',
        'TotalAmount',
        'OriginalAmount',
        'AwardAmount',
    ]);
    const status = firstField(block, ['Status', 'CaseStatus', 'Disposition', 'ReleaseStatus']);
    const description = firstField(block, [
        'Description',
        'DocumentType',
        'FilingType',
        'Type',
        'LienType',
        'JudgmentType',
        'JudgementType',
    ]);
    const parties = buildParties(block);

    if (!caseNumber && !court && !filingDate && !amount && !parties && !description) {
        return null;
    }

    return {
        source: 'clear',
        kind: classifyRecord(tag, block),
        groupId: meta.groupId,
        reportKind: meta.reportKind,
        caseNumber: caseNumber || undefined,
        court: court || undefined,
        filingDate: filingDate || undefined,
        amount: amount || undefined,
        parties: parties || undefined,
        status: status || undefined,
        description: description || undefined,
    };
}

/**
 * Parse CLEAR person/business report XML for Lien / Judgment rows.
 * Tolerant of tag naming variance across CLEAR report schemas.
 */
export function parseClearLienJudgmentRecords(
    xml: string,
    meta: { groupId: string; reportKind: ClearReportKind },
): ClearLienJudgmentRecord[] {
    if (!xml?.trim()) return [];

    const sectionBodies = extractNamedBlocks(xml, [
        'LienJudgmentSection',
        'LienJudgment',
        'LiensJudgments',
        'LienAndJudgmentSection',
    ]).map((entry) => entry.body);
    const searchXml = sectionBodies.length > 0 ? sectionBodies.join('\n') : xml;

    const blocks = extractNamedBlocks(searchXml, RECORD_BLOCK_TAGS);
    const records: ClearLienJudgmentRecord[] = [];
    const seen = new Set<string>();

    for (const { tag, body } of blocks) {
        if (!body.trim()) continue;
        // Prefer leaf records; skip wrappers that only nest other lien/judgment blocks.
        const nestedChildren = extractNamedBlocks(
            body,
            RECORD_BLOCK_TAGS.filter((childTag) => childTag !== tag),
        );
        if (nestedChildren.length > 0) continue;

        const record = parseRecordBlock(tag, body, meta);
        if (!record) continue;
        const key = [
            record.kind,
            record.caseNumber ?? '',
            record.court ?? '',
            record.filingDate ?? '',
            record.amount ?? '',
            record.parties ?? '',
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(record);
    }

    return records;
}

export function clearLienJudgmentTitle(record: ClearLienJudgmentRecord): string {
    const kindLabel = record.kind === 'lien' ? 'Lien' : 'Judgment';
    const parts = [kindLabel, record.amount, record.court || record.caseNumber].filter(Boolean);
    return parts.join(' · ');
}

function stableEvidenceId(record: ClearLienJudgmentRecord): string {
    const raw = [
        record.kind,
        record.groupId,
        record.caseNumber ?? '',
        record.court ?? '',
        record.filingDate ?? '',
        record.amount ?? '',
        record.parties ?? '',
    ].join('|');
    const hash = createHash('sha1').update(raw).digest('hex').slice(0, 12);
    return `clear-${record.kind}-${hash}`;
}

export function toNyCourtEvidenceItem(
    record: ClearLienJudgmentRecord,
    pdfUrl?: string,
): ClearNyCourtEvidenceItem {
    return {
        id: stableEvidenceId(record),
        kind: 'record',
        name: clearLienJudgmentTitle(record),
        url: pdfUrl?.trim() || '',
        source: 'clear',
        court: record.court,
        filingDate: record.filingDate,
        amount: record.amount,
        parties: record.parties,
        caseNumber: record.caseNumber,
        status: record.status,
    };
}

function isClearSourcedEvidence(item: unknown): boolean {
    if (!item || typeof item !== 'object') return false;
    const row = item as { source?: string; id?: string };
    return row.source === 'clear' || String(row.id ?? '').startsWith('clear-');
}

/**
 * Keep manual evidence; replace prior CLEAR-sourced rows with the latest parse.
 */
export function mergeClearNyCourtEvidence(
    existing: unknown,
    clearRecords: ClearLienJudgmentRecord[],
    pdfUrlByGroupId: Map<string, string>,
): ClearNyCourtEvidenceItem[] {
    const prior = Array.isArray(existing) ? existing : [];
    const manual = prior.filter((item) => !isClearSourcedEvidence(item)) as ClearNyCourtEvidenceItem[];
    const fromClear = clearRecords.map((record) =>
        toNyCourtEvidenceItem(record, pdfUrlByGroupId.get(record.groupId)),
    );
    return [...manual, ...fromClear];
}

/** Re-export helper used by callers that only need tag probes. */
export function clearReportHasLienJudgmentMarkers(xml: string): boolean {
    return /LienJudgment|Judg(?:e)?ment|TaxLien|<Lien[\s>]/i.test(xml);
}
