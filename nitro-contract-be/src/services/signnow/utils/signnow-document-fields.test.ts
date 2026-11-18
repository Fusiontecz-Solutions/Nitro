import {
  countSignNowDocumentFields,
  isEmptySignNowFieldsError,
  signNowOriginDocumentId,
} from './signnow-document-fields';

describe('countSignNowDocumentFields', () => {
  it('counts every fillable container', () => {
    expect(
      countSignNowDocumentFields({
        fields: [{ type: 'text' }, { type: 'signature' }],
        checks: [{ type: 'checkbox' }],
        radiobuttons: [],
      }),
    ).toBe(3);
  });

  it('does not count committed page text as fields', () => {
    // A merchant publish bakes CRM values into `texts`; an embedded invite still
    // needs a real widget, so a document with only stamps counts as empty.
    expect(countSignNowDocumentFields({ fields: [], texts: [{ data: '$10,000.00' }] })).toBe(0);
  });

  it('treats a missing or half-loaded document as empty', () => {
    expect(countSignNowDocumentFields(null)).toBe(0);
    expect(countSignNowDocumentFields({})).toBe(0);
  });
});

describe('isEmptySignNowFieldsError', () => {
  it('matches the SignNow rejection the review link failed with', () => {
    expect(
      isEmptySignNowFieldsError(
        'At least one document in document group must contain fields.',
      ),
    ).toBe(true);
  });

  it('ignores unrelated failures', () => {
    expect(isEmptySignNowFieldsError('Role Recipient 1 was not specified')).toBe(false);
    expect(isEmptySignNowFieldsError('')).toBe(false);
  });
});

describe('signNowOriginDocumentId', () => {
  it('reads the template document a copy was made from', () => {
    expect(signNowOriginDocumentId({ origin_document_id: 'abc123' })).toBe('abc123');
    expect(signNowOriginDocumentId({})).toBe('');
    expect(signNowOriginDocumentId(undefined)).toBe('');
  });
});
