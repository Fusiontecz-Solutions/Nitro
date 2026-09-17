import {
  mapSignNowStatusToken,
  resolveGroupInviteStatus,
  resolveGroupDocumentsStatus,
  resolveSignNowGroupStatus,
} from './signnow-group-status';

describe('mapSignNowStatusToken', () => {
  it('maps SignNow completion synonyms', () => {
    expect(mapSignNowStatusToken('fulfilled')).toBe('completed');
    expect(mapSignNowStatusToken('SIGNED')).toBe('completed');
    expect(mapSignNowStatusToken('canceled')).toBe('voided');
    expect(mapSignNowStatusToken('pending')).toBe('sent');
    expect(mapSignNowStatusToken('')).toBeNull();
    expect(mapSignNowStatusToken('something-else')).toBeNull();
  });
});

describe('resolveGroupInviteStatus', () => {
  it('is completed only when every signer action is fulfilled', () => {
    const invite = {
      invite: {
        status: 'pending',
        steps: [
          { invite_actions: [{ status: 'fulfilled' }, { status: 'fulfilled' }] },
        ],
      },
    };
    expect(resolveGroupInviteStatus(invite)).toBe('completed');
  });

  it('stays sent while a signer is outstanding, even if the envelope says fulfilled', () => {
    const invite = {
      invite: {
        status: 'fulfilled',
        steps: [{ invite_actions: [{ status: 'fulfilled' }, { status: 'pending' }] }],
      },
    };
    expect(resolveGroupInviteStatus(invite)).toBe('sent');
  });

  it('ignores email-delivery statuses that never reach "fulfilled"', () => {
    // Real GET /documentgroup/{id}/groupinvite/{id} payload: the signer
    // finished (invite_actions fulfilled) but invite_emails stay "sent".
    const invite = {
      invite: {
        status: 'fulfilled',
        steps: [
          {
            status: 'fulfilled',
            invite_actions: [{ status: 'fulfilled', role_name: 'Merchant' }],
            invite_emails: [{ status: 'sent', email: 'merchant@example.com' }],
            documents: [{ id: 'a', action: 'sign' }],
          },
        ],
      },
    };
    expect(resolveGroupInviteStatus(invite)).toBe('completed');
    expect(resolveSignNowGroupStatus({ documents: [{ id: 'a' }] }, invite)).toBe('completed');
  });

  it('uses the step status only when the step lists no signer actions', () => {
    const invite = { invite: { steps: [{ status: 'fulfilled', invite_emails: [{ status: 'sent' }] }] } };
    expect(resolveGroupInviteStatus(invite)).toBe('completed');
  });

  it('reports voided when any action was cancelled or declined', () => {
    const invite = {
      invite: { steps: [{ invite_actions: [{ status: 'fulfilled' }, { status: 'declined' }] }] },
    };
    expect(resolveGroupInviteStatus(invite)).toBe('voided');
  });
});

describe('resolveGroupDocumentsStatus', () => {
  it('is completed when every document field invite is fulfilled', () => {
    const group = {
      documents: [
        { id: 'a', field_invites: [{ status: 'fulfilled' }] },
        { id: 'b', field_invites: [{ status: 'fulfilled' }] },
      ],
    };
    expect(resolveGroupDocumentsStatus(group)).toBe('completed');
  });

  it('is sent when one document still has an open invite', () => {
    const group = {
      documents: [
        { id: 'a', field_invites: [{ status: 'fulfilled' }] },
        { id: 'b', field_invites: [{ status: 'pending' }] },
      ],
    };
    expect(resolveGroupDocumentsStatus(group)).toBe('sent');
  });

  it('returns null when the payload carries no signing signal at all', () => {
    expect(resolveGroupDocumentsStatus({ documents: [{ id: 'a' }] })).toBeNull();
    expect(resolveGroupDocumentsStatus({})).toBeNull();
  });
});

describe('resolveSignNowGroupStatus', () => {
  it('does not fall back to draft for a real document-group payload without `state`', () => {
    // The regression: GET /documentgroup/{id} has no top-level `state`, so the
    // old mapGroupState(data.state) call made every signed group read "draft".
    const group = {
      id: 'grp',
      document_group_invite_id: 'inv',
      documents: [{ id: 'a', field_invites: [{ status: 'fulfilled' }] }],
    };
    const invite = { invite: { steps: [{ invite_actions: [{ status: 'fulfilled' }] }] } };
    expect(resolveSignNowGroupStatus(group, invite)).toBe('completed');
  });

  it('waits for the review signer when documents still have an open invite', () => {
    // The merchants' invite is fulfilled, but the package is not done: the
    // review signer's field invite is still pending on one document. Marking
    // this "completed" is what promoted the deal the moment the review email
    // went out.
    const group = {
      id: 'grp',
      documents: [
        { id: 'a', field_invites: [{ status: 'fulfilled' }] },
        { id: 'b', field_invites: [{ status: 'pending' }] },
      ],
    };
    const invite = { invite: { steps: [{ invite_actions: [{ status: 'fulfilled' }] }] } };
    expect(resolveGroupInviteStatus(invite)).toBe('completed');
    expect(resolveSignNowGroupStatus(group, invite)).toBe('sent');
  });

  it('completes once the documents agree the package is finished', () => {
    const group = {
      id: 'grp',
      documents: [
        { id: 'a', field_invites: [{ status: 'fulfilled' }] },
        { id: 'b', field_invites: [{ status: 'fulfilled' }] },
      ],
    };
    const invite = { invite: { steps: [{ invite_actions: [{ status: 'fulfilled' }] }] } };
    expect(resolveSignNowGroupStatus(group, invite)).toBe('completed');
  });

  it('still honours an explicit legacy `state`', () => {
    expect(resolveSignNowGroupStatus({ state: 'completed' })).toBe('completed');
    expect(resolveSignNowGroupStatus({ state: 'voided' })).toBe('voided');
  });

  it('prefers the invite over per-document signals for terminal states', () => {
    const group = { documents: [{ id: 'a', field_invites: [{ status: 'pending' }] }] };
    const invite = { invite: { steps: [{ invite_actions: [{ status: 'declined' }] }] } };
    expect(resolveSignNowGroupStatus(group, invite)).toBe('voided');
  });

  it('reports sent while signing is in progress', () => {
    const group = { documents: [{ id: 'a', field_invites: [{ status: 'pending' }] }] };
    expect(resolveSignNowGroupStatus(group, { invite: { status: 'pending' } })).toBe('sent');
  });

  it('is draft when nothing indicates the group moved', () => {
    expect(resolveSignNowGroupStatus({ documents: [{ id: 'a' }] })).toBe('draft');
    expect(resolveSignNowGroupStatus({})).toBe('draft');
  });
});
