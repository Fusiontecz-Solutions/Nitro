/** DocuSign template GUIDs for Katan addendum merge (from template exports). */
export const DOCUSIGN_ADDENDUM_TEMPLATE_IDS = {
    BALANCE_TRANSFER_SHEET: "a963c28a-24ff-437d-834e-3233c986976a",
    FLEX_ADDENDUM: "1e199836-12b2-4558-ac11-258f3a9267d6",
    ACH_AUTHORIZATION: "c716fecc-7c02-4374-ad06-af851d0916dc",
} as const;

export type DocusignAddendumTemplateId =
    (typeof DOCUSIGN_ADDENDUM_TEMPLATE_IDS)[keyof typeof DOCUSIGN_ADDENDUM_TEMPLATE_IDS];

const ID_SET = new Set<string>(Object.values(DOCUSIGN_ADDENDUM_TEMPLATE_IDS));

export function normalizeDocusignTemplateId(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
}

export function isKnownKatanAddendumTemplateId(templateId: unknown): boolean {
    return ID_SET.has(normalizeDocusignTemplateId(templateId));
}
