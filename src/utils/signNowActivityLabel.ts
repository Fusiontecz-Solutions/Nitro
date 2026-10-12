/**
 * Contract e-signing runs on SignNow, but its API is still mounted at the legacy
 * `/docusign` path. Activity logs derived from that path must never show "DocuSign".
 */

/** Legacy route prefix (`/api/v1/docusign/...`) that actually serves SignNow. */
export const SIGNNOW_LEGACY_ROUTE_RESOURCE = 'docusign';

const DOCUSIGN_RE = /docu[\s_-]?sign/gi;

/** Replace any DocuSign mention with SignNow, keeping SCREAMING_CASE identifiers upper-case. */
export function rebrandDocuSignText(value: string): string {
  return value.replace(DOCUSIGN_RE, (match) =>
    match === match.toUpperCase() ? 'SIGNNOW' : 'SignNow',
  );
}

/** Phrase (after the actor) for each SignNow endpoint, e.g. "sent the contract via SignNow". */
const SIGNNOW_ENDPOINT_PHRASES: Record<string, string> = {
  'send-template': 'sent the contract via SignNow',
  'merge-and-send': 'sent the contract via SignNow',
  'send-envelope': 'sent the contract via SignNow',
  'create-draft-envelope': 'created the SignNow contract draft',
  'add-template-recipients': 'added SignNow contract recipients',
  'prefill-fields': 'prefilled the SignNow contract fields',
  'void-document': 'voided the SignNow contract',
  'sync-envelope-status': 'synced the SignNow signing status',
  'sync-envelope-cc': 'updated the SignNow contract CC recipients',
  'sender-view': 'opened the SignNow contract review',
  'embedded-request-url': 'opened the SignNow contract review',
  'embedded-sign-link': 'opened the SignNow signing link',
  'signnow-review-reset': 'reset the SignNow contract review',
  'signnow-review-finished': 'finished reviewing the SignNow contract',
  'send-contract-portal': 'sent the contract signing portal link',
  'resend-contract-portal': 'resent the contract signing portal link',
};

export function describeSignNowEndpoint(endpoint: string, verb: string): string {
  const key = endpoint.toLowerCase();
  return (
    SIGNNOW_ENDPOINT_PHRASES[key] ??
    (key ? `${verb} the SignNow contract (${key.replace(/-/g, ' ')})` : `${verb} the SignNow contract`)
  );
}

/** Sentence-case label for the "What changed" row, e.g. "Sent the contract via SignNow". */
export function signNowChangeSummary(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

const REBRANDED_METADATA_KEYS = ['resource', 'subAction', 'entity', 'changeSummary', 'description'];

/**
 * Read-time cleanup for rows written before SignNow labelling: rebrands text fields and
 * files legacy `/docusign` route entries under the Contract category.
 */
export function rebrandDocuSignMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;
  const meta = { ...(metadata as Record<string, unknown>) };
  const pathEndpoint = signNowEndpointFromPath(meta.path);
  const isLegacySignNowRoute =
    String(meta.resource ?? '').toLowerCase() === SIGNNOW_LEGACY_ROUTE_RESOURCE || pathEndpoint != null;

  for (const key of REBRANDED_METADATA_KEYS) {
    if (typeof meta[key] === 'string') meta[key] = rebrandDocuSignText(meta[key] as string);
  }

  if (isLegacySignNowRoute) {
    meta.resource = 'signnow';
    if (meta.category === 'SUB_ACTIVITY' || meta.category === 'GENERAL' || meta.category == null) {
      meta.category = 'CONTRACT';
    }
    if (meta.changeSummary == null) {
      meta.changeSummary = signNowChangeSummary(
        describeSignNowEndpoint(pathEndpoint ?? '', 'updated'),
      );
    }
  }

  return meta;
}

const LEGACY_ROUTE_DESCRIPTION_RE =
  /\b(added|updated|removed|changed) docu[\s_-]?sign(?: \(([^)]*)\))?\.?\s*$/i;

/** Generic middleware audit, e.g. "CREATE Docusign via POST /api/v1/docusign/send-contract-portal". */
const GENERIC_AUDIT_DESCRIPTION_RE =
  /^\w+\s+(?:docu[\s_-]?sign|signnow)\s+via\s+(?:GET|POST|PUT|PATCH|DELETE)\s+\S*\/docusign\/([\w-]+)/i;

/** SignNow endpoint (`send-envelope`, …) from a legacy `/api/v1/docusign/<endpoint>` path. */
export function signNowEndpointFromPath(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const match = path.match(/\/docusign\/([\w-]+)/i);
  return match?.[1] ?? null;
}

/**
 * Rewrite route-derived descriptions such as "Nitro Admin added docusign." into
 * "Nitro Admin updated the SignNow contract."; any other DocuSign mention becomes SignNow.
 * Run it before `sanitizeAuditDescription` so generic middleware audits keep their endpoint.
 */
export function rebrandDocuSignDescription(description: string | null | undefined): string {
  const raw = description ?? '';
  const generic = raw.match(GENERIC_AUDIT_DESCRIPTION_RE);
  if (generic) return signNowChangeSummary(describeSignNowEndpoint(generic[1], 'updated'));

  const rewritten = raw.replace(LEGACY_ROUTE_DESCRIPTION_RE, (_match, _verb: string, sub?: string) => {
    const endpoint = sub?.trim().replace(/\s+/g, '-') ?? '';
    return `${describeSignNowEndpoint(endpoint, 'updated')}.`;
  });
  return rebrandDocuSignText(rewritten);
}
