import type { DocumentLayout, DocumentLayoutPlacement } from './convert-docusign-template-export';

/** CRM storage prefix — PDF tab labels on each layout stay unchanged for value lookup. */
export const LAYOUT_CRM_PREFIX: Record<string, string> = {
  flex_addendum: 'flex_addendum_',
  pre_payment_addendum: 'pre_payment_addendum_',
  balance_transfer: 'balance_transfer_',
  case_takeover_addendum: 'case_takeover_addendum_',
  ach_authorization: 'ach_form_',
  ach_authorization_standalone: 'ach_form_',
  ach_authorization_texas: 'ach_form_texas_',
};

/** When CRM key differs from `{prefix}{pdfVariable}`. */
export const LAYOUT_VARIABLE_CRM_KEY: Record<string, Record<string, string>> = {
  flex_addendum: {
    client_legal_name: 'flex_addendum_merchant_legal_name',
  },
  balance_transfer: {
    balance_transfer_client_legal_name: 'balance_transfer_client_legal_name',
  },
};

export const DISCLOSURE_PDF_FIELD_PREFIX = 'disclosure_pdf:';

export function toDisclosureScopedPrefillId(pdfFieldId: string): string {
  return `${DISCLOSURE_PDF_FIELD_PREFIX}${String(pdfFieldId || '').trim()}`;
}

/** Disclosure PDF slots that must show the merchant business / legal name (never owner person). */
export const DISCLOSURE_MERCHANT_BUSINESS_NAME_VARS = new Set([
  'client_name',
  'recipient_name',
  'recipient_name2',
  'disclosure_name',
  'disclosure_merchant_name',
]);

/**
 * Business / legal name for state disclosure merchant fields.
 * Do not use `client_name` — package sends overwrite that with Owner 1 person name.
 */
export function resolveDisclosureMerchantBusinessName(
  values: Record<string, string>,
): string {
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const v = String(values[key] ?? '').trim();
      if (v) return v;
    }
    return '';
  };
  return (
    pick(
      toDisclosureScopedPrefillId('disclosure_merchant_name'),
      toDisclosureScopedPrefillId('disclosure_name'),
      toDisclosureScopedPrefillId('client_name'),
      'disclosure_merchant_name',
      'disclosure_name',
      'client_legal_name',
      'business_legal_name',
      'security_business_name',
      'legal_name',
      'merchant_legal_name',
      'doing_business_as',
      'authorization_client_name',
      'authorization_application',
    ) || ''
  );
}

/** Map funder-specific layout keys to platform coordinate layouts. */
export function resolveCanonicalSupplementalLayoutKey(layoutKey: string): string | null {
  const k = String(layoutKey || '').trim().toLowerCase();
  if (!k) return null;
  if (k === 'flex_addendum' || k.endsWith('_flex_addendum')) return 'flex_addendum';
  if (k === 'pre_payment_addendum' || k.endsWith('_pre_payment_addendum')) {
    return 'pre_payment_addendum';
  }
  // Must run before balance_transfer — legacy key ends with `_balance_transfer`.
  if (
    k === 'case_takeover_addendum' ||
    k.endsWith('_case_takeover_addendum') ||
    k === 'case_takeover_balance_transfer' ||
    k.endsWith('_case_takeover_balance_transfer')
  ) {
    return 'case_takeover_addendum';
  }
  if (k === 'balance_transfer' || k.endsWith('_balance_transfer')) return 'balance_transfer';
  if (
    k === 'ach_authorization' ||
    k === 'ach_authorization_standalone' ||
    k.endsWith('_ach_authorization') ||
    (k.includes('_ach_') && !k.includes('texas'))
  ) {
    return 'ach_authorization';
  }
  if (k === 'ach_authorization_texas' || k.endsWith('_ach_authorization_texas')) {
    return 'ach_authorization_texas';
  }
  return null;
}

export function isMainContractLayoutKey(layoutKey: string): boolean {
  const k = String(layoutKey || '').trim();
  if (
    k === 'contract' ||
    k === 'alliance_bridge_contract' ||
    k === 'texas_funding_group_contract'
  ) {
    return true;
  }
  if (!k.startsWith('funder_')) return false;
  return !/_flex_addendum|_pre_payment_addendum|_case_takeover_addendum|_case_takeover_balance_transfer|_balance_transfer|_ach_|_disclosure|_addendum_/.test(k);
}

export function resolveCrmKeyForLayoutVariable(layoutKey: string, pdfVariable: string): string {
  const pdfVar = String(pdfVariable || '').trim();
  const canonical = resolveCanonicalSupplementalLayoutKey(layoutKey) ?? layoutKey;
  const mapped = LAYOUT_VARIABLE_CRM_KEY[canonical]?.[pdfVar];
  if (mapped) return mapped;
  const prefix = LAYOUT_CRM_PREFIX[canonical];
  if (prefix) return `${prefix}${pdfVar}`;
  return pdfVar;
}

export function isStateDisclosureTextPlacement(placement?: DocumentLayoutPlacement): boolean {
  return Boolean(String(placement?.id || '').startsWith('sd_text_'));
}

/** Build values for one layout only — prevents cross-document tab bleed. */
export function buildScopedValuesForLayout(
  layout: DocumentLayout,
  globalValues: Record<string, string>,
): Record<string, string> {
  const layoutKey = String(layout.key || '').trim();
  if (isMainContractLayoutKey(layoutKey)) {
    return { ...globalValues };
  }

  const canonicalKey = resolveCanonicalSupplementalLayoutKey(layoutKey) ?? layoutKey;
  const prefix = LAYOUT_CRM_PREFIX[canonicalKey];
  const out: Record<string, string> = {};

  for (const placement of layout.placements) {
    if (placement.type !== 'text' && placement.type !== 'date') continue;
    const pdfVar = String(placement.variable || '').trim();
    if (!pdfVar) continue;

    if (isStateDisclosureTextPlacement(placement)) {
      // Individual data labels use unique sourceTabLabel (e.g. funder_name_5) so
      // repeated PDF slots stay independent in DocuSign. Prefer that value, but
      // always also expose the shared pdfVar so envelope value lookup works.
      const uniqueKey = String(placement.sourceTabLabel || '').trim();
      const perPlacement = uniqueKey
        ? String(globalValues[toDisclosureScopedPrefillId(uniqueKey)] ?? '').trim()
        : '';
      const scoped = String(globalValues[toDisclosureScopedPrefillId(pdfVar)] ?? '').trim();
      const pdfVarNorm = pdfVar.toLowerCase();
      // Prefer business/legal name over package-synced Owner 1 person name on client_name.
      const businessName = DISCLOSURE_MERCHANT_BUSINESS_NAME_VARS.has(pdfVarNorm)
        ? resolveDisclosureMerchantBusinessName(globalValues)
        : '';
      const legacy = String(globalValues[pdfVar] ?? '').trim();
      const val = perPlacement || scoped || businessName || legacy;
      if (val) {
        if (uniqueKey) out[uniqueKey] = val;
        out[pdfVar] = val;
      }
      continue;
    }

    if (prefix) {
      const crmKey = resolveCrmKeyForLayoutVariable(canonicalKey, pdfVar);
      let val = String(globalValues[crmKey] ?? '').trim();
      // Case Takeover funder name must stay document-scoped. Shared `funder_name` is
      // forced to platform disclosure "Woodmere" when a state disclosure is merged —
      // same pattern as Flex/BT using their own CRM keys instead of bare funder_name.
      const skipSharedFunderNameFallback =
        canonicalKey === 'case_takeover_addendum' && pdfVar === 'funder_name';
      if (!val && !skipSharedFunderNameFallback) {
        val = String(globalValues[pdfVar] ?? '').trim();
      }
      if (
        !val &&
        (placement.type === 'date' ||
          /^(agreement_date|signature_date)/i.test(pdfVar))
      ) {
        val =
          String(globalValues.agreement_date ?? '').trim() ||
          String(globalValues.signature_date ?? '').trim() ||
          String(globalValues.Signature_date ?? '').trim() ||
          String(globalValues.disclosure_date ?? '').trim() ||
          String(globalValues.addendum_date ?? '').trim();
      }
      if (
        !val &&
        canonicalKey === 'flex_addendum' &&
        pdfVar === 'business_name_2'
      ) {
        for (const fallbackKey of [
          'business_name_2',
          'merchant2_name',
          'owner2_guarantor_name',
          'guaranty_owner2_name',
          'guaranty_guarantor2_name',
        ]) {
          const candidate = String(globalValues[fallbackKey] ?? '').trim();
          if (candidate) {
            val = candidate;
            break;
          }
        }
      }
      if (val) out[pdfVar] = val;
      continue;
    }

    const disclosureScoped = String(
      globalValues[toDisclosureScopedPrefillId(pdfVar)] ?? '',
    ).trim();
    const direct = String(globalValues[pdfVar] ?? '').trim();
    const val = disclosureScoped || direct;
    if (val) out[pdfVar] = val;
  }

  return out;
}

/**
 * Unique DocuSign tab label for supplemental layouts (avoids shared-tab sync with contract).
 * Prefer CRM-scoped id so editing one document's tab never rewrites another document.
 */
export function resolveSupplementalEnvelopeTabLabel(
  layoutKey: string,
  placement: DocumentLayoutPlacement,
  pdfVariable: string,
): string | null {
  const layout = String(layoutKey || '').trim();
  if (isMainContractLayoutKey(layout)) {
    // Main contract: keep explicit source labels, but uniquify footer clone.
    const src = String(placement.sourceTabLabel || '').trim();
    if (src) return src;
    return null;
  }

  if (isStateDisclosureTextPlacement(placement)) {
    const unique = String(placement.sourceTabLabel || '').trim();
    if (unique) return `disclosure_${unique}`;
    const pdfVar = String(pdfVariable || '').trim();
    return pdfVar ? `disclosure_${pdfVar}` : null;
  }

  const canonical = resolveCanonicalSupplementalLayoutKey(layout);
  if (!canonical || !LAYOUT_CRM_PREFIX[canonical]) {
    const pdfVar = String(pdfVariable || '').trim();
    if (!pdfVar) return null;
    // State disclosures / other supplementals without a CRM prefix still need unique labels.
    const token = layout.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'doc';
    return `${token}_${pdfVar}`;
  }
  const pdfVar = String(pdfVariable || '').trim();
  if (!pdfVar) return null;
  return resolveCrmKeyForLayoutVariable(canonical, pdfVar);
}
