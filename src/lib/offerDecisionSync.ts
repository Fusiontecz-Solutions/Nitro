/** Dispatched after an offer-decision is saved elsewhere (e.g. approval modal). */
export const OFFER_DECISION_UPDATED_EVENT = "crm:offer-decision-updated";

export type OfferDecisionUpdatedDetail = {
    applicationId: string;
    skipRefetch?: boolean;
    movedToContractPending?: boolean;
};

export function emitOfferDecisionUpdated(
    applicationId: string | number,
    extra?: { skipRefetch?: boolean; movedToContractPending?: boolean },
) {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
        new CustomEvent(OFFER_DECISION_UPDATED_EVENT, {
            detail: {
                applicationId: String(applicationId),
                skipRefetch: extra?.skipRefetch === true,
                movedToContractPending: extra?.movedToContractPending === true,
            } satisfies OfferDecisionUpdatedDetail,
        }),
    );
}

export function offerDecisionUpdateMatchesApplication(
    eventApplicationId: unknown,
    currentApplicationId: string | number | null | undefined,
): boolean {
    if (currentApplicationId == null || currentApplicationId === "") return false;
    if (eventApplicationId == null || eventApplicationId === "") return false;
    return String(eventApplicationId) === String(currentApplicationId);
}
