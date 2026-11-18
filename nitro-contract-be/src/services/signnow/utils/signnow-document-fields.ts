/**
 * Field inventory of a live SignNow document.
 *
 * SignNow refuses to create an embedded invite on a document group whose
 * documents carry no fields ("At least one document in document group must
 * contain fields"), which is what the CRM surfaced as "Could not mint a SignNow
 * review link". A freshly built package hits that window: the group already
 * lists its documents (and `GET /document/{id}` already answers 200) while the
 * copied widgets are still being attached, so a document can look "ready" and
 * still have an empty field set.
 *
 * Counting the field containers — never the committed `texts`, which are flat
 * page stamps and are not fields as far as an invite is concerned — is what lets
 * the mint wait for the copy to finish instead of failing the reviewer.
 */

/** Containers `GET /document/{id}` returns fillable widgets in. */
const FIELD_CONTAINERS = [
  'fields',
  'fillable_fields',
  'signatures',
  'initials',
  'checks',
  'radiobuttons',
  'enumerations',
  'attachments',
] as const;

export function countSignNowDocumentFields(remote: unknown): number {
  if (!remote || typeof remote !== 'object') return 0;
  const src = remote as Record<string, unknown>;
  let total = 0;
  for (const container of FIELD_CONTAINERS) {
    const rows = src[container];
    if (Array.isArray(rows)) total += rows.length;
  }
  return total;
}

/** SignNow's "no fields anywhere in this group" rejection, in any of its wordings. */
export function isEmptySignNowFieldsError(detail: string): boolean {
  return /must contain fields|document group must contain|no fields/i.test(String(detail || ''));
}

/**
 * Template document this copy was made from. Present on both the group listing
 * and `GET /document/{id}`, so a document that came back with no fields can be
 * rebuilt from its own origin — the funder's template, not a global fallback
 * that would stamp another funder's widget layout onto it.
 */
export function signNowOriginDocumentId(source: unknown): string {
  if (!source || typeof source !== 'object') return '';
  const src = source as Record<string, unknown>;
  return String(src.origin_document_id || src.originDocumentId || '').trim();
}
