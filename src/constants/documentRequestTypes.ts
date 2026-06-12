export type DocumentRequestSlug =
    | "bank-statements"
    | "bank-statements-mtd"
    | "additional-id"
    | "business-license"
    | "proof-of-address"
    | "financial-statement"
    | "voided-check"
    | "tax-returns"
    | "articles-of-incorporation";

export type DocumentRequestRow = {
    name: string;
    label?: string;
    status: "Complete" | "Pending";
    createdAt?: string;
    fileUrl?: string;
    fileId?: string;
    contractUploadKey?: "voidedCheck" | "driverLicense";
    message?: string;
};

export const DOCUMENT_REQUEST_LABELS: Record<string, string> = {
    "bank-statements": "Bank Statements - 12 months",
    "bank-statements-mtd": "Bank Statements - MTD",
    "additional-id": "Additional ID Proof",
    "business-license": "Business License",
    "proof-of-address": "Proof of Address",
    "financial-statement": "Financial Statement",
    "voided-check": "Voided Check",
    "tax-returns": "Tax Returns - Last 2 Years",
    "articles-of-incorporation": "Articles of Incorporations",
};

export function documentRequestDisplayLabel(doc: DocumentRequestRow): string {
    if (doc.label?.trim()) return doc.label.trim();
    return DOCUMENT_REQUEST_LABELS[doc.name] || doc.name.replace(/[-_]/g, " ");
}

export function isContractUploadDocumentRequest(doc: DocumentRequestRow): boolean {
    return Boolean(doc.contractUploadKey);
}
