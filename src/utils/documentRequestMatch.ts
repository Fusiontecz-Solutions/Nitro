export const DOCUMENT_REQUEST_LABELS: Record<string, string> = {
    'bank-statements': 'Bank Statements - 12 months',
    'additional-id': 'Additional ID Proof',
    'business-license': 'Business License',
    'proof-of-address': 'Proof of Address',
    'financial-statement': 'Financial Statement',
    'voided-check': 'Voided Check',
    'tax-returns': 'Tax Returns- Last 2 Years',
    'articles-of-incorporation': 'Articles of Incorporations',
};

function normalizeSlug(value: string): string {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
}

/** True when an application file satisfies a requested document id (e.g. bank-statements). */
export function isDocumentRequestFulfilled(
    docId: string,
    files: Array<{ originalName?: string | null }> | null | undefined,
): boolean {
    const id = String(docId || '').trim().toLowerCase();
    if (!id || !Array.isArray(files) || files.length === 0) return false;

    const label = DOCUMENT_REQUEST_LABELS[id] || '';
    const idSlug = normalizeSlug(id);
    const labelSlug = normalizeSlug(label);

    return files.some((file) => {
        const name = String(file?.originalName || '').toLowerCase();
        if (!name) return false;

        if (name.includes(`[${id}]`) || name.startsWith(`${id}__`) || name.startsWith(`${id}_`)) {
            return true;
        }

        const nameSlug = normalizeSlug(name.split('.')[0] || name);
        if (idSlug && (nameSlug.includes(idSlug) || name.includes(id.replace(/-/g, ' ')))) {
            return true;
        }
        if (labelSlug && nameSlug.includes(labelSlug)) {
            return true;
        }

        return false;
    });
}

/** Document request ids matched by a single uploaded filename. */
export function documentRequestIdsMatchedByFileName(
    originalName: string,
    candidateIds: string[],
): string[] {
    const file = { originalName };
    return candidateIds.filter((id) => isDocumentRequestFulfilled(id, [file]));
}

export function documentRequestDisplayLabel(docId: string): string {
    const id = String(docId || '').trim();
    return DOCUMENT_REQUEST_LABELS[id] || id.replace(/[-_]/g, ' ');
}
