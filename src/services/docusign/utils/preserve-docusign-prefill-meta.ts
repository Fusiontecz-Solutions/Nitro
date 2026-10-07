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
  /**
   * Offer terms the current contract package was regenerated from (see
   * `reinitiateContractForApplication`). The next regeneration compares the live offer
   * against it to decide whether the saved addendum / disclosure values still apply.
   */
  'contractOfferSnapshot',
  /**
   * Merchant monthly revenue the disclosure calculator was last saved with. Only that
   * modal writes it, so every other prefill save must carry it over.
   */
  'disclosureMonthlyRevenues',
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
  const mergedTabs = mergeDocumentTemplatePrefillBlobs(
    prev[DOCUMENT_TEMPLATE_PREFILL_KEY],
    next[DOCUMENT_TEMPLATE_PREFILL_KEY],
  );
  if (mergedTabs) next[DOCUMENT_TEMPLATE_PREFILL_KEY] = mergedTabs;
  return next;
}

const DOCUMENT_TEMPLATE_PREFILL_KEY = 'documentTemplatePrefillByMappingId';

function plainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Per-document prefill tabs, merged per mapping row instead of replaced whole.
 *
 * Each addendum's tab is saved by a different editor (Info Required writes the
 * first addendum, the disclosure and the Exhibit C copies; each pencil dialog
 * writes its own row), and every one of them posts the blob as the browser
 * last loaded it. Replacing the stored blob with that copy dropped every tab the
 * posting screen had not loaded yet — which is how Exhibit C (2), the Flex /
 * PayOff tabs and the rest went back to empty after a Review round trip. A
 * mapping the save names is still taken exactly as sent (its editor owns the
 * whole row); a mapping it leaves out keeps what is stored.
 */
export function mergeDocumentTemplatePrefillBlobs(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> | null {
  const prevBlob = plainObject(existing);
  const nextBlob = plainObject(incoming);
  if (!prevBlob || !nextBlob) return null;
  return { ...prevBlob, ...nextBlob };
}
