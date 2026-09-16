import {
  buildSignNowPrefillFingerprint,
  resolveSignNowPrefillReuse,
} from './signnow-prefill-fingerprint';

const PACKAGE = '1|contract-template|disclosure';

describe('buildSignNowPrefillFingerprint', () => {
  it('is stable for the same values in a different key order', () => {
    const a = buildSignNowPrefillFingerprint({
      packageFingerprint: PACKAGE,
      values: { net_to_merchant: '38,000.00', underwriter_fee: '2,000.00' },
    });
    const b = buildSignNowPrefillFingerprint({
      packageFingerprint: PACKAGE,
      values: { underwriter_fee: '2,000.00', net_to_merchant: '38,000.00' },
    });
    expect(a).toBe(b);
  });

  it('changes when a contract value changes', () => {
    const withWireFee = buildSignNowPrefillFingerprint({
      packageFingerprint: PACKAGE,
      values: { net_to_merchant: '37,975.00', underwriter_fee: '2,025.00' },
    });
    const withoutWireFee = buildSignNowPrefillFingerprint({
      packageFingerprint: PACKAGE,
      values: { net_to_merchant: '38,000.00', underwriter_fee: '2,000.00' },
    });
    expect(withWireFee).not.toBe(withoutWireFee);
  });

  it('changes when the package structure changes but values do not', () => {
    const values = { net_to_merchant: '38,000.00' };
    expect(
      buildSignNowPrefillFingerprint({ packageFingerprint: PACKAGE, values }),
    ).not.toBe(
      buildSignNowPrefillFingerprint({
        packageFingerprint: '1|contract-template|disclosure,ach-daily',
        values,
      }),
    );
  });

  it('treats an absent key and a blank value as the same', () => {
    const absent = buildSignNowPrefillFingerprint({
      packageFingerprint: PACKAGE,
      values: { net_to_merchant: '38,000.00' },
    });
    const blank = buildSignNowPrefillFingerprint({
      packageFingerprint: PACKAGE,
      values: { net_to_merchant: '38,000.00', owner2_email: '   ' },
    });
    expect(absent).toBe(blank);
  });

  it('ignores per-request correlation ids', () => {
    const first = buildSignNowPrefillFingerprint({
      packageFingerprint: PACKAGE,
      values: { net_to_merchant: '38,000.00', timing_request_id: 'req-1' },
    });
    const second = buildSignNowPrefillFingerprint({
      packageFingerprint: PACKAGE,
      values: { net_to_merchant: '38,000.00', timing_request_id: 'req-2' },
    });
    expect(first).toBe(second);
  });
});

describe('resolveSignNowPrefillReuse', () => {
  it('reuses the draft group when values are unchanged', () => {
    expect(
      resolveSignNowPrefillReuse({
        previousFingerprint: 'abc',
        currentFingerprint: 'abc',
      }),
    ).toEqual({ reuse: true, reason: 'prefill_fingerprint_match' });
  });

  it('rebuilds when a value changed — the stale-value regression', () => {
    expect(
      resolveSignNowPrefillReuse({
        previousFingerprint: 'abc',
        currentFingerprint: 'def',
      }),
    ).toEqual({ reuse: false, reason: 'prefill_fingerprint_changed' });
  });

  it('rebuilds when no fingerprint was ever stored', () => {
    expect(
      resolveSignNowPrefillReuse({
        previousFingerprint: null,
        currentFingerprint: 'def',
      }),
    ).toEqual({ reuse: false, reason: 'missing_prefill_fingerprint' });
    expect(
      resolveSignNowPrefillReuse({
        previousFingerprint: '   ',
        currentFingerprint: 'def',
      }).reuse,
    ).toBe(false);
  });
});
