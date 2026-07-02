import type { DocumentLayout, DocumentLayoutPlacement } from './convert-docusign-template-export';

/** CRM storage prefix — PDF tab labels on each layout stay unchanged. */
export const LAYOUT_CRM_PREFIX: Record<string, string> = {
  flex_addendum: 'flex_addendum_',
  balance_transfer: 'balance_transfer_',
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

/** Map funder-specific layout keys to platform coordinate layouts. */
export function resolveCanonicalSupplementalLayoutKey(layoutKey: string): string | null {
  const k = String(layoutKey || '').trim().toLowerCase();
  if (!k) return null;
  if (k === 'flex_addendum' || k.endsWith('_flex_addendum')) return 'flex_addendum';
  if (k === 'balance_transfer' || k.endsWith('_balance_transfer')) return 'balance_transfer';
  return null;
}

export function isMainContractLayoutKey(layoutKey: string): boolean {
  const k = String(layoutKey || '').trim();
  if (k === 'contract' || k === 'alliance_bridge_contract') return true;
  if (!k.startsWith('funder_')) return false;
  return !/_flex_addendum|_balance_transfer|_ach_|_disclosure|_addendum_/.test(k);
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
      const scoped = String(globalValues[toDisclosureScopedPrefillId(pdfVar)] ?? '').trim();
      const legacy = String(globalValues[pdfVar] ?? '').trim();
      const val = scoped || legacy;
      if (val) out[pdfVar] = val;
      continue;
    }

    if (prefix) {
      const crmKey = resolveCrmKeyForLayoutVariable(canonicalKey, pdfVar);
      let val = String(globalValues[crmKey] ?? '').trim();
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

/** Unique DocuSign tab label for supplemental layouts (avoids shared-tab sync with contract). */
export function resolveSupplementalEnvelopeTabLabel(
  layoutKey: string,
  placement: DocumentLayoutPlacement,
  pdfVariable: string,
): string | null {
  const canonical = resolveCanonicalSupplementalLayoutKey(layoutKey);
  if (!canonical || !LAYOUT_CRM_PREFIX[canonical]) return null;
  const pdfVar = String(pdfVariable || '').trim();
  if (!pdfVar) return null;
  return resolveCrmKeyForLayoutVariable(canonical, pdfVar);
}
