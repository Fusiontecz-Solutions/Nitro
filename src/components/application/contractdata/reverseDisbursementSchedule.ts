export type ReverseDisbursementScheduleRow = {
    period: string;
    netDailysCredit: string;
    dailysCreditInclFees: string;
    totalPeriodCredits: string;
    receivablesPurchased: string;
};

export type ReverseDisbursementScheduleData = {
    fixedDailyDebit?: string;
    rows: ReverseDisbursementScheduleRow[];
};

export const REVERSE_DISBURSEMENT_COLUMN_LABELS = [
    "Deposit Disbursement Schedule:",
    "Net Dailys Credit",
    "Dailys Credit (Incl Fees)",
    "Total Period Credits",
    "Receivables Purchased",
] as const;

export const EMPTY_REVERSE_DISBURSEMENT_ROW = (): ReverseDisbursementScheduleRow => ({
    period: "",
    netDailysCredit: "",
    dailysCreditInclFees: "",
    totalPeriodCredits: "",
    receivablesPurchased: "",
});

/** Matches $1,234.56, $ 1,234.56, ($ 1,234.56), etc. */
const CURRENCY_TOKEN_REGEX = /(?:\(\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)\s*\)?/g;

function formatCurrencyToken(raw: string, digits: string): string {
    const negative = /\(/.test(raw);
    return negative ? `($ ${digits})` : `$ ${digits}`;
}

function extractCurrencyTokens(line: string): { values: string[]; firstIndex: number } {
    const values: string[] = [];
    let firstIndex = -1;
    const regex = new RegExp(CURRENCY_TOKEN_REGEX.source, "g");
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
        if (firstIndex < 0) firstIndex = match.index;
        values.push(formatCurrencyToken(match[0], match[1]));
    }
    return { values, firstIndex };
}

function isHeaderOrSummaryLine(line: string): boolean {
    const trimmed = line.trim();
    if (/^day\s/i.test(trimmed)) return false;

    const lower = trimmed.toLowerCase();
    if (
        lower.includes("deposit disbursement") &&
        (lower.includes("net dailys") || lower.includes("receivables purchased"))
    ) {
        return true;
    }
    if (lower.includes("receivables purchased") && lower.includes("total period")) {
        return true;
    }

    const summaryKeywords = [
        "total funding amount",
        "net funding amount",
        "daily debit",
        "fixed daily debit",
        "factor rate",
        "origination fee",
        "term length",
        "reduction on daily",
    ];
    return summaryKeywords.some((keyword) => lower.includes(keyword));
}

/** PDF copy: "Day 1 - Day 16. $ 1,530.35 $1,700.39 ..." */
function parsePdfStyleDisbursementLine(line: string): ReverseDisbursementScheduleRow | null {
    const trimmed = line.trim();
    if (!/^day\s/i.test(trimmed)) return null;

    const { values, firstIndex } = extractCurrencyTokens(trimmed);
    if (values.length < 4 || firstIndex < 0) return null;

    const period = trimmed.slice(0, firstIndex).trim().replace(/\s+/g, " ");
    return {
        period,
        netDailysCredit: values[0] || "",
        dailysCreditInclFees: values[1] || "",
        totalPeriodCredits: values[2] || "",
        receivablesPurchased: values[3] || "",
    };
}

function parseDelimitedDisbursementLine(line: string): ReverseDisbursementScheduleRow | null {
    let cols: string[];
    if (line.includes("\t")) {
        cols = line.split("\t").map((c) => c.trim());
    } else if (line.includes("|")) {
        cols = line.split("|").map((c) => c.trim());
    } else {
        cols = line.split(/\s{2,}/).map((c) => c.trim());
    }

    if (cols.length < 2) return null;
    while (cols.length < 5) cols.push("");

    return {
        period: cols[0] || "",
        netDailysCredit: cols[1] || "",
        dailysCreditInclFees: cols[2] || "",
        totalPeriodCredits: cols[3] || "",
        receivablesPurchased: cols[4] || "",
    };
}

/** Pull "Daily Debit: $1,071.25" from pasted PDF/sheet text when present. */
export function parseFixedDailyDebitFromPaste(text: string): string | undefined {
    const match = String(text || "").match(
        /(?:fixed\s+)?daily\s+debit\s*:?\s*(?:\(\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)\s*\)?/i,
    );
    if (!match?.[1]) return undefined;
    return `$ ${match[1]}`;
}

export function parsePastedReverseDisbursementTable(text: string): ReverseDisbursementScheduleRow[] {
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    const rows: ReverseDisbursementScheduleRow[] = [];
    for (const line of lines) {
        if (isHeaderOrSummaryLine(line)) continue;

        if (line.includes("\t") || line.includes("|")) {
            const delimited = parseDelimitedDisbursementLine(line);
            if (delimited) rows.push(delimited);
            continue;
        }

        const pdfRow = parsePdfStyleDisbursementLine(line);
        if (pdfRow) {
            rows.push(pdfRow);
            continue;
        }

        const fallback = parseDelimitedDisbursementLine(line);
        if (fallback && /^day\s/i.test(fallback.period)) {
            rows.push(fallback);
        }
    }
    return rows;
}

export function scheduleDataFromContract(
    contract: Record<string, unknown> | null | undefined,
): {
    enabled: boolean;
    schedule: ReverseDisbursementScheduleData | null;
} {
    const enabled = contract?.reverseDisbursementEnabled === true;
    const raw = contract?.reverseDisbursementSchedule;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { enabled, schedule: null };
    }
    const obj = raw as Record<string, unknown>;
    const rowsRaw = Array.isArray(obj.rows) ? obj.rows : [];
    const rows = rowsRaw
        .map((row) => {
            if (!row || typeof row !== "object" || Array.isArray(row)) return null;
            const r = row as Record<string, unknown>;
            return {
                period: String(r.period ?? "").trim(),
                netDailysCredit: String(r.netDailysCredit ?? "").trim(),
                dailysCreditInclFees: String(r.dailysCreditInclFees ?? "").trim(),
                totalPeriodCredits: String(r.totalPeriodCredits ?? "").trim(),
                receivablesPurchased: String(r.receivablesPurchased ?? "").trim(),
            };
        })
        .filter((row) =>
            Boolean(
                row &&
                    (row.period ||
                        row.netDailysCredit ||
                        row.dailysCreditInclFees ||
                        row.totalPeriodCredits ||
                        row.receivablesPurchased),
            ),
        ) as ReverseDisbursementScheduleRow[];

    if (!rows.length) {
        return { enabled, schedule: null };
    }

    return {
        enabled,
        schedule: {
            fixedDailyDebit: String(obj.fixedDailyDebit ?? "").trim() || undefined,
            rows,
        },
    };
}
