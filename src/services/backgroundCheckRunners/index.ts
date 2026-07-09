/**
 * Adapter seam for automated background-check runs.
 *
 * THIS PASS IS MANUAL ENTRY ONLY — every runner throws. When wiring real
 * providers later (OpenCorporates, DataMerch, TLO, …), implement the matching
 * runner and have the controller call `runCheck(checkType, item)` instead of
 * (or alongside) the manual update path. The return shape maps straight onto
 * a BackgroundCheckItem update: { result, notes, raw }.
 */
import type { CheckType } from '../backgroundCheckService';

export type RunnerResult = {
    result: 'PASS' | 'FAIL' | 'FLAG' | 'NA';
    notes?: string;
    raw?: unknown;
};

export interface BackgroundCheckRunner {
    runCheck(item: { checkType: CheckType; [k: string]: unknown }): Promise<RunnerResult>;
}

const manualOnly = (provider: string): BackgroundCheckRunner => ({
    async runCheck() {
        throw new Error(`${provider} automated check not wired yet — enter results manually.`);
    },
});

/** Registry keyed by checkType. Replace entries with real adapters later. */
export const runners: Record<CheckType, BackgroundCheckRunner> = {
    TLO: manualOnly('TLO'),
    OPENCORPORATES: manualOnly('OpenCorporates'),
    SOS: manualOnly('Secretary of State'),
    NY_COURT: manualOnly('NY Court'),
    DATAMERCH: manualOnly('DataMerch'),
    GOOGLE: manualOnly('Google'),
};

export async function runCheck(checkType: CheckType, item: any): Promise<RunnerResult> {
    const runner = runners[checkType];
    if (!runner) throw new Error(`No runner for check type ${checkType}`);
    return runner.runCheck({ checkType, ...item });
}
