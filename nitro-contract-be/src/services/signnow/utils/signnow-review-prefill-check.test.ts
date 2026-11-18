import {
  describeIncompleteReviewPrefill,
  incompleteReviewPrefillDocuments,
  missingReviewPrefillFields,
  readSignNowWidgetValues,
  requiredReviewPrefillFields,
  reviewPrefillIsComplete,
  type SignNowReviewPrefillCheck,
} from './signnow-review-prefill-check';

const check = (over: Partial<SignNowReviewPrefillCheck> = {}): SignNowReviewPrefillCheck => ({
  documentId: 'doc-1',
  documentName: 'Disclosure',
  missing: [],
  unreadable: false,
  withoutFields: false,
  ...over,
});

describe('readSignNowWidgetValues', () => {
  it('reads prefilled_text from json_attributes, as prefill-texts leaves it', () => {
    const values = readSignNowWidgetValues({
      fields: [
        { type: 'text', json_attributes: { name: 'business_name', prefilled_text: 'Acme LLC' } },
        { type: 'text', json_attributes: JSON.stringify({ name: 'Offer Amount', prefilled_text: '$10,000.00' }) },
      ],
    });
    expect(values.get('business_name')).toBe('Acme LLC');
    expect(values.get('offer amount')).toBe('$10,000.00');
  });

  it('ignores signature widgets and SignNow placeholder text', () => {
    const values = readSignNowWidgetValues({
      fields: [
        { type: 'signature', json_attributes: { name: 'owner_sig', prefilled_text: 'x' } },
        { type: 'text', json_attributes: { name: 'phone', prefilled_text: 'Enter text' } },
      ],
    });
    expect(values.size).toBe(0);
  });

  it('treats a missing or half-loaded document as having no values', () => {
    expect(readSignNowWidgetValues(null).size).toBe(0);
    expect(readSignNowWidgetValues({}).size).toBe(0);
  });
});

describe('requiredReviewPrefillFields', () => {
  it('requires every widget the prefill wrote to', () => {
    expect(
      requiredReviewPrefillFields({
        resolvable: ['business_name', 'phone'],
        planned: ['business_name', 'phone'],
        written: ['business_name', 'phone'],
      }),
    ).toEqual(['business_name', 'phone']);
  });

  it('requires widgets the stale snapshot did not know about', () => {
    // The first-click bug: the addendum's bank widgets arrived after the
    // snapshot the prefill was planned from, so they were never written.
    expect(
      requiredReviewPrefillFields({
        resolvable: ['business_name', 'bank_name', 'routing_number'],
        planned: ['business_name'],
        written: ['business_name'],
      }),
    ).toEqual(['business_name', 'bank_name', 'routing_number']);
  });

  it('does not require a widget the prefill saw but deliberately left blank', () => {
    // e.g. a value SignNow's validator refused and the write dropped —
    // demanding it would block Review forever.
    expect(
      requiredReviewPrefillFields({
        resolvable: ['business_name', 'ssn'],
        planned: ['business_name', 'ssn'],
        written: ['business_name'],
      }),
    ).toEqual(['business_name']);
  });

  it('matches names case-insensitively and without duplicates', () => {
    expect(
      requiredReviewPrefillFields({
        resolvable: ['Business_Name', 'business_name'],
        planned: ['business_name'],
        written: ['BUSINESS_NAME'],
      }),
    ).toEqual(['Business_Name']);
  });
});

describe('missingReviewPrefillFields', () => {
  it('lists required widgets that read back empty', () => {
    const remote = {
      fields: [
        { type: 'text', json_attributes: { name: 'business_name', prefilled_text: 'Acme LLC' } },
        { type: 'text', json_attributes: { name: 'bank_name' } },
      ],
    };
    expect(missingReviewPrefillFields(remote, ['business_name', 'bank_name', 'routing_number'])).toEqual([
      'bank_name',
      'routing_number',
    ]);
  });

  it('is empty once every required widget carries a value', () => {
    const remote = {
      fields: [{ type: 'text', json_attributes: { name: 'bank_name', prefilled_text: 'Chase' } }],
    };
    expect(missingReviewPrefillFields(remote, ['bank_name'])).toEqual([]);
  });

  it('treats a 0.00 placeholder as empty where the CRM holds a real amount', () => {
    const remote = {
      fields: [
        { type: 'text', json_attributes: { name: 'Text Field 1', prefilled_text: '0.00' } },
        { type: 'text', json_attributes: { name: 'Text Field 3', prefilled_text: '180.00' } },
        { type: 'text', json_attributes: { name: 'disclosure_page3_line_2_p3', prefilled_text: '0.00' } },
        { type: 'text', json_attributes: { name: 'client_name', prefilled_text: '0' } },
      ],
    };
    expect(
      missingReviewPrefillFields(
        remote,
        ['Text Field 1', 'Text Field 3', 'disclosure_page3_line_2_p3', 'client_name'],
        {
          'Text Field 1': '50,000.00',
          'Text Field 3': '180.00',
          // Zero is the real amount on a deal with no refinance.
          disclosure_page3_line_2_p3: '0.00',
          client_name: 'ACME LLC',
        },
      ),
    ).toEqual(['Text Field 1']);
  });
});

describe('reviewPrefillIsComplete', () => {
  it('is complete only when no document is empty, unread or field-less', () => {
    expect(reviewPrefillIsComplete([check(), check({ documentId: 'doc-2' })])).toBe(true);
    expect(reviewPrefillIsComplete([check({ missing: ['bank_name'] })])).toBe(false);
    expect(reviewPrefillIsComplete([check({ unreadable: true })])).toBe(false);
    expect(reviewPrefillIsComplete([check({ withoutFields: true })])).toBe(false);
  });

  it('picks out only the incomplete documents', () => {
    const rows = [check(), check({ documentId: 'doc-2', missing: ['x'] })];
    expect(incompleteReviewPrefillDocuments(rows).map((c) => c.documentId)).toEqual(['doc-2']);
  });
});

describe('describeIncompleteReviewPrefill', () => {
  it('names each incomplete document and why', () => {
    const msg = describeIncompleteReviewPrefill([
      check(),
      check({ documentName: 'Contract', missing: ['a'] }),
      check({ documentName: 'Exhibit C', missing: ['a', 'b'] }),
      check({ documentName: 'Addendum', withoutFields: true }),
      check({ documentName: '', documentId: 'doc-9', unreadable: true }),
    ]);
    expect(msg).toContain('not opened');
    expect(msg).toContain('Contract (1 field empty)');
    expect(msg).toContain('Exhibit C (2 fields empty)');
    expect(msg).toContain('Addendum (fields not loaded yet)');
    expect(msg).toContain('doc-9 (could not be read back)');
    expect(msg).not.toContain('Disclosure');
  });
});
