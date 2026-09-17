import {
  collectFinishedEmbeddedSigners,
  collectSignedRoleNames,
  resolveSignNowReviewStatus,
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
