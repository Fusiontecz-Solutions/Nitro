import type { ContractPrefillField } from "./Contract";

/** SignNow Exhibit A unique names — seller rows + opening / owner lines. */

export interface ExhibitAContractPrefillFields {
    agreementDate?: string;
    clientLegalName?: string;
    doingBusinessAs?: string;
    companyNames?: string[];
    companyEins?: string[];
    companyEntities?: string[];
    ownerName?: string;
    ownerSsn?: string;
    ownerTitle?: string;
}

const COMPANY_ROWS = 10;

export function buildExhibitAContractPrefillFields(
    values: ExhibitAContractPrefillFields = {},
): ContractPrefillField[] {
    const out: ContractPrefillField[] = [
        {
            id: "agreement_date_p1",
            label: "Agreement Date",
            value: String(values.agreementDate ?? "").trim(),
        },
        {
            id: "client_legal_name_p1",
            label: "Business Legal Name",
            value: String(values.clientLegalName ?? "").trim(),
        },
        {
            id: "doing_business_as_p1",
            label: "D/B/A",
            value: String(values.doingBusinessAs ?? "").trim(),
        },
    ];
    for (let i = 1; i <= COMPANY_ROWS; i += 1) {
        const idx = i - 1;
        out.push({
            id: `exhibit_a_value_${i}_p1`,
            label: `Company ${i} — Legal Name`,
            value: String(values.companyNames?.[idx] ?? "").trim(),
        });
        out.push({
            id: `addendum_ein_${i}_p1`,
            label: `Company ${i} — EIN`,
            value: String(values.companyEins?.[idx] ?? "").trim(),
        });
        out.push({
            id: `addendum_type_of_entity_${i}_p1`,
            label: `Company ${i} — Entity Type`,
            value: String(values.companyEntities?.[idx] ?? "").trim(),
        });
    }
    out.push({
        id: "exhibit_owner_name_p1",
        label: "Owner / Guarantor Name",
        value: String(values.ownerName ?? "").trim(),
    });
    out.push({
        id: "guaranty_ss_p1",
        label: "SSN",
        value: String(values.ownerSsn ?? "").trim(),
    });
    out.push({
        id: "owner_print_title_p1",
        label: "Title",
        value: String(values.ownerTitle ?? "").trim(),
    });
    return out;
}
