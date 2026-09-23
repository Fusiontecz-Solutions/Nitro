import {
  clearLiveEnvelopePointers,
  clearPrefillFieldOverrides,
  resetPrefillOverridesForReinitiation,
} from './contractReinitiationService';

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
