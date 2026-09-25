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
  /**
   * The "$25 wire fee" choice a SignNow review was built with (see
   * `persistIncludeWireFeePreference`). The prefill editor always writes it, so
   * this only keeps it when a save that knows nothing about it — send history,
   * signer rows — rebuilds the blob from an older copy. Dropping it made Send
   * fall back to "on" and re-add $25 the review had left out.
   */
  'includeWireFee',
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
