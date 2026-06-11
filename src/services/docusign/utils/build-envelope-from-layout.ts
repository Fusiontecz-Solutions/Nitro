import type {
  DocumentLayout,
  DocumentLayoutPlacement,
} from './convert-docusign-template-export';

export type LayoutSignerInput = {
  roleName: string;
  name: string;
  email: string;
  routingOrder?: number;
};

export function prefillFieldsToValueMap(
  fields: Array<{ id?: string; value?: string }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields || []) {
    const id = String(f?.id ?? '').trim();
    const value = String(f?.value ?? '').trim();
    if (id && value) out[id] = value;
  }
  return expandPrefillValues(out);
}

export type BuildEnvelopeFromLayoutOptions = {
  layouts: DocumentLayout[];
  /** Prefill values keyed by layout variable (snake_case data labels). */
  values: Record<string, string>;
  signers: LayoutSignerInput[];
  ownerCount?: number;
  guarantorCount?: number;
};

export type LayoutPartyCounts = {
  ownerCount: number;
  guarantorCount: number;
};

/** Canonical CRM keys copied to legacy / duplicate tab labels automatically. */
const PREFILL_VALUE_ALIASES: Record<string, string[]> = {
  agreement_date: ['signature_date'],
  client_legal_name: ['business_legal_name', 'merchant_legal_name'],
  client_name: ['client_name_by'],
  owner2_guarantor_name: ['guaranty_owner2_name', 'guaranty_guarantor2_name', 'merchant2_name'],
  guaranty_owner2_name: ['owner2_guarantor_name', 'guaranty_guarantor2_name', 'merchant2_name'],
  guaranty_guarantor2_name: ['owner2_guarantor_name', 'guaranty_owner2_name', 'merchant2_name'],
  merchant2_name: ['owner2_guarantor_name', 'guaranty_owner2_name', 'guaranty_guarantor2_name'],
};

/**
 * Merchant #2 initials — just right of Merchant #1 on the footer line (not mid-page).
 * ~1 initial-width + small gap from the primary tab; slightly higher on Y.
 */
const OWNER2_INITIAL_OFFSET_X = 108;
const OWNER2_INITIAL_OFFSET_Y = -6;

const PARTY2_NAME_KEYS = [
  'owner2_guarantor_name',
  'guaranty_owner2_name',
  'guaranty_guarantor2_name',
  'merchant2_name',
  'appendix_merchant2_name',
] as const;

function expandPrefillValues(values: Record<string, string>): Record<string, string> {
  const out = { ...values };
  const party2Name = PARTY2_NAME_KEYS.map((k) => String(out[k] || '').trim()).find(Boolean);
  if (party2Name) {
    for (const k of PARTY2_NAME_KEYS) {
      if (!String(out[k] || '').trim()) out[k] = party2Name;
    }
  }
  for (const [canonical, aliases] of Object.entries(PREFILL_VALUE_ALIASES)) {
    const v = String(out[canonical] || '').trim();
    if (!v) continue;
    for (const alias of aliases) {
      if (!String(out[alias] || '').trim()) out[alias] = v;
    }
  }
  return out;
}

function enrichValuesFromSigners(
  values: Record<string, string>,
  signers: LayoutSignerInput[],
  ownerCount: number,
): Record<string, string> {
  const out = { ...values };
  const primaryName = String(
    signers.find((s) => /client|merchant|customer/i.test(s.roleName))?.name ||
      signers.find((s) => /^owner$/i.test(s.roleName))?.name ||
      signers.find((s) => /^guarantor$/i.test(s.roleName))?.name ||
      signers[0]?.name ||
      '',
  ).trim();
  if (primaryName) {
    for (const k of PRIMARY_GUARANTOR_NAME_VARIABLES) {
      if (!String(out[k] || '').trim()) out[k] = primaryName;
    }
  }
  if (ownerCount >= 2) {
    const primaryEmail = String(
      signers.find((s) => /client|merchant|customer/i.test(s.roleName))?.email ||
        signers[0]?.email ||
        '',
    )
      .trim()
      .toLowerCase();
    const secondarySigner =
      signers.find((s) => /owner\s*2|guarantor\s*2/i.test(s.roleName)) ||
      signers.find((s) => {
        const email = String(s.email || '').trim().toLowerCase();
        return Boolean(email && email !== primaryEmail);
      });
    const secondaryName = String(secondarySigner?.name || '').trim();
    if (secondaryName) {
      for (const k of PARTY2_NAME_KEYS) {
        if (!String(out[k] || '').trim()) out[k] = secondaryName;
      }
    }
  }
  return out;
}

type DocuSignTab = Record<string, string | undefined>;

function resolvePrimarySignerRoleName(signers: LayoutSignerInput[]): string {
  return (
    signers.find((s) => /client|merchant|customer/i.test(s.roleName))?.roleName ||
    signers.find((s) => /^owner$/i.test(s.roleName))?.roleName ||
    signers.find((s) => /^guarantor$/i.test(s.roleName))?.roleName ||
    signers[0]?.roleName ||
    'Client'
  );
}

function resolveSecondarySignerRoleName(signers: LayoutSignerInput[]): string {
  return (
    signers.find((s) => /owner\s*2/i.test(s.roleName))?.roleName ||
    signers.find((s) => /guarantor\s*2/i.test(s.roleName))?.roleName ||
    'Owner 2'
  );
}

function isSecondaryParty(party: string | undefined): boolean {
  return party === 'secondary' || party === 'owner2' || party === 'guarantor2';
}

function isPrimaryParty(party: string | undefined): boolean {
  return (
    party === 'primary' ||
    party === 'client' ||
    party === 'owner' ||
    party === 'guarantor'
  );
}

function resolvePlacementSignerRoleName(
  placement: DocumentLayoutPlacement,
  signers: LayoutSignerInput[],
  counts: LayoutPartyCounts,
): string {
  const party = placement.signerParty;

  if (isSecondaryParty(party)) {
    if (counts.ownerCount >= 2) {
      return resolveSecondarySignerRoleName(signers);
    }
    // One signer deal: secondary-slot initials (e.g. page 11) go to the merchant/owner1.
    if (placement.type === 'initial') {
      return resolvePrimarySignerRoleName(signers);
    }
    return resolveSecondarySignerRoleName(signers);
  }

  if (isPrimaryParty(party)) {
    return resolvePrimarySignerRoleName(signers);
  }

  const legacy = String(placement.signerRole || '').trim();
  if (!legacy || legacy.toLowerCase() === 'signer' || legacy.toLowerCase() === 'receiver') {
    return resolvePrimarySignerRoleName(signers);
  }

  const match = signers.find((s) => s.roleName.toLowerCase() === legacy.toLowerCase());
  return match?.roleName || legacy;
}

const PRIMARY_GUARANTOR_NAME_VARIABLES = [
  'owner1_guarantor_name',
  'guaranty_owner1_name',
  'guaranty_guarantor1_name',
  'guaranty_client_name',
  'client_name',
] as const;

function primaryGuarantorNamePresent(values: Record<string, string>): boolean {
  return PRIMARY_GUARANTOR_NAME_VARIABLES.some((k) => String(values[k] || '').trim());
}

/** Mirror each Merchant #1 footer initial as a Merchant #2 initial when two owners sign. */
function expandLayoutsWithOwner2Initials(
  layouts: DocumentLayout[],
  ownerCount: number,
): DocumentLayout[] {
  if (ownerCount < 2) return layouts;

  return layouts.map((layout) => {
    const extras: DocumentLayoutPlacement[] = [];
    for (const placement of layout.placements) {
      if (placement.type !== 'initial') continue;
      if (placement.when === 'owners >= 2') continue;
      if (isSecondaryParty(placement.signerParty)) continue;
      const party = placement.signerParty;
      if (party && !isPrimaryParty(party)) continue;

      const baseX = Number(placement.x);
      const baseY = Number(placement.y);
      if (!Number.isFinite(baseX) || !Number.isFinite(baseY)) continue;

      extras.push({
        ...placement,
        id: `${placement.id}_m2init`,
        slot: `${placement.slot || placement.id}_m2init`,
        x: String(baseX + OWNER2_INITIAL_OFFSET_X),
        y: String(Math.max(0, baseY + OWNER2_INITIAL_OFFSET_Y)),
        signerParty: 'secondary',
        when: 'owners >= 2',
        sourceTabLabel: `Merchant #2 ${placement.sourceTabLabel || placement.id}`,
      });
    }
    return { ...layout, placements: [...layout.placements, ...extras] };
  });
}

function resolveTextPlacementValue(
  variable: string,
  values: Record<string, string>,
): string {
  const key = String(variable || '').trim();
  if (!key) return '';
  const direct = String(values[key] || '').trim();
  if (direct) return direct;
  const aliases = PREFILL_VALUE_ALIASES[key];
  if (aliases) {
    for (const alias of aliases) {
      const v = String(values[alias] || '').trim();
      if (v) return v;
    }
  }
  return '';
}

function placementAllowed(
  placement: DocumentLayoutPlacement,
  counts: LayoutPartyCounts,
  values: Record<string, string> = {},
): boolean {
  const when = String(placement.when || '').trim();
  if (when === 'owners >= 2' && counts.ownerCount < 2) return false;
  if (when === 'guarantors >= 2' && counts.ownerCount < 2) return false;

  if (isSecondaryParty(placement.signerParty)) {
    if (counts.ownerCount < 2) return false;
  }

  if (
    placement.type === 'signature' &&
    placement.optional &&
    isPrimaryParty(placement.signerParty) &&
    !primaryGuarantorNamePresent(values)
  ) {
    return false;
  }

  const variable = String(placement.variable || '').trim().toLowerCase();
  if (variable) {
    if (/owner2|owner_2/.test(variable) && counts.ownerCount < 2) return false;
    if (/guarantor2|guarantor_2/.test(variable) && counts.ownerCount < 2) return false;
  }

  return true;
}

function toTextTab(
  placement: DocumentLayoutPlacement,
  value: string,
  envelopeDocumentId: string,
): DocuSignTab {
  return {
    tabLabel: placement.variable || placement.slot,
    documentId: envelopeDocumentId,
    pageNumber: placement.pageNumber,
    xPosition: placement.x,
    yPosition: placement.y,
    value,
    locked: 'true',
    ...(placement.width ? { width: placement.width } : {}),
    ...(placement.height ? { height: placement.height } : {}),
  };
}

function toSignTab(
  placement: DocumentLayoutPlacement,
  envelopeDocumentId: string,
): DocuSignTab {
  return {
    tabLabel: placement.slot || `${placement.type}_${placement.id}`,
    documentId: envelopeDocumentId,
    pageNumber: placement.pageNumber,
    xPosition: placement.x,
    yPosition: placement.y,
    optional: placement.optional ? 'true' : 'false',
  };
}

export function buildRecipientTabsByRoleForLayout(
  layout: DocumentLayout,
  envelopeDocumentId: string,
  values: Record<string, string>,
  signers: LayoutSignerInput[],
  counts: LayoutPartyCounts,
): Map<
  string,
  {
    textTabs: DocuSignTab[];
    dateTabs: DocuSignTab[];
    signHereTabs: DocuSignTab[];
    initialHereTabs: DocuSignTab[];
  }
> {
  const signerTabs = new Map<
    string,
    {
      textTabs: DocuSignTab[];
      dateTabs: DocuSignTab[];
      signHereTabs: DocuSignTab[];
      initialHereTabs: DocuSignTab[];
    }
  >();

  const ensureSigner = (roleName: string) => {
    if (!signerTabs.has(roleName)) {
      signerTabs.set(roleName, {
        textTabs: [],
        dateTabs: [],
        signHereTabs: [],
        initialHereTabs: [],
      });
    }
    return signerTabs.get(roleName)!;
  };

  for (const placement of layout.placements) {
    if (!placementAllowed(placement, counts, values)) continue;

    const roleName = resolvePlacementSignerRoleName(placement, signers, counts);

    const bucket = ensureSigner(roleName);

    if (placement.type === 'text' || placement.type === 'date') {
      const variable = placement.variable || '';
      const value = String(values[variable] || '').trim();
      if (!value) continue;
      const tab = toTextTab(placement, value, envelopeDocumentId);
      if (placement.type === 'date') bucket.dateTabs.push(tab);
      else bucket.textTabs.push(tab);
      continue;
    }

    if (placement.type === 'signature') {
      bucket.signHereTabs.push(toSignTab(placement, envelopeDocumentId));
      continue;
    }

    if (placement.type === 'initial') {
      bucket.initialHereTabs.push(toSignTab(placement, envelopeDocumentId));
    }
  }

  return signerTabs;
}

function signerHasTabs(tabs: {
  textTabs: DocuSignTab[];
  dateTabs: DocuSignTab[];
  signHereTabs: DocuSignTab[];
  initialHereTabs: DocuSignTab[];
}): boolean {
  return (
    tabs.textTabs.length +
      tabs.dateTabs.length +
      tabs.signHereTabs.length +
      tabs.initialHereTabs.length >
    0
  );
}

/**
 * Builds DocuSign envelope definition from platform layouts + PDFs.
 * Same `variable` is written to every placement that references it (multi-page prefill).
 */
export function buildEnvelopeFromLayouts(options: BuildEnvelopeFromLayoutOptions) {
  const counts: LayoutPartyCounts = {
    ownerCount: options.ownerCount ?? 1,
    guarantorCount: options.guarantorCount ?? 0,
  };
  const values = enrichValuesFromSigners(
    expandPrefillValues(options.values),
    options.signers,
    counts.ownerCount,
  );
  const documents: Array<{ documentId: string; name: string; documentBase64: string }> =
    [];
  /** Map each layout package to envelope document id (1-based merge order). */
  const layoutKeyToEnvelopeDocId = new Map<string, string>();

  options.layouts.forEach((layout, idx) => {
    const envelopeDocId = String(idx + 1);
    layoutKeyToEnvelopeDocId.set(layout.key, envelopeDocId);
    const base64 = (layout as DocumentLayout & { documentBase64?: string })
      .documentBase64;
    if (!base64) {
      throw new Error(
        `Layout "${layout.key}" is missing documentBase64 on the merged envelope build.`,
      );
    }
    documents.push({
      documentId: envelopeDocId,
      name: layout.document.originalFileName || layout.name,
      documentBase64: base64,
    });
  });

  const signerTabs = new Map<
    string,
    {
      textTabs: DocuSignTab[];
      dateTabs: DocuSignTab[];
      signHereTabs: DocuSignTab[];
      initialHereTabs: DocuSignTab[];
    }
  >();

  const ensureSigner = (roleName: string) => {
    if (!signerTabs.has(roleName)) {
      signerTabs.set(roleName, {
        textTabs: [],
        dateTabs: [],
        signHereTabs: [],
        initialHereTabs: [],
      });
    }
    return signerTabs.get(roleName)!;
  };

  const expandedLayouts = options.layouts.map((layout) => {
    if (layout.key !== 'contract') return layout;
    return expandLayoutsWithOwner2Initials([layout], counts.ownerCount)[0]!;
  });

  for (const layout of expandedLayouts) {
    const envelopeDocId = layoutKeyToEnvelopeDocId.get(layout.key) || '1';

    for (const placement of layout.placements) {
      if (!placementAllowed(placement, counts, values)) continue;

      const roleName = resolvePlacementSignerRoleName(placement, options.signers, counts);

      const bucket = ensureSigner(roleName);

      if (placement.type === 'text' || placement.type === 'date') {
        const variable = placement.variable || '';
        const value = resolveTextPlacementValue(variable, values);
        if (!value) continue;
        const tab = toTextTab(placement, value, envelopeDocId);
        if (placement.type === 'date') bucket.dateTabs.push(tab);
        else bucket.textTabs.push(tab);
        continue;
      }

      if (placement.type === 'signature') {
        bucket.signHereTabs.push(toSignTab(placement, envelopeDocId));
        continue;
      }

      if (placement.type === 'initial') {
        bucket.initialHereTabs.push(toSignTab(placement, envelopeDocId));
      }
    }
  }

  const emptyTabs = () => ({
    textTabs: [] as DocuSignTab[],
    dateTabs: [] as DocuSignTab[],
    signHereTabs: [] as DocuSignTab[],
    initialHereTabs: [] as DocuSignTab[],
  });

  const mappedSigners = options.signers.map((s) => {
    const tabs = signerTabs.get(s.roleName) || emptyTabs();
    return {
      roleName: s.roleName,
      name: s.name,
      email: s.email,
      routingOrder: s.routingOrder,
      tabs,
    };
  });

  if (counts.ownerCount >= 2) {
    const secondaryRole = resolveSecondarySignerRoleName(options.signers);
    const secondaryTabs = signerTabs.get(secondaryRole);
    const hasSecondaryRecipient = mappedSigners.some(
      (s) => s.roleName.toLowerCase() === secondaryRole.toLowerCase() && signerHasTabs(s.tabs),
    );
    if (!hasSecondaryRecipient && secondaryTabs && signerHasTabs(secondaryTabs)) {
      const primaryEmail = String(
        options.signers.find((s) => /client|merchant|customer/i.test(s.roleName))?.email ||
          options.signers[0]?.email ||
          '',
      )
        .trim()
        .toLowerCase();
      const secondaryInput =
        options.signers.find((s) => s.roleName.toLowerCase() === secondaryRole.toLowerCase()) ||
        options.signers.find((s) => {
          const email = String(s.email || '').trim().toLowerCase();
          return Boolean(email && email !== primaryEmail);
        });
      if (secondaryInput) {
        mappedSigners.push({
          roleName: secondaryRole,
          name: secondaryInput.name,
          email: secondaryInput.email,
          routingOrder: secondaryInput.routingOrder ?? 2,
          tabs: secondaryTabs,
        });
      }
    }
  }

  const signers = mappedSigners
    .filter((s) => signerHasTabs(s.tabs))
    .map((s, idx) => ({
      roleName: s.roleName,
      name: s.name,
      email: s.email,
      recipientId: String(idx + 1),
      routingOrder: String(s.routingOrder ?? idx + 1),
      tabs: s.tabs,
    }));

  return {
    status: 'created',
    documents,
    recipients: { signers },
  };
}
