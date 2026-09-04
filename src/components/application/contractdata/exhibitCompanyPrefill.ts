import {
    EXHIBIT_A_VALUE_COUNT,
    EXHIBIT_A_VALUE_FIELD_KEYS,
    type BuildContractPrefillFieldsArgs,
    type ExhibitAValueFieldKey,
} from "./Contract";

function str(v: unknown): string {
    return String(v ?? "").trim();
}

/** Pull Exhibit A company names already saved on a template-mapping blob. */
export function exhibitANamesFromMappingBlob(
    blob: Record<string, Record<string, string>> | null | undefined,
): string[] {
    if (!blob) return [];
    const byIndex: string[] = [];
    for (const row of Object.values(blob)) {
        if (!row || typeof row !== "object") continue;
        for (const [id, raw] of Object.entries(row)) {
            const m = String(id)
                .toLowerCase()
                .match(/^exhibit_a_value_(\d+)(?:_p\d+)?$/);
            if (!m) continue;
            const idx = Number(m[1]) - 1;
            if (idx < 0 || idx >= EXHIBIT_A_VALUE_COUNT) continue;
            const v = str(raw);
            if (v && !byIndex[idx]) byIndex[idx] = v;
        }
    }
    return byIndex.filter((v) => Boolean(v));
}

export type AddendumCompanySlot = {
    name: string;
    ein: string;
    entity: string;
};

export type AddendumCompanySource =
    | Record<string, unknown>
    | Record<string, unknown>[]
    | null
    | undefined;

/** Legal name / EIN / entity from one or many addendum records (slots 1–3 or flattened `legalName`). */
export function addendumCompanySlots(addendum: AddendumCompanySource): AddendumCompanySlot[] {
    const rows = Array.isArray(addendum) ? addendum : addendum ? [addendum] : [];
    const seen = new Set<string>();
    const out: AddendumCompanySlot[] = [];
    const push = (name: string, ein: string, entity: string) => {
        const n = str(name);
        if (!n) return;
        const key = n.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ name: n, ein: str(ein), entity: str(entity) });
    };
    for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        for (const slot of [1, 2, 3] as const) {
            push(
                str(row[`legalName${slot}`]),
                str(row[`ein${slot}`]),
                str(row[`typeOfEntity${slot}`]),
            );
        }
        push(
            str(row.legalName),
            str(row.ein),
            str(row.typeOfEntity) || str(row.entityType),
        );
    }
    return out;
}

export function companiesFromAddendum(addendum: AddendumCompanySource): string[] {
    return addendumCompanySlots(addendum).map((slot) => slot.name);
}

export function companiesFromPrefill(
    prefill: Partial<BuildContractPrefillFieldsArgs> | null | undefined,
    fallbacks?: {
        legalName?: string | null;
        addendum?: AddendumCompanySource;
        mappingBlob?: Record<string, Record<string, string>> | null;
    },
): string[] {
    const loaded: string[] = [];
    for (const key of EXHIBIT_A_VALUE_FIELD_KEYS) {
        const v = str(prefill?.[key]);
        if (v) loaded.push(v);
    }
    if (loaded.length > 0) return loaded;

    const seen = new Set<string>();
    const out: string[] = [];
    const push = (value: string) => {
        const v = str(value);
        if (!v) return;
        const key = v.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(v);
    };
    for (const name of exhibitANamesFromMappingBlob(fallbacks?.mappingBlob)) push(name);
    for (const name of companiesFromAddendum(fallbacks?.addendum)) push(name);
    push(str(fallbacks?.legalName));
    return out.length > 0 ? out : [""];
}

export function companiesToPrefillPayload(
    companies: readonly string[],
): Partial<BuildContractPrefillFieldsArgs> {
    const out: Partial<BuildContractPrefillFieldsArgs> = {};
    for (let i = 0; i < EXHIBIT_A_VALUE_COUNT; i++) {
        const key = EXHIBIT_A_VALUE_FIELD_KEYS[i] as ExhibitAValueFieldKey;
        out[key] = String(companies[i] ?? "").trim();
    }
    return out;
}

/** Map company name rows to indexed pairs for UI lists. */
export function mapExhibitCompanyNames(names: readonly string[]): Array<{ name: string; index: number }> {
    return names.map((name: string, index: number) => ({ name, index }));
}
