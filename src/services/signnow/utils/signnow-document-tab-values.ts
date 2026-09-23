/**
 * Per-document prefill values saved by the CRM's contract prefill editor.
 *
 * The editor gives every attached addendum / disclosure a tab of its own, and
 * saves what was typed there into
 * `Contract.contractPrefillOverrides.documentTemplatePrefillByMappingId`, keyed
 * by the `ContractDocumentTemplateMapping` row id, with the SignNow widget's
 * own unique name (`installment_day_1_p1`, `addendum_p_pay_up_to_amount_p1`, …)
 * as the inner key.
 *
 * Only Exhibit C ever read that blob, and only for its bank/holder entity rows.
 * Every other document's tab was written to the database and then dropped: the
 * package-wide prefill map has no `installment_day_1` in it, and the CRM screen
 * lifts just a handful of shared identity/bank keys out of the blob before it
 * posts. That is why the Flex Addendum's installment table and the PayOff
 * Addendum's amounts went out blank on every funder no matter what was typed
 * into their tabs.
 *
 * These values are the most specific thing the CRM holds for a document — they
 * were entered against that document — so they are layered OVER the
 * package-wide map for that one document, and nowhere else.
 */
import {
  isExhibitCAddendumRow,
  knownLayoutKeyFromSettingsName,
  slugifyTemplateName,
} from './signnow-addendum-templates';

export type SignNowDocumentTabValues = {
  mappingId: string;
  /** Settings/catalog name of the template this mapping points at. */
  templateName: string;
  /** Known layout key (`flex_addendum`, `exhibit_a`, …) when one is resolvable. */
  layoutKey: string;
  values: Record<string, string>;
};

type MappingRowLike = {
  id?: unknown;
  template?: { layoutKey?: string | null; name?: string | null; type?: string | null } | null;
};

/** `contractPrefillOverrides.documentTemplatePrefillByMappingId`, normalized to strings. */
export function parseDocumentTemplatePrefillBlob(
  overrides: unknown,
): Record<string, Record<string, string>> {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};
  const blob = (overrides as Record<string, unknown>).documentTemplatePrefillByMappingId;
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return {};
  const out: Record<string, Record<string, string>> = {};
  for (const [mappingId, row] of Object.entries(blob)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const inner: Record<string, string> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      inner[k] = String(v ?? '');
    }
    out[mappingId] = inner;
  }
  return out;
}

function resolveLayoutKey(template: MappingRowLike['template']): string {
  const declared = String(template?.layoutKey || '').trim().toLowerCase();
  const name = String(template?.name || '').trim();
  const type = String(template?.type || '').trim().toLowerCase() === 'disclosure'
    ? 'disclosure'
    : 'addendum';
  const known = knownLayoutKeyFromSettingsName(name, type);
  // A funder-specific template stores its raw SignNow hex id as the layout key;
  // the name is the only thing that can say which layout it really is.
  if (known) return known;
  return declared;
}

/**
 * One entry per addendum/disclosure mapping that has saved tab values.
 *
 * Exhibit C is left out on purpose: its copies are resolved per instance
 * through `exhibitCDocumentPrefillValues`, which already reads this blob and
 * knows how to spread one entity per copy.
 */
export function buildSignNowDocumentTabValues(
  mappingRows: unknown,
  overrides: unknown,
): SignNowDocumentTabValues[] {
  const blob = parseDocumentTemplatePrefillBlob(overrides);
  if (!Object.keys(blob).length) return [];
  const rows = Array.isArray(mappingRows) ? (mappingRows as MappingRowLike[]) : [];
  const out: SignNowDocumentTabValues[] = [];
  for (const row of rows) {
    const mappingId = String(row?.id ?? '').trim();
    if (!mappingId) continue;
    const saved = blob[mappingId];
    if (!saved) continue;
    const values: Record<string, string> = {};
    for (const [key, raw] of Object.entries(saved)) {
      const value = String(raw ?? '').trim();
      if (value) values[key] = value;
    }
    if (!Object.keys(values).length) continue;
    const templateName = String(row?.template?.name || '').trim();
    if (isExhibitCAddendumRow({ layoutKey: row?.template?.layoutKey, name: templateName })) {
      continue;
    }
    out.push({
      mappingId,
      templateName,
      layoutKey: resolveLayoutKey(row?.template),
      values,
    });
  }
  return out;
}

/** Strip the copy suffix SignNow adds inside a group ("Exhibit A (2)", ".pdf"). */
function baseDocumentName(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\.(pdf|docx?)$/i, '')
    .replace(/\s*\(\d+\)\s*$/, '')
    .trim();
}

/**
 * The saved tab belonging to a live SignNow document, matched on its name.
 *
 * A live copy is titled after the funder's own PDF ("Flex addendum - Nitro
 * Advance"), not after the CRM template row, so an exact name match is tried
 * first and the known layout key — which both sides can derive from their own
 * name — is the fallback that actually carries most matches.
 */
export function pickSignNowDocumentTabValues(
  entries: SignNowDocumentTabValues[],
  documentName: unknown,
): Record<string, string> | null {
  if (!entries.length) return null;
  const name = baseDocumentName(documentName);
  if (!name) return null;
  const slug = slugifyTemplateName(name);
  if (!slug) return null;

  const exact = entries.find(
    (entry) => entry.templateName && slugifyTemplateName(entry.templateName) === slug,
  );
  if (exact) return exact.values;

  for (const type of ['addendum', 'disclosure'] as const) {
    const layoutKey = knownLayoutKeyFromSettingsName(name, type);
    if (!layoutKey) continue;
    const match = entries.find((entry) => entry.layoutKey === layoutKey);
    if (match) return match.values;
  }
  return null;
}
