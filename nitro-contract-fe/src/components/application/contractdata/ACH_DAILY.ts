import type { ContractPrefillField } from "./Contract";
import {
    buildExhibitCContractPrefillFields,
    type ExhibitCContractPrefillFields,
} from "./EXHIBIT_C";

/**
 * ACH Daily SignNow PDF is Extra Exhibit C (ACH Authorization) — same unique
 * field names (`*_p1`) as Exhibit C. Remittance/Weekly tabs (`*_p1_ach`) cross
 * into Date / Printed Names widgets on this PDF.
 *
 * Keep this Exhibit C field map for SignNow fill; CRM send-order labels it
 * "ACH Daily" (never Exhibit C ×N).
 */
export type AchDailyContractPrefillFields = ExhibitCContractPrefillFields;

export function buildAchDailyContractPrefillFields(
    values: AchDailyContractPrefillFields = {},
): ContractPrefillField[] {
    return buildExhibitCContractPrefillFields(values).map((row) => ({
        ...row,
        group: row.group ? `ACH Daily — ${row.group}` : "ACH Daily",
    }));
}
