/**
 * Keys that store DocuSign envelope lifecycle / history on Contract.contractPrefillOverrides.
 * FE prefill saves must not wipe these when they rebuild the JSON blob.
 */
export const DOCUSIGN_ENVELOPE_PREFILL_META_KEYS = [
  'contractSendHistory',
  'mainContractSendPackage',
  'achAuthorizationDocuSign',
  'achSendHistory',
  'standalonePackageDocuSign',
  'standalonePackageSendHistory',
  'documentSendHistory',
  'documentTemplateEnvelopeByMappingId',
  'documentTemplatePrefillByMappingId',
  'lastAchSentFunder',
  'contractSignerOverrides',
] as const;

/**
 * Merge incoming prefill overrides onto existing, keeping DocuSign history/capsule
 * keys from existing when the incoming payload omits them.
 */
export function mergePreservingDocuSignEnvelopeMeta(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> | null {
  if (incoming == null) return null;
  if (typeof incoming !== 'object' || Array.isArray(incoming)) {
    return null;
  }

  const next = { ...(incoming as Record<string, unknown>) };
  if (
    existing == null ||
    typeof existing !== 'object' ||
    Array.isArray(existing)
  ) {
    return next;
  }

  const prev = existing as Record<string, unknown>;
  for (const key of DOCUSIGN_ENVELOPE_PREFILL_META_KEYS) {
    if (next[key] === undefined && prev[key] !== undefined) {
      next[key] = prev[key];
    }
  }
  return next;
}
