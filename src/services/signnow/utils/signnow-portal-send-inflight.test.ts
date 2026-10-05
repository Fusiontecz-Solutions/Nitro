import {
  isPortalSendInFlight,
  trackPortalSend,
  waitForPortalSendToSettle,
} from './signnow-portal-send-inflight';

describe('waitForPortalSendToSettle', () => {
  it('resolves at once when no send is running', async () => {
    await expect(waitForPortalSendToSettle('group-idle', 1_000)).resolves.toBe(true);
  });

  it('waits for the running send to finish', async () => {
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    trackPortalSend('group-running', work);
    const waiting = waitForPortalSendToSettle('group-running', 5_000);
    finish();
    await expect(waiting).resolves.toBe(true);
    await work;
    expect(isPortalSendInFlight('group-running')).toBe(false);
  });

  it('treats a failed send as settled', async () => {
    const work = Promise.reject(new Error('publish failed'));
    trackPortalSend('group-failed', work);
    await expect(waitForPortalSendToSettle('group-failed', 5_000)).resolves.toBe(true);
  });

  it('gives up after the timeout', async () => {
    let finish!: () => void;
    const work = new Promise<void>((resolve) => {
      finish = resolve;
    });
    trackPortalSend('group-slow', work);
    await expect(waitForPortalSendToSettle('group-slow', 10)).resolves.toBe(false);
    finish();
    await work;
  });
});
