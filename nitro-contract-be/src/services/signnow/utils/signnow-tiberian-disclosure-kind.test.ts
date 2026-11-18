/**
 * Tiberian's disclosure is titled just "TIBERIAN FUNDING" — no "disclosure",
 * no "agreement". A merchant publish bakes a document's widget values into page
 * text and deletes the widgets, so on a resend the title is all the classifier
 * has left, and the funder name alone used to make it the Tiberian agreement.
 */
import {
  isSupplementalSignNowDocumentName,
  signNowPrefillDocumentKind,
} from './signnow-field-map';

const DISCLOSURE_WIDGETS = [
  'Text Field 1',
  'estimated_term_p2',
  'disclouser_pg2_frequency',
  'disclosure_page3_net_p3',
];

describe('Tiberian disclosure document classification', () => {
  it('is not the Tiberian agreement once its widgets have been baked away', () => {
    expect(signNowPrefillDocumentKind('TIBERIAN FUNDING', [])).toBeUndefined();
    expect(signNowPrefillDocumentKind('TIBERIAN FUNDING', undefined)).toBeUndefined();
  });

  it('is not the Tiberian agreement while it still has its widgets', () => {
    expect(signNowPrefillDocumentKind('TIBERIAN FUNDING', DISCLOSURE_WIDGETS)).toBeUndefined();
  });

  it('still recognises the Tiberian agreement by title', () => {
    expect(signNowPrefillDocumentKind('CONTRACT TIBERIAN FUNDING (2)', [])).toBe(
      'tiberian_agreement',
    );
  });

  it('still recognises the Tiberian agreement by widget signature alone', () => {
    expect(signNowPrefillDocumentKind('TIBERIAN FUNDING', ['merchant_pg22', 'p1_totalfee'])).toBe(
      'tiberian_agreement',
    );
  });

  it('still recognises the Obsidian and Nitro agreements', () => {
    expect(signNowPrefillDocumentKind('Obsidian Capital Group - Agreement 1', [])).toBe(
      'obsidian_agreement',
    );
    expect(signNowPrefillDocumentKind('Agreement - Nitro Advance', [])).toBeUndefined();
  });

  it('still keeps the other funders\u2019 disclosures out of the agreement layouts', () => {
    expect(signNowPrefillDocumentKind('Disclosure Obsidian Capital Group', [])).toBeUndefined();
    expect(signNowPrefillDocumentKind('Tiberian Funding - Disclosure', [])).toBeUndefined();
  });

  it('documents why the name-based template lookup could not save it', () => {
    // This is the gap the origin-document-id restore now covers: the title
    // carries none of the supplemental keywords, so the name-driven resolution
    // fell through to the agreement template.
    expect(isSupplementalSignNowDocumentName('TIBERIAN FUNDING')).toBe(false);
    expect(isSupplementalSignNowDocumentName('Tiberian Funding - Disclosure')).toBe(true);
  });
});
