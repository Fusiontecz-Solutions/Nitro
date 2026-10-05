import { createHash } from 'node:crypto';
import {
  buildSignNowPrefillFingerprint,
  resolveSignNowPrefillReuse,
  resolveSignNowPrewarmLink,
  SIGNNOW_PRISTINE_PREFILL_FINGERPRINT,
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

  it('changes when the field mapping changes but values do not', () => {
    // A group built before a mapping fix (no `mapping` key in the payload) must
    // not be reused: its pages still carry what the old mapping printed, e.g.
    // the business name on the Monthly Fee "Print Name of Account Holder" line.
    const values = { client_name: 'MATHEW CHARLES MILLER', legal_name: 'AMERICAN RADIATOR INC' };
    const beforeMappingFix = createHash('sha256')
      .update(JSON.stringify({ package: PACKAGE, values }))
      .digest('hex');
    const current = buildSignNowPrefillFingerprint({ packageFingerprint: PACKAGE, values });
    expect(current).not.toBe(beforeMappingFix);
    expect(
      resolveSignNowPrefillReuse({
        previousFingerprint: beforeMappingFix,
        currentFingerprint: current,
      }).reuse,
    ).toBe(false);
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

  it('reuses a pre-warmed group however much the contract was edited after', () => {
    // A `structureOnly` pre-warm copies the package and writes nothing into it,
    // so it has no baked `texts[]` to go stale. Refusing it on a value change
    // would throw the warm away and copy a second package against SignNow's
    // daily document limit — defeating the point of warming it early.
    expect(
      resolveSignNowPrefillReuse({
        previousFingerprint: SIGNNOW_PRISTINE_PREFILL_FINGERPRINT,
        currentFingerprint: 'anything-at-all',
      }),
    ).toEqual({ reuse: true, reason: 'pristine_structure_only' });
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

describe('resolveSignNowPrewarmLink', () => {
  const GROUP = 'group-1';
  const REVIEWED = 'a'.repeat(64);

  it('links when the application has no document yet', () => {
    expect(
      resolveSignNowPrewarmLink({ live: null, warmGroupId: GROUP, reviewFinished: false }),
    ).toEqual({ link: true, reason: 'no_linked_document' });
  });

  it('re-links an open pristine draft', () => {
    expect(
      resolveSignNowPrewarmLink({
        live: { envelopeId: GROUP, status: 'draft', prefillFingerprint: SIGNNOW_PRISTINE_PREFILL_FINGERPRINT },
        warmGroupId: GROUP,
        reviewFinished: false,
      }).link,
    ).toBe(true);
  });

  it('never downgrades a group Review already prefilled back to pristine', () => {
    expect(
      resolveSignNowPrewarmLink({
        live: { envelopeId: GROUP, status: 'draft', prefillFingerprint: REVIEWED },
        warmGroupId: GROUP,
        reviewFinished: false,
      }),
    ).toEqual({ link: false, reason: 'already_prefilled_by_review' });
  });

  it('still parks a new warm group when the linked one was built from other values', () => {
    expect(
      resolveSignNowPrewarmLink({
        live: { envelopeId: 'older-group', status: 'draft', prefillFingerprint: REVIEWED },
        warmGroupId: GROUP,
        reviewFinished: false,
      }).link,
    ).toBe(true);
  });

  it('does not touch a finished review or a document that left draft', () => {
    expect(
      resolveSignNowPrewarmLink({
        live: { envelopeId: 'older-group', status: 'draft', prefillFingerprint: null },
        warmGroupId: GROUP,
        reviewFinished: true,
      }).reason,
    ).toBe('review_finished');
    expect(
      resolveSignNowPrewarmLink({
        live: { envelopeId: GROUP, status: 'sent', prefillFingerprint: REVIEWED },
        warmGroupId: GROUP,
        reviewFinished: false,
      }).reason,
    ).toBe('not_open_draft');
  });
});
