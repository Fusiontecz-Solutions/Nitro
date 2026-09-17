import { clearLiveEnvelopePointers } from './contractReinitiationService';

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
