import {
  claimSignNowGroupForReview,
  isSignNowGroupClaimedByReview,
} from './signnow-review-group-claims';

/**
 * A background pre-warm must not seed a group a Review has already taken over:
 * its values come from the contract row, so a late warm write put an unticked
 * $25 wire fee back on the disclosure the first Review opened.
 */
describe('Review claims on warmed SignNow groups', () => {
  it('reports a group as claimed once a Review takes it', () => {
    expect(isSignNowGroupClaimedByReview('group-a')).toBe(false);
    claimSignNowGroupForReview('group-a');
    expect(isSignNowGroupClaimedByReview('group-a')).toBe(true);
    expect(isSignNowGroupClaimedByReview(' group-a ')).toBe(true);
  });

  it('keeps other groups free for their own warm', () => {
    claimSignNowGroupForReview('group-b');
    expect(isSignNowGroupClaimedByReview('group-c')).toBe(false);
  });

  it('ignores a blank group id', () => {
    claimSignNowGroupForReview('');
    expect(isSignNowGroupClaimedByReview('')).toBe(false);
  });

  it('lets a claim lapse after a few hours', () => {
    const start = 1_000_000;
    claimSignNowGroupForReview('group-d', start);
    expect(isSignNowGroupClaimedByReview('group-d', start + 60 * 60 * 1000)).toBe(true);
    expect(isSignNowGroupClaimedByReview('group-d', start + 7 * 60 * 60 * 1000)).toBe(false);
  });
});
