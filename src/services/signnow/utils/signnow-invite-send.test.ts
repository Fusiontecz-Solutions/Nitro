jest.mock('../../../config/prismaClient', () => ({
  __esModule: true,
  default: {
    signNowInviteSend: {},
    $transaction: jest.fn(),
  },
}));

import {
  canClaimSendStatus,
  isStaleSending,
  parseRetryAfterMs,
  SIGNNOW_SEND_FAILED,
  SIGNNOW_SEND_NOT_SENT,
  SIGNNOW_SEND_SENDING,
  SIGNNOW_SEND_SENT,
  STALE_SENDING_MS,
} from './signnow-invite-send';

describe('signnow invite send state', () => {
  it('concurrent claims: SENT and in-progress SENDING are not reclaimable', () => {
    expect(canClaimSendStatus(SIGNNOW_SEND_SENT, new Date())).toBe(false);
    expect(canClaimSendStatus(SIGNNOW_SEND_SENDING, new Date())).toBe(false);
  });

  it('claims NOT_SENT and FAILED', () => {
    expect(canClaimSendStatus(SIGNNOW_SEND_NOT_SENT, null)).toBe(true);
    expect(canClaimSendStatus(SIGNNOW_SEND_FAILED, new Date())).toBe(true);
  });

  it('does not claim a fresh SENDING lock', () => {
    expect(canClaimSendStatus(SIGNNOW_SEND_SENDING, new Date())).toBe(false);
  });

  it('reclaims a stale SENDING lock', () => {
    const startedAt = new Date(Date.now() - STALE_SENDING_MS - 1);
    expect(isStaleSending(SIGNNOW_SEND_SENDING, startedAt)).toBe(true);
    expect(canClaimSendStatus(SIGNNOW_SEND_SENDING, startedAt)).toBe(true);
  });

  it('parses Retry-After seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
  });
});
