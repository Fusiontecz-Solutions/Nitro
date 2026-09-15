import {
  buildSignNowPackageFingerprint,
  embeddedReviewRolesForDocument,
  liveSignNowGroupMatchesPackage,
  signNowPackageFingerprintsEqual,
} from './signnow-package-fingerprint';

describe('buildSignNowPackageFingerprint', () => {
  it('treats extra template order as significant', () => {
    const a = buildSignNowPackageFingerprint({
      includeMainContract: true,
      contractTemplateId: 'AAA',
      extraTemplateIds: ['bbb', 'ccc'],
    });
    const b = buildSignNowPackageFingerprint({
      includeMainContract: true,
      contractTemplateId: 'aaa',
      extraTemplateIds: ['CCC', 'BBB'],
    });
    expect(a).not.toBe(b);
    expect(a).toBe('1|aaa|bbb,ccc');
  });

  it('changes when disclosure/addenda templates change', () => {
    const withoutDisclosure = buildSignNowPackageFingerprint({
      includeMainContract: true,
      contractTemplateId: 'contract',
      extraTemplateIds: ['ach-daily'],
    });
    const withDisclosure = buildSignNowPackageFingerprint({
      includeMainContract: true,
      contractTemplateId: 'contract',
      extraTemplateIds: ['ach-daily', 'disclosure'],
    });
    expect(withoutDisclosure).not.toBe(withDisclosure);
  });

  it('does not include prefill or signer values', () => {
    const fingerprint = buildSignNowPackageFingerprint({
      includeMainContract: true,
      contractTemplateId: 'contract',
      extraTemplateIds: ['disclosure'],
    });
    expect(fingerprint).not.toMatch(/@/);
    expect(fingerprint).toBe('1|contract|disclosure');
  });
});

describe('signNowPackageFingerprintsEqual', () => {
  it('rejects empty fingerprints', () => {
    expect(signNowPackageFingerprintsEqual('', '1|a|b')).toBe(false);
    expect(signNowPackageFingerprintsEqual(null, null)).toBe(false);
  });
});

describe('liveSignNowGroupMatchesPackage', () => {
  const extras = [
    { name: 'ACH Daily', layoutKey: 'ach_daily', type: 'addendum' },
    { name: 'State Disclosure', layoutKey: 'signnow_disclosure', type: 'disclosure' },
    { name: 'Exhibit C', layoutKey: 'exhibit_c', type: 'addendum' },
  ];

  it('reuses a disclosure package when live extras match', () => {
    expect(
      liveSignNowGroupMatchesPackage({
        includeMainContract: true,
        extras,
        documents: [
          { document_name: 'MCA Agreement' },
          { document_name: 'ACH Daily' },
          { document_name: 'State Disclosure' },
          { document_name: 'Exhibit C' },
        ],
      }),
    ).toBe(true);
  });

  it('does not reuse a main-only group when disclosure is enabled', () => {
    expect(
      liveSignNowGroupMatchesPackage({
        includeMainContract: true,
        extras,
        documents: [{ document_name: 'MCA Agreement' }],
      }),
    ).toBe(false);
  });

  it('does not reuse a group when extras are in a different send order', () => {
    expect(
      liveSignNowGroupMatchesPackage({
        includeMainContract: true,
        extras,
        documents: [
          { document_name: 'MCA Agreement' },
          { document_name: 'Exhibit C' },
          { document_name: 'State Disclosure' },
          { document_name: 'ACH Daily' },
        ],
      }),
    ).toBe(false);
  });

  it('does not reuse a group with a stale extra after disclosure is turned off', () => {
    expect(
      liveSignNowGroupMatchesPackage({
        includeMainContract: true,
        extras: extras.filter((row) => row.type !== 'disclosure'),
        documents: [
          { document_name: 'MCA Agreement' },
          { document_name: 'ACH Daily' },
          { document_name: 'State Disclosure' },
          { document_name: 'Exhibit C' },
        ],
      }),
    ).toBe(false);
  });
});

describe('embeddedReviewRolesForDocument', () => {
  it('includes Recipient 2 from listed roles even when field roles omit it', () => {
    expect(
      embeddedReviewRolesForDocument({
        roles: ['Owner', 'Recipient 1'],
        listedRoles: ['Owner', 'Recipient 1', 'Recipient 2'],
        remainingRoles: ['Owner', 'Recipient 1'],
      }),
    ).toEqual(['Owner', 'Recipient 1', 'Recipient 2']);
  });
});
