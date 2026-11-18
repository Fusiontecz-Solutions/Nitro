import { postGroupInviteSafely } from './signnow-groupinvite-post';

describe('postGroupInviteSafely', () => {
  it('Test 1 — normal send posts groupinvite once', async () => {
    const postInvite = jest.fn().mockResolvedValue({ status: 200, data: { id: 'inv-1' } });
    const result = await postGroupInviteSafely({
      groupId: 'group-a',
      requestId: 'req-1',
      attemptNumber: 1,
      postInvite,
      findExistingInviteId: jest.fn().mockResolvedValueOnce('').mockResolvedValue('inv-1'),
    });
    expect(postInvite).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.postCount).toBe(1);
  });

  it('Test 2 / 7 — existing invite does not call SignNow', async () => {
    const postInvite = jest.fn();
    const result = await postGroupInviteSafely({
      groupId: 'group-a',
      requestId: 'req-2',
      attemptNumber: 2,
      postInvite,
      findExistingInviteId: jest.fn().mockResolvedValue('inv-existing'),
    });
    expect(postInvite).not.toHaveBeenCalled();
    expect(result.skippedBecauseExisting).toBe(true);
    expect(result.ok).toBe(true);
  });

  it('Test 3 / 5 — second request after a successful send does not post again', async () => {
    let existing = '';
    const postInvite = jest.fn().mockImplementation(async () => {
      existing = 'inv-1';
      return { status: 200, data: { id: 'inv-1' } };
    });
    await postGroupInviteSafely({
      groupId: 'group-a',
      requestId: 'req-a',
      attemptNumber: 1,
      postInvite,
      findExistingInviteId: async () => existing,
    });
    await postGroupInviteSafely({
      groupId: 'group-a',
      requestId: 'req-b',
      attemptNumber: 1,
      postInvite,
      findExistingInviteId: async () => existing,
    });
    expect(postInvite).toHaveBeenCalledTimes(1);
  });

  it('Test 4 — multiple signers still use a single postInvite call', async () => {
    const postInvite = jest.fn().mockResolvedValue({
      status: 201,
      data: {
        invite_steps: [{ order: 1 }, { order: 2 }, { order: 3 }],
      },
    });
    const result = await postGroupInviteSafely({
      groupId: 'group-a',
      requestId: 'req-4',
      attemptNumber: 1,
      postInvite,
      findExistingInviteId: jest.fn().mockResolvedValue(''),
    });
    expect(postInvite).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('Test 6 — timeout does not post again when invite state is unknown', async () => {
    const postInvite = jest.fn().mockRejectedValue(new Error('timeout'));
    await expect(
      postGroupInviteSafely({
        groupId: 'group-a',
        requestId: 'req-6',
        attemptNumber: 1,
        postInvite,
        findExistingInviteId: jest.fn().mockResolvedValue(''),
      }),
    ).rejects.toThrow('timeout');
    expect(postInvite).toHaveBeenCalledTimes(1);
  });

  it('Test 6b — timeout treats existing invite as success without another post', async () => {
    const postInvite = jest.fn().mockRejectedValue(new Error('timeout'));
    const result = await postGroupInviteSafely({
      groupId: 'group-a',
      requestId: 'req-6b',
      attemptNumber: 1,
      postInvite,
      findExistingInviteId: jest
        .fn()
        .mockResolvedValueOnce('')
        .mockResolvedValue('inv-after-timeout'),
    });
    expect(result.ok).toBe(true);
    expect(postInvite).toHaveBeenCalledTimes(1);
  });

  it('Test 8 — 429 waits Retry-After and posts at most once more', async () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    const postInvite = jest
      .fn()
      .mockResolvedValueOnce({
        status: 429,
        data: { error: 'rate limited' },
        headers: { 'retry-after': '1' },
      })
      .mockResolvedValueOnce({ status: 200, data: { id: 'inv-429' } });
    const result = await postGroupInviteSafely({
      groupId: 'group-a',
      requestId: 'req-8',
      attemptNumber: 1,
      postInvite,
      findExistingInviteId: jest.fn().mockResolvedValue(''),
      sleep,
    });
    expect(sleep).toHaveBeenCalled();
    expect(postInvite).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
  });

  it('does not cancel-and-repost when groupinvite already exists', async () => {
    const postInvite = jest.fn().mockResolvedValue({
      status: 400,
      data: { errors: [{ message: 'Group invite already exists' }] },
    });
    const result = await postGroupInviteSafely({
      groupId: 'group-a',
      requestId: 'req-dup',
      attemptNumber: 1,
      postInvite,
      findExistingInviteId: jest.fn().mockResolvedValueOnce('').mockResolvedValue('inv-dup'),
    });
    expect(postInvite).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.skippedBecauseExisting).toBe(true);
  });
});
