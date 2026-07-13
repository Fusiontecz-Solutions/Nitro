import { axiosPost, axiosPut } from "@/redux/axios";
import {
    createPosition,
    getPositions,
    updatePosition,
} from "@/redux/actions/positionActions";
import type { AppDispatch } from "@/redux/store";
import type { CreatePositionPayload } from "@/types/positionTypes";
import {
    getPositionRepaymentForSpa,
    isActivePositionForTotals,
    type SpaBankMonthContribution,
    type SpaMonthlyPaymentRow,
    type SpaMonthlyRevenueRow,
} from "@/lib/scrubbingSpecifiedPercent";

export const SPA_SCRUBBER_SYNCED_EVENT = "katan:spa-scrubber-synced";

export type SpaBankApiRecord = {
    _id?: string;
    id?: string;
    accountNumber?: string;
    rows?: Array<Record<string, unknown>>;
};

function parseAmount(value: unknown): number {
    const raw = String(value ?? "").trim();
    if (!raw) return 0;
    const n = Number.parseFloat(raw.replace(/[$,%\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
}

function paymentRowKey(row: SpaMonthlyPaymentRow): string {
    if (row.source === "positions_total") return "positions:total";
    return row.source === "offer"
        ? "offer:monthly"
        : `position:${row.positionId ?? row.label}`;
}

function amountsEqual(a: number, b: number): boolean {
    return Math.abs(a - b) < 0.005;
}

function positionBackendId(row: Record<string, unknown>): string {
    return String(row._id ?? row.id ?? "").trim();
}

/** Distribute a target total across parts (proportional, or equal if all zero). */
function distributeAmount(
    target: number,
    parts: Array<{ id: string; amount: number }>,
): Array<{ id: string; amount: number }> {
    if (!parts.length) return [];
    const sum = parts.reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0);
    if (!(sum > 0)) {
        const each = target / parts.length;
        return parts.map((p) => ({ id: p.id, amount: each }));
    }
    return parts.map((p) => ({
        id: p.id,
        amount: target * ((p.amount > 0 ? p.amount : 0) / sum),
    }));
}

/**
 * SPA edits the Credits column. Contributions.netCredit is already Credits
 * (not net of transfers), so write that value straight to totalCredit.
 */
function distributeCredits(
    targetCredits: number,
    contributions: SpaBankMonthContribution[],
): SpaBankMonthContribution[] {
    if (!contributions.length) return [];
    const sum = contributions.reduce((s, row) => s + row.netCredit, 0);
    if (!(targetCredits >= 0)) return contributions;

    return contributions.map((contrib, index) => {
        const ratio =
            sum > 0 ? contrib.netCredit / sum : 1 / contributions.length;
        const newCredits =
            sum > 0 || index === 0 ? targetCredits * ratio : 0;
        return {
            ...contrib,
            netCredit: newCredits,
            totalCredit: newCredits,
        };
    });
}

function cloneBanks(banks: SpaBankApiRecord[]): SpaBankApiRecord[] {
    return banks.map((bank) => ({
        ...bank,
        rows: Array.isArray(bank.rows) ? bank.rows.map((row) => ({ ...row })) : [],
    }));
}

function monthLabelOf(row: Record<string, unknown>): string {
    return String(row.monthLabel ?? row.month ?? "").trim();
}

function applyRevenueEditsToBanks(
    banks: SpaBankApiRecord[],
    revenueEdits: Array<{
        month: string;
        netCredit: number;
        bankContributions?: SpaBankMonthContribution[];
    }>,
): { banks: SpaBankApiRecord[]; banksToSave: SpaBankApiRecord[] } {
    const next = cloneBanks(banks);
    const touched = new Set<SpaBankApiRecord>();

    for (const edit of revenueEdits) {
        const contributions = edit.bankContributions ?? [];
        if (contributions.length > 0) {
            const adjusted = distributeCredits(edit.netCredit, contributions);
            for (const contrib of adjusted) {
                const bank = next.find(
                    (item) =>
                        String(item._id ?? item.id ?? "").trim() ===
                        contrib.bankBackendId,
                );
                if (!bank) continue;
                if (!Array.isArray(bank.rows)) bank.rows = [];
                let row = bank.rows.find((r) => {
                    const rowId = String(r._id ?? r.id ?? "").trim();
                    if (contrib.rowBackendId && rowId) {
                        return rowId === contrib.rowBackendId;
                    }
                    return monthLabelOf(r) === edit.month;
                });
                if (!row) {
                    row = {
                        monthLabel: edit.month,
                        month: edit.month,
                        totalCredit: contrib.totalCredit,
                        loanTransfer: contrib.loanTransfer,
                        deposit: contrib.deposit,
                        other: contrib.other,
                        nsfNegDays: 0,
                        lowBlcDays: 0,
                        avgDailyBlc: 0,
                    };
                    bank.rows.push(row);
                } else {
                    row.totalCredit = contrib.totalCredit;
                }
                touched.add(bank);
            }
            continue;
        }

        // No per-bank contributions (manual SPA entry): write full credits onto first bank.
        const bank = next[0];
        if (!bank) continue;
        if (!Array.isArray(bank.rows)) bank.rows = [];
        let row = bank.rows.find((r) => monthLabelOf(r) === edit.month);
        if (!row) {
            row = {
                monthLabel: edit.month,
                month: edit.month,
                totalCredit: edit.netCredit,
                loanTransfer: 0,
                deposit: 0,
                other: 0,
                nsfNegDays: 0,
                lowBlcDays: 0,
                avgDailyBlc: 0,
            };
            bank.rows.push(row);
        } else {
            row.totalCredit = edit.netCredit;
        }
        touched.add(bank);
    }

    return { banks: next, banksToSave: Array.from(touched) };
}

async function saveBankRecord(bank: SpaBankApiRecord): Promise<void> {
    const bankId = String(bank._id ?? bank.id ?? "").trim();
    if (!bankId) return;

    const rowsPayload = (bank.rows ?? [])
        .map((row) => {
            const monthLabel = monthLabelOf(row);
            const totalCredit = parseAmount(row.totalCredit);
            const loanTransfer = parseAmount(row.loanTransfer);
            const deposit = parseAmount(row.deposit);
            const other = parseAmount(row.other);
            const hasValue =
                monthLabel &&
                (totalCredit !== 0 ||
                    loanTransfer !== 0 ||
                    deposit !== 0 ||
                    other !== 0 ||
                    parseAmount(row.nsfNegDays) !== 0 ||
                    parseAmount(row.lowBlcDays) !== 0 ||
                    parseAmount(row.avgDailyBlc) !== 0);
            if (!hasValue) return null;
            const rowBackendId = String(row._id ?? row.id ?? "").trim();
            return {
                _id: rowBackendId || undefined,
                id: rowBackendId || undefined,
                monthLabel,
                monthDate: new Date().toISOString(),
                totalCredit,
                loanTransfer,
                deposit,
                other,
                nsfNegDays: parseAmount(row.nsfNegDays),
                lowBlcDays: parseAmount(row.lowBlcDays),
                avgDailyBlc: parseAmount(row.avgDailyBlc),
            };
        })
        .filter(Boolean);

    await axiosPut(`/bank-analysis/${bankId}`, {
        accountNumber: bank.accountNumber ?? "",
        rows: rowsPayload,
    });
}

async function createBankWithRevenueRows(
    applicationUuid: string,
    revenueEdits: Array<{ month: string; netCredit: number }>,
): Promise<void> {
    const rows = revenueEdits
        .filter((edit) => edit.netCredit > 0 && String(edit.month).trim())
        .map((edit) => ({
            monthLabel: edit.month,
            monthDate: new Date().toISOString(),
            totalCredit: edit.netCredit,
            loanTransfer: 0,
            deposit: 0,
            other: 0,
            nsfNegDays: 0,
            lowBlcDays: 0,
            avgDailyBlc: 0,
        }));
    if (!rows.length) return;

    await axiosPost("/bank-analysis", {
        application: applicationUuid,
        accountNumber: "",
        rows,
    });
}

function buildManualPositionPayload(
    applicationUuid: string,
    repayment: number,
): CreatePositionPayload {
    const today = new Date().toISOString().slice(0, 10);
    const amount = repayment > 0 ? repayment : 1;
    return {
        position: "Position 1",
        factorRate: "1.49",
        ach: String(repayment),
        percentOfGross: "0",
        funder: "SPA Calculator",
        paybackAmount: amount,
        fundingDate: today,
        activeStatus: true,
        fundedAmount: amount,
        frequency: "Daily",
        closeDate: today,
        application: applicationUuid,
        status: "ACTIVE",
    };
}

export function notifySpaScrubberSynced(applicationUuid: string): void {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent(SPA_SCRUBBER_SYNCED_EVENT, {
            detail: { applicationUuid },
        }),
    );
}

export async function persistSpaEditsToScrubber(args: {
    dispatch: AppDispatch;
    applicationUuid: string;
    banks: SpaBankApiRecord[];
    positions?: Array<Record<string, unknown>>;
    initialPayments: SpaMonthlyPaymentRow[];
    currentPayments: SpaMonthlyPaymentRow[];
    initialRevenues: SpaMonthlyRevenueRow[];
    currentRevenues: SpaMonthlyRevenueRow[];
}): Promise<void> {
    const appKey = String(args.applicationUuid ?? "").trim();
    if (!appKey) return;

    const initialPaymentMap = new Map(
        args.initialPayments.map((row) => [paymentRowKey(row), row.amount]),
    );

    /** Persist REPAYMENT (ach), not MONTHLY PMTS — matches SPA numerator. */
    const positionAchUpdates: Array<{ id: string; ach: number }> = [];
    let createRepaymentAmount: number | null = null;

    for (const row of args.currentPayments) {
        const key = paymentRowKey(row);
        const before = initialPaymentMap.get(key) ?? 0;
        if (amountsEqual(before, row.amount)) continue;

        if (row.source === "position" && row.positionId) {
            positionAchUpdates.push({ id: row.positionId, ach: row.amount });
            continue;
        }

        if (row.source !== "positions_total") continue;

        const activePositions = (args.positions ?? []).filter((p) =>
            isActivePositionForTotals(p),
        );
        const withIds = activePositions
            .map((p) => ({
                id: positionBackendId(p),
                amount: getPositionRepaymentForSpa(p),
            }))
            .filter((p) => p.id);

        if (!withIds.length) {
            if (row.amount > 0) createRepaymentAmount = row.amount;
            continue;
        }

        for (const part of distributeAmount(row.amount, withIds)) {
            positionAchUpdates.push({ id: part.id, ach: part.amount });
        }
    }

    const initialRevenueMap = new Map(
        args.initialRevenues.map((row) => [row.month, row.netCredit]),
    );
    const revenueEdits: Array<{
        month: string;
        netCredit: number;
        bankContributions?: SpaBankMonthContribution[];
    }> = [];
    for (const row of args.currentRevenues) {
        const before = initialRevenueMap.get(row.month) ?? 0;
        if (amountsEqual(before, row.netCredit)) continue;
        revenueEdits.push({
            month: row.month,
            netCredit: row.netCredit,
            bankContributions: row.bankContributions,
        });
    }

    const hasPaymentWork =
        positionAchUpdates.length > 0 || createRepaymentAmount != null;
    const hasRevenueWork = revenueEdits.length > 0;
    if (!hasPaymentWork && !hasRevenueWork) return;

    for (const update of positionAchUpdates) {
        await args
            .dispatch(
                updatePosition({
                    id: update.id,
                    data: { ach: String(update.ach) },
                }),
            )
            .unwrap();
    }

    if (createRepaymentAmount != null) {
        await args
            .dispatch(
                createPosition(
                    buildManualPositionPayload(appKey, createRepaymentAmount),
                ),
            )
            .unwrap();
    }

    if (hasRevenueWork) {
        if (args.banks.length > 0) {
            const { banksToSave } = applyRevenueEditsToBanks(
                args.banks,
                revenueEdits,
            );
            for (const bank of banksToSave) {
                await saveBankRecord(bank);
            }
        } else {
            await createBankWithRevenueRows(appKey, revenueEdits);
        }
    }

    await args.dispatch(getPositions({ application: appKey }));
    notifySpaScrubberSynced(appKey);
}
