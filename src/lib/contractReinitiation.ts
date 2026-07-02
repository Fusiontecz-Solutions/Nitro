import type { Application } from "@/types/applicationTypes";

/** Application row flag from API — UW updated offer after a contract was already generated. */
export function applicationNeedsContractReinitiation(
    app: Application | Record<string, unknown> | null | undefined,
): boolean {
    return (app as { needsContractReinitiation?: boolean } | null)?.needsContractReinitiation === true;
}

/**
 * Deal still belongs in the Reinitiate Contract pipeline — flagged for reinitiation and
 * no new DocuSign envelope has been linked yet.
 */
export function applicationAwaitingContractReinitiation(
    app: Application | Record<string, unknown> | null | undefined,
): boolean {
    if (!applicationNeedsContractReinitiation(app)) return false;
    const document =
        (app as { document?: { envelopeId?: unknown } | null } | null)?.document ??
        (
            (app as { contract?: { application?: { document?: { envelopeId?: unknown } | null } } } | null)
                ?.contract?.application?.document
        );
    const envelopeId = String(document?.envelopeId ?? "").trim();
    return !envelopeId;
}

/** ISO approved the updated offer while the deal awaits contract regeneration. */
export function isIsoUpdatedOfferApproved(
    app: Application | Record<string, unknown> | null | undefined,
): boolean {
    return (app as { isoUpdatedOfferApproved?: boolean } | null)?.isoUpdatedOfferApproved === true;
}

/** Label for the Reinitiate Contract list ISO Decision column. */
export function getReinitiateContractIsoDecisionLabel(
    app: Application | Record<string, unknown> | null | undefined,
): string {
    return isIsoUpdatedOfferApproved(app) ? "Approved" : "--";
}
