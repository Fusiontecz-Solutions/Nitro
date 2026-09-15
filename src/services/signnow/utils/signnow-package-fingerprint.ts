/**
 * Structural identity of a SignNow review package.
 * Intentionally excludes contract/customer prefill — those are rewritten on every Review.
 */
export function buildSignNowPackageFingerprint(parts: {
  includeMainContract: boolean;
  contractTemplateId: string;
  extraTemplateIds: Array<string | null | undefined>;
}): string {
  // Keep duplicate template ids (e.g. Exhibit C × 3) — count is part of package identity.
  const extras: string[] = [];
  for (const id of parts.extraTemplateIds) {
    const normalized = String(id || '').trim().toLowerCase();
    if (!normalized) continue;
    extras.push(normalized);
  }
  return [
    parts.includeMainContract ? '1' : '0',
    String(parts.contractTemplateId || '').trim().toLowerCase(),
    extras.join(','),
  ].join('|');
}

export function signNowPackageFingerprintsEqual(
  a?: string | null,
  b?: string | null,
): boolean {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  return Boolean(left && right && left === right);
}

export function signNowDocumentDisplayName(doc: {
  document_name?: string;
  name?: string;
}): string {
  return String(doc.document_name || doc.name || '').trim().toLowerCase();
}

export function signNowDocumentLooksLikeAgreement(doc: {
  document_name?: string;
  name?: string;
}): boolean {
  return /agreement/i.test(signNowDocumentDisplayName(doc));
}

export function signNowDocumentMatchesSupplemental(
  documentName: string,
  extra: { name?: string; layoutKey?: string; type?: string },
): boolean {
  const n = String(documentName || '').trim().toLowerCase();
  if (!n) return false;
  const name = String(extra.name || '').trim().toLowerCase();
  const key = String(extra.layoutKey || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');
  if (name && n.includes(name)) {
    // "Exhibit C" must not match a live "ACH Daily" / Extra Exhibit C (ACH Daily) doc.
    if (
      extra.layoutKey === 'exhibit_c' &&
      /\bach\b/.test(n) &&
      /daily/.test(n) &&
      !/weekly/.test(n)
    ) {
      return false;
    }
    return true;
  }
  if (key && n.includes(key)) return true;
  if (extra.type === 'disclosure' && n.includes('disclosure')) return true;
  if (extra.layoutKey === 'monthly_fee' && /monthly/.test(n) && /fee/.test(n)) return true;
  if (extra.layoutKey === 'ach_weekly' && /\bach\b/.test(n) && /week/.test(n)) return true;
  if (extra.layoutKey === 'ach_daily' && /\bach\b/.test(n) && /daily/.test(n)) return true;
  // Do not treat ACH Daily docs as Exhibit C instances via loose "exhibit c" text.
  if (
    extra.layoutKey === 'exhibit_c' &&
    /exhibit[\s_-]*c/.test(n) &&
    !(/\bach\b/.test(n) && /daily/.test(n))
  ) {
    return true;
  }
  return false;
}

/**
 * True when a live SignNow group already has the same structural extras
 * (disclosure / addenda / monthly fee) as the requested review package.
 */
export function liveSignNowGroupMatchesPackage(params: {
  documents: Array<{ document_name?: string; name?: string }>;
  includeMainContract: boolean;
  extras: Array<{ name?: string; layoutKey?: string; type?: string }>;
}): boolean {
  const documents = Array.isArray(params.documents) ? params.documents : [];
  if (!documents.length) return false;
  const extras = Array.isArray(params.extras) ? params.extras : [];
  const agreementIdx = documents.findIndex((doc) => signNowDocumentLooksLikeAgreement(doc));
  const extraDocs = params.includeMainContract
    ? documents.filter((_, idx) => idx !== (agreementIdx >= 0 ? agreementIdx : 0))
    : documents;

  if (params.includeMainContract && documents.length < extras.length + 1) return false;

  for (const extra of extras) {
    const key = String(extra.layoutKey || extra.name || '')
      .trim()
      .toLowerCase();
    const presentCount = documents.filter((doc) =>
      signNowDocumentMatchesSupplemental(signNowDocumentDisplayName(doc), extra),
    ).length;
    const neededSoFar =
      extras.filter((row) => {
        const rowKey = String(row.layoutKey || row.name || '')
          .trim()
          .toLowerCase();
        return rowKey === key;
      }).indexOf(extra) + 1;
    if (presentCount < neededSoFar) return false;
  }

  if (extraDocs.length !== extras.length) return false;

  return extras.every((extra, index) =>
    signNowDocumentMatchesSupplemental(
      signNowDocumentDisplayName(extraDocs[index]),
      extra,
    ),
  );
}

/** Roles SignNow requires on the first embedded-invite POST (review iframe). */
export function embeddedReviewRolesForDocument(doc: {
  roles?: string[];
  listedRoles?: string[];
  remainingRoles?: string[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [
    ...(doc.remainingRoles || []),
    ...(doc.listedRoles || []),
    ...(doc.roles || []),
  ]) {
    const name = String(raw || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
