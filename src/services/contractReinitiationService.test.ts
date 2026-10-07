import {
  CONTRACT_OFFER_SNAPSHOT_KEY,
  clearLiveEnvelopePointers,
  clearPrefillFieldOverrides,
  detectOfferChangeSinceLastContract,
  isApplicationDerivedPrefillKey,
  refreshApplicationDerivedPrefillOverrides,
  resetPrefillOverridesForReinitiation,
  resetPrefillOverridesForRegeneration,
  resolveRegenerationPrefillMode,
} from './contractReinitiationService';
import { buildContractOfferFingerprint } from './docusign/utils/contract-send-history';

describe('clearLiveEnvelopePointers', () => {
  it('drops pointers at the package being archived', () => {
    const next = clearLiveEnvelopePointers({
      mainContractSendPackage: { envelopeId: 'grp-old' },
      documentTemplateEnvelopeByMappingId: { 'map-1': { envelopeId: 'doc-old' } },
      achAuthorizationDocuSign: { envelopeId: 'ach-old' },
      standalonePackageDocuSign: { envelopeId: 'pkg-old' },
    }) as Record<string, unknown>;
    expect(next).toEqual({});
  });

  it('keeps the send history and every unrelated prefill value', () => {
    const next = clearLiveEnvelopePointers({
      mainContractSendPackage: { envelopeId: 'grp-old' },
      documentSendHistory: [{ envelopeId: 'grp-old', status: 'sent' }],
      contractSendHistory: [{ envelopeId: 'grp-older' }],
      contractSignerOverrides: [{ email: 'owner@example.com' }],
      includeWireFee: 'false',
      legalName: 'ACME LLC',
    }) as Record<string, unknown>;

    expect(next.mainContractSendPackage).toBeUndefined();
    expect(next.documentSendHistory).toEqual([{ envelopeId: 'grp-old', status: 'sent' }]);
    expect(next.contractSendHistory).toEqual([{ envelopeId: 'grp-older' }]);
    expect(next.contractSignerOverrides).toEqual([{ email: 'owner@example.com' }]);
    // The deal's $25 wire-fee choice is a preference, not a pointer at the old package.
    expect(next.includeWireFee).toBe('false');
    expect(next.legalName).toBe('ACME LLC');
  });

  it('leaves the column untouched when there is nothing to clear', () => {
    expect(clearLiveEnvelopePointers({ legalName: 'ACME LLC' })).toBeUndefined();
    expect(clearLiveEnvelopePointers(null)).toBeUndefined();
    expect(clearLiveEnvelopePointers(['nope'])).toBeUndefined();
  });
});

describe('clearPrefillFieldOverrides', () => {
  it('drops every cached document value so the resend re-derives from live data', () => {
    const next = clearPrefillFieldOverrides({
      legalName: 'OLD NAME LLC',
      owner_first_name: 'Jane',
      purchase_amount: '50000',
      documentTemplatePrefillByMappingId: { 'map-1': { legal_name: 'OLD NAME LLC' } },
      contractSignerOverrides: [{ email: 'old-owner@example.com' }],
    }) as Record<string, unknown>;

    expect(next).toEqual({});
  });

  it('keeps send history, the wire-fee toggle and hand-entered Exhibit C entities', () => {
    const exhibitC = JSON.stringify([{ clientName: 'SECOND HOLDER' }]);
    const next = clearPrefillFieldOverrides({
      legalName: 'OLD NAME LLC',
      includeWireFee: 'false',
      exhibitCEntities: exhibitC,
      contractSendHistory: [{ envelopeId: 'grp-older' }],
      documentSendHistory: [{ envelopeId: 'grp-old', status: 'sent' }],
    }) as Record<string, unknown>;

    expect(next.legalName).toBeUndefined();
    expect(next.includeWireFee).toBe('false');
    expect(next.exhibitCEntities).toBe(exhibitC);
    expect(next.contractSendHistory).toEqual([{ envelopeId: 'grp-older' }]);
    expect(next.documentSendHistory).toEqual([{ envelopeId: 'grp-old', status: 'sent' }]);
  });

  it('keeps the disclosure calculator monthly revenues entered by hand', () => {
    const next = clearPrefillFieldOverrides({
      legalName: 'OLD NAME LLC',
      disclosureMonthlyRevenues: [85000, 92000.5],
    }) as Record<string, unknown>;

    expect(next.legalName).toBeUndefined();
    expect(next.disclosureMonthlyRevenues).toEqual([85000, 92000.5]);
  });
});

describe('resetPrefillOverridesForReinitiation', () => {
  const overrides = {
    mainContractSendPackage: { envelopeId: 'grp-old' },
    contractSendHistory: [{ envelopeId: 'grp-old', status: 'sent' }],
    legalName: 'OLD NAME LLC',
  };

  it('clears only the live pointers for an ISO re-approval reinitiation', () => {
    const next = resetPrefillOverridesForReinitiation(overrides) as Record<string, unknown>;
    expect(next.mainContractSendPackage).toBeUndefined();
    expect(next.legalName).toBe('OLD NAME LLC');
    expect(next.contractSendHistory).toEqual([{ envelopeId: 'grp-old', status: 'sent' }]);
  });

  it('also clears cached field values for a user-driven resend', () => {
    const next = resetPrefillOverridesForReinitiation(overrides, {
      clearFieldOverrides: true,
    }) as Record<string, unknown>;
    expect(next.mainContractSendPackage).toBeUndefined();
    expect(next.legalName).toBeUndefined();
    // The prior send must stay in Contracts Generated after the reset.
    expect(next.contractSendHistory).toEqual([{ envelopeId: 'grp-old', status: 'sent' }]);
  });
});

const offerA = buildContractOfferFingerprint({
  offer: '10000.00',
  totalRemit: '14990.000000',
  term: '20 Weeks',
  frequency: 'Weekly',
  repayPerPeriod: '749.50',
  rate: '1.499000',
  fees: '5.000000',
})!;

describe('detectOfferChangeSinceLastContract', () => {
  const sentWith = (offerValues: unknown) => ({
    mainContractSendPackage: { envelopeId: 'grp-old', termsSnapshot: { offerValues } },
  });

  it('reports no change when the live offer matches the archived send', () => {
    const live = buildContractOfferFingerprint({ ...offerA, offer: 10000 })!;
    expect(detectOfferChangeSinceLastContract(sentWith(offerA), 'grp-old', live)).toBe(false);
  });

  it('reports a change when any offer term moved', () => {
    const live = buildContractOfferFingerprint({ ...offerA, offer: 12000 })!;
    expect(detectOfferChangeSinceLastContract(sentWith(offerA), 'grp-old', live)).toBe(true);
    const termMoved = buildContractOfferFingerprint({ ...offerA, term: '24 Weeks' })!;
    expect(detectOfferChangeSinceLastContract(sentWith(offerA), 'grp-old', termMoved)).toBe(true);
  });

  it('falls back to the snapshot stamped by the last regeneration', () => {
    const overrides = { [CONTRACT_OFFER_SNAPSHOT_KEY]: offerA };
    expect(detectOfferChangeSinceLastContract(overrides, '', offerA)).toBe(false);
    const live = buildContractOfferFingerprint({ ...offerA, fees: 7 })!;
    expect(detectOfferChangeSinceLastContract(overrides, '', live)).toBe(true);
  });

  it('compares legacy snapshots on amount, payback and term', () => {
    const legacy = {
      contractSendHistory: [
        {
          envelopeId: 'grp-old',
          termsSnapshot: { approvedAmount: 10000, totalAmount: 14990, term: '20 Weeks' },
        },
      ],
    };
    expect(detectOfferChangeSinceLastContract(legacy, 'grp-old', offerA)).toBe(false);
    const live = buildContractOfferFingerprint({ ...offerA, totalRemit: 15500 })!;
    expect(detectOfferChangeSinceLastContract(legacy, 'grp-old', live)).toBe(true);
  });

  it('returns null with nothing to compare against', () => {
    expect(detectOfferChangeSinceLastContract({}, 'grp-old', offerA)).toBeNull();
  });
});

describe('resolveRegenerationPrefillMode', () => {
  it('clears everything when the offer changed', () => {
    expect(
      resolveRegenerationPrefillMode({
        offerChanged: true,
        clearFieldOverrides: false,
        flaggedForReinitiation: false,
      }),
    ).toBe('clear-all');
  });

  it('keeps document values on a same-offer resend', () => {
    expect(
      resolveRegenerationPrefillMode({
        offerChanged: false,
        clearFieldOverrides: true,
        flaggedForReinitiation: true,
      }),
    ).toBe('refresh-application');
  });

  it('falls back to a full clear for an unknown baseline on a resend or flagged deal', () => {
    const unknown = { offerChanged: null, clearFieldOverrides: false };
    expect(resolveRegenerationPrefillMode({ ...unknown, flaggedForReinitiation: true })).toBe(
      'clear-all',
    );
    expect(
      resolveRegenerationPrefillMode({
        offerChanged: null,
        clearFieldOverrides: true,
        flaggedForReinitiation: false,
      }),
    ).toBe('clear-all');
    expect(resolveRegenerationPrefillMode({ ...unknown, flaggedForReinitiation: false })).toBe(
      'pointers-only',
    );
  });
});

describe('isApplicationDerivedPrefillKey', () => {
  it.each([
    'businessAddressCity',
    'clientEmail',
    'owner_1_email',
    'federalTaxIdEin',
    'doingBusinessAs',
    'legalName',
    'authorizationClientBankRouting',
    'business_state',
  ])('treats %s as application data', (key) => {
    expect(isApplicationDerivedPrefillKey(key)).toBe(true);
  });

  it.each([
    'disclosure_avg_monthly_revenue',
    'installment_day_1_p1',
    'purchase_amount',
    'disclosure_estimated_payment',
    'remittance',
    'appendixUnderwritingFees',
  ])('treats %s as a document / offer value', (key) => {
    expect(isApplicationDerivedPrefillKey(key)).toBe(false);
  });
});

describe('refreshApplicationDerivedPrefillOverrides', () => {
  it('keeps addendum / disclosure values and drops application copies', () => {
    const tabs = { 'map-flex': { installment_day_1_p1: '15', daily_payment_1_p1: '425.00' } };
    const next = refreshApplicationDerivedPrefillOverrides({
      businessAddress: '1 OLD ST',
      clientEmail: 'old@example.com',
      disclosure_avg_monthly_revenue: '85,000.00',
      purchase_amount: '10000',
      includeWireFee: 'false',
      documentTemplatePrefillByMappingId: tabs,
      contractSignerOverrides: [{ email: 'old@example.com' }],
      contractSendHistory: [{ envelopeId: 'grp-old' }],
    }) as Record<string, unknown>;

    expect(next).toEqual({
      disclosure_avg_monthly_revenue: '85,000.00',
      purchase_amount: '10000',
      includeWireFee: 'false',
      documentTemplatePrefillByMappingId: tabs,
      contractSendHistory: [{ envelopeId: 'grp-old' }],
    });
  });
});

describe('resetPrefillOverridesForRegeneration', () => {
  const stored = {
    mainContractSendPackage: { envelopeId: 'grp-old' },
    contractSendHistory: [{ envelopeId: 'grp-old', status: 'sent' }],
    documentTemplatePrefillByMappingId: { 'map-flex': { installment_day_1_p1: '15' } },
    disclosure_avg_monthly_revenue: '85,000.00',
    businessAddress: '1 OLD ST',
  };

  it('same offer: keeps document values, drops application copies, stamps the offer', () => {
    const next = resetPrefillOverridesForRegeneration(
      stored,
      'refresh-application',
      offerA,
    ) as Record<string, unknown>;
    expect(next.mainContractSendPackage).toBeUndefined();
    expect(next.businessAddress).toBeUndefined();
    expect(next.disclosure_avg_monthly_revenue).toBe('85,000.00');
    expect(next.documentTemplatePrefillByMappingId).toEqual(
      stored.documentTemplatePrefillByMappingId,
    );
    expect(next[CONTRACT_OFFER_SNAPSHOT_KEY]).toEqual(offerA);
  });

  it('changed offer: drops every cached document value but keeps send history', () => {
    const next = resetPrefillOverridesForRegeneration(stored, 'clear-all', offerA) as Record<
      string,
      unknown
    >;
    expect(next.documentTemplatePrefillByMappingId).toBeUndefined();
    expect(next.disclosure_avg_monthly_revenue).toBeUndefined();
    expect(next.businessAddress).toBeUndefined();
    expect(next.contractSendHistory).toEqual(stored.contractSendHistory);
    expect(next[CONTRACT_OFFER_SNAPSHOT_KEY]).toEqual(offerA);
  });
});

describe('detectOfferChangeSinceLastContract — contract column fallback', () => {
  const signedNoSnapshot = {
    documentSendHistory: [{ envelopeId: 'grp-signed', documentKind: 'contract' }],
  };

  it('a signed contract with no recorded terms and the same offer is unchanged', () => {
    expect(
      detectOfferChangeSinceLastContract(signedNoSnapshot, 'grp-signed', offerA, {
        status: 'COMPLETED',
        approvedAmount: 10000,
        totalAmount: 14990,
      }),
    ).toBe(false);
  });

  it('a signed contract whose amounts differ from the live offer is changed', () => {
    expect(
      detectOfferChangeSinceLastContract(signedNoSnapshot, 'grp-signed', offerA, {
        status: 'COMPLETED',
        approvedAmount: 8000,
        totalAmount: 11992,
      }),
    ).toBe(true);
  });

  it('ignores the columns of a DRAFT row (offer saves re-sync them)', () => {
    expect(
      detectOfferChangeSinceLastContract(signedNoSnapshot, 'grp-signed', offerA, {
        status: 'DRAFT',
        approvedAmount: 10000,
        totalAmount: 14990,
      }),
    ).toBeNull();
  });
});
