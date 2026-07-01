import type { Application } from "@/types/applicationTypes";

/** Application row flag from API — UW updated offer after a contract was already generated. */
export function applicationNeedsContractReinitiation(
    app: Application | Record<string, unknown> | null | undefined,
): boolean {
    return (app as { needsContractReinitiation?: boolean } | null)?.needsContractReinitiation === true;
}
