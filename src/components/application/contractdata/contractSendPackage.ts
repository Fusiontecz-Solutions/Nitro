import {
    buildAchFormEnvelopeEmailSubject,
    buildContractEnvelopeEmailSubject,
    CONTRACT_ENVELOPE_LENDER_NAME,
} from "./docusignTemplateConfig";

/** Which documents are included in a single DocuSign envelope from Create Contract. */
export type ContractSendPackageSelection = {
    includeMainContract: boolean;
    includeAddendum: boolean;
    includeDisclosure: boolean;
};

export function contractSendPackageFingerprint(
    selection: ContractSendPackageSelection,
    funderName?: string | null,
    addendumLayoutKey?: string | null,
    funderProfileId?: string | null,
): string {
    const parts: string[] = [];
    if (selection.includeMainContract) parts.push("contract");
    if (selection.includeAddendum) parts.push("addendum");
    if (selection.includeDisclosure) parts.push("disclosure");
    const funderId = String(funderProfileId ?? "").trim();
    if (funderId) {
        parts.push(`funderId:${funderId}`);
    } else {
        const funder = String(funderName ?? "").trim().toLowerCase();
        if (funder) parts.push(`funder:${funder}`);
    }
    const addendum = String(addendumLayoutKey ?? "").trim();
    if (addendum) parts.push(`add:${addendum}`);
    return parts.join("+") || "none";
}

export function resolveEffectiveSendPackage(input: {
    includeMainContractInSend: boolean;
    addendumLayoutKey: string | null;
    disclosureRef: string | null;
}): ContractSendPackageSelection {
    const hasAddendum = Boolean(input.addendumLayoutKey);
    const hasDisclosure = Boolean(input.disclosureRef);
    const canSendWithoutContract = hasAddendum || hasDisclosure;

    if (!canSendWithoutContract || input.includeMainContractInSend) {
        return {
            includeMainContract: true,
            includeAddendum: hasAddendum,
            includeDisclosure: hasDisclosure,
        };
    }

    return {
        includeMainContract: false,
        includeAddendum: hasAddendum,
        includeDisclosure: hasDisclosure,
    };
}

export function canSendWithoutMainContract(
    addendumLayoutKey: string | null,
    disclosureRef: string | null,
): boolean {
    return Boolean(addendumLayoutKey || disclosureRef);
}

export function validateContractSendPackage(
    selection: ContractSendPackageSelection,
    context: {
        addendumLayoutKey: string | null;
        disclosureRef: string | null;
    },
): string | null {
    if (
        !selection.includeMainContract &&
        !selection.includeAddendum &&
        !selection.includeDisclosure
    ) {
        return "At least one document must be included in this send.";
    }
    if (selection.includeAddendum && !context.addendumLayoutKey) {
        return "Select an addendum below to include it in this send.";
    }
    if (selection.includeDisclosure && !context.disclosureRef) {
        return "Link a state disclosure below to include it in this send.";
    }
    return null;
}

export function buildPackageEnvelopeEmailSubject(
    businessName: string,
    selection: ContractSendPackageSelection,
    offerAmount?: number | string | null,
): string {
    const business = String(businessName || "").trim() || "Business";
    if (selection.includeMainContract) {
        return buildContractEnvelopeEmailSubject(business, offerAmount);
    }
    const labels: string[] = [];
    if (selection.includeAddendum) labels.push("Addendum");
    if (selection.includeDisclosure) labels.push("Disclosure");
    const docLabel = labels.join(" & ") || "Documents";
    return `${CONTRACT_ENVELOPE_LENDER_NAME} : ${business} - ${docLabel}`;
}

export function buildPackageEnvelopeEmailMessage(
    businessName: string,
    selection: ContractSendPackageSelection,
): string {
    const business = String(businessName || "").trim() || "your business";
    if (selection.includeMainContract) {
        return `Please review and sign your agreement with ${CONTRACT_ENVELOPE_LENDER_NAME}.`;
    }
    if (selection.includeAddendum && selection.includeDisclosure) {
        return `Please review and sign the addendum and state disclosure for ${business}.`;
    }
    if (selection.includeAddendum) {
        return `Please review and sign the addendum for ${business}.`;
    }
    if (selection.includeDisclosure) {
        return `Please review and sign the state disclosure for ${business}.`;
    }
    return `Please review and sign the documents for ${business}.`;
}

/** ACH standalone uses a dedicated subject — not part of the 3-document package. */
export { buildAchFormEnvelopeEmailSubject };
