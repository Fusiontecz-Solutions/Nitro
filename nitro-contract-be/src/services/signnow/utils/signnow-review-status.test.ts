import {
  collectFinishedEmbeddedSigners,
  collectSignedRoleNames,
  resolveSignNowReviewStatus,
  signNowRowTimestamp,
} from './signnow-review-status';

describe('resolveSignNowReviewStatus', () => {
  it('reports in_review while the preparer has not finished', () => {
    const payload = {
      data: [
        {
          signers: [
            { role: 'Owner', status: 'pending', documents: [{ role: 'Owner', status: 'pending' }] },
            { role: 'Recipient 1', status: 'created' },
          ],
        },
      ],
    };
    expect(resolveSignNowReviewStatus(payload)).toEqual({
      reviewComplete: false,
      fulfilledRoles: [],
      status: 'in_review',
    });
  });

  it('reports review_complete once a signer status is fulfilled', () => {
    const payload = {
      data: {
        invites: [
          {
            signers: [
              { role: 'Owner', status: 'fulfilled' },
              { role: 'Recipient 1', status: 'pending' },
            ],
          },
        ],
      },
    };
    const result = resolveSignNowReviewStatus(payload);
    expect(result.reviewComplete).toBe(true);
    expect(result.fulfilledRoles).toEqual(['Owner']);
  });

  it('ignores per-document fulfilled status on a still-pending signer', () => {
    // An addendum with no Owner widgets comes back fulfilled for that role
    // straight away. Counting it would flip the UI to "Send" before the
    // preparer had read anything.
    const payload = {
      data: [
        {
          signers: [
            {
              role: 'Owner',
              status: 'pending',
              documents: [
                { role: 'Owner', status: 'fulfilled' },
                { role: 'Owner', status: 'pending' },
              ],
            },
          ],
        },
      ],
    };
    expect(resolveSignNowReviewStatus(payload).reviewComplete).toBe(false);
  });

  it('accepts the alternative status keys SignNow uses', () => {
    expect(
      collectFinishedEmbeddedSigners({
        data: [{ signers: [{ email: 'prep@nitro.test', invite_status: 'SIGNED' }] }],
      }),
    ).toEqual(['prep@nitro.test']);
    expect(
      collectFinishedEmbeddedSigners({ data: [{ signers: [{ role: 'Owner', state: 'done' }] }] }),
    ).toEqual(['Owner']);
  });

  it('reads the nested data[].invites[].signers[] shape SignNow returns for a group', () => {
    // The shape the live embedded-invites listing answers with on a first send.
    // The old parser stopped at the outer row, found no `signers`, and reported
    // "in review" forever — so Finish was never detected.
    const payload = {
      data: [
        {
          id: 'invite-1',
          invites: [
            {
              id: 'invite-1',
              order: 1,
              signers: [
                { role: 'Owner', status: 'fulfilled' },
                { role: 'Recipient 1', status: 'created' },
              ],
            },
          ],
        },
      ],
    };
    const result = resolveSignNowReviewStatus(payload);
    expect(result.reviewComplete).toBe(true);
    expect(result.fulfilledRoles).toEqual(['Owner']);
  });

  it('reads a single invite object returned without an array wrapper', () => {
    const payload = {
      data: { id: 'invite-1', signers: [{ role: 'Owner', status: 'fulfilled' }] },
    };
    expect(resolveSignNowReviewStatus(payload).reviewComplete).toBe(true);
  });

  it('counts a signer whose every assigned document is fulfilled', () => {
    // SignNow leaves the signer row on `pending` for some groups and only
    // flips the per-document rows. Every document done is still Finish.
    const payload = {
      data: [
        {
          signers: [
            {
              role: 'Owner',
              status: 'pending',
              documents: [
                { role: 'Owner', status: 'fulfilled' },
                { role: 'Owner', status: 'fulfilled' },
              ],
            },
            { role: 'Recipient 1', status: 'created', documents: [{ status: 'pending' }] },
          ],
        },
      ],
    };
    const result = resolveSignNowReviewStatus(payload);
    expect(result.reviewComplete).toBe(true);
    expect(result.fulfilledRoles).toEqual(['Owner']);
  });

  it('dedupes roles and survives empty or malformed payloads', () => {
    expect(
      collectFinishedEmbeddedSigners({
        data: [
          { signers: [{ role: 'Owner', status: 'fulfilled' }] },
          { signers: [{ role: 'owner', status: 'completed' }] },
        ],
      }),
    ).toEqual(['Owner']);
    for (const bad of [null, undefined, {}, { data: null }, { data: [null, 'x'] }, []]) {
      expect(resolveSignNowReviewStatus(bad)).toEqual({
        reviewComplete: false,
        fulfilledRoles: [],
        status: 'in_review',
      });
    }
  });
});

describe('collectSignedRoleNames', () => {
  const group = (signature: Record<string, unknown>) => ({
    data: { documents: [{ id: 'doc-1', signatures: [signature] }] },
  });

  it('reports the role behind a signature that carries signed data', () => {
    expect(collectSignedRoleNames(group({ role: 'Owner', data: 'base64' }))).toEqual(['Owner']);
    expect(
      collectSignedRoleNames(group({ json_attributes: { role: 'Owner' }, signature_id: 'sig-1' })),
    ).toEqual(['Owner']);
  });

  it('ignores an empty signature widget waiting to be signed', () => {
    expect(collectSignedRoleNames(group({ role: 'Owner' }))).toEqual([]);
    expect(collectSignedRoleNames({ documents: [] })).toEqual([]);
    for (const bad of [null, undefined, {}, { data: null }, []]) {
      expect(collectSignedRoleNames(bad)).toEqual([]);
    }
  });
});

describe('review-session freshness (`since`)', () => {
  const HOUR = 60 * 60 * 1000;
  const openedAt = Date.parse('2026-09-21T12:00:00Z');
  const lastWeek = Math.floor((openedAt - 7 * 24 * HOUR) / 1000);
  const justNow = Math.floor((openedAt + 30_000) / 1000);

  it('ignores a signature the preparer drew in an earlier review of a reused group', () => {
    // Prefill does not clear signature widgets, so a group that was reviewed,
    // finished and then reused still carries them. Counting them reported
    // "review complete" about four seconds after the new iframe opened.
    const payload = {
      data: {
        documents: [
          { id: 'doc-1', signatures: [{ role: 'Owner', data: 'base64', created: lastWeek }] },
        ],
      },
    };
    expect(collectSignedRoleNames(payload)).toEqual(['Owner']);
    expect(collectSignedRoleNames(payload, openedAt)).toEqual([]);
  });

  it('still reports a signature laid down during this review session', () => {
    const payload = {
      data: {
        documents: [
          { id: 'doc-1', signatures: [{ role: 'Owner', data: 'base64', created: justNow }] },
        ],
      },
    };
    expect(collectSignedRoleNames(payload, openedAt)).toEqual(['Owner']);
  });

  it('keeps a row that carries no timestamp, so freshness can only discard proven-old evidence', () => {
    const payload = {
      data: { documents: [{ id: 'doc-1', signatures: [{ role: 'Owner', data: 'base64' }] }] },
    };
    expect(collectSignedRoleNames(payload, openedAt)).toEqual(['Owner']);
  });

  it('drops a fulfilled embedded signer left over from the previous review', () => {
    const payload = {
      data: [
        {
          created: lastWeek,
          signers: [{ role: 'Owner', status: 'fulfilled', created: lastWeek }],
        },
      ],
    };
    expect(resolveSignNowReviewStatus(payload).reviewComplete).toBe(true);
    expect(resolveSignNowReviewStatus(payload, openedAt).reviewComplete).toBe(false);
  });

  it('accepts the invite timestamp when the signer row carries none', () => {
    const payload = {
      data: [{ created: justNow, signers: [{ role: 'Owner', status: 'fulfilled' }] }],
    };
    expect(resolveSignNowReviewStatus(payload, openedAt).reviewComplete).toBe(true);
  });

  it('reads unix seconds, milliseconds and ISO timestamps alike', () => {
    expect(signNowRowTimestamp({ created: 1_758_456_000 })).toBe(1_758_456_000_000);
    expect(signNowRowTimestamp({ created: 1_758_456_000_000 })).toBe(1_758_456_000_000);
    expect(signNowRowTimestamp({ created_at: '2026-09-21T12:00:00Z' })).toBe(openedAt);
    expect(signNowRowTimestamp({ json_attributes: { created: 1_758_456_000 } })).toBe(
      1_758_456_000_000,
    );
    expect(signNowRowTimestamp({ role: 'Owner' })).toBeNull();
  });
});
