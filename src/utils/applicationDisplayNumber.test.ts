import { resolveApplicationDisplayNumber } from './applicationDisplayNumber';

describe('resolveApplicationDisplayNumber', () => {
  it('prefers the deal id shown in the CRM list', () => {
    expect(resolveApplicationDisplayNumber({ dealId: ' 331 ', applicationId: 10428 })).toBe('331');
  });

  it('keeps funder-prefixed deal ids as-is', () => {
    expect(resolveApplicationDisplayNumber({ dealId: 'WF331', applicationId: 10428 })).toBe('WF331');
  });

  it('falls back to applicationId when no deal id is set', () => {
    expect(resolveApplicationDisplayNumber({ dealId: '  ', applicationId: 10428 })).toBe('10428');
    expect(resolveApplicationDisplayNumber({ applicationId: 7 })).toBe('7');
  });

  it('returns empty string when nothing is available', () => {
    expect(resolveApplicationDisplayNumber(null)).toBe('');
    expect(resolveApplicationDisplayNumber({})).toBe('');
  });
});
