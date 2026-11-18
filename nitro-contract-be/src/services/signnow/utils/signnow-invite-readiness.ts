/**
 * Guards that keep a SignNow signing session loadable.
 *
 * SignNow accepts an embedded invite on a document group even when one of the
 * group's documents cannot be read, and the signer then sees "Could not load
 * document (Unsuccessful HTTP request)". These helpers decide, from data the
 * CRM already holds, when an invite must not be created or a group must not be
 * reused. They never take tokens or signer identities, so their output is safe
 * to log as-is.
 */

/** The Document row fields that say a group has left the CRM for a merchant. */
export type SignNowSentMarkers = {
  status?: string | null;
  sentAt?: Date | string | null;
  portalSentAt?: Date | string | null;
} | null | undefined;

/**
 * A group the merchant has been sent (SignNow invite or signing portal).
 * Such a group is live: its embedded invites back the merchant's session, so it
 * must never be adopted as a review draft.
 */
export function isSignNowGroupAlreadySent(row: SignNowSentMarkers): boolean {
  if (!row) return false;
  if (String(row.status || '').trim().toLowerCase() === 'sent') return true;
  return Boolean(row.sentAt || row.portalSentAt);
}

/** The subset of a hydrated group document these checks read. */
export type SignNowReadinessDoc = {
  id: string;
  document_name?: string;
  name?: string;
  /** `GET /document/{id}` body; absent when that read never succeeded. */
  remote?: unknown;
  fieldCount?: number;
};

/** One loggable line per document: no field values, no signer data. */
export type SignNowDocumentReadiness = {
  documentId: string;
  name: string;
  readable: boolean;
  pageCount: number;
  fieldCount: number;
};

/** Same reading as the service's own page count (meta fields or `pages[]`). */
function pageCountOf(remote: unknown): number {
  if (!remote || typeof remote !== 'object') return 0;
  const r = remote as Record<string, unknown>;
  const fromMeta = Number(r.page_count ?? r.pages_amount ?? r.document_pages ?? 0);
  const meta = Number.isFinite(fromMeta) && fromMeta > 0 ? Math.floor(fromMeta) : 0;
  const fromPages = Array.isArray(r.pages) ? r.pages.length : 0;
  return Math.max(meta, fromPages);
}

export function describeSignNowDocumentReadiness(
  documents: SignNowReadinessDoc[],
): SignNowDocumentReadiness[] {
  return documents
    .filter((d) => String(d.id || '').trim())
    .map((d) => ({
      documentId: d.id,
      name: String(d.document_name || d.name || '').trim(),
      readable: Boolean(d.remote),
      pageCount: pageCountOf(d.remote),
      fieldCount: Number(d.fieldCount ?? 0) || 0,
    }));
}

/**
 * Documents an invite must not be created over: SignNow never returned them on
 * `GET /document/{id}` (deleted, replaced by a group rebuild, or still copying).
 * That is the document the signer's session fails to load. A readable document
 * with no page metadata is only logged — some SignNow payloads omit it.
 */
export function findUnloadableSignNowDocuments(
  documents: SignNowReadinessDoc[],
): SignNowDocumentReadiness[] {
  return describeSignNowDocumentReadiness(documents).filter((d) => !d.readable);
}
