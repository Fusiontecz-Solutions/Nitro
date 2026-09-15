/**
 * Deterministic SignNow package ordering.
 *
 * Every review/send package must present as:
 *   1. Disclosure
 *   2. Contract template (main agreement)
 *   3. Addendums, in the order the user selected them
 *
 * Ordering must not depend on attachment selection order, on the order SignNow
 * happens to return group members in, or on which extra copy settled first.
 */

export const SIGNNOW_ORDER_DISCLOSURE = 0;
export const SIGNNOW_ORDER_CONTRACT = 1;
export const SIGNNOW_ORDER_ADDENDUM = 2;

export type SignNowOrderableDocument = {
  id: string;
  document_name?: string;
  name?: string;
};

export type SignNowOrderableExtra = {
  name?: string;
  layoutKey?: string;
  type?: string;
};

function displayName(doc: SignNowOrderableDocument): string {
  return String(doc.document_name || doc.name || '').trim();
}

/** Supplemental document names (addendum / disclosure), never the main agreement. */
export function looksLikeSignNowDisclosureName(name: string): boolean {
  return /disclosure/i.test(String(name || ''));
}

export function looksLikeSignNowAgreementName(name: string): boolean {
  const n = String(name || '');
  if (looksLikeSignNowDisclosureName(n)) return false;
  if (/addendum|exhibit|\bach\b|\bepa\b|payoff|flex|monthly\s*fee/i.test(n)) return false;
  return /agreement|pcm[_ ]?contract|^contract\b/i.test(n);
}

/**
 * Rank a live group document. `hints` carries the ids we assembled ourselves,
 * which is authoritative — names are only the fallback for reused drafts whose
 * ids this process never saw.
 */
export function signNowDocumentOrderRank(
  doc: SignNowOrderableDocument,
  hints?: {
    disclosureIds?: Iterable<string>;
    contractIds?: Iterable<string>;
    addendumIds?: Iterable<string>;
  },
): number {
  const id = String(doc.id || '').trim().toLowerCase();
  const has = (ids?: Iterable<string>) => {
    if (!ids || !id) return false;
    for (const raw of ids) {
      if (String(raw || '').trim().toLowerCase() === id) return true;
    }
    return false;
  };
  if (has(hints?.disclosureIds)) return SIGNNOW_ORDER_DISCLOSURE;
  if (has(hints?.contractIds)) return SIGNNOW_ORDER_CONTRACT;
  if (has(hints?.addendumIds)) return SIGNNOW_ORDER_ADDENDUM;

  const name = displayName(doc);
  if (looksLikeSignNowDisclosureName(name)) return SIGNNOW_ORDER_DISCLOSURE;
  if (looksLikeSignNowAgreementName(name)) return SIGNNOW_ORDER_CONTRACT;
  if (/addendum|exhibit|\bach\b|\bepa\b|payoff|flex|weekly|monthly/i.test(name)) {
    return SIGNNOW_ORDER_ADDENDUM;
  }
  // Unrecognized documents belong to the contract template copy.
  return SIGNNOW_ORDER_CONTRACT;
}

/**
 * Disclosure first, then addenda in the caller's (selection) order.
 * Stable: equal ranks keep their relative order, so Addendum 1/2/3 never swap.
 */
export function sortSignNowSupplementalsForPackage<T extends SignNowOrderableExtra>(
  extras: readonly T[],
): T[] {
  const list = Array.isArray(extras) ? [...extras] : [];
  return list
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rankA = String(a.row?.type || '').toLowerCase() === 'disclosure' ? 0 : 1;
      const rankB = String(b.row?.type || '').toLowerCase() === 'disclosure' ? 0 : 1;
      if (rankA !== rankB) return rankA - rankB;
      return a.index - b.index;
    })
    .map((entry) => entry.row);
}

/** Canonical order for a live group: Disclosure → Contract → Addendums (stable). */
export function orderSignNowGroupDocuments<T extends SignNowOrderableDocument>(
  documents: readonly T[],
  hints?: {
    disclosureIds?: Iterable<string>;
    contractIds?: Iterable<string>;
    addendumIds?: Iterable<string>;
  },
): T[] {
  const list = Array.isArray(documents) ? [...documents] : [];
  return list
    .map((doc, index) => ({ doc, index, rank: signNowDocumentOrderRank(doc, hints) }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index))
    .map((entry) => entry.doc);
}

export function signNowDocumentIdsInOrder(
  documents: readonly SignNowOrderableDocument[],
): string[] {
  return (Array.isArray(documents) ? documents : [])
    .map((doc) => String(doc.id || '').trim())
    .filter(Boolean);
}

export function sameSignNowDocumentOrder(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const left = (Array.isArray(a) ? a : []).map((id) => String(id || '').trim().toLowerCase());
  const right = (Array.isArray(b) ? b : []).map((id) => String(id || '').trim().toLowerCase());
  if (left.length !== right.length) return false;
  return left.every((id, index) => id === right[index]);
}
