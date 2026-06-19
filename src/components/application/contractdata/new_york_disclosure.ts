export const NEW_YORK_DISCLOSURE_PAGE3_DEFAULT_AMOUNT = "0.00";
export const NEW_YORK_DISCLOSURE_PAGE1_DEFAULT_AMOUNT = "0.00";

export function isNewYorkDisclosureState(state: string | null | undefined): boolean {
    const key = String(state ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, " ");
    return key === "new york" || key === "newyork" || key === "ny";
}

export function resolveNewYorkPage3LineAmount(value: string | null | undefined): string {
    const trimmed = String(value ?? "").trim();
    return trimmed || NEW_YORK_DISCLOSURE_PAGE3_DEFAULT_AMOUNT;
}

export function resolveNewYorkPage1LineAmount(value: string | null | undefined): string {
    const trimmed = String(value ?? "").trim();
    return trimmed || NEW_YORK_DISCLOSURE_PAGE1_DEFAULT_AMOUNT;
}
